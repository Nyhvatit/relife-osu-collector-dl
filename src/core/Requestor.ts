import { Response, fetch, request } from "undici";
import { Constant, Mirror, Mirrors, getCatboyRateLimitUrl } from "../struct/Constant";
import { Json, Mode, ResolvedBeatmap } from "../types";
import OcdlError from "../struct/OcdlError";
import { CollectionId } from "../struct/Collection";
import { LIB_VERSION } from "../version";
import { config } from "../state";
import { UserUploadsSchema, ResolvedBeatmapSchema, RateLimitSchema } from "./schemas";

const APP_UA = `relife-ocdl/v${LIB_VERSION}`;

interface FetchCollectionQuery {
  perPage?: number;
  cursor?: number;
}

interface DownloadCollectionOptions {
  mirror?: Mirror;
  signal?: AbortSignal;
}

interface FetchCollectionOptions {
  v2: boolean;
  cursor?: number;
}

export interface UserCollectionSummary {
  id: number;
  name: string;
  beatmapCount: number;
}

export interface UserTournamentSummary {
  id: number;
  name: string;
}

export interface UserUploads {
  collections: UserCollectionSummary[];
  tournaments: UserTournamentSummary[];
}

export interface v1ResCollectionType extends Json {
  beatmapIds: v1ResBeatMapType[];
  beatmapsets: v1ResBeatMapSetType[];
  id: number;
  name: string;
  uploader: {
    username: string;
  };
}
export interface v1ResBeatMapSetType extends Json {
  beatmaps: v1ResBeatMapType[];
  id: number;
}
export interface v1ResBeatMapType extends Json {
  checksum: string;
  id: number;
}

export interface v2ResCollectionType extends Json {
  hasMore: boolean;
  nextPageCursor: number;
  beatmaps: v2ResBeatMapType[];
}
export interface v2ResBeatMapType extends Json {
  id: number;
  mode: Mode;
  difficulty_rating: number;
  version: string;
  beatmapset: v2ResBeatMapSetType;
}
export interface v2ResBeatMapSetType extends Json {
  id: number;
  title: string;
  artist: string;
}

export class Requestor {
  static async fetchDownloadCollection(
    id: CollectionId,
    options: DownloadCollectionOptions = {}
  ): Promise<Response> {
    const mirror = options.mirror ?? config.mirror;

    const url = Mirrors[mirror].buildDownloadUrl(id, config.noVideo, config.catboyServer);

    const res = await fetch(url, {
      headers: { "User-Agent": APP_UA },
      method: "GET",
      signal: options.signal,
    });
    return res;
  }

  private static async _requestJson(
    url: string,
    query?: FetchCollectionQuery
  ): Promise<Json> {
    const data = await request(url, { method: "GET", query })
      .then(async (res) => {
        if (res.statusCode !== 200) {
          throw `Status code: ${res.statusCode}`;
        }
        return (await res.body.json()) as Json;
      })
      .catch((e: unknown) => {
        return new OcdlError("REQUEST_DATA_FAILED", e);
      });

    if (data instanceof OcdlError) {
      throw data;
    }

    return data;
  }

  static async fetchCollection(
    id: CollectionId,
    options: FetchCollectionOptions = { v2: false }
  ): Promise<Json> {
    const { v2, cursor } = options;
    const url =
      Constant.OsuCollectorApiUrl + id.toString() + (v2 ? "/beatmapsV2" : "");

    const query: FetchCollectionQuery =
      v2
        ? {
            perPage: 100,
            cursor,
          }
        : {};

    return this._requestJson(url, query);
  }

  static async fetchUserUploads(userId: number): Promise<UserUploads> {
    const url = Constant.OsuCollectorApiUrl.replace("collections", "users") + userId.toString() + "/uploads";

    const parsed = UserUploadsSchema.safeParse(await this._requestJson(url));
    const raw = parsed.success ? parsed.data : {};

    const collections: UserCollectionSummary[] = (raw.collections ?? []).map((c) => ({
      id: c.id,
      name: c.name ?? "Unknown",
      beatmapCount: c.beatmapCount ?? 0,
    }));
    const tournaments: UserTournamentSummary[] = (raw.tournaments ?? []).map((t) => ({
      id: t.id,
      name: t.name ?? "Unknown",
    }));

    return { collections, tournaments };
  }

  static async fetchTournament(id: number): Promise<Json> {
    const url = Constant.OsuCollectorApiUrl.replace("collections", "tournaments") + id.toString();
    return this._requestJson(url);
  }

  static async resolveBeatmap(beatmapId: number): Promise<ResolvedBeatmap | null> {
    const endpoints = [
      `https://osu.direct/api/v2/b/${beatmapId}`,
      `https://catboy.best/api/v2/b/${beatmapId}`,
    ];

    for (const url of endpoints) {
      try {
        const res = await request(url, {
          method: "GET",
          headers: { "User-Agent": APP_UA },
        });
        if (res.statusCode !== 200) continue;

        const parsed = ResolvedBeatmapSchema.safeParse(await res.body.json());
        if (parsed.success) {
          const d = parsed.data;
          return {
            beatmapsetId: d.beatmapset_id,
            checksum: d.checksum,
            version: d.version,
            mode: d.mode,
            difficulty_rating: d.difficulty_rating,
          };
        }
      } catch {
      }
    }

    return null;
  }

  static async checkRateLimitation(): Promise<number | null> {
    const rateLimitUrl = getCatboyRateLimitUrl(config.catboyServer);
    try {
      const res = await request(rateLimitUrl, {
        method: "GET",
        headers: { "User-Agent": APP_UA },
      });

      if (!res || res.statusCode !== 200) return null;
      const parsed = RateLimitSchema.safeParse(await res.body.json().catch(() => null));
      if (!parsed.success) return null;

      const remaining = parsed.data.remaining ?? parsed.data.daily?.remaining?.downloads;
      return typeof remaining === "number" ? remaining : null;
    } catch {
      return null;
    }
  }
}
