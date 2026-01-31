import { createWriteStream, existsSync, readdirSync, unlinkSync } from "fs";
import { Response } from "undici";
import _path from "path";
import OcdlError from "../struct/OcdlError";
import { replaceForbiddenChars } from "../util";
import EventEmitter from "events";
import { BeatMapSet } from "../struct/BeatMapSet";
import { collection, config } from "../state";
import PQueue from "p-queue";
import { Requestor } from "./Requestor";
import { Mirror, getFallbackMirrors } from "../struct/Constant";

interface DownloadManagerEvents {
  downloaded: (beatMapSet: BeatMapSet) => void;
  skipped: (beatMapSet: BeatMapSet) => void;
  error: (beatMapSet: BeatMapSet, e: unknown) => void;
  retrying: (beatMapSet: BeatMapSet) => void;
  downloading: (beatMapSet: BeatMapSet) => void;
  rateLimited: () => void;
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

// Download manager with parallel downloading and rate limiting support
export class DownloadManager extends EventEmitter {
  path: string;
  private queue: PQueue;  // Queue for managing parallel downloads
  private downloadedBeatMapSetSize = 0;  // Downloaded beatmapsets counter
  private skippedBeatMapSetSize = 0;  // Skipped (already existing) beatmapsets counter
  private existingBeatmapsetIds: Set<number> | null = null;  // Cached existing beatmapset IDs in Songs
  private remainingDownloadsLimit: number | null;  // Remaining downloads limit
  private lastDownloadsLimitCheck: number | null = null;  // Last limit check timestamp
  private testRequest = false;  // Flag for test request after rate limit
  private bannedMirrors: Set<Mirror> = new Set();  // Mirrors that returned 403 (blocked)

  constructor(remainingDownloadsLimit: number | null) {
    super();

    this.remainingDownloadsLimit = remainingDownloadsLimit;

    // Determine path for saving files
    if (config.mode === 4) {
      // Mode 4: download directly to Songs folder
      this.path = config.songsPath;
    } else {
      // Modes 1-3: download to directory, into collection subfolder
      this.path = config.useSubfolder
        ? _path.join(config.directory, collection.getCollectionFolderName())
        : config.directory;
    }

    // Initialize queue with parallelism and rate limiting settings
    // Nerinyan and Sayobot have no rate limit, skip intervalCap for them
    const noRateLimit = config.mirror === Mirror.Nerinyan || config.mirror === Mirror.Sayobot || config.mirror === Mirror.Beatconnect || config.mirror === Mirror.Nekoha;
    this.queue = !noRateLimit
      ? new PQueue({
          concurrency: config.parallel ? config.concurrency : 1,
          intervalCap: config.intervalCap,
          interval: 60e3,  // 60 seconds
        })
      : new PQueue({
          concurrency: config.parallel ? config.concurrency : 1,
        });
  }

