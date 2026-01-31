import { DownloadManager } from "./DownloadManager";
import OsdbGenerator from "./OsdbGenerator";
import OcdlError from "../struct/OcdlError";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "fs";
import _path from "path";
import { isOnline, checkUndefined } from "../util";
import Monitor, { DisplayTextColor, FreezeCondition, GO_BACK_SIGNAL } from "./Monitor";
import Logger from "./Logger";
import { Msg } from "../struct/Message";
import { collection, config } from "../state";
import type { WorkingMode } from "../types";
import { Requestor, v2ResCollectionType } from "./Requestor";
import { BeatMapSet } from "../struct/BeatMapSet";
import { CatboyServer, Mirror } from "../struct/Constant";
import { clear } from "console";
import OsuDbReader from "./OsuDbReader";

// Mirror choice mapping to enum values
const MIRROR_CHOICES: Record<string, Mirror> = {
  "1": Mirror.Catboy,
  "2": Mirror.Nerinyan,
  "3": Mirror.OsuDirect,
  "4": Mirror.Sayobot,
  "5": Mirror.Beatconnect,
  "6": Mirror.Nekoha,
};

// Catboy server choice mapping
const CATBOY_SERVER_CHOICES: Record<string, CatboyServer> = {
  "1": CatboyServer.Default,
  "2": CatboyServer.Central,
  "3": CatboyServer.US,
  "4": CatboyServer.Asia,
};

// Valid working modes (1-5)
const VALID_MODES = ["1", "2", "3", "4", "5"] as const;

export default class Worker {
  monitor: Monitor;
  private resumeMissingBeatmapIds: Set<number> | null = null;
  // Saved beatmaps for mode 4 (collection.beatMapSets gets cleared during download)
  private savedBeatMaps: Array<{ id: number; checksum: string }> | null = null;

  constructor() {
    this.monitor = new Monitor();
  }

  /**
   * Checks if osu! is running. If so, prompts the user to close it.
   * Loops until osu! is closed or user cancels.
   * @returns true if osu! is closed and safe to proceed, false if user cancelled
   */
  private waitForOsuClosed(): boolean {
    const CollectionDbManager = require("./CollectionDbManager").default;

    this.monitor.displayMessage(Msg.CHECK_OSU_RUNNING);
    while (CollectionDbManager.isOsuRunning()) {
      this.monitor.displayMessage(Msg.OSU_IS_RUNNING_WAIT, {}, DisplayTextColor.DANGER);
      this.monitor.awaitInput(Msg.OSU_IS_RUNNING_PROMPT, {}, "");
      this.monitor.displayMessage(Msg.CHECK_OSU_RUNNING);
      if (CollectionDbManager.isOsuRunning()) {
        this.monitor.displayMessage(Msg.OSU_STILL_RUNNING, {}, DisplayTextColor.DANGER);
      }
    }
    return true;
  }

  /**
   * Adds collection to collection.db using real hashes from osu!.db
   * Used in modes 4 and 5
   * @returns true if operation succeeded, false if cancelled or error
   */
  private addToCollectionDb(): boolean {
    const CollectionDbManager = require("./CollectionDbManager").default;

    if (!this.waitForOsuClosed()) {
      return false;
    }

    // Read osu!.db to get real hashes
    let beatmapIdToRealHash: Map<number, string> = new Map();
    this.monitor.displayMessage(Msg.FIX_READING_OSU_DB);
    try {
      const osuDbReader = new OsuDbReader(config.osuDbPath);
      beatmapIdToRealHash = osuDbReader.readBeatmapIdToHash();
      this.monitor.displayMessage(Msg.FIX_OSU_DB_COMPLETE, {
        count: beatmapIdToRealHash.size.toString()
      });
    } catch {
      // Failed to read osu!.db, use hashes from API
    }

    const dbManager = new CollectionDbManager();
    this.monitor.displayMessage(Msg.READING_COLLECTION_DB);
    dbManager.readCollectionDb();

    // Check if collection with this name already exists
    let collectionName = collection.name;
    let collectionAction: "merge" | "replace" = "merge";

    if (dbManager.hasCollection(collectionName)) {
      const existingSize = dbManager.getCollectionSize(collectionName);
      this.monitor.displayMessage(Msg.COLLECTION_CONFLICT, {
        name: collectionName,
        count: existingSize.toString(),
      });

      let validChoice = false;
      while (!validChoice) {
        const choice = this.monitor.awaitInput(Msg.COLLECTION_CONFLICT_INPUT, {}, "1");
        if (choice === "1") {
          collectionAction = "merge";
          validChoice = true;
        } else if (choice === "2") {
          collectionAction = "replace";
          validChoice = true;
        } else if (choice === "3") {
          // Rename: find next available suffix
          let suffix = 2;
          while (dbManager.hasCollection(`${collection.name}_${suffix}`)) {
            suffix++;
          }
          collectionName = `${collection.name}_${suffix}`;
          collectionAction = "merge"; // new collection, merge = add
          validChoice = true;
        } else if (choice === "4") {
          return false;
        }
      }
    }

    // Get hashes, replacing API hashes with real ones where possible
    // Use savedBeatMaps if available (mode 4 - collection gets cleared during download)
    const { hashes, replaced } = CollectionDbManager.getMd5HashesWithRealHashes(
      beatmapIdToRealHash,
      this.savedBeatMaps ?? undefined
    );

    this.monitor.displayMessage(Msg.ADDING_TO_COLLECTION_DB);
    if (collectionAction === "replace") {
      dbManager.replaceCollection(collectionName, hashes);
    } else {
      dbManager.addCollection(collectionName, hashes);
    }

    dbManager.writeCollectionDb();

    const backupPath = dbManager.getLastBackupPath();
    if (backupPath) {
      this.monitor.displayMessage(Msg.COLLECTION_DB_BACKUP_CREATED, {
        path: backupPath,
      });
    }

    // Show hash replacement statistics
    if (replaced > 0) {
      this.monitor.displayMessage(Msg.FIX_COLLECTION_STATS, {
        name: collectionName,
        fixed: replaced.toString(),
        total: hashes.length.toString(),
      });
    }

    this.monitor.freeze(Msg.COLLECTION_DB_UPDATED, {
      name: collectionName,
      count: hashes.length.toString(),
    });

    return true;
  }

