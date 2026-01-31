export interface Json {
  [x: string]: JsonValues;
}

export type JsonValues = string | number | boolean | Date | Json | JsonArray;
type JsonArray = Array<string | number | boolean | Date | Json | JsonArray>;

export type Mode = "taiko" | "osu" | "fruits" | "mania";

export enum ModeByte {
  "osu" = 0,
  "taiko" = 1,
  "fruits" = 2,
  "mania" = 3,
}

// Working modes:
// 1 - Download beatmaps only
// 2 - Download beatmaps + generate .osdb
// 3 - Generate .osdb only (no download)
// 4 - Download beatmaps + add to collection.db (maps will be visible in osu!)
// 5 - Add to collection.db only (instant, maps shown as "unknown" until downloaded)
export type WorkingMode = 1 | 2 | 3 | 4 | 5;
