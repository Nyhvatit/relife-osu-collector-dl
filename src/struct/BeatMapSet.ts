import { v1ResBeatMapSetType, v1ResBeatMapType } from "../core/Requestor";
import type { Json } from "../types";
import { checkUndefined } from "../util";
import { BeatMap, BeatMapId } from "./BeatMap";
import OcdlError from "./OcdlError";

export type BeatMapSetId = number;

export class BeatMapSet {
  id: BeatMapSetId;
  beatMaps: Map<BeatMapId, BeatMap>;
  title?: string;
  artist?: string;

  constructor(jsonData: Json) {
    const und = checkUndefined(jsonData, ["id", "beatmaps"]);
    if (und) {
      throw new OcdlError("CORRUPTED_RESPONSE", `${und} is required`);
    }

    const { id, beatmaps } = jsonData as v1ResBeatMapSetType;
    this.id = id;
    this.beatMaps = this._resolveBeatMaps(beatmaps);
  }

  private _resolveBeatMaps(jsonBeatMaps: v1ResBeatMapType[]): Map<number, BeatMap> {
    return jsonBeatMaps.reduce((acc, current) => {
      try {
        const map = new BeatMap(current);
        acc.set(map.id, map);
        return acc;
      } catch (e) {
        throw new OcdlError("CORRUPTED_RESPONSE", e);
      }
    }, new Map<number, BeatMap>());
  }
}
