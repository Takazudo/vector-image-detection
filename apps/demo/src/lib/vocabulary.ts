/** The customer-friendly default: two obviously-different everyday categories, not the electronics set. */
export const DEFAULT_CATEGORY_VOCABULARY = ["cat", "dog"];

export const DEFAULT_TAG_VOCABULARY = ["cat", "dog", "capacitor", "resistor", "led", "connector"];

/**
 * Parses a free-text vocabulary field into labels. Commas and newlines separate
 * entries; spaces do not, so multi-word labels like "circuit board" survive.
 * Duplicates are dropped case-insensitively, keeping the first spelling typed.
 */
export function parseVocabulary(raw: string): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const chunk of raw.split(/[,\n]/)) {
    const label = chunk.trim().replace(/\s+/g, " ");
    const key = label.toLowerCase();
    if (label.length === 0 || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  return labels;
}
