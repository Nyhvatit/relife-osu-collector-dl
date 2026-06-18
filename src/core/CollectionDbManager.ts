import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import _path from "path";
import { collection, config } from "../state";
import OcdlError from "../struct/OcdlError";
import { readOsuString, writeOsuString } from "../struct/osuBinary";

interface CollectionDbEntry {
  name: string;
  md5Hashes: string[];
}

export default class CollectionDbManager {
  private static backedUp = false;

  private collectionDbPath: string;
  private version: number = 20150203;
  private collections: CollectionDbEntry[] = [];
  private offset: number = 0;
  private lastBackupPath: string | null = null;

  static resetBackupSession(): void {
    CollectionDbManager.backedUp = false;
  }

  constructor() {
    this.collectionDbPath = config.collectionDbPath;
  }

  private readOsuString(buffer: Buffer): string {
    const [str, next] = readOsuString(buffer, this.offset);
    this.offset = next;
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

  hasCollection(collectionName: string): boolean {
    return this.collections.some((c) => c.name === collectionName);
  }

  getCollectionSize(collectionName: string): number {
    const coll = this.collections.find((c) => c.name === collectionName);
    return coll ? coll.md5Hashes.length : 0;
  }

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

  writeCollectionDb(): boolean {
    try {
      if (!CollectionDbManager.backedUp) {
        this.lastBackupPath = this._createBackup();
        CollectionDbManager.backedUp = true;
      } else {
        this.lastBackupPath = null;
      }

      const buffers: Buffer[] = [];

      const versionBuffer = Buffer.allocUnsafe(4);
      versionBuffer.writeInt32LE(this.version, 0);
      buffers.push(versionBuffer);

      const countBuffer = Buffer.allocUnsafe(4);
      countBuffer.writeInt32LE(this.collections.length, 0);
      buffers.push(countBuffer);

      for (const coll of this.collections) {
        buffers.push(writeOsuString(coll.name));

        const beatmapCountBuffer = Buffer.allocUnsafe(4);
        beatmapCountBuffer.writeInt32LE(coll.md5Hashes.length, 0);
        buffers.push(beatmapCountBuffer);

        for (const hash of coll.md5Hashes) {
          buffers.push(writeOsuString(hash));
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
      this._pruneBackups(backupDir);
      return backupPath;
    }
    return null;
  }

  private _pruneBackups(backupDir: string): void {
    try {
      const backups = readdirSync(backupDir)
        .filter((f) => f.startsWith("collection.db.") && f.endsWith(".backup"))
        .sort();
      const excess = backups.length - config.backupRetention;
      for (let i = 0; i < excess; i++) {
        try {
          unlinkSync(_path.join(backupDir, backups[i]));
        } catch {
        }
      }
    } catch {
    }
  }

  getLastBackupPath(): string | null {
    return this.lastBackupPath;
  }

  static isOsuRunning(): boolean {
    try {
      const result = execSync('tasklist /FI "IMAGENAME eq osu!.exe"', {
        encoding: "utf-8",
      });
      return result.includes("osu!.exe");
    } catch {
      return false;
    }
  }

  static getMd5HashesWithRealHashes(
    beatmapIdToRealHash: Map<number, string>
  ): {
    hashes: string[];
    replaced: number;
  } {
    const hashes: string[] = [];
    let replaced = 0;

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
        }
      });
    });

    return { hashes, replaced };
  }
}
