import { existsSync, readdirSync } from "fs";
import EventEmitter from "events";
import { BeatMapSet } from "../struct/BeatMapSet";
import { collection, config } from "../state";
import PQueue from "p-queue";
import { Requestor } from "./Requestor";
import { streamResponseToOsz } from "./OszFile";
import DownloadPool, { MAX_DOWNLOAD_ATTEMPTS, DownloadOutcome, PoolHost } from "./DownloadPool";
import MirrorRuntime from "./MirrorRuntime";
import { MirrorStatsView } from "../types";
import { Mirror, getFallbackMirrors, mirrorHasRateLimit } from "../struct/Constant";

interface DownloadManagerEvents {
  downloaded: (beatMapSet: BeatMapSet) => void;
  skipped: (beatMapSet: BeatMapSet) => void;
  error: (beatMapSet: BeatMapSet, e: unknown) => void;
  retrying: (beatMapSet: BeatMapSet) => void;
  downloading: (beatMapSet: BeatMapSet) => void;
  rateLimited: (mirror: Mirror) => void;
  dailyRateLimited: (beatMapSets: BeatMapSet[]) => void;
  blocked: (beatMapSets: BeatMapSet[]) => void;
  unavailable: (beatMapSets: BeatMapSet[]) => void;
  end: (beatMapSets: BeatMapSet[]) => void;
}

export declare interface DownloadManager {
  on<U extends keyof DownloadManagerEvents>(
    event: U,
    listener: DownloadManagerEvents[U]
  ): this;

  emit<U extends keyof DownloadManagerEvents>(
    event: U,
    ...args: Parameters<DownloadManagerEvents[U]>
  ): boolean;
}

const DOWNLOAD_STALL_TIMEOUT = 20e3;
const RESPONSE_TIMEOUT = 10e3;
const IDLE_TIMEOUT = 15e3;

export class DownloadManager extends EventEmitter {
  path: string;
  private queue: PQueue;
  private downloadedBeatMapSetSize = 0;
  private existingBeatmapsetIds: Set<number> | null = null;
  private remainingDownloadsLimit: number | null;
  private lastDownloadsLimitCheck: number | null = null;
  private testRequest = false;
  private readonly mirrors: MirrorRuntime;
  private pending = new Map<number, BeatMapSet>();

  constructor(remainingDownloadsLimit: number | null) {
    super();

    this.remainingDownloadsLimit = remainingDownloadsLimit;

    this.mirrors = new MirrorRuntime(
      Array.from(new Set<Mirror>([config.mirror, ...getFallbackMirrors(config.mirror)])),
      { onRateLimited: (m) => this.emit("rateLimited", m) }
    );

    this.path = config.getDownloadPath(collection);

    const noRateLimit = !mirrorHasRateLimit(config.mirror);
    this.queue = !noRateLimit
      ? new PQueue({
          concurrency: config.parallel ? config.concurrency : 1,
          intervalCap: config.intervalCap,
          interval: 60e3,
        })
      : new PQueue({
          concurrency: config.parallel ? config.concurrency : 1,
        });
  }

  private _buildExistingIds(): void {
    if (config.skipExisting && existsSync(this.path)) {
      this.existingBeatmapsetIds = new Set<number>();
      try {
        const entries = readdirSync(this.path);
        for (const entry of entries) {
          const match = entry.match(/^(\d+)\s/);
          if (match) {
            this.existingBeatmapsetIds.add(parseInt(match[1]));
          }
        }
      } catch {
        this.existingBeatmapsetIds = null;
      }
    }
  }

  public bulkDownload(): void {
    this.pending = new Map(collection.beatMapSets);
    this._buildExistingIds();

    if (config.mirrorRotation) {
      this._bulkDownloadPool().catch(() => {
        this.emit("end", this.getNotDownloadedBeatMapSets());
      });
      return;
    }

    this.pending.forEach((beatMapSet) => {
      void this.queue.add(async () => {
        if (this.existingBeatmapsetIds?.has(beatMapSet.id)) {
          this.downloadedBeatMapSetSize++;
          this.emit("skipped", beatMapSet);
          this.pending.delete(beatMapSet.id);
          return;
        }

        const success = await this._downloadFile(beatMapSet);
        if (success) {
          this.pending.delete(beatMapSet.id);
        }
      });
    });

    this.queue.on("idle", () => {
      this.emit("end", this.getNotDownloadedBeatMapSets());
    });

    this.on("rateLimited", () => {
      if (!this.queue.isPaused) {
        this.testRequest = true;
        this.queue.pause();
        this.queue.concurrency = 1;
        setTimeout(() => this.queue.start(), 60e3);
      }
    });
  }