  private runSetupWizard(): void {
    this.monitor.displayMessage(Msg.SETUP_WELCOME, {}, DisplayTextColor.PRIMARY);

    // Choose setup type: standard or advanced
    this.monitor.displayMessage(Msg.SETUP_TYPE);
    let setupType: "standard" | "advanced" | null = null;
    while (!setupType) {
      const choice = this.monitor.awaitInput(Msg.SETUP_TYPE_INPUT, {}, "1");
      if (choice === "1") setupType = "standard";
      else if (choice === "2") setupType = "advanced";
    }

    if (setupType === "standard") {
      this.runStandardSetup();
    } else {
      this.runAdvancedSetup();
    }

    config.isFirstRun = false;
    config.save();
    this.monitor.displayMessage(Msg.SETUP_COMPLETE, {}, DisplayTextColor.SUCCESS);
  }

  private runStandardSetup(): void {
    // Standard: only osu! path, mode=4, mirror=catboy (default server)
    this.promptOsuPath(true);
    config.mode = 4;
    config.mirror = Mirror.Catboy;
    config.catboyServer = CatboyServer.Default;
  }

  private runAdvancedSetup(): void {
    // osu! path (optional — can skip)
    this.promptOsuPath(false);

    // Mirror
    this.monitor.displayMessage(Msg.SETUP_MIRROR);
    let validMirror = false;
    while (!validMirror) {
      const mirrorChoice = this.monitor.awaitInput(Msg.SETUP_MIRROR_INPUT, {}, "1");
      if (mirrorChoice in MIRROR_CHOICES) {
        config.mirror = MIRROR_CHOICES[mirrorChoice];
        validMirror = true;
      }
    }

    // Catboy server selection (only if catboy selected)
    if (config.mirror === Mirror.Catboy) {
      this.promptCatboyServer();
    }

    // Mode
    this.monitor.displayMessage(Msg.SETUP_MODE);
    let validMode = false;
    while (!validMode) {
      const modeChoice = this.monitor.awaitInput(Msg.SETUP_MODE_INPUT, {}, "1");
      if (VALID_MODES.includes(modeChoice as typeof VALID_MODES[number])) {
        config.mode = parseInt(modeChoice) as WorkingMode;
        validMode = true;
      }
    }

    // Download directory (only for modes 1-3)
    if (config.mode >= 1 && config.mode <= 3) {
      let validDir = false;
      while (!validDir) {
        const dir = this.monitor.awaitInput(Msg.SETUP_DIRECTORY, {}, process.cwd());
        if (dir && existsSync(dir)) {
          config.directory = _path.isAbsolute(dir) ? dir : _path.resolve(dir);
          validDir = true;
        } else if (!dir) {
          config.directory = process.cwd();
          validDir = true;
        } else {
          this.monitor.displayMessage(Msg.SETUP_DIRECTORY_INVALID, {}, DisplayTextColor.DANGER);
        }
      }
    }
  }

