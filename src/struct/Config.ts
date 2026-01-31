import { existsSync, writeFileSync } from "fs";
import path from "path";
import Logger from "../core/Logger";
import type { Json, JsonValues, WorkingMode } from "../types";
import { isBoolean, checkRange } from "../util";
import OcdlError from "./OcdlError";
import { CatboyServer, Mirror } from "./Constant";

export default class Config {
  parallel: boolean;
  concurrency: number;
  intervalCap: number;
  directory: string; // For modes 1, 2, 3 — download destination
  mode: WorkingMode;
  logSize: number;
  useSubfolder: boolean; // For modes 1, 2, 3 — create subfolder
  osuPath: string; // osu! game folder
  mirror: Mirror;
  catboyServer: CatboyServer;
  isFirstRun: boolean;
  skipExisting: boolean; // Skip downloading beatmapsets that already exist in Songs

  static readonly configFilePath = "./config.json";

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

    this.logSize = !isNaN(Number(config.logSize)) ? Number(config.logSize) : 15;
    if (!checkRange(this.logSize, 0, Infinity)) {
      this.logSize = 15;
    }

    this.parallel = isBoolean(config.parallel)
      ? (config.parallel as boolean)
      : true;

    this.concurrency = !isNaN(Number(config.concurrency))
      ? Number(config.concurrency)
      : 3;
    if (!checkRange(this.concurrency, 0, 10)) {
      this.concurrency = 5;
    }

    this.intervalCap = !isNaN(Number(config.intervalCap))
      ? Number(config.intervalCap)
      : 50;
    if (!checkRange(this.intervalCap, 0, 120)) {
      this.intervalCap = 50;
    }

    this.directory = this._getPath(config.directory);
    this.mode = this._getMode(config.mode);
    this.useSubfolder = isBoolean(config.useSubfolder)
      ? (config.useSubfolder as boolean)
      : true;

    // osuPath — main setting, other paths are derived from it
    this.osuPath = this._getOsuPath(config.osuPath);

    // Migration: if old settings collectionDbPath/songsPath exist, derive osuPath from them
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
    this.skipExisting = isBoolean(config.skipExisting)
      ? (config.skipExisting as boolean)
      : true;
  }

  // Getters for automatic path resolution from osuPath
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

  // Validate osuPath
  isOsuPathValid(): boolean {
    if (!this.osuPath) return false;
    return existsSync(this.osuPath) &&
           existsSync(this.songsPath) &&
           existsSync(this.osuDbPath);
  }

  static generateConfig(): Config {
    const isFirstRun = !existsSync(Config.configFilePath);
    if (isFirstRun) {
      writeFileSync(
        Config.configFilePath,
        JSON.stringify({
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
        })
      );
    }
    return new Config(undefined, isFirstRun);
  }

  save(): void {
    writeFileSync(
      Config.configFilePath,
      JSON.stringify(
        {
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
        },
        null,
        2
      )
    );
  }

  // Validate and get working mode with default value
  private _getMode(data: JsonValues): 1 | 2 | 3 | 4 | 5 {
    const mode = Number(data);
    // Check that mode is valid (1-5)
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
