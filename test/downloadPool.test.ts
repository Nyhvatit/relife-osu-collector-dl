import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import DownloadPool, { DownloadOutcome, PoolHost } from "../src/core/DownloadPool";
import MirrorRuntime from "../src/core/MirrorRuntime";
import Logger from "../src/core/Logger";
import { collection, config } from "../src/state";
import { BeatMapSet } from "../src/struct/BeatMapSet";
import { Mirror, getFallbackMirrors } from "../src/struct/Constant";

beforeEach(() => {
  config.mirror = Mirror.Catboy;
  vi.spyOn(Logger, "generateDiagnosticsLog").mockReturnValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  collection.reset();
});

function seed(ids: number[]): void {
  const sets = new Map<number, BeatMapSet>();
  for (const id of ids) sets.set(id, new BeatMapSet({ id, beatmaps: [] }));
  collection.load(0, "test", sets, 0, "x");
}

function makeHost(attempt: (set: BeatMapSet, mirror: Mirror) => DownloadOutcome) {
  const errors: number[] = [];
  let ended: BeatMapSet[] | null = null;
  const host: PoolHost = {
    existingIds: () => null,
    attemptDownload: (set, mirror) => Promise.resolve(attempt(set, mirror)),
    pending: () => collection.beatMapSets,
    countDownloaded: () => undefined,
    downloadedCount: () => 0,
    emitSkipped: () => undefined,
    emitError: (set) => errors.push(set.id),
    emitRetrying: () => undefined,
    emitEnd: (sets) => (ended = sets),
  };
  return { host, errors, ended: () => ended };
}

function freshRuntime(): MirrorRuntime {
  return new MirrorRuntime([config.mirror, ...getFallbackMirrors(config.mirror)]);
}

describe("DownloadPool outcomes", () => {
  it("drains the collection when every download succeeds", async () => {
    seed([1, 2, 3]);
    const h = makeHost(() => "ok");
    await new DownloadPool(h.host, freshRuntime()).run();
    expect(collection.beatMapSets.size).toBe(0);
    expect(h.errors).toEqual([]);
    expect(h.ended()).toEqual([]);
  });

  it("gives every map up to missing when no mirror stocks it (notfound)", async () => {
    seed([1, 2, 3]);
    const h = makeHost(() => "notfound");
    await new DownloadPool(h.host, freshRuntime()).run();
    expect(collection.beatMapSets.size).toBe(3);
    expect(h.errors.sort()).toEqual([1, 2, 3]);
    expect(h.ended()).toHaveLength(3);
  });

  it("gives up after every mirror fails a map (generic failure)", async () => {
    seed([1]);
    const h = makeHost(() => "fail");
    await new DownloadPool(h.host, freshRuntime()).run();
    expect(h.errors).toEqual([1]);
    expect(collection.beatMapSets.size).toBe(1);
  });

  it("waits out a mirror's cooldown and completes the map on retry (event-driven)", async () => {
    vi.useFakeTimers();
    try {
      seed([1]);
      const runtime = freshRuntime();
      const [, ...rest] = [config.mirror, ...getFallbackMirrors(config.mirror)];
      for (const m of rest) runtime.ban(m);
      let attempts = 0;
      const h = makeHost(() => (++attempts === 1 ? "rateLimited" : "ok"));
      const runP = new DownloadPool(h.host, runtime).run();
      await vi.runAllTimersAsync();
      await runP;
      expect(attempts).toBe(2);
      expect(collection.beatMapSets.size).toBe(0);
      expect(h.errors).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bans a mirror on 'banned' but still serves the map from another", async () => {
    seed([1]);
    let first: Mirror | null = null;
    const h = makeHost((_set, mirror) => {
      if (first === null) {
        first = mirror;
        return "banned";
      }
      return mirror === first ? "banned" : "ok";
    });
    const runtime = freshRuntime();
    await new DownloadPool(h.host, runtime).run();
    expect(runtime.isBanned(first!)).toBe(true);
    expect(collection.beatMapSets.size).toBe(0);
    expect(h.errors).toEqual([]);
  });
});
