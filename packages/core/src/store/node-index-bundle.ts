// Node-only side of the index bundle format: reads/writes `meta.json` +
// `embeddings.bin` on disk. `node:fs` and `node:path` are only ever reached
// via dynamic import inside these functions (never a top-level `import`), so
// this module stays safe to include in a browser bundle's dependency graph —
// mirrors the pattern in ../embedding/node-cache-dir.ts. Browser code never
// calls these functions, so the dynamic import is never actually triggered
// there; it exists purely so bundlers don't choke on a static `node:fs`
// resolution.
import type { IndexMeta, Vector } from "../types.js";
import { assertModelMatch, decodeVectors, encodeVectors } from "./index-bundle-codec.js";

function isNodeRuntime(): boolean {
  return typeof process !== "undefined" && process.versions?.node != null;
}

async function nodeFsPath() {
  if (!isNodeRuntime()) {
    throw new Error(
      "packages/core store: saveIndex/loadIndex/updateTags are Node-only (they read/write the " +
        "local filesystem) and cannot run in a browser — use loadIndexFromUrl instead.",
    );
  }
  const [{ promises: fs }, { default: path }] = await Promise.all([
    import("node:fs"),
    import("node:path"),
  ]);
  return { fs, path };
}

const META_FILE = "meta.json";
const EMBEDDINGS_FILE = "embeddings.bin";

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

/**
 * Writes an index bundle (`meta.json` + `embeddings.bin`) to `dir`. Each file
 * is published atomically (write `.tmp`, then `rename` over the final path —
 * `rename` is an atomic swap on POSIX), and both `.tmp` files are written
 * before either is renamed, so the two renames land back-to-back. A failure
 * during the write phase (before any rename) leaves both final files fully
 * untouched, with no leftover `.tmp` files — this is what the accompanying
 * tests exercise.
 *
 * This does **not** make the two-file bundle transactional as a pair: on
 * POSIX, `rename()` only guarantees atomicity for a single file, not for two
 * files together. If the process is killed between the two renames (or one
 * rename fails while the other has already landed), `dir` can briefly or
 * persistently hold new `meta.json` paired with old `embeddings.bin` (or
 * vice versa). `decodeVectors` catches the common case where this changes
 * `items.length` (a hard byte-length mismatch), but a same-item-count resave
 * torn between the two renames is not detected. A fully torn-proof bundle
 * publish (e.g. a directory-level atomic swap) is a larger layout change
 * than the frozen `dir/meta.json` + `dir/embeddings.bin` contract calls for
 * here — flag it for a follow-up if airtight cross-file atomicity is needed.
 */
export async function saveIndex(dir: string, meta: IndexMeta, vectors: Vector[]): Promise<void> {
  if (meta.items.length !== vectors.length) {
    throw new Error(
      `saveIndex: meta.items has ${meta.items.length} entries but got ${vectors.length} vectors`,
    );
  }
  const { fs, path } = await nodeFsPath();
  await fs.mkdir(dir, { recursive: true });

  const metaPath = path.join(dir, META_FILE);
  const embeddingsPath = path.join(dir, EMBEDDINGS_FILE);
  const metaJson = JSON.stringify(meta, null, 2);
  const embeddingsBytes = new Uint8Array(encodeVectors(vectors, meta.dim));

  const metaTmp = `${metaPath}.tmp`;
  const embeddingsTmp = `${embeddingsPath}.tmp`;

  // Promise.allSettled (not Promise.all) for both phases: Promise.all
  // rejects as soon as the first promise rejects without waiting for the
  // other to settle, which would race our cleanup rm() below against a
  // still-in-flight write/rename of the other file.
  const writes = await Promise.allSettled([
    fs.writeFile(metaTmp, metaJson),
    fs.writeFile(embeddingsTmp, embeddingsBytes),
  ]);
  const failedWrite = writes.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failedWrite) {
    await Promise.allSettled([
      fs.rm(metaTmp, { force: true }),
      fs.rm(embeddingsTmp, { force: true }),
    ]);
    throw failedWrite.reason;
  }

  const renames = await Promise.allSettled([
    fs.rename(metaTmp, metaPath),
    fs.rename(embeddingsTmp, embeddingsPath),
  ]);
  const failedRename = renames.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failedRename) {
    await Promise.allSettled([
      fs.rm(metaTmp, { force: true }),
      fs.rm(embeddingsTmp, { force: true }),
    ]);
    throw failedRename.reason;
  }
}

/**
 * Reads an index bundle from `dir`. If `expected` is given, throws
 * `IndexModelMismatchError` when the bundle's `{modelId, dim}` disagrees.
 */
export async function loadIndex(
  dir: string,
  expected?: { modelId: string; dim: number },
): Promise<{ meta: IndexMeta; vectors: Vector[] }> {
  const { fs, path } = await nodeFsPath();
  const metaRaw = await fs.readFile(path.join(dir, META_FILE), "utf8");
  const meta = JSON.parse(metaRaw) as IndexMeta;
  assertModelMatch(meta, expected);

  const embeddingsBuffer = await fs.readFile(path.join(dir, EMBEDDINGS_FILE));
  const vectors = decodeVectors(toArrayBuffer(embeddingsBuffer), meta.items.length, meta.dim);
  return { meta, vectors };
}

/**
 * Rewrites the **confirmed** tags for the given item ids, atomically.
 * `embeddings.bin` is untouched — tag edits never touch vector data. Ids not
 * present in the index are ignored (no-op for that entry).
 */
export async function updateTags(
  dir: string,
  changes: { id: string; tags: string[] }[],
): Promise<void> {
  const { fs, path } = await nodeFsPath();
  const metaPath = path.join(dir, META_FILE);
  const metaRaw = await fs.readFile(metaPath, "utf8");
  const meta = JSON.parse(metaRaw) as IndexMeta;

  const tagsById = new Map(changes.map((change) => [change.id, change.tags]));
  const nextMeta: IndexMeta = {
    ...meta,
    items: meta.items.map((item) => {
      const tags = tagsById.get(item.id);
      return tags ? { ...item, tags } : item;
    }),
  };

  const metaTmp = `${metaPath}.tmp`;
  try {
    await fs.writeFile(metaTmp, JSON.stringify(nextMeta, null, 2));
    await fs.rename(metaTmp, metaPath);
  } catch (err) {
    await fs.rm(metaTmp, { force: true }).catch(() => {});
    throw err;
  }
}
