import { v1ResBeatMapType } from "../core/Requestor";
import type { Json } from "../types";
import { checkUndefined } from "../util";
import OcdlError from "./OcdlError";

export type BeatMapId = number;

export class BeatMap {
  id: BeatMapId;
  checksum: string;
  version?: string;
  mode?: number;
  difficulty_rating?: number;

  constructor(jsonData: Json) {
    const und = checkUndefined(jsonData, ["id", "checksum"]);
    if (und) {
      throw new OcdlError("CORRUPTED_RESPONSE", `${und} is required`);
    }

    const { id, checksum } = jsonData as v1ResBeatMapType;
    this.id = id;
    this.checksum = checksum;
  }
}
