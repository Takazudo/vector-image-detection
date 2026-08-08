import type { EmbedderHandle } from "./hooks/use-embedder";
import type { TagOverlayHandle } from "./hooks/use-tag-overlay";
import type { DemoIndex } from "./lib/index-data";

/** Everything the five feature views share. Passed as one prop rather than drilled field by field. */
export interface DemoContext {
  index: DemoIndex;
  tags: TagOverlayHandle;
  embedder: EmbedderHandle;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export const VIEWS = [
  { id: "gallery", label: "Gallery" },
  { id: "categorize", label: "Auto-categorize" },
  { id: "search", label: "Search" },
  { id: "vocab-tags", label: "Vocabulary tags" },
  { id: "attach", label: "Attach a word" },
] as const;

export type ViewId = (typeof VIEWS)[number]["id"];