  public bulkDownload(): void {
    // Build set of existing beatmapset IDs in Songs folder for skip check
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

    collection.beatMapSets.forEach((beatMapSet) => {
      void this.queue.add(async () => {
        // Skip if beatmapset already exists in Songs
        if (this.existingBeatmapsetIds?.has(beatMapSet.id)) {
          this.skippedBeatMapSetSize++;
          this.downloadedBeatMapSetSize++;
          this.emit("skipped", beatMapSet);
          collection.beatMapSets.delete(beatMapSet.id);
          return;
        }

        const success = await this._downloadFile(beatMapSet);
        // Remove beatmap only if download successful
        // (in mode 4 collection.db is already updated at start from API)
        if (success) {
          collection.beatMapSets.delete(beatMapSet.id);
        }
      });
    });

    this.queue.on("idle", () => {
      this.emit("end", this.getNotDownloadedBeatapSets());
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

  public getSkippedBeatMapSetSize() {
    return this.skippedBeatMapSetSize;
  }

  public getRemainingDownloadsLimit() {
    return this.remainingDownloadsLimit;
  }

  private async _downloadFile(
    beatMapSet: BeatMapSet,
    options: { remainingMirrors?: Mirror[] } = {}
  ): Promise<boolean> {
    // Determine current mirror and remaining fallbacks, excluding banned mirrors
    let allMirrors: Mirror[];
    if (options.remainingMirrors !== undefined) {
      allMirrors = options.remainingMirrors.filter(m => !this.bannedMirrors.has(m));
    } else {
      // First attempt: start with config mirror, then fallbacks
      allMirrors = this.bannedMirrors.has(config.mirror)
        ? getFallbackMirrors(config.mirror).filter(m => !this.bannedMirrors.has(m))
        : [config.mirror, ...getFallbackMirrors(config.mirror).filter(m => !this.bannedMirrors.has(m))];
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

    if (
      this.remainingDownloadsLimit != null &&
      this.remainingDownloadsLimit <= 0
    ) {
      this.emit("dailyRateLimited", this.getNotDownloadedBeatapSets());
      return false;
    }

    try {
      this.emit("downloading", beatMapSet);

      if (!this._checkIfDirectoryExists()) {
        this.path = process.cwd();
      }

      const response = await Requestor.fetchDownloadCollection(beatMapSet.id, {
        mirror: currentMirror,
      });

      // Rate limit check only for Catboy and OsuDirect (Nerinyan and Sayobot don't have this limit)
      if (currentMirror !== Mirror.Nerinyan && currentMirror !== Mirror.Sayobot && currentMirror !== Mirror.Beatconnect && currentMirror !== Mirror.Nekoha) {
        const xRateLimit = response.headers.get("x-ratelimit-remaining");
        if (xRateLimit && parseInt(xRateLimit) <= 12) {
          if (!this.queue.isPaused) {
            this.emit("rateLimited");
          }
        }
      }

      if (response.status === 429) {
        // For Nerinyan/Sayobot: no rate limit pause, just retry on same mirror
        if (currentMirror === Mirror.Nerinyan || currentMirror === Mirror.Sayobot || currentMirror === Mirror.Beatconnect || currentMirror === Mirror.Nekoha) {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          this.queue.add(async () => await this._downloadFile(beatMapSet, options));
          return false;
        }

        // For Catboy/OsuDirect: check daily limit and pause queue
        if (isProbeRequest) {
          if (
            !this.lastDownloadsLimitCheck ||
            Date.now() - this.lastDownloadsLimitCheck > 5e3
          ) {
            this.lastDownloadsLimitCheck = Date.now();
            const rateLimitStatus = await Requestor.checkRateLimitation();
            if (rateLimitStatus === 0) {
              this.emit("dailyRateLimited", this.getNotDownloadedBeatapSets());
            } else {
              this.remainingDownloadsLimit = rateLimitStatus;
            }
          }
        }

        if (!this.queue.isPaused) {
          this.emit("rateLimited");
        }
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.queue.add(async () => await this._downloadFile(beatMapSet, options));
        return false;
      } else if (response.status === 403 || response.status === 451) {
        // Ban this mirror from future requests on 403
        if (response.status === 403) {
          this.bannedMirrors.add(currentMirror);
        }
        // If there are fallback mirrors left, try next one instead of stopping
        if (nextMirrors.length > 0) {
          throw `Status Code: ${response.status}`;
        }
        // All mirrors exhausted — stop
        if (response.status === 403) {
          this.emit("blocked", this.getNotDownloadedBeatapSets());
        } else {
          this.emit("unavailable", this.getNotDownloadedBeatapSets());
        }
        return false;
      } else if (response.status !== 200) {
        throw `Status Code: ${response.status}`;
      }

      if (isProbeRequest) {
        this.queue.concurrency = config.parallel ? config.concurrency : 1;
      }

      const fileName = this._getFilename(response);
      const filePath = _path.join(this.path, fileName);
      const file = createWriteStream(filePath);

      // Write file in chunks
      let bytesWritten = 0;
      if (response.body) {
        for await (const chunk of response.body) {
          file.write(chunk);
          bytesWritten += (chunk as Buffer).length;
        }
      } else {
        throw "res.body is null";
      }

      // Wait for the stream to fully flush to disk
      await new Promise<void>((resolve, reject) => {
        file.end(() => resolve());
        file.on("error", reject);
      });

      // Validate file size — .osz is a zip archive, valid files are at least a few KB
      if (bytesWritten < 1024) {
        try { unlinkSync(filePath); } catch { /* ignore */ }
        throw `Downloaded file is too small (${bytesWritten} bytes)`;
      }

      this.downloadedBeatMapSetSize++;
      if (this.remainingDownloadsLimit != null) this.remainingDownloadsLimit--;
      this.emit("downloaded", beatMapSet);
    } catch (e) {
      if (isProbeRequest) {
        this.testRequest = true;
      }

      if (nextMirrors.length > 0) {
        this.emit("retrying", beatMapSet);
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.queue.add(async () => {
          const success = await this._downloadFile(beatMapSet, {
            remainingMirrors: nextMirrors,
          });
          // Remove beatmap only if retry successful
          if (success) {
            collection.beatMapSets.delete(beatMapSet.id);
          }
        });
      } else {
        // All mirrors exhausted - beatmap stays in collection for missing log
        this.emit("error", beatMapSet, e);
      }

      return false;
    }

    return true;
  }

  public getNotDownloadedBeatapSets(): BeatMapSet[] {
    return Array.from(collection.beatMapSets.values());
  }

  private _getFilename(response: Response): string {
    const contentDisposition = response.headers.get("content-disposition");

    let fileName = "Untitled.osz";
    if (contentDisposition) {
      const result = /filename=([^;]+)/g.exec(contentDisposition);
      if (result) {
        try {
          fileName = replaceForbiddenChars(decodeURIComponent(result[1]));
        } catch (e) {
          throw new OcdlError("FILE_NAME_EXTRACTION_FAILED", e);
        }
      }
    }

    return fileName;
  }

  private _checkIfDirectoryExists(): boolean {
    return existsSync(this.path);
  }
}
