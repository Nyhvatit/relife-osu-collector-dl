import { existsSync, readFileSync } from "fs";
import OcdlError from "../struct/OcdlError";

interface OsuDbBeatmap {
  beatmapId: number;
  beatmapsetId: number;
  md5Hash: string;
}

/**
 * Reads osu!.db and extracts mapping md5Hash -> beatmapId
 * Format: https://osu.ppy.sh/wiki/en/Client/File_formats/osu!.db
 */
export default class OsuDbReader {
  private filePath: string;
  private buffer: Buffer = Buffer.alloc(0);
  private offset: number = 0;
  private version: number = 0;

  constructor(osuDbPath: string) {
    this.filePath = osuDbPath;
  }

  /**
   * Reads osu!.db and returns mapping md5Hash -> beatmapId
   */
  read(): Map<string, number> {
    const { hashToBeatmapId } = this.parse();
    return hashToBeatmapId;
  }

  /**
   * Reads osu!.db and returns mapping beatmapId -> md5Hash
   * Used for replacing API hashes with real hashes
   */
  readBeatmapIdToHash(): Map<number, string> {
    const { beatmapIdToHash } = this.parse();
    return beatmapIdToHash;
  }

  /**
   * Reads osu!.db and returns Set of all md5 hashes
   * Used to check which beatmaps are already downloaded
   */
  readAllHashes(): Set<string> {
    const { allHashes } = this.parse();
    return allHashes;
  }

  /**
   * Reads osu!.db and returns Set of all beatmapsetIds
   * Used to check which beatmapsets are already downloaded
   */
  readAllBeatmapsetIds(): Set<number> {
    const { beatmapsetIds } = this.parse();
    return beatmapsetIds;
  }

