import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "fs";
import _path from "path";
import { collection, config } from "../state";
import OcdlError from "../struct/OcdlError";

interface CollectionDbEntry {
  name: string;
  md5Hashes: string[];
}

export default class CollectionDbManager {
  private collectionDbPath: string;
  private version: number = 20150203;
  private collections: CollectionDbEntry[] = [];
  private offset: number = 0;
  private lastBackupPath: string | null = null;

  constructor() {
    this.collectionDbPath = config.collectionDbPath;
  }

  private readOsuString(buffer: Buffer): string {
    const indicator = buffer.readUInt8(this.offset);
    this.offset += 1;

    if (indicator === 0x00) return "";

    if (indicator !== 0x0b) {
      throw new Error(`Invalid string indicator: ${indicator}`);
    }

    // Read ULEB128 length
    let length = 0;
    let shift = 0;
    let byte = 0;

    do {
      byte = buffer.readUInt8(this.offset);
      this.offset += 1;
      length |= (byte & 0x7f) << shift;
      shift += 7;
    } while ((byte & 0x80) !== 0);

    const str = buffer.toString("utf-8", this.offset, this.offset + length);
    this.offset += length;

    return str;
  }

  readCollectionDb(): boolean {
    try {
      if (!existsSync(this.collectionDbPath)) {
        this.collections = [];
        return true;
      }

      const buffer = readFileSync(this.collectionDbPath);
      this.offset = 0;

      this.version = buffer.readInt32LE(this.offset);
      this.offset += 4;

      const collectionCount = buffer.readInt32LE(this.offset);
      this.offset += 4;

      for (let i = 0; i < collectionCount; i++) {
        const name = this.readOsuString(buffer);
        const beatmapCount = buffer.readInt32LE(this.offset);
        this.offset += 4;

        const md5Hashes: string[] = [];
        for (let j = 0; j < beatmapCount; j++) {
          md5Hashes.push(this.readOsuString(buffer));
        }

        this.collections.push({ name, md5Hashes });
      }

      return true;
    } catch (e) {
      throw new OcdlError("COLLECTION_DB_READ_FAILED", e);
    }
  }

  /**
   * Check if collection with this name exists
   */
  hasCollection(collectionName: string): boolean {
    return this.collections.some((c) => c.name === collectionName);
  }

  /**
   * Get number of beatmaps in collection (or 0 if doesn't exist)
   */
  getCollectionSize(collectionName: string): number {
    const coll = this.collections.find((c) => c.name === collectionName);
    return coll ? coll.md5Hashes.length : 0;
  }

  /**
   * Add collection (merges if exists)
   */
  addCollection(collectionName: string, md5Hashes: string[]): void {
    const existingIndex = this.collections.findIndex(
      (c) => c.name === collectionName
    );

    if (existingIndex !== -1) {
      const existing = this.collections[existingIndex];
      const uniqueHashes = new Set([...existing.md5Hashes, ...md5Hashes]);
      this.collections[existingIndex].md5Hashes = Array.from(uniqueHashes);
    } else {
      this.collections.push({ name: collectionName, md5Hashes });
    }
  }

  /**
   * Replace collection (completely overwrites if exists)
   */
  replaceCollection(collectionName: string, md5Hashes: string[]): void {
    const existingIndex = this.collections.findIndex(
      (c) => c.name === collectionName
    );

    if (existingIndex !== -1) {
      this.collections[existingIndex].md5Hashes = md5Hashes;
    } else {
      this.collections.push({ name: collectionName, md5Hashes });
    }
  }

  private writeOsuString(str: string): Buffer {
    if (!str || str.length === 0) {
      return Buffer.from([0x00]);
    }

    const strBuffer = Buffer.from(str, "utf-8");
    const length = strBuffer.length;

    // Encode length as ULEB128
    const lengthBytes: number[] = [];
    let value = length;
    do {
      let byte = value & 0x7f;
      value >>= 7;
      if (value !== 0) byte |= 0x80;
      lengthBytes.push(byte);
    } while (value !== 0);

    return Buffer.concat([
      Buffer.from([0x0b]),
      Buffer.from(lengthBytes),
      strBuffer,
    ]);
  }

  writeCollectionDb(): boolean {
    try {
      this.lastBackupPath = this._createBackup();

      const buffers: Buffer[] = [];

      const versionBuffer = Buffer.allocUnsafe(4);
      versionBuffer.writeInt32LE(this.version, 0);
      buffers.push(versionBuffer);

      const countBuffer = Buffer.allocUnsafe(4);
      countBuffer.writeInt32LE(this.collections.length, 0);
      buffers.push(countBuffer);

      for (const coll of this.collections) {
        buffers.push(this.writeOsuString(coll.name));

        const beatmapCountBuffer = Buffer.allocUnsafe(4);
        beatmapCountBuffer.writeInt32LE(coll.md5Hashes.length, 0);
        buffers.push(beatmapCountBuffer);

        for (const hash of coll.md5Hashes) {
          buffers.push(this.writeOsuString(hash));
        }
      }

      writeFileSync(this.collectionDbPath, Buffer.concat(buffers));
      return true;
    } catch (e) {
      throw new OcdlError("COLLECTION_DB_WRITE_FAILED", e);
    }
  }

