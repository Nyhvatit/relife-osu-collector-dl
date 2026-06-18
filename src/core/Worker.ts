import { DownloadManager } from "./DownloadManager";
import OsdbGenerator from "./OsdbGenerator";
import CollectionDbManager from "./CollectionDbManager";
import OcdlError from "../struct/OcdlError";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "fs";
import _path from "path";
import { isOnline, parseIdInput } from "../util";
import Monitor, { DisplayTextColor, FreezeCondition, GO_BACK_SIGNAL, BackToMenu } from "./Monitor";
import Logger from "./Logger";
import { Msg } from "../struct/Message";
import { collection, config } from "../state";
import { Requestor } from "./Requestor";
import { Mirror } from "../struct/Constant";
import SettingsManager from "./SettingsManager";
import CollectionDbService from "./CollectionDbService";
import DownloadFlow from "./DownloadFlow";
import FixCommand from "./commands/FixCommand";
import TournamentCommand from "./commands/TournamentCommand";
import UserUploadsCommand from "./commands/UserUploadsCommand";
import RetryFailedCommand from "./commands/RetryFailedCommand";

export default class Worker {
  monitor: Monitor;
  private settings: SettingsManager;
  private collectionDb: CollectionDbService;
  private flow: DownloadFlow;
  private resumeMissingBeatmapIds: Set<number> | null = null;

  constructor() {
    this.monitor = new Monitor();
    this.settings = new SettingsManager(this.monitor);
    this.collectionDb = new CollectionDbService(this.monitor);
    this.flow = new DownloadFlow(this.monitor, this.collectionDb);
  }

  async run(): Promise<void> {
    CollectionDbManager.resetBackupSession();

    this.monitor.update();

    if (config.isFirstRun) {
      this.settings.runSetupWizard();
    }

    const rateLimitStatus = await this.runStartupChecks();

    if ((await this.resolveCollectionId(rateLimitStatus)) === null) return;

    this.monitor.nextTask();

    try {
      const v1ResponseData = await Requestor.fetchCollection(collection.id);
      collection.resolveData(v1ResponseData);
    } catch (e) {
      throw new OcdlError("REQUEST_DATA_FAILED", e);
    }

    if (config.caps.collectionDb && !config.caps.download) {
      if (!config.isOsuPathValid()) {
        return this.monitor.freeze(
          Msg.SETUP_OSU_PATH_INVALID,
          {},
          FreezeCondition.ERRORED
        );
      }

      try {
        this.collectionDb.addToCollectionDb();
        return;
      } catch (e) {
        if (e instanceof BackToMenu) throw e;
        this.monitor.freeze(
          Msg.PROCESS_ERRORED,
          { error: String(e) },
          FreezeCondition.ERRORED
        );
      }
    }

    this.monitor.nextTask();

    if (config.caps.download && config.caps.collectionDb && !config.isOsuPathValid()) {
      return this.monitor.freeze(
        Msg.SETUP_OSU_PATH_INVALID,
        {},
        FreezeCondition.ERRORED
      );
    }
    const folderPath = config.getDownloadPath(collection);

    const logFolderPath = config.useSubfolder
      ? folderPath
      : _path.dirname(config.directory);

    const missingLogPath = _path.join(logFolderPath, Logger.missingLogPath);

    if (config.useSubfolder && !existsSync(folderPath)) {
      try {
        mkdirSync(folderPath);
      } catch (e) {
        throw new OcdlError("FOLDER_GENERATION_FAILED", e);
      }
    }

    if (!this.handleMissingLog(missingLogPath)) return;

    this.monitor.nextTask();
    await this.flow.fetchFullData();

    this.monitor.nextTask();

    if (config.caps.osdb) {
      try {
        const generator = new OsdbGenerator();
        generator.writeOsdb();
      } catch (e) {
        throw new OcdlError("GENERATE_OSDB_FAILED", e);
      }
    }

    if (config.caps.osdb && !config.caps.download) {
      return this.monitor.freeze(Msg.GENERATED_OSDB, {
        name: collection.name,
      });
    }

    this.monitor.nextTask();
    await this.runDownload(rateLimitStatus, logFolderPath);
  }

  private async runStartupChecks(): Promise<number | null> {
    this.monitor.displayMessage(Msg.CHECK_CONNECTION_TO_SERVER);
    if (!(await isOnline())) {
      this.monitor.freeze(Msg.NO_CONNECTION, {}, FreezeCondition.ERRORED);
      return null;
    }

    return null;
  }

