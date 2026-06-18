import { describe, it, expect } from "vitest";
import {
  Mirror,
  Mirrors,
  CatboyServer,
  getFallbackMirrors,
  mirrorHasRateLimit,
} from "../src/struct/Constant";

const ID = 12345;
const server = CatboyServer.Default;

describe("Mirrors.buildDownloadUrl", () => {
  const cases: Record<Mirror, { nv: string; full: string }> = {
    [Mirror.Catboy]: {
      nv: "https://catboy.best/d/12345n",
      full: "https://catboy.best/d/12345",
    },
    [Mirror.Nerinyan]: {
      nv: "https://api.nerinyan.moe/d/12345",
      full: "https://api.nerinyan.moe/d/12345",
    },
    [Mirror.OsuDirect]: {
      nv: "https://osu.direct/api/d/12345?noVideo=1",
      full: "https://osu.direct/api/d/12345",
    },
    [Mirror.Sayobot]: {
      nv: "https://txy1.sayobot.cn/beatmaps/download/novideo/12345?server=auto",
      full: "https://txy1.sayobot.cn/beatmaps/download/full/12345?server=auto",
    },
    [Mirror.Beatconnect]: {
      nv: "https://beatconnect.io/b/12345",
      full: "https://beatconnect.io/b/12345",
    },
    [Mirror.Nekoha]: {
      nv: "https://mirror.nekoha.moe/api4/download/12345?noVideo=1",
      full: "https://mirror.nekoha.moe/api4/download/12345",
    },
  };

  for (const mirror of Object.values(Mirror)) {
    it(`${mirror} builds the expected no-video and full URLs`, () => {
      expect(Mirrors[mirror].buildDownloadUrl(ID, true, server)).toBe(cases[mirror].nv);
      expect(Mirrors[mirror].buildDownloadUrl(ID, false, server)).toBe(cases[mirror].full);
    });
  }
});

describe("getFallbackMirrors", () => {
  it("excludes the current mirror and the defunct Nerinyan, preserving order", () => {
    expect(getFallbackMirrors(Mirror.Catboy)).toEqual([
      Mirror.OsuDirect,
      Mirror.Sayobot,
      Mirror.Beatconnect,
      Mirror.Nekoha,
    ]);
  });

  it("never includes Nerinyan even when it is the current mirror", () => {
    expect(getFallbackMirrors(Mirror.Nerinyan)).not.toContain(Mirror.Nerinyan);
  });
});

describe("mirrorHasRateLimit", () => {
  it("is true only for the rate-limited mirrors (catboy, osu.direct)", () => {
    expect(mirrorHasRateLimit(Mirror.Catboy)).toBe(true);
    expect(mirrorHasRateLimit(Mirror.OsuDirect)).toBe(true);
    expect(mirrorHasRateLimit(Mirror.Sayobot)).toBe(false);
    expect(mirrorHasRateLimit(Mirror.Beatconnect)).toBe(false);
    expect(mirrorHasRateLimit(Mirror.Nerinyan)).toBe(false);
    expect(mirrorHasRateLimit(Mirror.Nekoha)).toBe(false);
  });
});
