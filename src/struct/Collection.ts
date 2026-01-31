import OcdlError from "./OcdlError";
import { BeatMapSet, BeatMapSetId } from "./BeatMapSet";
import { checkUndefined, replaceForbiddenChars } from "../util";
import { Json, ModeByte } from "../types";
import {
  v1ResBeatMapSetType,
  v1ResCollectionType,
  v2ResBeatMapType,
} from "../core/Requestor";

export type CollectionId = number;

export class Collection {
  beatMapSets: Map<BeatMapSetId, BeatMapSet> = new Map();
  beatMapSetCount = 0;
  beatMapCount = 0;
  id: CollectionId = 0;
  name = "Unknown";
  uploader: { username: string } = { username: "Unknown" };

  reset(): void {
    this.beatMapSets = new Map();
    this.beatMapSetCount = 0;
    this.beatMapCount = 0;
    this.id = 0;
    this.name = "Unknown";
    this.uploader = { username: "Unknown" };
  }

  resolveData(jsonData: Json = {}) {
    const und = checkUndefined(jsonData, ["id", "name", "uploader", "beatmapsets"]);
    if (und) {
      throw new OcdlError("CORRUPTED_RESPONSE", `${und} is required`);
    }

    const { id, name, uploader, beatmapsets } = jsonData as v1ResCollectionType;

    this.id = id;
    this.name = name;
    this.uploader = uploader;
    // Parse beatmapsets and count beatmaps in one pass
    const { beatMapSets, beatMapCount } = this._resolveBeatMapSets(beatmapsets);
    this.beatMapSets = beatMapSets;
    this.beatMapSetCount = beatMapSets.size;
    this.beatMapCount = beatMapCount;
  }

  getCollectionName(): string {
    return replaceForbiddenChars(this.name).trim();
  }

  getCollectionFolderName(): string {
    return this.id.toString() + " - " + this.getCollectionName();
  }

  resolveFullData(jsonBeatMaps: v2ResBeatMapType[]): void {
    if (!jsonBeatMaps.length) {
      throw new OcdlError("CORRUPTED_RESPONSE", "No beatmap found");
    }

    for (const data of jsonBeatMaps) {
      const und = checkUndefined(data, [
        "id",
        "mode",
        "difficulty_rating",
        "version",
        "beatmapset",
      ]);
      if (und) {
        throw new OcdlError("CORRUPTED_RESPONSE", `${und} is required`);
      }

      const { id, mode, difficulty_rating, version, beatmapset } = data;

      const beatMapSet = this.beatMapSets.get(beatmapset.id);
      if (!beatMapSet) continue;

      beatMapSet.title = beatmapset.title;
      beatMapSet.artist = beatmapset.artist;

      const beatMap = beatMapSet.beatMaps.get(id);
      if (!beatMap) continue;

      beatMap.difficulty_rating = difficulty_rating;
      beatMap.mode = +ModeByte[mode];
      beatMap.version = version;
    }
  }

  // Parse beatmapsets with beatmaps count in single array pass
  // Optimization: avoid double iteration over array
  private _resolveBeatMapSets(
    jsonBeatMapSets: v1ResBeatMapSetType[]
  ): { beatMapSets: Map<number, BeatMapSet>; beatMapCount: number } {
    let beatMapCount = 0;
    const beatMapSets = new Map<number, BeatMapSet>();

    for (const current of jsonBeatMapSets) {
      try {
        const map = new BeatMapSet(current);
        beatMapSets.set(map.id, map);
        beatMapCount += current.beatmaps.length;
      } catch (e) {
        throw new OcdlError("CORRUPTED_RESPONSE", e);
      }
    }

    return { beatMapSets, beatMapCount };
  }
}
