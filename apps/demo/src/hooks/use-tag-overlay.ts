import type { IndexMeta } from "../generated/core-browser.mjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addTag as addTagToOverlay,
  exportTagsJson,
  mergeTags,
  overlayStorageKey,
  overlayTagCount,
  readOverlay,
  removeTag as removeTagFromOverlay,
  writeOverlay,
  type TagOverlay,
} from "../lib/tags";

export interface TagOverlayHandle {
  overlay: TagOverlay;
  /** Index tags merged with confirmed overlay tags, keyed by item id — what the UI renders. */
  tagsById: ReadonlyMap<string, string[]>;
  confirmedCount: number;
  addTag: (ids: readonly string[], tag: string) => void;
  removeTag: (id: string, tag: string) => void;
  reset: () => void;
  exportJson: () => string;
}

export function useTagOverlay(
  meta: Pick<IndexMeta, "modelId" | "createdAt" | "items">,
): TagOverlayHandle {
  const storageKey = overlayStorageKey(meta);
  const [overlay, setOverlay] = useState<TagOverlay>(() => readStoredOverlay(storageKey));

  // Re-read on an index swap: the key is derived from index identity, so the
  // state seeded at mount belongs to whichever bundle was loaded first.
  useEffect(() => setOverlay(readStoredOverlay(storageKey)), [storageKey]);

  useEffect(() => {
    try {
      writeOverlay(window.localStorage, storageKey, overlay);
    } catch {
      // A full or blocked localStorage must not break tagging — the session
      // keeps working, it just will not survive a reload.
    }
  }, [storageKey, overlay]);

  const addTag = useCallback(
    (ids: readonly string[], tag: string) =>
      setOverlay((current) => addTagToOverlay(current, ids, tag)),
    [],
  );

  const removeTag = useCallback(
    (id: string, tag: string) => setOverlay((current) => removeTagFromOverlay(current, id, tag)),
    [],
  );

  const reset = useCallback(() => setOverlay({}), []);

  const tagsById = useMemo(
    () => new Map(meta.items.map((item) => [item.id, mergeTags(item.tags, overlay[item.id])])),
    [meta.items, overlay],
  );

  return {
    overlay,
    tagsById,
    confirmedCount: overlayTagCount(overlay),
    addTag,
    removeTag,
    reset,
    exportJson: () => exportTagsJson(meta, overlay, new Date().toISOString()),
  };
}

function readStoredOverlay(key: string): TagOverlay {
  try {
    return readOverlay(window.localStorage, key);
  } catch {
    return {};
  }
}