  public getDownloadedBeatMapSetSize() {
    return this.downloadedBeatMapSetSize;
  }

  public getRemainingDownloadsLimit() {
    return this.remainingDownloadsLimit;
  }

  public getMirrorStats(): MirrorStatsView[] {
    return this.mirrors.snapshot();
  }

  private requeueDownload(
    beatMapSet: BeatMapSet,
    options: { remainingMirrors?: Mirror[]; attempts?: number }
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.queue.add(async () => {
      const success = await this._downloadFile(beatMapSet, options);
      if (success) this.pending.delete(beatMapSet.id);
    });
  }

  private async _downloadFile(
    beatMapSet: BeatMapSet,
    options: { remainingMirrors?: Mirror[]; attempts?: number } = {}
  ): Promise<boolean> {
    const attempt = (options.attempts ?? 0) + 1;
    if (attempt > MAX_DOWNLOAD_ATTEMPTS) {
      this.emit(
        "error",
        beatMapSet,
        `No mirror provided this map (gave up after ${MAX_DOWNLOAD_ATTEMPTS} attempts)`
      );
      return false;
    }

    let allMirrors: Mirror[];
    if (options.remainingMirrors !== undefined) {
      allMirrors = options.remainingMirrors.filter(m => !this.mirrors.isBanned(m));
    } else {
      const fallbacks = getFallbackMirrors(config.mirror).filter(m => !this.mirrors.isBanned(m));
      allMirrors = this.mirrors.isBanned(config.mirror)
        ? fallbacks
        : [config.mirror, ...fallbacks];
    }

    if (allMirrors.length === 0) {
      this.emit("error", beatMapSet, "All mirrors are banned");
      return false;
    }

    const currentMirror = allMirrors[0];
    const nextMirrors = allMirrors.slice(1);

    let isProbeRequest = false;
    if (this.testRequest) {
      isProbeRequest = true;
      this.testRequest = false;
    }

    this.mirrors.setActive(currentMirror, 1);

    const controller = new AbortController();
    let stallTimer = setTimeout(() => controller.abort(), DOWNLOAD_STALL_TIMEOUT);
    const resetStall = (): void => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => controller.abort(), DOWNLOAD_STALL_TIMEOUT);
    };
    try {
      this.emit("downloading", beatMapSet);

      if (!this._checkIfDirectoryExists()) {
        this.path = process.cwd();
      }

      const response = await Requestor.fetchDownloadCollection(beatMapSet.id, {
        mirror: currentMirror,
        signal: controller.signal,
      });

      if (mirrorHasRateLimit(currentMirror)) {
        const xRateLimit = response.headers.get("x-ratelimit-remaining");
        if (xRateLimit !== null) {
          const remaining = parseInt(xRateLimit);
          if (!isNaN(remaining)) {
            this.remainingDownloadsLimit = remaining;
            if (remaining <= 12 && !this.queue.isPaused) {
              this.emit("rateLimited", currentMirror);
            }
          }
        }
      }

      if (response.status === 429) {
        if (!mirrorHasRateLimit(currentMirror)) {
          this.requeueDownload(beatMapSet, { ...options, attempts: attempt });
          return false;
        }

        if (isProbeRequest) {
          if (
            !this.lastDownloadsLimitCheck ||
            Date.now() - this.lastDownloadsLimitCheck > 5e3
          ) {
            this.lastDownloadsLimitCheck = Date.now();
            const rateLimitStatus = await Requestor.checkRateLimitation();
            if (rateLimitStatus === 0) {
              this.emit("dailyRateLimited", this.getNotDownloadedBeatMapSets());
            } else {
              this.remainingDownloadsLimit = rateLimitStatus;
            }
          }
        }

        if (!this.queue.isPaused) {
          this.emit("rateLimited", currentMirror);
        }
        this.requeueDownload(beatMapSet, { ...options, attempts: attempt });
        return false;
      } else if (
        response.status === 403 ||
        response.status === 418 ||
        response.status === 451
      ) {
        if (response.status === 403 || response.status === 418) {
          this.mirrors.ban(currentMirror);
        }
        if (nextMirrors.length > 0) {
          throw `Status Code: ${response.status}`;
        }
        if (response.status === 451) {
          this.emit("unavailable", this.getNotDownloadedBeatMapSets());
        } else {
          this.emit("blocked", this.getNotDownloadedBeatMapSets());
        }
        return false;
      } else if (response.status !== 200) {
        throw `Status Code: ${response.status}`;
      }

      if (isProbeRequest) {
        this.queue.concurrency = config.parallel ? config.concurrency : 1;
      }

      await streamResponseToOsz(response, this.path, resetStall);

      this.downloadedBeatMapSetSize++;
      this.mirrors.note(currentMirror, "ok");
      this.emit("downloaded", beatMapSet);
    } catch (e) {
      this.mirrors.note(currentMirror, "fail");
      if (isProbeRequest) {
        this.testRequest = true;
      }

      if (nextMirrors.length > 0) {
        this.emit("retrying", beatMapSet);
        this.requeueDownload(beatMapSet, {
          remainingMirrors: nextMirrors,
          attempts: attempt,
        });
      } else {
        this.emit("error", beatMapSet, e);
      }

      return false;
    } finally {
      clearTimeout(stallTimer);
      this.mirrors.setActive(currentMirror, -1);
    }

    return true;
  }

  private async _bulkDownloadPool(): Promise<void> {
    const host: PoolHost = {
      existingIds: () => this.existingBeatmapsetIds,
      attemptDownload: (set, mirror) => this._attemptDownload(set, mirror),
      pending: () => this.pending,
      countDownloaded: () => { this.downloadedBeatMapSetSize++; },
      downloadedCount: () => this.downloadedBeatMapSetSize,
      emitSkipped: (set) => { this.emit("skipped", set); },
      emitError: (set, reason) => { this.emit("error", set, reason); },
      emitRetrying: (set) => { this.emit("retrying", set); },
      emitEnd: (sets) => { this.emit("end", sets); },
    };
    await new DownloadPool(host, this.mirrors).run();
  }

  private async _attemptDownload(
    beatMapSet: BeatMapSet,
    mirror: Mirror
  ): Promise<DownloadOutcome> {
    this.mirrors.setActive(mirror, 1);

    const controller = new AbortController();
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const armStall = (ms: number): void => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => controller.abort(), ms);
    };
    armStall(RESPONSE_TIMEOUT);

    try {
      this.emit("downloading", beatMapSet);

      if (!this._checkIfDirectoryExists()) {
        this.path = process.cwd();
      }

      const response = await Requestor.fetchDownloadCollection(beatMapSet.id, {
        mirror,
        signal: controller.signal,
      });

      armStall(IDLE_TIMEOUT);

      if (mirrorHasRateLimit(mirror)) {
        const xRateLimit = response.headers.get("x-ratelimit-remaining");
        if (xRateLimit !== null) {
          const remaining = parseInt(xRateLimit);
          if (!isNaN(remaining)) {
            this.remainingDownloadsLimit = remaining;
            if (remaining <= 12 && !this.mirrors.isCooling(mirror)) {
              this.mirrors.recordApproachingLimit(mirror);
            }
          }
        }
      }

      if (response.status === 429) return "rateLimited";
      if (response.status === 403 || response.status === 418) return "banned";
      if (response.status === 451) return "unavailable";
      if (response.status === 404 || response.status === 410) {
        this.mirrors.note(mirror, "notfound");
        return "notfound";
      }
      if (response.status !== 200) throw `Status Code: ${response.status}`;

      await streamResponseToOsz(response, this.path, () => armStall(IDLE_TIMEOUT));

      this.downloadedBeatMapSetSize++;
      this.mirrors.note(mirror, "ok");
      this.emit("downloaded", beatMapSet);
      return "ok";
    } catch {
      this.mirrors.note(mirror, "fail");
      return "fail";
    } finally {
      clearTimeout(stallTimer);
      this.mirrors.setActive(mirror, -1);
    }
  }

  public getNotDownloadedBeatMapSets(): BeatMapSet[] {
    return Array.from(this.pending.values());
  }

  private _checkIfDirectoryExists(): boolean {
    return existsSync(this.path);
  }
}