  private promptOsuPath(required: boolean): void {
    let validOsuPath = false;
    while (!validOsuPath) {
      const osuPath = this.monitor.awaitInput(Msg.SETUP_OSU_PATH, {}, "");
      if (osuPath) {
        const fullPath = _path.isAbsolute(osuPath) ? osuPath : _path.resolve(osuPath);
        const songsPath = _path.join(fullPath, "Songs");
        const osuDbPath = _path.join(fullPath, "osu!.db");

        if (existsSync(fullPath) && existsSync(songsPath) && existsSync(osuDbPath)) {
          config.osuPath = fullPath;
          validOsuPath = true;
        } else {
          this.monitor.displayMessage(Msg.SETUP_OSU_PATH_INVALID, {}, DisplayTextColor.DANGER);
        }
      } else if (!required) {
        // Skip if user didn't enter a path (only in advanced mode)
        validOsuPath = true;
      }
    }
  }

  private promptCatboyServer(): void {
    this.monitor.displayMessage(Msg.SETUP_CATBOY_SERVER);
    let valid = false;
    while (!valid) {
      const choice = this.monitor.awaitInput(Msg.SETUP_CATBOY_SERVER_INPUT, {}, "1");
      if (choice in CATBOY_SERVER_CHOICES) {
        config.catboyServer = CATBOY_SERVER_CHOICES[choice];
        valid = true;
      }
    }
  }

  private openSettings(): boolean {
    clear();
    this.monitor.displayMessage(Msg.SETTINGS_HEADER, {}, DisplayTextColor.PRIMARY);
    this.monitor.displayMessage(Msg.SETTINGS_CURRENT, {
      osuPath: config.osuPath || "(not set)",
      directory: config.directory,
      mirror: config.mirror + (config.mirror === Mirror.Catboy ? ` [${config.catboyServer}]` : ""),
      mode: config.mode.toString(),
      parallel: config.parallel ? "Yes" : "No",
      concurrency: config.concurrency.toString(),
      skipExisting: config.skipExisting ? "Yes" : "No",
    });

    const choice = this.monitor.awaitInput(Msg.SETTINGS_SELECT, {}, "");

    switch (choice) {
      case "1": {
        // Mirror (+ catboy server selection if catboy chosen)
        this.monitor.displayMessage(Msg.SETUP_MIRROR);
        const mirrorChoice = this.monitor.awaitInput(Msg.SETUP_MIRROR_INPUT, {}, "1");
        if (mirrorChoice in MIRROR_CHOICES) {
          config.mirror = MIRROR_CHOICES[mirrorChoice];
          if (config.mirror === Mirror.Catboy) {
            this.promptCatboyServer();
          }
        }
        break;
      }
      case "2": {
        // Download mode
        this.monitor.displayMessage(Msg.SETUP_MODE);
        const modeChoice = this.monitor.awaitInput(Msg.SETUP_MODE_INPUT, {}, config.mode.toString());
        if (VALID_MODES.includes(modeChoice as typeof VALID_MODES[number])) {
          config.mode = parseInt(modeChoice) as WorkingMode;
        }
        break;
      }
      case "3": {
        // Concurrency
        const concurrency = this.monitor.awaitInput(Msg.SETTINGS_CONCURRENCY, {}, config.concurrency.toString());
        const num = parseInt(concurrency);
        if (!isNaN(num) && num >= 1 && num <= 10) {
          config.concurrency = num;
        }
        break;
      }
      case "4": {
        // Parallel downloads
        const parallel = this.monitor.awaitInput(Msg.SETTINGS_PARALLEL, {}, config.parallel ? "y" : "n");
        config.parallel = parallel.toLowerCase() === "y";
        break;
      }
      case "5": {
        // Skip existing maps
        const skip = this.monitor.awaitInput(Msg.SETTINGS_SKIP_EXISTING, {}, config.skipExisting ? "y" : "n");
        config.skipExisting = skip.toLowerCase() === "y";
        break;
      }
      case "6": {
        // osu! folder
        const osuPath = this.monitor.awaitInput(Msg.SETUP_OSU_PATH, {}, config.osuPath);
        if (osuPath) {
          const fullPath = _path.isAbsolute(osuPath) ? osuPath : _path.resolve(osuPath);
          const songsPath = _path.join(fullPath, "Songs");
          const osuDbPath = _path.join(fullPath, "osu!.db");

          if (existsSync(fullPath) && existsSync(songsPath) && existsSync(osuDbPath)) {
            config.osuPath = fullPath;
          } else {
            this.monitor.displayMessage(Msg.SETUP_OSU_PATH_INVALID, {}, DisplayTextColor.DANGER);
          }
        }
        break;
      }
      case "7": {
        // Download directory (modes 1-3)
        const dir = this.monitor.awaitInput(Msg.SETUP_DIRECTORY, {}, config.directory);
        if (dir && existsSync(dir)) {
          config.directory = _path.isAbsolute(dir) ? dir : _path.resolve(dir);
        }
        break;
      }
      case "":
        // Enter = go back
        return false;
      default:
        return true;
    }

    config.save();
    this.monitor.displayMessage(Msg.SETTINGS_SAVED, {}, DisplayTextColor.SUCCESS);
    return true;
  }

