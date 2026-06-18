import { Mirror } from "../struct/Constant";
import { MirrorStatsView } from "../types";

interface MirrorState {
  ok: number;
  fail: number;
  notfound: number;
  active: number;
  banned: boolean;
  cooldownUntil: number;
  window: number;
  baseRttMs: number;
  rateLimitStreak: number;
  recent: boolean[];
}

const MIN_WINDOW = 1;
export const MAX_MIRROR_WINDOW = 8;
const START_WINDOW = 2;
const MD_FACTOR = 0.5;
const LATENCY_GRADIENT = 2.0;

const RL_BACKOFF_BASE = 60e3;
const RL_BACKOFF_CAP = 180e3;
const SOFT_RL_COOLDOWN = 60e3;

const CATBOY_MIN_START_INTERVAL_MS = 1050;

const HEALTH_WINDOW = 12;
const HEALTH_MIN_SAMPLES = 8;
const HEALTH_MIN_RATE = 0.3;
const UNHEALTHY_BENCH = 90e3;

export interface MirrorRuntimeHooks {
  onRateLimited?: (mirror: Mirror) => void;
  onEvent?: (msg: string) => void;
}

export default class MirrorRuntime {
  private readonly states = new Map<Mirror, MirrorState>();
  private hooks: MirrorRuntimeHooks;

  constructor(mirrors: Mirror[], hooks: MirrorRuntimeHooks = {}) {
    this.hooks = hooks;
    for (const m of mirrors) this.states.set(m, MirrorRuntime.fresh());
  }

  private static fresh(): MirrorState {
    return {
      ok: 0,
      fail: 0,
      notfound: 0,
      active: 0,
      banned: false,
      cooldownUntil: 0,
      window: START_WINDOW,
      baseRttMs: Infinity,
      rateLimitStreak: 0,
      recent: [],
    };
  }

  private state(mirror: Mirror): MirrorState {
    let s = this.states.get(mirror);
    if (!s) {
      s = MirrorRuntime.fresh();
      this.states.set(mirror, s);
    }
    return s;
  }

  setEventSink(onEvent: (msg: string) => void): void {
    this.hooks = { ...this.hooks, onEvent };
  }

  note(mirror: Mirror, key: "ok" | "fail" | "notfound"): void {
    this.state(mirror)[key]++;
  }

  setActive(mirror: Mirror, delta: number): void {
    this.state(mirror).active += delta;
  }

  activeOf(mirror: Mirror): number {
    return this.states.get(mirror)?.active ?? 0;
  }

  ban(mirror: Mirror): void {
    this.state(mirror).banned = true;
  }

  isBanned(mirror: Mirror): boolean {
    return this.states.get(mirror)?.banned ?? false;
  }

  windowOf(mirror: Mirror): number {
    return this.state(mirror).window;
  }

  isCooling(mirror: Mirror, now = Date.now()): boolean {
    return this.state(mirror).cooldownUntil > now;
  }

  cooldownRemaining(mirror: Mirror, now = Date.now()): number {
    return Math.max(0, this.state(mirror).cooldownUntil - now);
  }

  isDispatchable(mirror: Mirror, now = Date.now()): boolean {
    const s = this.state(mirror);
    return !s.banned && s.cooldownUntil <= now && s.active < Math.floor(s.window);
  }

  wouldSaturate(mirror: Mirror): boolean {
    const s = this.state(mirror);
    return s.active + 1 >= Math.floor(s.window);
  }

  recordDispatch(mirror: Mirror, now = Date.now()): void {
    if (mirror !== Mirror.Catboy) return;
    const s = this.state(mirror);
    const until = now + CATBOY_MIN_START_INTERVAL_MS;
    if (until > s.cooldownUntil) s.cooldownUntil = until;
  }

  recordSuccess(mirror: Mirror, saturated: boolean, rttMs: number): void {
    const s = this.state(mirror);
    if (rttMs < s.baseRttMs) s.baseRttMs = rttMs;
    const latencyOk = rttMs <= s.baseRttMs * LATENCY_GRADIENT;
    if (saturated && latencyOk && s.window < MAX_MIRROR_WINDOW) {
      s.window = Math.min(MAX_MIRROR_WINDOW, s.window + 1 / s.window);
    }
    s.rateLimitStreak = 0;
    this.recordHealth(mirror, true);
  }

  recordFailure(mirror: Mirror): void {
    this.decreaseWindow(this.state(mirror));
    this.recordHealth(mirror, false);
  }

  recordRateLimited(mirror: Mirror): void {
    const s = this.state(mirror);
    this.decreaseWindow(s);
    const n = ++s.rateLimitStreak;
    const wait = Math.min(RL_BACKOFF_BASE * 2 ** (n - 1), RL_BACKOFF_CAP);
    s.cooldownUntil = Date.now() + wait;
    this.hooks.onEvent?.(
      `${mirror} 429 -> window ${s.window.toFixed(1)}, cooldown ${Math.round(wait / 1000)}s (streak ${n})`
    );
    this.hooks.onRateLimited?.(mirror);
  }

  recordApproachingLimit(mirror: Mirror): void {
    const s = this.state(mirror);
    this.decreaseWindow(s);
    s.cooldownUntil = Math.max(s.cooldownUntil, Date.now() + SOFT_RL_COOLDOWN);
    this.hooks.onEvent?.(
      `${mirror} approaching limit -> window ${s.window.toFixed(1)}, rest ${SOFT_RL_COOLDOWN / 1000}s`
    );
    this.hooks.onRateLimited?.(mirror);
  }

  notifyRateLimited(mirror: Mirror): void {
    this.hooks.onRateLimited?.(mirror);
  }

  private decreaseWindow(s: MirrorState): void {
    s.window = Math.max(MIN_WINDOW, s.window * MD_FACTOR);
  }

  private recordHealth(mirror: Mirror, ok: boolean): void {
    const s = this.state(mirror);
    s.recent.push(ok);
    if (s.recent.length > HEALTH_WINDOW) s.recent.shift();
    if (s.recent.length >= HEALTH_MIN_SAMPLES) {
      const successes = s.recent.filter(Boolean).length;
      if (successes / s.recent.length < HEALTH_MIN_RATE) {
        s.cooldownUntil = Date.now() + UNHEALTHY_BENCH;
        s.recent.length = 0;
        this.hooks.onEvent?.(
          `${mirror} benched ${UNHEALTHY_BENCH / 1000}s (health ${successes}/${HEALTH_WINDOW} too low)`
        );
      }
    }
  }

  statsOf(mirror: Mirror): { ok: number; fail: number; notfound: number } {
    const s = this.states.get(mirror);
    return s ? { ok: s.ok, fail: s.fail, notfound: s.notfound } : { ok: 0, fail: 0, notfound: 0 };
  }

  snapshot(): MirrorStatsView[] {
    return Array.from(this.states.entries()).map(([mirror, s]) => ({
      mirror,
      ok: s.ok,
      fail: s.fail,
      active: s.active,
      notfound: s.notfound,
      banned: s.banned,
    }));
  }
}