  private parse(): {
    hashToBeatmapId: Map<string, number>;
    beatmapIdToHash: Map<number, string>;
    beatmapsetIds: Set<number>;
    allHashes: Set<string>;
  } {
    if (!existsSync(this.filePath)) {
      throw new OcdlError("OSU_DB_NOT_FOUND", `File not found: ${this.filePath}`);
    }

    this.buffer = readFileSync(this.filePath);
    this.offset = 0;

    const hashToBeatmapId = new Map<string, number>();
    const beatmapIdToHash = new Map<number, string>();
    const beatmapsetIds = new Set<number>();
    const allHashes = new Set<string>();

    try {
      // Version (Int)
      this.version = this.readInt();

      // Folder count (Int)
      this.readInt();

      // Account unlocked (Bool)
      this.readBool();

      // Date account unlocked (DateTime - 8 bytes)
      this.offset += 8;

      // Player name (String)
      this.readString();

      // Number of beatmaps (Int)
      const beatmapCount = this.readInt();

      // Read beatmaps
      for (let i = 0; i < beatmapCount; i++) {
        const beatmap = this.readBeatmap();
        if (beatmap && beatmap.md5Hash) {
          allHashes.add(beatmap.md5Hash);
          if (beatmap.beatmapId > 0) {
            hashToBeatmapId.set(beatmap.md5Hash, beatmap.beatmapId);
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

    return { hashToBeatmapId, beatmapIdToHash, beatmapsetIds, allHashes };
  }

  private readBeatmap(): OsuDbBeatmap | null {
    try {
      // Size in bytes (Int) - only for version < 20191106
      if (this.version < 20191106) {
        this.readInt();
      }

      // Artist name (String)
      this.readString();

      // Artist name unicode (String)
      this.readString();

      // Song title (String)
      this.readString();

      // Song title unicode (String)
      this.readString();

      // Creator name (String)
      this.readString();

      // Difficulty (String)
      this.readString();

      // Audio file name (String)
      this.readString();

      // MD5 hash (String)
      const md5Hash = this.readString();

      // .osu file name (String)
      this.readString();

      // Ranked status (Byte)
      this.readByte();

      // Number of hitcircles (Short)
      this.readShort();

      // Number of sliders (Short)
      this.readShort();

      // Number of spinners (Short)
      this.readShort();

      // Last modification time (Long)
      this.offset += 8;

      // Approach rate (Single/Byte depending on version)
      if (this.version < 20140609) {
        this.readByte();
      } else {
        this.readSingle();
      }

      // Circle size (Single/Byte)
      if (this.version < 20140609) {
        this.readByte();
      } else {
        this.readSingle();
      }

      // HP drain (Single/Byte)
      if (this.version < 20140609) {
        this.readByte();
      } else {
        this.readSingle();
      }

      // Overall difficulty (Single/Byte)
      if (this.version < 20140609) {
        this.readByte();
      } else {
        this.readSingle();
      }

      // Slider velocity (Double)
      this.readDouble();

      // Star rating for osu! standard (Int-Double pairs)
      if (this.version >= 20140609) {
        this.readIntDoublePairs();
      }

      // Star rating for Taiko
      if (this.version >= 20140609) {
        this.readIntDoublePairs();
      }

      // Star rating for CTB
      if (this.version >= 20140609) {
        this.readIntDoublePairs();
      }

      // Star rating for Mania
      if (this.version >= 20140609) {
        this.readIntDoublePairs();
      }

      // Drain time (Int)
      this.readInt();

      // Total time (Int)
      this.readInt();

      // Audio preview time (Int)
      this.readInt();

      // Timing points
      const timingPointCount = this.readInt();
      // Each timing point: Double + Double + Bool = 17 bytes
      this.offset += timingPointCount * 17;

      // Beatmap ID (Int)
      const beatmapId = this.readInt();

      // Beatmapset ID (Int)
      const beatmapsetId = this.readInt();

      // Thread ID (Int)
      this.readInt();

      // Grade osu! (Byte)
      this.readByte();

      // Grade Taiko (Byte)
      this.readByte();

      // Grade CTB (Byte)
      this.readByte();

      // Grade Mania (Byte)
      this.readByte();

      // Local offset (Short)
      this.readShort();

      // Stack leniency (Single)
      this.readSingle();

      // Game mode (Byte)
      this.readByte();

      // Song source (String)
      this.readString();

      // Song tags (String)
      this.readString();

      // Online offset (Short)
      this.readShort();

      // Font (String)
      this.readString();

      // Unplayed (Bool)
      this.readBool();

      // Last played time (Long)
      this.offset += 8;

      // Is osz2 (Bool)
      this.readBool();

      // Folder name (String)
      this.readString();

      // Last checked against repo (Long)
      this.offset += 8;

      // Ignore beatmap sound (Bool)
      this.readBool();

      // Ignore beatmap skin (Bool)
      this.readBool();

      // Disable storyboard (Bool)
      this.readBool();

      // Disable video (Bool)
      this.readBool();

      // Visual override (Bool)
      this.readBool();

      // Unknown (Short) - only for version < 20140609
      if (this.version < 20140609) {
        this.readShort();
      }

      // Last modification time (Int)
      this.readInt();

      // Mania scroll speed (Byte)
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
    const indicator = this.readByte();

    if (indicator === 0x00) {
      return "";
    }

    if (indicator !== 0x0b) {
      throw new Error(`Invalid string indicator: ${indicator}`);
    }

    // Read ULEB128 length
    let length = 0;
    let shift = 0;
    let byte = 0;

    do {
      byte = this.readByte();
      length |= (byte & 0x7f) << shift;
      shift += 7;
    } while ((byte & 0x80) !== 0);

    const str = this.buffer.toString("utf-8", this.offset, this.offset + length);
    this.offset += length;

    return str;
  }

  private readIntDoublePairs(): void {
    const count = this.readInt();
    // Version >= 20250107: Int-Float pairs (0x08 + Int(4) + 0x0c + Float(4) = 10 bytes)
    // Version < 20250107: Int-Double pairs (0x08 + Int(4) + 0x0d + Double(8) = 14 bytes)
    const bytesPerPair = this.version >= 20250107 ? 10 : 14;
    this.offset += count * bytesPerPair;
  }
}
