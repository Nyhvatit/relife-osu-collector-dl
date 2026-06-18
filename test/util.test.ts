import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import _path from "path";
import {
  isBoolean,
  isValidOsuFolder,
  parseIdInput,
  parseIndexSelection,
  replaceForbiddenChars,
  checkRange,
} from "../src/util";

describe("parseIdInput", () => {
  it("parses a raw id", () => expect(parseIdInput("44")).toBe(44));
  it("extracts the id from a pasted URL", () =>
    expect(parseIdInput("https://osucollector.com/collections/44/slug")).toBe(44));
  it("returns null when there are no digits", () => expect(parseIdInput("abc")).toBeNull());
  it("takes the first run of digits", () => expect(parseIdInput("v2 #44 x9")).toBe(2));
});

describe("parseIndexSelection", () => {
  it("treats empty / a / all as everything (0-based)", () => {
    expect(parseIndexSelection("", 3)).toEqual([0, 1, 2]);
    expect(parseIndexSelection("a", 3)).toEqual([0, 1, 2]);
    expect(parseIndexSelection("all", 3)).toEqual([0, 1, 2]);
  });
  it("parses comma/space lists into 0-based, de-duplicated indices", () => {
    expect(parseIndexSelection("1,3 5", 5)).toEqual([0, 2, 4]);
    expect(parseIndexSelection("2 2 2", 5)).toEqual([1]);
  });
  it("returns null for out-of-range or non-numeric input", () => {
    expect(parseIndexSelection("0", 5)).toBeNull();
    expect(parseIndexSelection("6", 5)).toBeNull();
    expect(parseIndexSelection("x", 5)).toBeNull();
  });
});

describe("replaceForbiddenChars", () => {
  it("strips characters illegal in filenames", () => {
    expect(replaceForbiddenChars('a\\b/c<d>e:f"g|h?i*j')).toBe("abcdefghij");
  });
});

describe("checkRange", () => {
  it("is inclusive on both ends", () => {
    expect(checkRange(0, 0, 10)).toBe(true);
    expect(checkRange(10, 0, 10)).toBe(true);
    expect(checkRange(11, 0, 10)).toBe(false);
  });
});

describe("isBoolean", () => {
  it("is true only for actual booleans", () => {
    expect([true, false].map(isBoolean)).toEqual([true, true]);
    expect([0, 1, "x", null, undefined, {}].map(isBoolean)).toEqual([
      false, false, false, false, false, false,
    ]);
  });
});

describe("isValidOsuFolder", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("is false for empty / nonexistent paths", () => {
    expect(isValidOsuFolder("")).toBe(false);
    expect(isValidOsuFolder(_path.join(tmpdir(), "definitely-not-here-xyz"))).toBe(false);
  });

  it("is true only when both Songs/ and osu!.db are present", () => {
    dir = mkdtempSync(_path.join(tmpdir(), "ocdl-osu-"));
    expect(isValidOsuFolder(dir)).toBe(false);
    mkdirSync(_path.join(dir, "Songs"));
    expect(isValidOsuFolder(dir)).toBe(false);
    writeFileSync(_path.join(dir, "osu!.db"), "");
    expect(isValidOsuFolder(dir)).toBe(true);
  });
});
