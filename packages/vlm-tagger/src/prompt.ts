import type { VlmLanguage } from "./types.js";

export interface SystemPromptOptions {
  language: VlmLanguage;
}

/**
 * The JSON contract is enforced by prompting rather than the API's
 * structured-output feature, so a malformed response is a normal, expected
 * case for callers to parse defensively and retry — see `parse.ts`.
 */
export function buildSystemPrompt({ language }: SystemPromptOptions): string {
  const languageLine =
    language === "ja"
      ? "Write every tag, the caption, and readableText (if present) in Japanese."
      : "Write every tag, the caption, and readableText (if present) in English.";

  return [
    "You are tagging a single photo of a physical item for a searchable inventory catalog.",
    languageLine,
    "Respond with ONLY one JSON object and nothing else — no markdown code fences, no explanation, no text before or after it. The object must have exactly this shape:",
    '{"tags": string[], "readableText": string, "caption": string}',
    "",
    "- tags: 3 to 8 lowercase domain nouns describing the item (material, category, color, brand, condition). Not full sentences.",
    "- readableText: any printed part numbers, model numbers, or other legible markings visible on the item. Omit this field entirely if nothing is legible.",
    "- caption: one short sentence describing the item.",
  ].join("\n");
}
