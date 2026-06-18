import { describe, it, expect } from "vitest";
import { Tournament } from "../src/struct/Tournament";

const fixture = () => ({
  id: 7,
  name: "Cup",
  uploader: { username: "host" },
  rounds: [
    {
      round: "Qualifiers",
      mods: [
        {
          mod: "NM",
          maps: [
            { id: 1, checksum: "h1", beatmapset: { id: 100, title: "T1", artist: "A1" } },
            { id: 2, checksum: "h2", beatmapset: { id: 100, title: "T1", artist: "A1" } },
          ],
        },
        {
          mod: "HD",
          maps: [{ id: 3, checksum: "h3", beatmapset: { id: 200, title: "T2", artist: "A2" } }],
        },
      ],
    },
    {
      round: "Finals",
      mods: [
        {
          mod: "NM",
          maps: [
            { id: 4, checksum: "h4", beatmapset: { id: 300, title: "T3", artist: "A3" } },
            { id: 5, checksum: "h5", beatmapset: {} },
          ],
        },
      ],
    },
  ],
});

describe("Tournament construction", () => {
  it("groups maps into stages by beatmapset and counts them", () => {
    const t = new Tournament(fixture());
    expect(t.id).toBe(7);
    expect(t.uploaderName).toBe("host");
    expect(t.stages.map((s) => s.name)).toEqual(["Qualifiers", "Finals"]);

    const quals = t.stages[0];
    expect([...quals.beatMapSets.keys()]).toEqual([100, 200]);
    expect(quals.beatMapCount).toBe(3);
  });

  it("defers maps with no beatmapset id as unresolved", () => {
    const t = new Tournament(fixture());
    expect(t.unresolvedCount).toBe(1);
    expect(t.stages[1].unresolvedBeatmapIds).toEqual([5]);
    expect(t.stages[1].beatMapCount).toBe(1);
  });

  it("throws when a top-level field is missing", () => {
    const bad = fixture() as Record<string, unknown>;
    delete bad.rounds;
    expect(() => new Tournament(bad)).toThrow(/rounds is required/);
  });
});

describe("Tournament.mergeStages", () => {
  it("combines stages into one unit, de-duplicating shared sets", () => {
    const t = new Tournament(fixture());
    const merged = Tournament.mergeStages("Cup (all)", t.stages);
    expect(merged.name).toBe("Cup (all)");
    expect([...merged.beatMapSets.keys()].sort((a, b) => a - b)).toEqual([100, 200, 300]);
    expect(merged.beatMapCount).toBe(4);
  });
});
