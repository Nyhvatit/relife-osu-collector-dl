export interface Json {
  [x: string]: JsonValues;
}

export type JsonValues = string | number | boolean | Date | Json | JsonArray;
type JsonArray = Array<string | number | boolean | Date | Json | JsonArray>;

export type Mode = "taiko" | "osu" | "fruits" | "mania";

export interface ResolvedBeatmap {
  beatmapsetId: number;
  checksum: string;
  version?: string;
  mode?: string;
  difficulty_rating?: number;
}

export enum ModeByte {
  "osu" = 0,
  "taiko" = 1,
  "fruits" = 2,
  "mania" = 3,
}

export type WorkingMode = 1 | 2 | 3 | 4 | 5;

export interface ModeCapabilities {
  download: boolean;
  osdb: boolean;
  collectionDb: boolean;
  dest: "songs" | "dir";
}

export const MODE_CAPABILITIES: Record<WorkingMode, ModeCapabilities> = {
  1: { download: true, osdb: false, collectionDb: false, dest: "dir" },
  2: { download: true, osdb: true, collectionDb: false, dest: "dir" },
  3: { download: false, osdb: true, collectionDb: false, dest: "dir" },
  4: { download: true, osdb: false, collectionDb: true, dest: "songs" },
  5: { download: false, osdb: false, collectionDb: true, dest: "dir" },
};

export interface MirrorTallyData {
  ok: number;
  fail: number;
  active: number;
  notfound: number;
}

export interface MirrorStatsView extends MirrorTallyData {
  mirror: string;
  banned: boolean;
}
