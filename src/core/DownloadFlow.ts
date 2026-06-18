import { existsSync, mkdirSync } from "fs";
import _path from "path";
import { DownloadManager } from "./DownloadManager";
import OsdbGenerator from "./OsdbGenerator";
import CollectionDbService from "./CollectionDbService";
import OcdlError from "../struct/OcdlError";
import { checkUndefined } from "../util";
import Monitor, { DisplayTextColor, FreezeCondition } from "./Monitor";
import Logger from "./Logger";
import { Msg } from "../struct/Message";
import { collection, config } from "../state";
import { Requestor, v2ResCollectionType } from "./Requestor";
import { BeatMapSet } from "../struct/BeatMapSet";
import { Mirror } from "../struct/Constant";

export default class DownloadFlow {
  private static signalsHooked = false;
  private static activeDownloadCleanup: (() => void) | null = null;

  constructor(
    private monitor: Monitor,
    private collectionDb: CollectionDbService
  ) {}

  private logDownload(message: Msg, beatMapSet: BeatMapSet, color: DisplayTextColor): void {
    this.monitor.appendDownloadLog(
      message,
      { id: beatMapSet.id.toString(), name: beatMapSet.title ?? "" },
      color
    );
    this.monitor.update();
  }

  private logRateLimited(mirror: Mirror): void {
    if (config.mirrorRotation) {
      this.monitor.appendDownloadLog(
        Msg.MIRROR_RATE_LIMITED_ROTATING,
        { mirror },
        DisplayTextColor.SECONDARY
      );
    } else {
      this.monitor.appendDownloadLog(Msg.RATE_LIMITED, {}, DisplayTextColor.DANGER);
    }
    this.monitor.update();
  }

  wireCommonDownloadEvents(dm: DownloadManager): void {
    dm.on("downloading", (b) => {
        this.monitor.setCondition({ mirror_stats: dm.getMirrorStats() });
        this.logDownload(Msg.DOWNLOADING_FILE, b, DisplayTextColor.SECONDARY);
      })
      .on("retrying", (b) => {
        this.monitor.setCondition({ mirror_stats: dm.getMirrorStats() });
        this.logDownload(Msg.RETRYING_DOWNLOAD, b, DisplayTextColor.SECONDARY);
      })
      .on("skipped", (b) => {
        this.monitor.setCondition({ downloaded_beatmapset: dm.getDownloadedBeatMapSetSize() });
        this.logDownload(Msg.SKIPPED_FILE, b, DisplayTextColor.SECONDARY);
      })
      .on("downloaded", (b) => {
        this.monitor.setCondition({
          downloaded_beatmapset: dm.getDownloadedBeatMapSetSize(),
          remaining_downloads: dm.getRemainingDownloadsLimit(),
          mirror_stats: dm.getMirrorStats(),
        });
        this.logDownload(Msg.DOWNLOADED_FILE, b, DisplayTextColor.SUCCESS);
      })
      .on("error", (b, e) => {
        this.monitor.setCondition({ mirror_stats: dm.getMirrorStats() });
        this.monitor.appendDownloadLog(
          Msg.DOWNLOAD_FILE_FAILED,
          { id: b.id.toString(), name: b.title ?? "", error: String(e) },
          DisplayTextColor.DANGER
        );
        this.monitor.update();
      });
  }

  wireTerminalDownloadEvents(
    dm: DownloadManager,
    logFolderPath: string,
    opts: { freeze: boolean; onEnd?: (beatMapSets: BeatMapSet[]) => void | Promise<void> }
  ): void {
    const dump = (beatMapSets: BeatMapSet[]): void => {
      if (beatMapSets.length > 0) Logger.generateMissingLog(logFolderPath, beatMapSets);
    };
    dm.on("rateLimited", (mirror) => this.logRateLimited(mirror))
      .on("dailyRateLimited", (beatMapSets) => {
        dump(beatMapSets);
        this.monitor.setCondition({ remaining_downloads: 0 });
        this.monitor.update();
        if (opts.freeze) this.monitor.freeze(Msg.DAILY_RATE_LIMIT_HIT, {}, FreezeCondition.ERRORED);
      })
      .on("blocked", (beatMapSets) => {
        dump(beatMapSets);
        if (opts.freeze) this.monitor.freeze(Msg.REQUEST_BLOCKED, {}, FreezeCondition.ERRORED);
      })
      .on("unavailable", (beatMapSets) => {
        dump(beatMapSets);
        if (opts.freeze) this.monitor.freeze(Msg.RESOURCE_UNAVAILBALE, {}, FreezeCondition.ERRORED);
      })
      .on("end", async (beatMapSets) => {
        dump(beatMapSets);
        if (opts.onEnd) await opts.onEnd(beatMapSets);
      });
  }

