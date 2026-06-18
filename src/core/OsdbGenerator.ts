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

    if (!config.caps.download) {
      this.filePath = _path.join(config.directory, this.fileName);
    } else {
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

  writeOsdb(): void {
    this.writer.writeString("o!dm6");

    this.writer.writeDouble(this._toOADate(new Date()));

    this.writer.writeString(collection.uploader.username);

    this.writer.writeInt32(1);

    this.writer.writeString(collection.name);

    this.writer.writeInt32(collection.beatMapCount);

    collection.beatMapSets.forEach((beatMapSet, beatMapSetId) => {
      beatMapSet.beatMaps.forEach((beatmap, beatMapId) => {
        this.writer.writeInt32(beatMapId);
        this.writer.writeInt32(beatMapSetId);
        this.writer.writeString(beatMapSet.artist ?? "Unknown");
        this.writer.writeString(beatMapSet.title ?? "Unknown");
        this.writer.writeString(beatmap.version ?? "Unknown");
        this.writer.writeString(beatmap.checksum);
        this.writer.writeString("");
        this.writer.writeByte(beatmap.mode ?? 0);
        this.writer.writeDouble(beatmap.difficulty_rating ?? 0);
      });
    });

    this.writer.writeInt32(0);

    this.writer.writeString("By Piotrekol");

    this.writer.close();
  }

  private _toOADate(date: Date): number {
    const timezoneOffset = date.getTimezoneOffset() / (60 * 24);
    return date.getTime() / 86400000 + (25569 - timezoneOffset);
  }
}
