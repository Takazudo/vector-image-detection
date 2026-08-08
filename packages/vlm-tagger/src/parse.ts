export class VlmParseError extends Error {}

export interface ParsedVlmTag {
  tags: string[];
  readableText?: string;
  caption: string;
}

interface RawVlmResponse {
  tags?: unknown;
  readableText?: unknown;
  caption?: unknown;
}

// Models occasionally wrap JSON in a markdown fence or add a stray sentence
// despite the "ONLY one JSON object" instruction — pull the outermost {...}
// out of whatever text came back before attempting JSON.parse.
function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new VlmParseError(`no JSON object found in model response: ${text.slice(0, 200)}`);
  }
  return candidate.slice(start, end + 1);
}

export function parseVlmResponse(text: string): ParsedVlmTag {
  const jsonText = extractJsonObject(text);

  let raw: RawVlmResponse;
  try {
    raw = JSON.parse(jsonText) as RawVlmResponse;
  } catch (cause) {
    throw new VlmParseError(`model response is not valid JSON: ${(cause as Error).message}`);
  }

  if (
    !Array.isArray(raw.tags) ||
    raw.tags.length === 0 ||
    !raw.tags.every((tag) => typeof tag === "string")
  ) {
    throw new VlmParseError('model response "tags" must be a non-empty array of strings');
  }
  if (typeof raw.caption !== "string" || raw.caption.trim() === "") {
    throw new VlmParseError('model response "caption" must be a non-empty string');
  }
  if (raw.readableText !== undefined && typeof raw.readableText !== "string") {
    throw new VlmParseError('model response "readableText" must be a string when present');
  }

  // A tag that is only whitespace (e.g. "   ") passes the string-array check
  // above but normalizes to "" — reject it here rather than silently
  // recording an empty tag, so this counts as malformed and gets retried.
  const tags = raw.tags.map((tag) => tag.toLowerCase().trim());
  if (tags.some((tag) => tag === "")) {
    throw new VlmParseError('model response "tags" must not contain empty/whitespace-only strings');
  }

  const parsed: ParsedVlmTag = {
    tags,
    caption: raw.caption.trim(),
  };
  if (typeof raw.readableText === "string" && raw.readableText.trim() !== "") {
    parsed.readableText = raw.readableText.trim();
  }
  return parsed;
}