  async run(): Promise<void> {
    this.monitor.update();

    // Run setup wizard on first run
    if (config.isFirstRun) {
      this.runSetupWizard();
    }

    // Check if internet connection is presence
    this.monitor.displayMessage(Msg.CHECK_CONNECTION_TO_SERVER);
    const onlineStatus = await isOnline();
    if (!onlineStatus)
      return this.monitor.freeze(
        Msg.NO_CONNECTION,
        {},
        FreezeCondition.ERRORED
      );

    // Check daily rate limit (only for mirrors that have rate limiting)
    const hasRateLimit = config.mirror === Mirror.Catboy || config.mirror === Mirror.OsuDirect;
    let rateLimitStatus: number | null = null;
    if (hasRateLimit) {
      this.monitor.displayMessage(Msg.CHECK_RATE_LIMIT);
      rateLimitStatus = await Requestor.checkRateLimitation();
      if (rateLimitStatus === null) {
        this.monitor.freeze(
          Msg.UNABLE_TO_GET_DAILY_RATE_LIMIT,
          {},
          FreezeCondition.WARNING
        );
      }
      this.monitor.setCondition({ remaining_downloads: rateLimitStatus });
    }

    let id: number | null = null;

    try {
      // Task 1: Get collection ID (mode is taken from settings)
      this.monitor.nextTask();

      while (id === null) {
        this.monitor.update();
        this.monitor.displayMessage(Msg.INPUT_ID_COMMANDS, {}, DisplayTextColor.SECONDARY);
        const input = this.monitor.awaitInput(Msg.INPUT_ID_HINT, {}, "None");

        // Check for settings
        if (input.toLowerCase() === "s") {
          while (this.openSettings()) {
            // Keep showing settings until user chooses to go back
          }
          continue;
        }

        // Check for fix command
        if (input.toLowerCase() === "f") {
          await this.runFixCommand();
          return;
        }

        // Check for backup command
        if (input.toLowerCase() === "b") {
          this.runBackupCommand();
          return;
        }

        const result = parseInt(input);
        if (!isNaN(result)) {
          id = result;
        }
        this.monitor.setCondition({ retry_input: true });
      }

      collection.id = id;

      // If rate limit exhausted on current mirror, switch to Nerinyan
      if (rateLimitStatus === 0 && config.mirror !== Mirror.Nerinyan) {
        config.mirror = Mirror.Nerinyan;
        this.monitor.freeze(
          Msg.MIRROR_SWITCHED_DUE_TO_RATE_LIMIT,
          { mirror: Mirror.Nerinyan },
          FreezeCondition.WARNING
        );
      }
    } catch (e) {
      throw new OcdlError("GET_USER_INPUT_FAILED", e);
    }

    // Task 2: Fetch brief collection info
    this.monitor.nextTask();

    try {
      const v1ResponseData = await Requestor.fetchCollection(collection.id);
      collection.resolveData(v1ResponseData);
    } catch (e) {
      throw new OcdlError("REQUEST_DATA_FAILED", e);
    }

    // Mode 5: add to collection.db immediately after fetching data
    if (config.mode === 5) {
      if (!config.isOsuPathValid()) {
        return this.monitor.freeze(
          Msg.SETUP_OSU_PATH_INVALID,
          {},
          FreezeCondition.ERRORED
        );
      }

      try {
        this.addToCollectionDb();
        return;
      } catch (e) {
        this.monitor.freeze(
          Msg.PROCESS_ERRORED,
          { error: String(e) },
          FreezeCondition.ERRORED
        );
      }
    }

    // Task 3: Create folder
    this.monitor.nextTask();

    // For mode 4, download directly to Songs (without subfolder)
    let folderPath: string;
    if (config.mode === 4) {
      if (!config.isOsuPathValid()) {
        return this.monitor.freeze(
          Msg.SETUP_OSU_PATH_INVALID,
          {},
          FreezeCondition.ERRORED
        );
      }
      folderPath = config.songsPath;
    } else {
      folderPath = config.useSubfolder
        ? _path.join(config.directory, collection.getCollectionFolderName())
        : config.directory;
    }

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

    if (existsSync(missingLogPath)) {
      try {
        let option: 1 | 2 | null = null;
        while (option === null) {
          this.monitor.setCondition({ missing_log_found: true });
          this.monitor.update();
          const result = this.monitor.awaitInputWithBack(
            Msg.INPUT_CONTINUE_DOWNLOAD,
            {}
          );

          // Go back - start over
          if (result === GO_BACK_SIGNAL) {
            return;
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
    }

    // Task 4: Fetch full collection data (mode 2 and 3 only)
    this.monitor.nextTask();

    if (config.mode === 2 || config.mode === 3) {
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

    // Task 5: Generate .osdb file (mode 2 and 3 only)
    this.monitor.nextTask();

    if (config.mode === 2 || config.mode === 3) {
      try {
        const generator = new OsdbGenerator();
        generator.writeOsdb();
      } catch (e) {
        throw new OcdlError("GENERATE_OSDB_FAILED", e);
      }
    }

    if (config.mode === 3) {
      return this.monitor.freeze(Msg.GENERATED_OSDB, {
        name: collection.name,
      });
    }

    // Task 6: Download beatmaps
    this.monitor.nextTask();

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

      // Filter collection if resuming from missing log
      if (this.resumeMissingBeatmapIds !== null) {
        const filtered: Map<number, BeatMapSet> = new Map();
        for (const id of this.resumeMissingBeatmapIds) {
          const beatMapSet = collection.beatMapSets.get(id);
          if (beatMapSet) {
            filtered.set(id, beatMapSet);
          }
        }
        collection.beatMapSets = filtered;
        collection.beatMapSetCount = filtered.size;
      }

      // Mode 4: save beatmaps before downloading (collection gets cleared during download)
      if (config.mode === 4) {
        this.savedBeatMaps = [];
        collection.beatMapSets.forEach((beatMapSet) => {
          beatMapSet.beatMaps.forEach((beatMap) => {
            this.savedBeatMaps!.push({ id: beatMap.id, checksum: beatMap.checksum });
          });
        });
      }

      const downloadManager = new DownloadManager(rateLimitStatus);

      downloadManager
        .on("downloading", (beatMapSet) => {
          this.monitor.appendDownloadLog(
            Msg.DOWNLOADING_FILE,
            { id: beatMapSet.id.toString(), name: beatMapSet.title ?? "" },
            DisplayTextColor.SECONDARY
          );
          this.monitor.update();
        })
        .on("retrying", (beatMapSet) => {
          this.monitor.appendDownloadLog(
            Msg.RETRYING_DOWNLOAD,
            { id: beatMapSet.id.toString(), name: beatMapSet.title ?? "" },
            DisplayTextColor.SECONDARY
          );
          this.monitor.update();
        })
        .on("skipped", (beatMapSet) => {
          this.monitor.setCondition({
            downloaded_beatmapset: downloadManager.getDownloadedBeatMapSetSize(),
          });
          this.monitor.appendDownloadLog(
            Msg.SKIPPED_FILE,
            { id: beatMapSet.id.toString(), name: beatMapSet.title ?? "" },
            DisplayTextColor.SECONDARY
          );
          this.monitor.update();
        })
        .on("downloaded", (beatMapSet) => {
          this.monitor.setCondition({
            downloaded_beatmapset: downloadManager.getDownloadedBeatMapSetSize(),
            remaining_downloads: downloadManager.getRemainingDownloadsLimit(),
          });
          this.monitor.appendDownloadLog(
            Msg.DOWNLOADED_FILE,
            { id: beatMapSet.id.toString(), name: beatMapSet.title ?? "" },
            DisplayTextColor.SUCCESS
          );
          this.monitor.update();
        })
        .on("rateLimited", () => {
          this.monitor.appendDownloadLog(Msg.RATE_LIMITED, {}, DisplayTextColor.DANGER);
          this.monitor.update();
        })
        .on("dailyRateLimited", (beatMapSets) => {
          if (beatMapSets.length > 0) {
            Logger.generateMissingLog(logFolderPath, beatMapSets);
          }
          this.monitor.setCondition({ remaining_downloads: 0 });
          this.monitor.update();
          this.monitor.freeze(Msg.DAILY_RATE_LIMIT_HIT, {}, FreezeCondition.ERRORED);
        })
        .on("blocked", (beatMapSets) => {
          if (beatMapSets.length > 0) {
            Logger.generateMissingLog(logFolderPath, beatMapSets);
          }
          this.monitor.freeze(Msg.REQUEST_BLOCKED, {}, FreezeCondition.ERRORED);
        })
        .on("unavailable", (beatMapSets) => {
          if (beatMapSets.length > 0) {
            Logger.generateMissingLog(logFolderPath, beatMapSets);
          }
          this.monitor.freeze(Msg.RESOURCE_UNAVAILBALE, {}, FreezeCondition.ERRORED);
        })
        .on("end", async (beatMapSets) => {
          if (beatMapSets.length > 0) {
            Logger.generateMissingLog(logFolderPath, beatMapSets);
          }

          // Mode 4: add to collection.db AFTER downloading
          if (config.mode === 4) {
            try {
              this.addToCollectionDb();
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
        })
        .on("error", (beatMapSet, e) => {
          this.monitor.appendDownloadLog(
            Msg.DOWNLOAD_FILE_FAILED,
            {
              id: beatMapSet.id.toString(),
              name: beatMapSet.title ?? "",
              error: String(e),
            },
            DisplayTextColor.DANGER
          );
          this.monitor.update();
        });

      const cleanUp = () => {
        const beatMapSets = downloadManager.getNotDownloadedBeatapSets();
        if (beatMapSets.length > 0) {
          Logger.generateMissingLog(logFolderPath, beatMapSets);
        }
      };

      ["SIGINT", "SIGTERM", "SIGHUP"].forEach((signal) => {
        process.on(signal, () => cleanUp());
      });

      downloadManager.bulkDownload();

      // Wait for download to complete
      await new Promise<void>((resolve) => {
        downloadManager.on("end", () => resolve());
        downloadManager.on("dailyRateLimited", () => resolve());
        downloadManager.on("blocked", () => resolve());
        downloadManager.on("unavailable", () => resolve());
      });
    } catch (e) {
      throw new OcdlError("MANAGE_DOWNLOAD_FAILED", e);
    }
  }

  private async runFixCommand(): Promise<void> {
    const CollectionDbManager = require("./CollectionDbManager").default;

    this.monitor.displayMessage(Msg.FIX_START, {}, DisplayTextColor.PRIMARY);

    // Check that osuPath is configured
    if (!config.isOsuPathValid()) {
      const inputPath = this.monitor.awaitInput(Msg.SETUP_OSU_PATH, {}, "");
      if (inputPath) {
        const fullPath = _path.isAbsolute(inputPath) ? inputPath : _path.resolve(inputPath);
        const songsPath = _path.join(fullPath, "Songs");
        const osuDbPath = _path.join(fullPath, "osu!.db");

        if (existsSync(fullPath) && existsSync(songsPath) && existsSync(osuDbPath)) {
          config.osuPath = fullPath;
          config.save();
        } else {
          return this.monitor.freeze(Msg.SETUP_OSU_PATH_INVALID, {}, FreezeCondition.ERRORED);
        }
      } else {
        return this.monitor.freeze(Msg.SETUP_OSU_PATH_INVALID, {}, FreezeCondition.ERRORED);
      }
    }

    // Request collection ID
    let collectionId: number | null = null;
    while (collectionId === null) {
      const input = this.monitor.awaitInput(Msg.FIX_INPUT_COLLECTION_ID, {}, "");
      if (!input) {
        return; // Cancel
      }
      const parsed = parseInt(input);
      if (!isNaN(parsed)) {
        collectionId = parsed;
      }
    }

    // Check if osu! is running
    if (!this.waitForOsuClosed()) {
      return;
    }

    // Fetch collection data from API
    this.monitor.displayMessage(Msg.FETCH_BRIEF_INFO, { id: collectionId.toString() });
    let apiData;
    try {
      apiData = await Requestor.fetchCollection(collectionId);
    } catch (e) {
      return this.monitor.freeze(Msg.PROCESS_ERRORED, { error: String(e) }, FreezeCondition.ERRORED);
    }

    // Resolve collection data
    collection.id = collectionId;
    collection.resolveData(apiData);

    // Step 1: Read osu!.db and fix hashes in collection.db (like mode 5)
    this.monitor.displayMessage(Msg.FIX_READING_OSU_DB);
    const osuDbReader = new OsuDbReader(config.osuDbPath);
    let beatmapIdToRealHash: Map<number, string>;
    let existingBeatmapsetIds: Set<number>;
    try {
      beatmapIdToRealHash = osuDbReader.readBeatmapIdToHash();
      existingBeatmapsetIds = osuDbReader.readAllBeatmapsetIds();
    } catch (e) {
      return this.monitor.freeze(Msg.PROCESS_ERRORED, { error: String(e) }, FreezeCondition.ERRORED);
    }

    this.monitor.displayMessage(Msg.FIX_OSU_DB_COMPLETE, { count: beatmapIdToRealHash.size.toString() });

    // Step 2: Build hashes with real ones and replace collection in collection.db
    this.monitor.displayMessage(Msg.FIX_HASHES_FIXING);
    const { hashes, replaced } = CollectionDbManager.getMd5HashesWithRealHashes(beatmapIdToRealHash);

    const dbManager = new CollectionDbManager();
    dbManager.readCollectionDb();
    dbManager.replaceCollection(collection.name, hashes);
    dbManager.writeCollectionDb();

    const backupPath = dbManager.getLastBackupPath();
    if (backupPath) {
      this.monitor.displayMessage(Msg.COLLECTION_DB_BACKUP_CREATED, { path: backupPath });
    }

    this.monitor.displayMessage(Msg.FIX_HASHES_COMPLETE, {
      fixed: replaced.toString(),
      total: hashes.length.toString(),
      name: collection.name,
    });

    // Step 3: Find missing beatmapsets (not in osu!.db at all)
    const missingBeatmapsetIds = new Set<number>();
    for (const [beatmapsetId, beatmapSet] of collection.beatMapSets) {
      let hasAny = existingBeatmapsetIds.has(beatmapsetId);
      if (!hasAny && beatmapSet.beatMaps) {
        for (const beatmap of beatmapSet.beatMaps.values()) {
          if (beatmapIdToRealHash.has(beatmap.id)) {
            hasAny = true;
            break;
          }
        }
      }
      if (!hasAny) {
        missingBeatmapsetIds.add(beatmapsetId);
      }
    }

    if (missingBeatmapsetIds.size === 0) {
      return this.monitor.freeze(Msg.FIX_ALL_DOWNLOADED, {
        fixed: replaced.toString(),
        total: hashes.length.toString(),
        name: collection.name,
      });
    }

    // Step 4: Offer to download missing
    this.monitor.displayMessage(Msg.FIX_MISSING_COUNT, {
      missing: missingBeatmapsetIds.size.toString(),
      total: collection.beatMapSetCount.toString(),
    });

    const confirm = this.monitor.awaitInput(Msg.FIX_CONFIRM_DOWNLOAD, {}, "y");
    if (confirm.toLowerCase() !== "y") {
      return;
    }

    // Filter collection — keep only missing
    const filteredBeatMapSets = new Map<number, BeatMapSet>();
    for (const id of missingBeatmapsetIds) {
      const beatMapSet = collection.beatMapSets.get(id);
      if (beatMapSet) {
        filteredBeatMapSets.set(id, beatMapSet);
      }
    }
    collection.beatMapSets = filteredBeatMapSets;
    collection.beatMapSetCount = filteredBeatMapSets.size;

    // Get rate limit
    let rateLimitStatus: number | null = null;
    try {
      rateLimitStatus = await Requestor.checkRateLimitation();
    } catch {
      // Failed to check rate limit, proceed without it
    }

    // Switch monitor to download view
    this.monitor.setTask(6);

    const downloadManager = new DownloadManager(rateLimitStatus);

    downloadManager
      .on("downloading", (beatMapSet) => {
        this.monitor.appendDownloadLog(
          Msg.DOWNLOADING_FILE,
          { id: beatMapSet.id.toString(), name: beatMapSet.title ?? "" },
          DisplayTextColor.SECONDARY
        );
        this.monitor.update();
      })
      .on("skipped", (beatMapSet) => {
        this.monitor.setCondition({
          downloaded_beatmapset: downloadManager.getDownloadedBeatMapSetSize(),
        });
        this.monitor.appendDownloadLog(
          Msg.SKIPPED_FILE,
          { id: beatMapSet.id.toString(), name: beatMapSet.title ?? "" },
          DisplayTextColor.SECONDARY
        );
        this.monitor.update();
      })
      .on("downloaded", (beatMapSet) => {
        this.monitor.setCondition({
          downloaded_beatmapset: downloadManager.getDownloadedBeatMapSetSize(),
        });
        this.monitor.appendDownloadLog(
          Msg.DOWNLOADED_FILE,
          { id: beatMapSet.id.toString(), name: beatMapSet.title ?? "" },
          DisplayTextColor.SUCCESS
        );
        this.monitor.update();
      })
      .on("error", (beatMapSet, e) => {
        this.monitor.appendDownloadLog(
          Msg.DOWNLOAD_FILE_FAILED,
          { id: beatMapSet.id.toString(), name: beatMapSet.title ?? "", error: String(e) },
          DisplayTextColor.DANGER
        );
        this.monitor.update();
      })
      .on("end", async () => {
        this.monitor.freeze(Msg.FIX_DOWNLOAD_COMPLETE, {
          downloaded: downloadManager.getDownloadedBeatMapSetSize().toString(),
          total: missingBeatmapsetIds.size.toString(),
          name: collection.name,
        });
      });

    downloadManager.bulkDownload();

    await new Promise<void>((resolve) => {
      downloadManager.on("end", () => resolve());
      downloadManager.on("dailyRateLimited", () => resolve());
      downloadManager.on("blocked", () => resolve());
    });
  }

  private runBackupCommand(): void {
    const CollectionDbManager = require("./CollectionDbManager").default;

    // Show description
    this.monitor.displayMessage(Msg.BACKUP_DESCRIPTION, {}, DisplayTextColor.PRIMARY);

    // Confirm
    const confirm = this.monitor.awaitInput(Msg.BACKUP_CONFIRM, {}, "n");
    if (confirm.toLowerCase() !== "y") {
      this.monitor.displayMessage(Msg.BACKUP_CANCELLED);
      return;
    }

    // Validate osu! path
    if (!config.isOsuPathValid()) {
      const inputPath = this.monitor.awaitInput(Msg.SETUP_OSU_PATH, {}, "");
      if (inputPath) {
        const fullPath = _path.isAbsolute(inputPath) ? inputPath : _path.resolve(inputPath);
        const songsPath = _path.join(fullPath, "Songs");
        const osuDbPath = _path.join(fullPath, "osu!.db");

        if (existsSync(fullPath) && existsSync(songsPath) && existsSync(osuDbPath)) {
          config.osuPath = fullPath;
          config.save();
        } else {
          return this.monitor.freeze(Msg.SETUP_OSU_PATH_INVALID, {}, FreezeCondition.ERRORED);
        }
      } else {
        return this.monitor.freeze(Msg.SETUP_OSU_PATH_INVALID, {}, FreezeCondition.ERRORED);
      }
    }

    // Check osu! running
    if (!this.waitForOsuClosed()) {
      return;
    }

    // Read osu!.db
    this.monitor.displayMessage(Msg.BACKUP_READING_OSU_DB);
    let allHashes: Set<string>;
    try {
      const osuDbReader = new OsuDbReader(config.osuDbPath);
      allHashes = osuDbReader.readAllHashes();
    } catch (e) {
      return this.monitor.freeze(Msg.PROCESS_ERRORED, { error: String(e) }, FreezeCondition.ERRORED);
    }

    this.monitor.displayMessage(Msg.BACKUP_FOUND_MAPS, { count: allHashes.size.toString() });

    // Empty check
    if (allHashes.size === 0) {
      return this.monitor.freeze(Msg.BACKUP_NO_MAPS, {}, FreezeCondition.ERRORED);
    }

    // Read collection.db
    this.monitor.displayMessage(Msg.READING_COLLECTION_DB);
    const dbManager = new CollectionDbManager();
    dbManager.readCollectionDb();

    // Handle conflict if "backup maps" already exists
    let collectionName = "backup maps";
    let collectionAction: "merge" | "replace" = "merge";

    if (dbManager.hasCollection(collectionName)) {
      const existingSize = dbManager.getCollectionSize(collectionName);
      this.monitor.displayMessage(Msg.COLLECTION_CONFLICT, {
        name: collectionName,
        count: existingSize.toString(),
      });

      let validChoice = false;
      while (!validChoice) {
        const choice = this.monitor.awaitInput(Msg.COLLECTION_CONFLICT_INPUT, {}, "1");
        if (choice === "1") {
          collectionAction = "merge";
          validChoice = true;
        } else if (choice === "2") {
          collectionAction = "replace";
          validChoice = true;
        } else if (choice === "3") {
          let suffix = 2;
          while (dbManager.hasCollection(`backup maps_${suffix}`)) {
            suffix++;
          }
          collectionName = `backup maps_${suffix}`;
          collectionAction = "merge";
          validChoice = true;
        } else if (choice === "4") {
          return;
        }
      }
    }

    // Write to collection.db
    this.monitor.displayMessage(Msg.BACKUP_WRITING);
    const hashArray = Array.from(allHashes);

    if (collectionAction === "replace") {
      dbManager.replaceCollection(collectionName, hashArray);
    } else {
      dbManager.addCollection(collectionName, hashArray);
    }

    dbManager.writeCollectionDb();

    const backupPath = dbManager.getLastBackupPath();
    if (backupPath) {
      this.monitor.displayMessage(Msg.COLLECTION_DB_BACKUP_CREATED, { path: backupPath });
    }

    this.monitor.freeze(Msg.BACKUP_COMPLETE, { count: hashArray.length.toString(), name: collectionName });
  }
}
