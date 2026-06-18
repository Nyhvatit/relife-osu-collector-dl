import { BeatMap } from "./BeatMap";
import { BeatMapSet, BeatMapSetId } from "./BeatMapSet";
import { ModeByte } from "../types";
import { checkUndefined } from "../util";
import type { Json, ResolvedBeatmap } from "../types";
import OcdlError from "./OcdlError";

export interface TournamentStage {
  name: string;
  beatMapSets: Map<BeatMapSetId, BeatMapSet>;
  beatMapCount: number;
  unresolvedBeatmapIds: number[];
}

interface TourMapData {
  id: number;
  checksum: string;
  version?: string;
  mode?: string;
  difficulty_rating?: number;
  beatmapset: { id: number; title?: string; artist?: string };
}
interface TourModData {
  mod: string;
  maps: TourMapData[];
}
interface TourRoundData {
  round: string;
  mods: TourModData[];
}

export class Tournament {
  id = 0;
  name = "Unknown";
  uploaderName = "Unknown";
  stages: TournamentStage[] = [];
  unresolvedCount = 0;

  constructor(jsonData: Json = {}) {
    const und = checkUndefined(jsonData, ["id", "name", "rounds"]);
    if (und) {
      throw new OcdlError("CORRUPTED_RESPONSE", `${und} is required`);
    }

    this.id = jsonData.id as number;
    this.name = jsonData.name as string;

    const uploader = jsonData.uploader as { username?: string } | undefined;
    if (uploader?.username) this.uploaderName = uploader.username;

    const rounds = jsonData.rounds as unknown as TourRoundData[];
    for (const round of rounds) {
      this.stages.push(this.resolveStage(round));
    }
  }

  static mergeStages(name: string, stages: TournamentStage[]): TournamentStage {
    const beatMapSets = new Map<BeatMapSetId, BeatMapSet>();
    for (const stage of stages) {
      stage.beatMapSets.forEach((set, setId) => {
        let target = beatMapSets.get(setId);
        if (!target) {
          target = new BeatMapSet({ id: setId, beatmaps: [] });
          target.title = set.title;
          target.artist = set.artist;
          beatMapSets.set(setId, target);
        }
        set.beatMaps.forEach((bm, id) => target!.beatMaps.set(id, bm));
      });
    }

    let beatMapCount = 0;
    beatMapSets.forEach((set) => (beatMapCount += set.beatMaps.size));

    return { name, beatMapSets, beatMapCount, unresolvedBeatmapIds: [] };
  }

  private resolveStage(round: TourRoundData): TournamentStage {
    const beatMapSets = new Map<BeatMapSetId, BeatMapSet>();
    const unresolvedBeatmapIds: number[] = [];

    for (const modGroup of round.mods ?? []) {
      for (const map of modGroup.maps ?? []) {
        const setId = map.beatmapset?.id;
        if (setId == null) {
          if (map.id != null) unresolvedBeatmapIds.push(map.id);
          this.unresolvedCount++;
          continue;
        }

        let set = beatMapSets.get(setId);
        if (!set) {
          set = new BeatMapSet({ id: setId, beatmaps: [] });
          set.title = map.beatmapset.title;
          set.artist = map.beatmapset.artist;
          beatMapSets.set(set.id, set);
        }

        const beatMap = new BeatMap({ id: map.id, checksum: map.checksum });
        beatMap.version = map.version;
        beatMap.difficulty_rating = map.difficulty_rating;
        if (map.mode) beatMap.mode = +ModeByte[map.mode as keyof typeof ModeByte];
        set.beatMaps.set(beatMap.id, beatMap);
      }
    }

    let beatMapCount = 0;
    beatMapSets.forEach((set) => (beatMapCount += set.beatMaps.size));

    return { name: round.round, beatMapSets, beatMapCount, unresolvedBeatmapIds };
  }

  addResolvedMap(
    stage: TournamentStage,
    beatmapId: number,
    resolved: ResolvedBeatmap
  ): void {
    let set = stage.beatMapSets.get(resolved.beatmapsetId);
    if (!set) {
      set = new BeatMapSet({ id: resolved.beatmapsetId, beatmaps: [] });
      stage.beatMapSets.set(set.id, set);
    }

    const beatMap = new BeatMap({ id: beatmapId, checksum: resolved.checksum });
    beatMap.version = resolved.version;
    beatMap.difficulty_rating = resolved.difficulty_rating;
    if (resolved.mode) {
      beatMap.mode = +ModeByte[resolved.mode as keyof typeof ModeByte];
    }
    set.beatMaps.set(beatMap.id, beatMap);
    stage.beatMapCount++;
  }
}
