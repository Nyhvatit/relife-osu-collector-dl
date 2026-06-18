import { existsSync, writeFileSync } from "fs";
import path from "path";
import Logger from "../core/Logger";
import type { Json, JsonValues, WorkingMode, ModeCapabilities } from "../types";
import { MODE_CAPABILITIES } from "../types";
import { isBoolean, checkRange, isValidOsuFolder } from "../util";
import OcdlError from "./OcdlError";
import { CatboyServer, Mirror } from "./Constant";
import type { Collection } from "./Collection";

export default class Config {
  parallel: boolean;
  concurrency: number;
  intervalCap: number;
  directory: string;
  mode: WorkingMode;
  logSize: number;
  useSubfolder: boolean;
  osuPath: string;
  mirror: Mirror;
  catboyServer: CatboyServer;
  isFirstRun: boolean;
  skipExisting: boolean;
  backupRetention: number;
  mirrorRotation: boolean;
  noVideo: boolean;

  static readonly configFilePath = "./config.json";

  private static readonly DEFAULTS = {
    parallel: true,
    concurrency: 5,
    intervalCap: 50,
    logSize: 15,
    directory: "",
    mode: 1,
    useSubfolder: true,
    osuPath: "",
    mirror: Mirror.Catboy,
    catboyServer: CatboyServer.Default,
    skipExisting: true,
    backupRetention: 30,
    mirrorRotation: false,
    noVideo: true,
  };

  constructor(contents?: string, isFirstRun = false) {
    this.isFirstRun = isFirstRun;
    let config: Json = {};
    if (contents) {
      try {
        config = JSON.parse(contents) as Json;
      } catch (e) {
        throw Logger.generateErrorLog(new OcdlError("INVALID_CONFIG", e));
      }
    }

    this.logSize = Config._num(config.logSize, 15, 0, Infinity);

    this.parallel = Config._bool(config.parallel, true);

    this.concurrency = Config._num(config.concurrency, 3, 0, 10, 5);

    this.intervalCap = Config._num(config.intervalCap, 50, 0, 120);

    this.directory = this._getPath(config.directory);
    this.mode = this._getMode(config.mode);
    this.useSubfolder = Config._bool(config.useSubfolder, true);

    this.osuPath = this._getOsuPath(config.osuPath);

    if (!this.osuPath || this.osuPath === process.cwd()) {
      const oldCollectionDbPath = this._getPath(config.collectionDbPath);
      const oldSongsPath = this._getPath(config.songsPath);

      if (oldCollectionDbPath && oldCollectionDbPath !== process.cwd() && existsSync(oldCollectionDbPath)) {
        this.osuPath = path.dirname(oldCollectionDbPath);
      } else if (oldSongsPath && oldSongsPath !== process.cwd() && existsSync(oldSongsPath)) {
        this.osuPath = path.dirname(oldSongsPath);
      }
    }

    this.mirror = this._getMirror(config.mirror);
    this.catboyServer = this._getCatboyServer(config.catboyServer);
    this.skipExisting = Config._bool(config.skipExisting, true);

    this.backupRetention = Config._num(config.backupRetention, 30, 1, 1000);

    this.mirrorRotation = Config._bool(config.mirrorRotation, false);

    this.noVideo = Config._bool(config.noVideo, true);
  }

  private static _num(
    raw: JsonValues,
    whenMissing: number,
    min: number,
    max: number,
    whenInvalid: number = whenMissing
  ): number {
    const n = !isNaN(Number(raw)) ? Number(raw) : whenMissing;
    return checkRange(n, min, max) ? n : whenInvalid;
  }

  private static _bool(raw: JsonValues, fallback: boolean): boolean {
    return isBoolean(raw) ? (raw as boolean) : fallback;
  }

  get songsPath(): string {
    if (!this.osuPath) return "";
    return path.join(this.osuPath, "Songs");
  }

  get collectionDbPath(): string {
    if (!this.osuPath) return "";
    return path.join(this.osuPath, "collection.db");
  }

  get osuDbPath(): string {
    if (!this.osuPath) return "";
    return path.join(this.osuPath, "osu!.db");
  }

  get caps(): ModeCapabilities {
    return MODE_CAPABILITIES[this.mode];
  }

  getDownloadPath(collection: Collection): string {
    if (this.caps.dest === "songs") return this.songsPath;
    return this.useSubfolder
      ? path.join(this.directory, collection.getCollectionFolderName())
      : this.directory;
  }

  isOsuPathValid(): boolean {
    return isValidOsuFolder(this.osuPath);
  }

  static generateConfig(): Config {
    const isFirstRun = !existsSync(Config.configFilePath);
    if (isFirstRun) {
      writeFileSync(Config.configFilePath, JSON.stringify(Config.DEFAULTS));
    }
    return new Config(undefined, isFirstRun);
  }

  private _serialize(): Record<string, JsonValues> {
    return {
      parallel: this.parallel,
      concurrency: this.concurrency,
      intervalCap: this.intervalCap,
      logSize: this.logSize,
      directory: this.directory,
      mode: this.mode,
      useSubfolder: this.useSubfolder,
      osuPath: this.osuPath,
      mirror: this.mirror,
      catboyServer: this.catboyServer,
      skipExisting: this.skipExisting,
      backupRetention: this.backupRetention,
      mirrorRotation: this.mirrorRotation,
      noVideo: this.noVideo,
    };
  }

  save(): void {
    writeFileSync(
      Config.configFilePath,
      JSON.stringify(this._serialize(), null, 2)
    );
  }

  private _getMode(data: JsonValues): 1 | 2 | 3 | 4 | 5 {
    const mode = Number(data);
    return mode >= 1 && mode <= 5 ? (mode as 1 | 2 | 3 | 4 | 5) : 1;
  }

  private _getPath(data: JsonValues): string {
    if (typeof data !== "string" || !data) return process.cwd();
    return path.isAbsolute(data) ? data : process.cwd();
  }

  private _getOsuPath(data: JsonValues): string {
    if (typeof data !== "string" || !data) return "";
    return path.isAbsolute(data) ? data : "";
  }

  private _getMirror(data: JsonValues): Mirror {
    if (typeof data === "string" && Object.values(Mirror).includes(data as Mirror)) {
      return data as Mirror;
    }
    return Mirror.Catboy;
  }

  private _getCatboyServer(data: JsonValues): CatboyServer {
    if (typeof data === "string" && Object.values(CatboyServer).includes(data as CatboyServer)) {
      return data as CatboyServer;
    }
    return CatboyServer.Default;
  }
}
