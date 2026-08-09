import { VALIDATION_LIMITS } from "../../config";

const WORD = "[\\p{L}\\p{N}][\\p{L}\\p{N}\\p{M}]*";
const TAG_PATTERN = new RegExp(`^${WORD}(?:[ _-]${WORD})*$`, "u");

/** Canonical contract shared by human-tag storage and word search. */
export function normalizeTagWord(value: string): string {
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > VALIDATION_LIMITS.maximumTagLength ||
    !TAG_PATTERN.test(normalized)
  ) {
    throw new TagWordValidationError();
  }
  return normalized;
}

export class TagWordValidationError extends Error {
  constructor() {
    super("Tag words must contain only letters, numbers, single spaces, hyphens, or underscores.");
    this.name = "TagWordValidationError";
  }
}
