import { BinaryWriter, File, IFile } from "csbinary";
import { existsSync, mkdirSync, openSync, writeFileSync } from "fs";
import _path from "path";
import { collection, config } from "../state";

export default class OsdbGenerator {
  filePath: string;
  fileName: string;
  file: IFile;
  writer: BinaryWriter;

  constructor() {
    this.fileName = collection.getCollectionName() + ".osdb";

    if (config.mode === 3) {
      // Mode 3: .osdb directly into chosen directory, no subfolder
      this.filePath = _path.join(config.directory, this.fileName);
    } else {
      // Mode 2: .osdb into collection subfolder
      const dir = _path.join(config.directory, collection.getCollectionFolderName());
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      this.filePath = _path.join(dir, this.fileName);
    }

    writeFileSync(this.filePath, "");
    this.file = File(openSync(this.filePath, "w"));
    this.writer = new BinaryWriter(this.file);
  }

  // Reference: https://github.com/Piotrekol/CollectionManager/blob/master/CollectionManagerDll/Modules/FileIO/FileCollections/OsdbCollectionHandler.cs#L89
  writeOsdb(): void {
    // Version o!dm6 (uncompressed)
    this.writer.writeString("o!dm6");

    // OADate
    this.writer.writeDouble(this._toOADate(new Date()));

    // Editor
    this.writer.writeString(collection.uploader.username);

    // Number of collections (always 1)
    this.writer.writeInt32(1);

    // Collection name
    this.writer.writeString(collection.name);

    // Beatmap count
    this.writer.writeInt32(collection.beatMapCount);

    // Write beatmap info
    collection.beatMapSets.forEach((beatMapSet, beatMapSetId) => {
      beatMapSet.beatMaps.forEach((beatmap, beatMapId) => {
        this.writer.writeInt32(beatMapId);
        this.writer.writeInt32(beatMapSetId);
        this.writer.writeString(beatMapSet.artist ?? "Unknown");
        this.writer.writeString(beatMapSet.title ?? "Unknown");
        this.writer.writeString(beatmap.version ?? "Unknown");
        this.writer.writeString(beatmap.checksum);
        this.writer.writeString(""); // User comment
        this.writer.writeByte(beatmap.mode ?? 0);
        this.writer.writeDouble(beatmap.difficulty_rating ?? 0);
      });
    });

    // Map with hash (always 0)
    this.writer.writeInt32(0);

    // Footer
    this.writer.writeString("By Piotrekol");

    this.writer.close();
  }

  private _toOADate(date: Date): number {
    const timezoneOffset = date.getTimezoneOffset() / (60 * 24);
    return date.getTime() / 86400000 + (25569 - timezoneOffset);
  }
}
