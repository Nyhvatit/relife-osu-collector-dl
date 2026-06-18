export enum Constant {
  OsuCollectorApiUrl = "https://osucollector.com/api/collections/",
}

export enum Mirror {
  Catboy = "catboy",
  Nerinyan = "nerinyan",
  OsuDirect = "osu.direct",
  Sayobot = "sayobot",
  Beatconnect = "beatconnect",
  Nekoha = "nekoha",
}

export enum CatboyServer {
  Default = "default",
}

export const CatboyServerBaseUrls: Record<CatboyServer, string> = {
  [CatboyServer.Default]: "https://catboy.best",
};

export function getCatboyRateLimitUrl(server: CatboyServer): string {
  return CatboyServerBaseUrls[server] + "/api/ratelimits";
}

export function getCatboyDownloadUrl(server: CatboyServer): string {
  return CatboyServerBaseUrls[server] + "/d/";
}

export const MirrorUrls: Record<Mirror, string> = {
  [Mirror.Catboy]: "https://catboy.best/d/",
  [Mirror.Nerinyan]: "https://api.nerinyan.moe/d/",
  [Mirror.OsuDirect]: "https://osu.direct/api/d/",
  [Mirror.Sayobot]: "https://txy1.sayobot.cn/beatmaps/download/novideo/",
  [Mirror.Beatconnect]: "https://beatconnect.io/b/",
  [Mirror.Nekoha]: "https://mirror.nekoha.moe/api4/download/",
};

export interface MirrorInfo {
  hasRateLimit: boolean;
  usableAsFallback: boolean;
  buildDownloadUrl(id: number, noVideo: boolean, catboyServer: CatboyServer): string;
}

export const Mirrors: Record<Mirror, MirrorInfo> = {
  [Mirror.Catboy]: {
    hasRateLimit: true,
    usableAsFallback: true,
    buildDownloadUrl: (id, noVideo, catboyServer) =>
      getCatboyDownloadUrl(catboyServer) + id.toString() + (noVideo ? "n" : ""),
  },
  [Mirror.Nerinyan]: {
    hasRateLimit: false,
    usableAsFallback: false,
    buildDownloadUrl: (id) => MirrorUrls[Mirror.Nerinyan] + id.toString(),
  },
  [Mirror.OsuDirect]: {
    hasRateLimit: true,
    usableAsFallback: true,
    buildDownloadUrl: (id, noVideo) =>
      MirrorUrls[Mirror.OsuDirect] + id.toString() + (noVideo ? "?noVideo=1" : ""),
  },
  [Mirror.Sayobot]: {
    hasRateLimit: false,
    usableAsFallback: true,
    buildDownloadUrl: (id, noVideo) =>
      (noVideo
        ? MirrorUrls[Mirror.Sayobot]
        : MirrorUrls[Mirror.Sayobot].replace("/novideo/", "/full/")) +
      id.toString() +
      "?server=auto",
  },
  [Mirror.Beatconnect]: {
    hasRateLimit: false,
    usableAsFallback: true,
    buildDownloadUrl: (id) => MirrorUrls[Mirror.Beatconnect] + id.toString(),
  },
  [Mirror.Nekoha]: {
    hasRateLimit: false,
    usableAsFallback: true,
    buildDownloadUrl: (id, noVideo) =>
      MirrorUrls[Mirror.Nekoha] + id.toString() + (noVideo ? "?noVideo=1" : ""),
  },
};

export function getFallbackMirrors(current: Mirror): Mirror[] {
  return (Object.keys(Mirrors) as Mirror[]).filter(
    (m) => m !== current && Mirrors[m].usableAsFallback
  );
}

export function mirrorHasRateLimit(mirror: Mirror): boolean {
  return Mirrors[mirror].hasRateLimit;
}
