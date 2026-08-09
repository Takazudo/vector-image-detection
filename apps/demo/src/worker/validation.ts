import { z } from "zod";

import { VALIDATION_LIMITS } from "./config";

export const supportedImageMimeTypeSchema = z.enum(VALIDATION_LIMITS.supportedMimeTypes);

export const normalizedTagSchema = z
  .string()
  .trim()
  .min(1)
  .max(VALIDATION_LIMITS.maximumTagLength)
  .transform((value) => value.normalize("NFKC").toLocaleLowerCase("en-US"));

export const paginationSchema = z.strictObject({
  version: z.literal("v1"),
  cursor: z.string().max(512).optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(VALIDATION_LIMITS.maximumPageSize)
    .default(VALIDATION_LIMITS.defaultPageSize),
});

export const searchQuerySchema = z
  .string()
  .trim()
  .min(1)
  .max(VALIDATION_LIMITS.maximumQueryLength)
  .transform((value) => value.normalize("NFKC"));

export const searchRequestSchema = z.strictObject({
  version: z.literal("v1"),
  query: searchQuerySchema,
  cursor: z.string().max(512).optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(VALIDATION_LIMITS.maximumPageSize)
    .default(VALIDATION_LIMITS.defaultPageSize),
});

export const createUploadRequestSchema = z.strictObject({
  version: z.literal("v1"),
  filename: z.string().trim().min(1).max(255),
  declaredMimeType: supportedImageMimeTypeSchema,
  byteSize: z.number().int().positive().max(VALIDATION_LIMITS.maximumUploadBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  attribution: z
    .strictObject({
      sourceUrl: z.url().nullable(),
      licenseName: z.string().max(128).nullable(),
      licenseUrl: z.url().nullable(),
      authorName: z.string().max(128).nullable(),
      authorUrl: z.url().nullable(),
    })
    .optional(),
});

export const bulkHumanTagMutationSchema = z.strictObject({
  version: z.literal("v1"),
  action: z.enum(["attach", "remove"]),
  photoIds: z
    .array(z.string().min(1).max(47))
    .min(1)
    .max(VALIDATION_LIMITS.maximumBulkPhotoCount)
    .refine((values) => new Set(values).size === values.length, "photoIds must be unique"),
  humanTagNames: z
    .array(normalizedTagSchema)
    .min(1)
    .max(VALIDATION_LIMITS.maximumTagsPerPhoto)
    .refine((values) => new Set(values).size === values.length, "humanTagNames must be unique"),
  expectedRevisions: z.record(z.string(), z.number().int().nonnegative()).optional(),
});

export function validateImageDimensions(width: number, height: number): boolean {
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width >= VALIDATION_LIMITS.minimumImageDimension &&
    height >= VALIDATION_LIMITS.minimumImageDimension &&
    width <= VALIDATION_LIMITS.maximumImageDimension &&
    height <= VALIDATION_LIMITS.maximumImageDimension &&
    width * height <= VALIDATION_LIMITS.maximumImagePixels
  );
}
