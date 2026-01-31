import { Response, fetch, request } from "undici";
import { Constant, Mirror, MirrorUrls, getCatboyDownloadUrl, getCatboyRateLimitUrl } from "../struct/Constant";
import { Json, Mode } from "../types";
import OcdlError from "../struct/OcdlError";
import { CollectionId } from "../struct/Collection";
import { LIB_VERSION } from "../version";
import { config } from "../state";

interface FetchCollectionQuery {
  perPage?: number;
  cursor?: number;
}

interface DownloadCollectionOptions {
  mirror?: Mirror;
}

interface FetchCollectionOptions {
  v2: boolean;
  cursor?: number;
}

// Basic collection data types
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

// Full collection data types
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
    // For Catboy, use the selected server's base URL
    const mirrorBaseUrl = mirror === Mirror.Catboy
      ? getCatboyDownloadUrl(config.catboyServer)
      : MirrorUrls[mirror];
    const baseUrl = mirrorBaseUrl + id.toString();

    // Add noVideo parameter for mirrors that support it
    // Sayobot already has novideo in the URL path
    const url = mirror === Mirror.Nerinyan || mirror === Mirror.Catboy
      ? baseUrl + "?noVideo=1"
      : baseUrl;

    const res = await fetch(url, {
      headers: { "User-Agent": `osu-collector-dl/v${LIB_VERSION}` },
      method: "GET",
    });
    return res;
  }

  static async fetchCollection(
    id: CollectionId,
    options: FetchCollectionOptions = { v2: false }
  ): Promise<Json> {
    const { v2, cursor } = options;
    // Use different endpoint for different version of api request
    const url =
      Constant.OsuCollectorApiUrl + id.toString() + (v2 ? "/beatmapsV2" : "");

    const query: FetchCollectionQuery = // Query is needed for V2 collection
      v2
        ? {
            perPage: 100,
            cursor, // Cursor which point to the next page
          }
        : {};

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

  static async checkRateLimitation(): Promise<number | null> {
    const rateLimitUrl = getCatboyRateLimitUrl(config.catboyServer);
    const res = await request(rateLimitUrl, {
      method: "GET",
      headers: { "User-Agent": `osu-collector-dl/v${LIB_VERSION}` },
    });

    if (!res || res.statusCode !== 200) return null;
    const data = (await res.body.json().catch(() => null)) as Json | null;
    if (!data) return null;

    // Return remaining beatmaps that can be request to download
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
    return ((data as any).daily?.remaining?.downloads ?? null) as number | null;
  }
}
