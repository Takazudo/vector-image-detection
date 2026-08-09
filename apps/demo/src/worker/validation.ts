import { z } from "zod";

import { VALIDATION_LIMITS } from "./config";

export const supportedImageMimeTypeSchema = z.enum(VALIDATION_LIMITS.supportedMimeTypes);

export const normalizedTagSchema = z
  .string()
  .trim()
  .min(1)
  .max(VALIDATION_LIMITS.maximumTagLength)
  .transform((value) => value.normalize("NFKC").toLocaleLowerCase("en-US"));

export const paginationSchema = z.object({
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

export const bulkHumanTagMutationSchema = z.object({
  action: z.enum(["attach", "remove"]),
  photoIds: z.array(z.string().min(1).max(128)).min(1).max(VALIDATION_LIMITS.maximumBulkPhotoCount),
  humanTagNames: z.array(normalizedTagSchema).min(1).max(VALIDATION_LIMITS.maximumTagsPerPhoto),
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
