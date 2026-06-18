import { describe, it, expect } from "vitest";
import { UserUploadsSchema, ResolvedBeatmapSchema, RateLimitSchema } from "../src/core/schemas";

describe("ResolvedBeatmapSchema", () => {
  it("accepts a response with the required set id + checksum", () => {
    const r = ResolvedBeatmapSchema.safeParse({
      beatmapset_id: 100,
      checksum: "abc",
      version: "Insane",
      extra: "ignored",
    });
    expect(r.success).toBe(true);
  });

  it("rejects when the required fields are missing or mistyped", () => {
    expect(ResolvedBeatmapSchema.safeParse({ checksum: "abc" }).success).toBe(false);
    expect(ResolvedBeatmapSchema.safeParse({ beatmapset_id: "100", checksum: "a" }).success).toBe(false);
    expect(ResolvedBeatmapSchema.safeParse(null).success).toBe(false);
  });
});

describe("RateLimitSchema", () => {
  it("reads the flat remaining shape", () => {
    const r = RateLimitSchema.safeParse({ limit: 1200, remaining: 980, reset: 0 });
    expect(r.success && r.data.remaining).toBe(980);
  });

  it("supports the legacy nested shape", () => {
    const r = RateLimitSchema.safeParse({ daily: { remaining: { downloads: 5 } } });
    expect(r.success && r.data.daily?.remaining.downloads).toBe(5);
  });

  it("rejects null", () => {
    expect(RateLimitSchema.safeParse(null).success).toBe(false);
  });
});

describe("UserUploadsSchema", () => {
  it("accepts uploads with optional names/counts and ignores extras", () => {
    const r = UserUploadsSchema.safeParse({
      collections: [{ id: 1, name: "A", beatmapCount: 3, foo: 1 }, { id: 2 }],
      tournaments: [{ id: 9 }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.collections?.length).toBe(2);
      expect(r.data.collections?.[1].name).toBeUndefined();
    }
  });

  it("tolerates missing arrays", () => {
    expect(UserUploadsSchema.safeParse({}).success).toBe(true);
  });
});
