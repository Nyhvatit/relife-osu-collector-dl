import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import MirrorRuntime, { MAX_MIRROR_WINDOW } from "../src/core/MirrorRuntime";
import { Mirror } from "../src/struct/Constant";

const M = Mirror.Catboy;

describe("MirrorRuntime counters / ban / snapshot", () => {
  it("counts ok/fail/notfound and tracks in-flight via setActive", () => {
    const r = new MirrorRuntime([M]);
    r.note(M, "ok");
    r.note(M, "ok");
    r.note(M, "fail");
    r.note(M, "notfound");
    r.setActive(M, 1);
    expect(r.statsOf(M)).toEqual({ ok: 2, fail: 1, notfound: 1 });
    expect(r.activeOf(M)).toBe(1);
    r.setActive(M, -1);
    expect(r.activeOf(M)).toBe(0);
  });

  it("snapshots every known mirror with its ban state", () => {
    const r = new MirrorRuntime([M]);
    r.note(M, "ok");
    r.ban(M);
    expect(r.isBanned(M)).toBe(true);
    expect(r.snapshot()).toEqual([
      { mirror: M, ok: 1, fail: 0, active: 0, notfound: 0, banned: true },
    ]);
  });
});

describe("MirrorRuntime AIMD window", () => {
  it("starts at 2 and additively increases on saturated, low-latency success", () => {
    const r = new MirrorRuntime([M]);
    expect(r.windowOf(M)).toBe(2);
    r.recordSuccess(M, true, 100);
    expect(r.windowOf(M)).toBeCloseTo(2.5);
    r.recordSuccess(M, true, 100);
    expect(r.windowOf(M)).toBeCloseTo(2.9);
  });

  it("does not grow when not saturated or when latency is climbing", () => {
    const r = new MirrorRuntime([M]);
    r.recordSuccess(M, true, 100);
    r.recordSuccess(M, false, 100);
    expect(r.windowOf(M)).toBeCloseTo(2.5);
    r.recordSuccess(M, true, 1000);
    expect(r.windowOf(M)).toBeCloseTo(2.5);
  });

  it("multiplicatively decreases on congestion, clamped at 1", () => {
    const r = new MirrorRuntime([M]);
    for (let i = 0; i < 6; i++) r.recordSuccess(M, true, 50);
    const grown = r.windowOf(M);
    expect(grown).toBeGreaterThan(3);
    r.recordFailure(M);
    expect(r.windowOf(M)).toBeCloseTo(grown * 0.5);
    for (let i = 0; i < 10; i++) r.recordRateLimited(M);
    expect(r.windowOf(M)).toBe(1);
  });

  it("never grows past the safety ceiling", () => {
    const r = new MirrorRuntime([M]);
    for (let i = 0; i < 200; i++) r.recordSuccess(M, true, 10);
    expect(r.windowOf(M)).toBeLessThanOrEqual(MAX_MIRROR_WINDOW);
    expect(r.windowOf(M)).toBeGreaterThan(MAX_MIRROR_WINDOW - 1);
  });

  it("gates dispatch on ban, cooldown and the window slots", () => {
    const r = new MirrorRuntime([M]);
    expect(r.isDispatchable(M, 0)).toBe(true);
    expect(r.wouldSaturate(M)).toBe(false);
    r.setActive(M, 1);
    expect(r.wouldSaturate(M)).toBe(true);
    r.setActive(M, 1);
    expect(r.isDispatchable(M, 0)).toBe(false);
    r.setActive(M, -2);
    r.ban(M);
    expect(r.isDispatchable(M, 0)).toBe(false);
  });

  it("arms catboy's per-minute rate cap on dispatch, but never throttles other mirrors", () => {
    const r = new MirrorRuntime([Mirror.Catboy, Mirror.Sayobot]);
    expect(r.isDispatchable(Mirror.Catboy, 0)).toBe(true);
    r.recordDispatch(Mirror.Catboy, 0);
    expect(r.isDispatchable(Mirror.Catboy, 500)).toBe(false);
    expect(r.isDispatchable(Mirror.Catboy, 2000)).toBe(true);
    r.recordDispatch(Mirror.Sayobot, 0);
    expect(r.isDispatchable(Mirror.Sayobot, 1)).toBe(true);
  });
});

describe("MirrorRuntime rate-limit backoff & health", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it("rests with exponential backoff 1→2→3 min and notifies", () => {
    const rl: Mirror[] = [];
    const r = new MirrorRuntime([M], { onRateLimited: (m) => rl.push(m) });
    r.recordRateLimited(M);
    expect(r.isCooling(M, 59_999)).toBe(true);
    expect(r.isCooling(M, 60_001)).toBe(false);
    vi.setSystemTime(60_001);
    r.recordRateLimited(M);
    expect(r.isCooling(M, 180_000)).toBe(true);
    expect(r.isCooling(M, 180_002)).toBe(false);
    expect(rl).toEqual([M, M]);
  });

  it("resets the backoff streak after a success", () => {
    const r = new MirrorRuntime([M]);
    r.recordRateLimited(M);
    r.recordRateLimited(M);
    r.recordSuccess(M, false, 100);
    r.recordRateLimited(M);
    expect(r.isCooling(M, 59_999)).toBe(true);
    expect(r.isCooling(M, 60_001)).toBe(false);
  });

  it("benches a mirror whose recent success rate falls below 30%", () => {
    const r = new MirrorRuntime([Mirror.Sayobot]);
    for (let i = 0; i < 8; i++) r.recordFailure(Mirror.Sayobot);
    expect(r.isCooling(Mirror.Sayobot, 89_999)).toBe(true);
    expect(r.isCooling(Mirror.Sayobot, 90_001)).toBe(false);
  });

  it("does not bench before 8 samples or at/above 30% success", () => {
    const r = new MirrorRuntime([Mirror.OsuDirect]);
    for (let i = 0; i < 7; i++) r.recordFailure(Mirror.OsuDirect);
    expect(r.isCooling(Mirror.OsuDirect, 1)).toBe(false);

    const r2 = new MirrorRuntime([Mirror.Nekoha]);
    const pattern = [true, true, true, false, false, false, false, false];
    for (const ok of pattern) {
      if (ok) r2.recordSuccess(Mirror.Nekoha, false, 100);
      else r2.recordFailure(Mirror.Nekoha);
    }
    expect(r2.isCooling(Mirror.Nekoha, 1)).toBe(false);
  });

  it("recordApproachingLimit rests proactively and shrinks the window", () => {
    const rl: Mirror[] = [];
    const r = new MirrorRuntime([M], { onRateLimited: (m) => rl.push(m) });
    r.recordSuccess(M, true, 50);
    r.recordApproachingLimit(M);
    expect(r.windowOf(M)).toBeCloseTo(1.25);
    expect(r.isCooling(M, 59_999)).toBe(true);
    expect(rl).toEqual([M]);
  });

  it("reports cooldownRemaining counting down to 0 across the rest, never negative", () => {
    const r = new MirrorRuntime([M]);
    expect(r.cooldownRemaining(M, 0)).toBe(0);
    r.recordRateLimited(M);
    expect(r.cooldownRemaining(M, 0)).toBe(60_000);
    expect(r.cooldownRemaining(M, 20_000)).toBe(40_000);
    expect(r.cooldownRemaining(M, 60_000)).toBe(0);
    expect(r.cooldownRemaining(M, 99_999)).toBe(0);
  });
});
