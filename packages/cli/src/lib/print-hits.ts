import type { SearchHit } from "@vector-image-detection/core";
import type { Logger } from "../types.js";
import { formatTable } from "./table.js";

/** Prints a rank/score/file/tags table for search-like results, reading `file`/`tags` off each hit's payload. */
export function printHits(logger: Logger, hits: SearchHit[]): void {
  if (hits.length === 0) {
    logger.log("(no results)");
    return;
  }
  const rows = hits.map((hit, i) => {
    const file = typeof hit.payload?.file === "string" ? hit.payload.file : hit.id;
    const tags = Array.isArray(hit.payload?.tags) ? (hit.payload.tags as unknown[]).join(",") : "";
    return [String(i + 1), hit.score.toFixed(4), file, tags];
  });
  logger.log(formatTable(["rank", "score", "file", "tags"], rows));
}
