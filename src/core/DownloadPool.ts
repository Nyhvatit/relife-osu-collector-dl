import { BeatMapSet } from "../struct/BeatMapSet";
import { Mirror, getFallbackMirrors } from "../struct/Constant";
import { config } from "../state";
import RunDiagnostics from "./RunDiagnostics";
import MirrorRuntime from "./MirrorRuntime";

export type DownloadOutcome =
  | "ok"
  | "rateLimited"
  | "banned"
  | "unavailable"
  | "notfound"
  | "fail";

export const MAX_DOWNLOAD_ATTEMPTS = 25;

const MAX_RATE_LIMIT_HITS = 3;

export interface PoolHost {
  existingIds(): Set<number> | null;
  attemptDownload(set: BeatMapSet, mirror: Mirror): Promise<DownloadOutcome>;
  pending(): Map<number, BeatMapSet>;
  countDownloaded(): void;
  downloadedCount(): number;
  emitSkipped(set: BeatMapSet): void;
  emitError(set: BeatMapSet, reason: unknown): void;
  emitRetrying(set: BeatMapSet): void;
  emitEnd(sets: BeatMapSet[]): void;
}

interface PoolJob {
  set: BeatMapSet;
  failed: Set<Mirror>;
  attempts: number;
  rlHits: number;
  claimed: boolean;
}

