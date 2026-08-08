import { useEffect, useRef } from "react";
import type { DemoIndex } from "../lib/index-data";
import { syncStoreTags } from "../lib/search";
import { changedOverlayIds, type TagOverlay } from "../lib/tags";

/**
 * Keeps the vector store's `payload.tags` in step with the confirmed overlay,
 * touching only the items that actually changed. `proposeTagPropagation` filters
 * on that payload field, so without this the propagation view would keep
 * re-proposing photos the user already accepted.
 */
export function useStoreTagSync(index: DemoIndex, overlay: TagOverlay): void {
  const lastSync = useRef<{ index: DemoIndex | null; overlay: TagOverlay }>({
    index: null,
    overlay: {},
  });

  useEffect(() => {
    // A freshly loaded index starts from the bundle's own tags, so everything
    // in the overlay counts as changed against it.
    const previous = lastSync.current.index === index ? lastSync.current.overlay : {};
    const ids = changedOverlayIds(previous, overlay);
    lastSync.current = { index, overlay };
    if (ids.length === 0) return;
    void syncStoreTags(index.store, index.itemById, index.vectorById, overlay, ids);
  }, [index, overlay]);
}
