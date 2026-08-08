export type VlmLanguage = "en" | "ja";

export interface VlmTagOptions {
  /** Claude model id. Defaults to `claude-haiku-4-5` — the cheap tier is the point. */
  model?: string;
  /** Controls the language of `tags`/`caption`/`readableText`. Defaults to `"en"`. */
  language?: VlmLanguage;
  /** Falls back to `process.env.ANTHROPIC_API_KEY`. Throws a clear error if neither is set. */
  apiKey?: string;
}

export interface VlmTagSuccess {
  imagePath: string;
  ok: true;
  /** 3-8 lowercase domain nouns, per the tagging prompt contract. */
  tags: string[];
  /** Any printed part numbers or markings the model could read off the item. */
  readableText?: string;
  /** One-line description of the item. */
  caption: string;
}

export interface VlmTagFailure {
  imagePath: string;
  ok: false;
  error: string;
}

export type VlmTagResult = VlmTagSuccess | VlmTagFailure;
