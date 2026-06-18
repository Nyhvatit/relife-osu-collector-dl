import { existsSync, readFileSync } from "fs";
import OcdlError from "../struct/OcdlError";
import { readOsuString } from "../struct/osuBinary";

interface OsuDbBeatmap {
  beatmapId: number;
  beatmapsetId: number;
  md5Hash: string;
}

export default class OsuDbReader {
  private filePath: string;
  private buffer: Buffer = Buffer.alloc(0);
  private offset: number = 0;
  private version: number = 0;
  private parsed: {
    beatmapIdToHash: Map<number, string>;
    beatmapsetIds: Set<number>;
    allHashes: Set<string>;
  } | null = null;

  constructor(osuDbPath: string) {
    this.filePath = osuDbPath;
  }

  readBeatmapIdToHash(): Map<number, string> {
    const { beatmapIdToHash } = this.parse();
    return beatmapIdToHash;
  }

  readAllHashes(): Set<string> {
    const { allHashes } = this.parse();
    return allHashes;
  }

  readAllBeatmapsetIds(): Set<number> {
    const { beatmapsetIds } = this.parse();
    return beatmapsetIds;
  }

  private parse(): {
    beatmapIdToHash: Map<number, string>;
    beatmapsetIds: Set<number>;
    allHashes: Set<string>;
  } {
    if (this.parsed) return this.parsed;

    if (!existsSync(this.filePath)) {
      throw new OcdlError("OSU_DB_NOT_FOUND", `File not found: ${this.filePath}`);
    }

    this.buffer = readFileSync(this.filePath);
    this.offset = 0;

    const beatmapIdToHash = new Map<number, string>();
    const beatmapsetIds = new Set<number>();
    const allHashes = new Set<string>();

    try {
      this.version = this.readInt();

      this.readInt();

      this.readBool();

      this.offset += 8;

      this.readString();

      const beatmapCount = this.readInt();

      for (let i = 0; i < beatmapCount; i++) {
        const beatmap = this.readBeatmap();
        if (beatmap && beatmap.md5Hash) {
          allHashes.add(beatmap.md5Hash);
          if (beatmap.beatmapId > 0) {
            beatmapIdToHash.set(beatmap.beatmapId, beatmap.md5Hash);
          }
          if (beatmap.beatmapsetId > 0) {
            beatmapsetIds.add(beatmap.beatmapsetId);
          }
        }
      }
    } catch (e) {
      throw new OcdlError("OSU_DB_READ_FAILED", e);
    }

    this.parsed = { beatmapIdToHash, beatmapsetIds, allHashes };
    return this.parsed;
  }

  private readBeatmap(): OsuDbBeatmap | null {
    try {
      if (this.version < 20191106) {
        this.readInt();
      }

      this.readString();

      this.readString();

      this.readString();

      this.readString();

      this.readString();

      this.readString();

      this.readString();

      const md5Hash = this.readString();

      this.readString();

      this.readByte();

      this.readShort();

      this.readShort();

      this.readShort();

      this.offset += 8;

      if (this.version < 20140609) {
        this.readByte();
      } else {
        this.readSingle();
      }

      if (this.version < 20140609) {
        this.readByte();
      } else {
        this.readSingle();
      }

      if (this.version < 20140609) {
        this.readByte();
      } else {
        this.readSingle();
      }

      if (this.version < 20140609) {
        this.readByte();
      } else {
        this.readSingle();
      }

      this.readDouble();

      if (this.version >= 20140609) {
        this.readIntDoublePairs();
      }

      if (this.version >= 20140609) {
        this.readIntDoublePairs();
      }

      if (this.version >= 20140609) {
        this.readIntDoublePairs();
      }

      if (this.version >= 20140609) {
        this.readIntDoublePairs();
      }

      this.readInt();

      this.readInt();

      this.readInt();

      const timingPointCount = this.readInt();
      this.offset += timingPointCount * 17;

      const beatmapId = this.readInt();

      const beatmapsetId = this.readInt();

      this.readInt();

      this.readByte();

      this.readByte();

      this.readByte();

      this.readByte();

      this.readShort();

      this.readSingle();

      this.readByte();

      this.readString();

      this.readString();

      this.readShort();

      this.readString();

      this.readBool();

      this.offset += 8;

      this.readBool();

      this.readString();

      this.offset += 8;

      this.readBool();

      this.readBool();

      this.readBool();

      this.readBool();

      this.readBool();

      if (this.version < 20140609) {
        this.readShort();
      }

      this.readInt();

      this.readByte();

      return { beatmapId, beatmapsetId, md5Hash };
    } catch {
      return null;
    }
  }

  private readByte(): number {
    const value = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  private readShort(): number {
    const value = this.buffer.readInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  private readInt(): number {
    const value = this.buffer.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  private readSingle(): number {
    const value = this.buffer.readFloatLE(this.offset);
    this.offset += 4;
    return value;
  }

  private readDouble(): number {
    const value = this.buffer.readDoubleLE(this.offset);
    this.offset += 8;
    return value;
  }

  private readBool(): boolean {
    return this.readByte() !== 0;
  }

  private readString(): string {
    const [str, next] = readOsuString(this.buffer, this.offset);
    this.offset = next;
    return str;
  }

  private readIntDoublePairs(): void {
    const count = this.readInt();
    const bytesPerPair = this.version >= 20250107 ? 10 : 14;
    this.offset += count * bytesPerPair;
  }
}
