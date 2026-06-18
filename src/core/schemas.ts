import { z } from "zod";

export const UserUploadsSchema = z
  .object({
    collections: z
      .array(
        z
          .object({
            id: z.number(),
            name: z.string().optional(),
            beatmapCount: z.number().optional(),
          })
          .passthrough()
      )
      .optional(),
    tournaments: z
      .array(
        z
          .object({ id: z.number(), name: z.string().optional() })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

export const ResolvedBeatmapSchema = z
  .object({
    beatmapset_id: z.number(),
    checksum: z.string(),
    version: z.string().optional(),
    mode: z.string().optional(),
    difficulty_rating: z.number().optional(),
  })
  .passthrough();

export const RateLimitSchema = z
  .object({
    remaining: z.number().optional(),
    daily: z
      .object({
        remaining: z.object({ downloads: z.number().optional() }).passthrough(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
