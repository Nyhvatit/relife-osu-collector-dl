import { describe, it, expect } from "vitest";
import { Collection } from "../src/struct/Collection";
import { ModeByte } from "../src/types";

const fixture = () => ({
  id: 44,
  name: "My Collection",
  uploader: { username: "bob" },
  beatmapsets: [
    { id: 100, beatmaps: [{ id: 1, checksum: "a" }, { id: 2, checksum: "b" }] },
    { id: 200, beatmaps: [{ id: 3, checksum: "c" }] },
  ],
});

describe("Collection.resolveData", () => {
  it("parses sets + counts beatmaps in one pass", () => {
    const c = new Collection();
    c.resolveData(fixture());
    expect(c.id).toBe(44);
    expect(c.name).toBe("My Collection");
    expect(c.beatMapSetCount).toBe(2);
    expect(c.beatMapCount).toBe(3);
    expect([...c.beatMapSets.keys()]).toEqual([100, 200]);
  });

  it("throws CORRUPTED_RESPONSE when a required field is missing", () => {
    const bad = fixture() as Record<string, unknown>;
    delete bad.uploader;
    expect(() => new Collection().resolveData(bad)).toThrow(/uploader is required/);
  });
});

describe("Collection.keepOnly", () => {
  it("retains only the listed sets and updates the count", () => {
    const c = new Collection();
    c.resolveData(fixture());
    c.keepOnly([100]);
    expect([...c.beatMapSets.keys()]).toEqual([100]);
    expect(c.beatMapSetCount).toBe(1);
  });
});

describe("Collection.resolveFullData", () => {
  it("merges per-beatmap metadata into the loaded sets", () => {
    const c = new Collection();
    c.resolveData(fixture());
    c.resolveFullData([
      {
        id: 1,
        mode: "osu",
        difficulty_rating: 5.5,
        version: "Insane",
        beatmapset: { id: 100, title: "Song", artist: "Artist" },
      },
    ] as never);
    const set = c.beatMapSets.get(100)!;
    expect(set.title).toBe("Song");
    expect(set.artist).toBe("Artist");
    const bm = set.beatMaps.get(1)!;
    expect(bm.version).toBe("Insane");
    expect(bm.difficulty_rating).toBe(5.5);
    expect(bm.mode).toBe(ModeByte.osu);
  });
});