  private async resolveCollectionId(rateLimitStatus: number | null): Promise<number | null> {
    let id: number | null = null;
    try {
      this.monitor.nextTask();

      while (id === null) {
        this.monitor.update();
        this.monitor.section("Commands");
        this.monitor.displayMessage(Msg.INPUT_ID_COMMANDS, {}, DisplayTextColor.SECONDARY);
        const input = this.monitor.awaitInput(Msg.INPUT_ID_HINT, {}, "None");
        const cmd = input.toLowerCase();

        if (cmd === "s") {
          while (this.settings.openSettings()) {
          }
          continue;
        }
        if (cmd === "f") {
          await new FixCommand(this.monitor, this.collectionDb, this.flow).run();
          return null;
        }
        if (cmd === "b") {
          this.collectionDb.backupLocalMaps();
          return null;
        }
        if (cmd === "t") {
          await new TournamentCommand(this.monitor, this.flow).run(rateLimitStatus);
          return null;
        }
        if (cmd === "u") {
          await new UserUploadsCommand(this.monitor, this.flow).run(rateLimitStatus);
          return null;
        }
        if (cmd === "r") {
          await new RetryFailedCommand(this.monitor, this.flow).run(rateLimitStatus);
          return null;
        }

        const parsed = parseIdInput(input);
        if (parsed !== null) {
          id = parsed;
        }
        this.monitor.setCondition({ retry_input: true });
      }

      collection.id = id;

      if (rateLimitStatus === 0 && config.mirror !== Mirror.OsuDirect) {
        config.mirror = Mirror.OsuDirect;
        this.monitor.freeze(
          Msg.MIRROR_SWITCHED_DUE_TO_RATE_LIMIT,
          { mirror: Mirror.OsuDirect },
          FreezeCondition.WARNING
        );
      }
    } catch (e) {
      if (e instanceof BackToMenu) throw e;
      throw new OcdlError("GET_USER_INPUT_FAILED", e);
    }
    return id;
  }

  private async runDownload(
    rateLimitStatus: number | null,
    logFolderPath: string
  ): Promise<void> {
    try {
      if (
        rateLimitStatus !== null &&
        rateLimitStatus < collection.beatMapSetCount
      ) {
        this.monitor.freeze(
          Msg.TO_DOWNLOADS_EXCEED_DAILY_RATE_LIMIT,
          {
            collection: collection.beatMapSetCount.toString(),
            limit: rateLimitStatus.toString(),
          },
          FreezeCondition.WARNING
        );
      }

      if (this.resumeMissingBeatmapIds !== null) {
        collection.keepOnly(this.resumeMissingBeatmapIds);
      }

      const downloadManager = new DownloadManager(rateLimitStatus);

      this.flow.wireCommonDownloadEvents(downloadManager);
      this.flow.wireTerminalDownloadEvents(downloadManager, logFolderPath, {
        freeze: true,
        onEnd: () => {
          if (config.caps.download && config.caps.collectionDb) {
            try {
              this.collectionDb.addToCollectionDb();
            } catch (e) {
              this.monitor.freeze(
                Msg.PROCESS_ERRORED,
                { error: String(e) },
                FreezeCondition.ERRORED
              );
            }
          } else {
            this.monitor.freeze(Msg.DOWNLOAD_COMPLETED);
          }
        },
      });

      this.flow.armDownloadCleanup(downloadManager, logFolderPath);

      downloadManager.bulkDownload();

      await this.flow.waitUntilDone(downloadManager);
    } catch (e) {
      if (e instanceof BackToMenu) throw e;
      throw new OcdlError("MANAGE_DOWNLOAD_FAILED", e);
    }
  }

  private handleMissingLog(missingLogPath: string): boolean {
    if (!existsSync(missingLogPath)) return true;

    try {
      let option: 1 | 2 | null = null;
      while (option === null) {
        this.monitor.setCondition({ missing_log_found: true });
        this.monitor.update();
        const result = this.monitor.awaitInputWithBack(
          Msg.INPUT_CONTINUE_DOWNLOAD,
          {}
        );

        if (result === GO_BACK_SIGNAL) {
          return false;
        }

        if (["1", "2"].includes(result)) {
          option = parseInt(result) as 1 | 2;
        }
        this.monitor.setCondition({ retry_missing_log_input: true });
      }

      if (option === 1) {
        config.mode = 1;
        const missingLog = readFileSync(missingLogPath, "utf-8");
        const lines = missingLog.split("\n").slice(2);

        this.resumeMissingBeatmapIds = new Set<number>();
        for (const line of lines) {
          const match = line.trim().match(/\/beatmapsets\/(\d+)/);
          if (match) {
            this.resumeMissingBeatmapIds.add(+match[1]);
          }
        }
      }

      unlinkSync(missingLogPath);
    } catch (e) {
      throw new OcdlError("GET_USER_INPUT_FAILED", e);
    }

    return true;
  }

}