  private _createBackup(): string | null {
    if (existsSync(this.collectionDbPath)) {
      const dbDir = _path.dirname(this.collectionDbPath);
      const backupDir = _path.join(dbDir, "backup collections");

      if (!existsSync(backupDir)) {
        mkdirSync(backupDir, { recursive: true });
      }

      const timestamp = new Date()
        .toISOString()
        .replace(/:/g, "-")
        .replace(/\..+/, "")
        .replace("T", "_");
      const backupPath = _path.join(
        backupDir,
        `collection.db.${timestamp}.backup`
      );

      copyFileSync(this.collectionDbPath, backupPath);
      return backupPath;
    }
    return null;
  }

  getLastBackupPath(): string | null {
    return this.lastBackupPath;
  }

  static isOsuRunning(): boolean {
    try {
      const { execSync } = require("child_process");
      const result = execSync('tasklist /FI "IMAGENAME eq osu!.exe"', {
        encoding: "utf-8",
      });
      return result.includes("osu!.exe");
    } catch {
      return false;
    }
  }

  static getMd5HashesFromCollection(): string[] {
    const hashes: string[] = [];
    collection.beatMapSets.forEach((beatMapSet) => {
      beatMapSet.beatMaps.forEach((beatMap) => {
        if (beatMap.checksum) {
          hashes.push(beatMap.checksum);
        }
      });
    });
    return hashes;
  }

  /**
   * Get hashes from collection, replacing apiHash with realHash where possible
   * @param beatmapIdToRealHash mapping beatmapId -> realHash from osu!.db
   * @param savedBeatMaps optional saved beatmaps data (use when collection.beatMapSets may be modified)
   */
  static getMd5HashesWithRealHashes(
    beatmapIdToRealHash: Map<number, string>,
    savedBeatMaps?: Array<{ id: number; checksum: string }>
  ): {
    hashes: string[];
    replaced: number;
    notFound: number
  } {
    const hashes: string[] = [];
    let replaced = 0;
    let notFound = 0;

    // Use saved beatmaps if provided, otherwise read from collection
    if (savedBeatMaps) {
      for (const beatMap of savedBeatMaps) {
        const realHash = beatmapIdToRealHash.get(beatMap.id);
        if (realHash) {
          hashes.push(realHash);
          if (realHash !== beatMap.checksum) {
            replaced++;
          }
        } else if (beatMap.checksum) {
          hashes.push(beatMap.checksum);
          notFound++;
        }
      }
    } else {
      collection.beatMapSets.forEach((beatMapSet) => {
        beatMapSet.beatMaps.forEach((beatMap) => {
          const realHash = beatmapIdToRealHash.get(beatMap.id);
          if (realHash) {
            hashes.push(realHash);
            if (realHash !== beatMap.checksum) {
              replaced++;
            }
          } else if (beatMap.checksum) {
            hashes.push(beatMap.checksum);
            notFound++;
          }
        });
      });
    }

    return { hashes, replaced, notFound };
  }

  // Get mapping oldMd5 -> beatmapId from current collection (API data)
  static getApiHashToBeatmapId(): Map<string, number> {
    const map = new Map<string, number>();
    collection.beatMapSets.forEach((beatMapSet) => {
      beatMapSet.beatMaps.forEach((beatMap) => {
        if (beatMap.checksum) {
          map.set(beatMap.checksum, beatMap.id);
        }
      });
    });
    return map;
  }

  // Fix hashes in collection.db using mapping oldMd5 -> newMd5
  fixHashes(hashMapping: Map<string, string>): { totalFixed: number; collectionStats: Map<string, { fixed: number; total: number }> } {
    let totalFixed = 0;
    const collectionStats = new Map<string, { fixed: number; total: number }>();

    for (const coll of this.collections) {
      let fixed = 0;
      const newHashes: string[] = [];

      for (const oldHash of coll.md5Hashes) {
        const newHash = hashMapping.get(oldHash);
        if (newHash && newHash !== oldHash) {
          newHashes.push(newHash);
          fixed++;
          totalFixed++;
        } else {
          newHashes.push(oldHash);
        }
      }

      coll.md5Hashes = newHashes;
      collectionStats.set(coll.name, { fixed, total: coll.md5Hashes.length });
    }

    return { totalFixed, collectionStats };
  }

  getCollections(): CollectionDbEntry[] {
    return this.collections;
  }
}