  requireOsuPathForDbModes(): boolean {
    if (config.caps.collectionDb && !config.isOsuPathValid()) {
      this.monitor.freeze(Msg.SETUP_OSU_PATH_INVALID, {}, FreezeCondition.WARNING);
      return false;
    }
    return true;
  }

  armDownloadCleanup(dm: DownloadManager, logFolderPath: string): void {
    DownloadFlow.activeDownloadCleanup = () => {
      const beatMapSets = dm.getNotDownloadedBeatMapSets();
      if (beatMapSets.length > 0) Logger.generateMissingLog(logFolderPath, beatMapSets);
    };
    if (!DownloadFlow.signalsHooked) {
      DownloadFlow.signalsHooked = true;
      ["SIGINT", "SIGTERM", "SIGHUP"].forEach((signal) => {
        process.on(signal, () => DownloadFlow.activeDownloadCleanup?.());
      });
    }
  }

  async runToCompletion(
    dm: DownloadManager,
    logFolderPath: string,
    opts: { freeze: boolean; onEnd?: (beatMapSets: BeatMapSet[]) => void | Promise<void> }
  ): Promise<void> {
    this.wireCommonDownloadEvents(dm);
    this.wireTerminalDownloadEvents(dm, logFolderPath, opts);
    this.armDownloadCleanup(dm, logFolderPath);
    dm.bulkDownload();
    await this.waitUntilDone(dm);
  }

  waitUntilDone(dm: DownloadManager): Promise<void> {
    return new Promise<void>((resolve) => {
      dm.on("end", () => resolve());
      dm.on("dailyRateLimited", () => resolve());
      dm.on("blocked", () => resolve());
      dm.on("unavailable", () => resolve());
    });
  }

  async fetchFullData(): Promise<void> {
    if (!config.caps.osdb) return;

    let cursor: number | undefined = undefined;
    let fetchedCount = 0;
    do {
      const v2ResponseData = await Requestor.fetchCollection(collection.id, {
        v2: true,
        cursor,
      });

      const und = checkUndefined(v2ResponseData, [
        "nextPageCursor",
        "beatmaps",
      ]);
      if (und) {
        throw new OcdlError("CORRUPTED_RESPONSE", `${und} is required`);
      }

      const { nextPageCursor, beatmaps } =
        v2ResponseData as v2ResCollectionType;
      cursor = nextPageCursor;
      collection.resolveFullData(beatmaps);

      fetchedCount += beatmaps.length;
      this.monitor.setCondition({ fetched_collection: fetchedCount });
      this.monitor.update();
    } while (cursor);
  }

  async processLoadedCollection(rateLimitStatus: number | null): Promise<number | null> {
    const folderPath = config.getDownloadPath(collection);
    const logFolderPath = config.useSubfolder ? folderPath : _path.dirname(config.directory);

    if (config.caps.collectionDb && !config.caps.download) {
      this.collectionDb.addToCollectionDb({ silent: true });
      return rateLimitStatus;
    }

    if (config.useSubfolder && config.caps.download && !existsSync(folderPath)) {
      mkdirSync(folderPath, { recursive: true });
    }

    if (config.caps.osdb) {
      const generator = new OsdbGenerator();
      generator.writeOsdb();
    }
    if (config.caps.osdb && !config.caps.download) return rateLimitStatus;

    const dm = new DownloadManager(rateLimitStatus);
    await this.runToCompletion(dm, logFolderPath, { freeze: true });

    if (config.caps.download && config.caps.collectionDb) {
      this.collectionDb.addToCollectionDb({ silent: true });
    }

    return dm.getRemainingDownloadsLimit();
  }
}