export default class DownloadPool {
  private readonly jobs = new Map<number, PoolJob>();
  private readonly mirrors: Mirror[];
  private readonly diag = new RunDiagnostics();
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly host: PoolHost,
    private readonly runtime: MirrorRuntime
  ) {
    this.mirrors = Array.from(
      new Set<Mirror>([config.mirror, ...getFallbackMirrors(config.mirror)])
    ).filter((m) => !runtime.isBanned(m));
    this.runtime.setEventSink((msg) => this.diag.event(msg));
  }

  async run(): Promise<void> {
    this.skipExisting();
    this.buildJobs();

    while (this.jobs.size > 0) {
      for (let pick = this.pickAssignment(); pick; pick = this.pickAssignment()) {
        this.startAttempt(pick);
      }

      if (this.inFlight.size > 0) {
        await this.waitForSlotOrCooldown();
        continue;
      }

      this.reapDeadJobs();
      if (this.jobs.size === 0) break;
      const delay = this.nextCooldownDelay();
      if (delay === Infinity) {
        for (const job of [...this.jobs.values()]) {
          this.giveUp(job, "No mirror could provide this map");
        }
        break;
      }
      this.diag.idle();
      await this.sleep(delay);
    }

    await Promise.all([...this.inFlight]);

    const notDownloaded = [...this.host.pending().values()];
    this.diag.dump(
      this.mirrors,
      (m) => this.runtime.statsOf(m),
      (m) => this.runtime.isBanned(m),
      this.host.downloadedCount(),
      notDownloaded.length
    );
    this.host.emitEnd(notDownloaded);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  private skipExisting(): void {
    const existing = this.host.existingIds();
    const pending = this.host.pending();
    for (const set of Array.from(pending.values())) {
      if (existing?.has(set.id)) {
        this.host.countDownloaded();
        this.host.emitSkipped(set);
        pending.delete(set.id);
      }
    }
  }

  private buildJobs(): void {
    for (const set of this.host.pending().values()) {
      this.jobs.set(set.id, { set, failed: new Set<Mirror>(), attempts: 0, rlHits: 0, claimed: false });
    }
  }

  private candidatesFor(job: PoolJob): Mirror[] {
    return this.mirrors.filter((m) => !this.runtime.isBanned(m) && !job.failed.has(m));
  }

  private claimJobFor(mirror: Mirror): PoolJob | null {
    for (const job of this.jobs.values()) {
      if (job.claimed || job.failed.has(mirror)) continue;
      job.claimed = true;
      return job;
    }
    return null;
  }

  private pickAssignment(): { mirror: Mirror; job: PoolJob; saturated: boolean } | null {
    const now = Date.now();
    const usable = this.mirrors
      .filter((m) => this.runtime.isDispatchable(m, now))
      .sort((a, b) => this.runtime.activeOf(a) - this.runtime.activeOf(b));
    for (const mirror of usable) {
      const saturated = this.runtime.wouldSaturate(mirror);
      const job = this.claimJobFor(mirror);
      if (job) return { mirror, job, saturated };
    }
    return null;
  }

  private giveUp(job: PoolJob, reason: unknown): void {
    this.diag.giveUp(job.set.id, String(reason), job.attempts, job.rlHits, Array.from(job.failed));
    this.jobs.delete(job.set.id);
    this.host.emitError(job.set, reason);
  }

  private startAttempt(pick: { mirror: Mirror; job: PoolJob; saturated: boolean }): void {
    const { mirror, job, saturated } = pick;
    job.attempts++;
    this.runtime.recordDispatch(mirror);
    const tAttempt = Date.now();
    const tracked = this.host
      .attemptDownload(job.set, mirror)
      .then((outcome) => {
        const ms = Date.now() - tAttempt;
        this.diag.download(mirror, outcome === "ok", ms);
        this.handleOutcome(outcome, mirror, job, saturated, ms);
      })
      .catch(() => {
        job.claimed = false;
      });
    this.inFlight.add(tracked);
    tracked.finally(() => this.inFlight.delete(tracked));
  }

  private waitForSlotOrCooldown(): Promise<void> {
    const signals: Promise<unknown>[] = [...this.inFlight];
    const delay = this.nextCooldownDelay();
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (delay !== Infinity) {
      signals.push(new Promise<void>((resolve) => (timer = setTimeout(resolve, delay))));
    }
    return Promise.race(signals).then(() => {
      if (timer) clearTimeout(timer);
    });
  }

  private nextCooldownDelay(now = Date.now()): number {
    let min = Infinity;
    for (const m of this.mirrors) {
      if (this.runtime.isBanned(m) || !this.runtime.isCooling(m, now)) continue;
      min = Math.min(min, this.runtime.cooldownRemaining(m, now));
    }
    return min === Infinity ? Infinity : min + 1;
  }

  private reapDeadJobs(): void {
    for (const job of this.jobs.values()) {
      if (!job.claimed && this.candidatesFor(job).length === 0) {
        this.giveUp(job, "No mirror could provide this map");
      }
    }
  }

  private handleOutcome(
    outcome: DownloadOutcome,
    mirror: Mirror,
    job: PoolJob,
    saturated: boolean,
    rttMs: number
  ): void {
    if (outcome === "ok") {
      this.jobs.delete(job.set.id);
      this.host.pending().delete(job.set.id);
      this.runtime.recordSuccess(mirror, saturated, rttMs);
      return;
    }

    if (outcome === "rateLimited") {
      this.diag.rateLimit(mirror);
      if (mirror === Mirror.Beatconnect) {
        this.runtime.ban(mirror);
        this.diag.event(`${mirror} BANNED (first 429 — dropped for the run)`);
        this.runtime.notifyRateLimited(mirror);
        job.claimed = false;
        this.reapDeadJobs();
        return;
      }
      this.runtime.recordRateLimited(mirror);
      job.claimed = false;
      if (++job.rlHits >= MAX_RATE_LIMIT_HITS) {
        this.giveUp(job, "Mirror kept rate-limiting this map");
      }
      return;
    }

    if (outcome === "banned") {
      this.runtime.ban(mirror);
      this.diag.event(`${mirror} BANNED (403/418 — blocked for the run)`);
      job.claimed = false;
      this.reapDeadJobs();
      return;
    }

    if (outcome === "unavailable") {
      this.giveUp(job, "Beatmap is unavailable (451)");
      return;
    }

    if (outcome === "notfound") {
      job.failed.add(mirror);
      job.claimed = false;
      if (job.attempts >= MAX_DOWNLOAD_ATTEMPTS || this.candidatesFor(job).length === 0) {
        this.giveUp(job, "No mirror has this beatmap");
      }
      return;
    }

    job.failed.add(mirror);
    job.claimed = false;
    this.runtime.recordFailure(mirror);
    if (job.attempts >= MAX_DOWNLOAD_ATTEMPTS || this.candidatesFor(job).length === 0) {
      this.giveUp(job, "No mirror could provide this map");
    } else {
      this.host.emitRetrying(job.set);
    }
  }
}
