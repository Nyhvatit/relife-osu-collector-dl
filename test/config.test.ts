import { describe, it, expect } from "vitest";
import Config from "../src/struct/Config";

const make = (o: Record<string, unknown>) => new Config(JSON.stringify(o));

describe("Config parsing", () => {
  it("applies defaults for an empty config", () => {
    const c = make({});
    expect(c.logSize).toBe(15);
    expect(c.concurrency).toBe(3);
    expect(c.intervalCap).toBe(50);
    expect(c.backupRetention).toBe(30);
    expect(c.parallel).toBe(true);
    expect(c.skipExisting).toBe(true);
    expect(c.useSubfolder).toBe(true);
    expect(c.mirrorRotation).toBe(false);
    expect(c.noVideo).toBe(true);
    expect(c.mode).toBe(1);
  });

  it("keeps in-range numbers and clamps out-of-range to the right fallback", () => {
    expect(make({ logSize: 0 }).logSize).toBe(0);
    expect(make({ logSize: -1 }).logSize).toBe(15);
    expect(make({ concurrency: 7 }).concurrency).toBe(7);
    expect(make({ concurrency: 11 }).concurrency).toBe(5);
    expect(make({ concurrency: -3 }).concurrency).toBe(5);
    expect(make({ concurrency: "x" }).concurrency).toBe(3);
    expect(make({ intervalCap: 121 }).intervalCap).toBe(50);
    expect(make({ backupRetention: 0 }).backupRetention).toBe(30);
    expect(make({ backupRetention: 1000 }).backupRetention).toBe(1000);
  });

  it("parses booleans, falling back for non-boolean values", () => {
    expect(make({ parallel: false }).parallel).toBe(false);
    expect(make({ parallel: "no" }).parallel).toBe(true);
    expect(make({ noVideo: false }).noVideo).toBe(false);
    expect(make({ skipExisting: false }).skipExisting).toBe(false);
  });

  it("only accepts modes 1-5, defaulting to 1", () => {
    expect(make({ mode: 4 }).mode).toBe(4);
    expect(make({ mode: 6 }).mode).toBe(1);
    expect(make({ mode: 0 }).mode).toBe(1);
  });

  it("derives sub-paths from osuPath", () => {
    const c = make({});
    c.osuPath = "/games/osu";
    expect(c.songsPath.replace(/\\/g, "/")).toBe("/games/osu/Songs");
    expect(c.collectionDbPath.replace(/\\/g, "/")).toBe("/games/osu/collection.db");
    expect(c.osuDbPath.replace(/\\/g, "/")).toBe("/games/osu/osu!.db");
  });
});
