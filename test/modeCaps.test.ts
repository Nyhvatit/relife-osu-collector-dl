import { describe, it, expect } from "vitest";
import { MODE_CAPABILITIES, WorkingMode } from "../src/types";
import Config from "../src/struct/Config";

const modes: WorkingMode[] = [1, 2, 3, 4, 5];

describe("MODE_CAPABILITIES equivalence with the old mode === N checks", () => {
  it.each(modes)("mode %i", (m) => {
    const c = MODE_CAPABILITIES[m];
    expect(c.download).toBe(m === 1 || m === 2 || m === 4);
    expect(c.osdb).toBe(m === 2 || m === 3);
    expect(c.collectionDb).toBe(m === 4 || m === 5);
    expect(c.dest === "songs").toBe(m === 4);

    expect(c.collectionDb && !c.download).toBe(m === 5);
    expect(c.osdb && !c.download).toBe(m === 3);
    expect(c.download && c.collectionDb).toBe(m === 4);
    expect(c.dest === "dir" && (c.download || c.osdb)).toBe(m >= 1 && m <= 3);
  });
});

describe("Config.caps", () => {
  it("reflects the configured mode", () => {
    expect(new Config(JSON.stringify({ mode: 4 })).caps).toBe(MODE_CAPABILITIES[4]);
    expect(new Config(JSON.stringify({ mode: 3 })).caps).toBe(MODE_CAPABILITIES[3]);
  });
});
