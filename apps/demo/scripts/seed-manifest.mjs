import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const defaultBundleDirectory = resolve(scriptDirectory, "../fixtures/bundle");

export function parseSeedTarget(arguments_) {
  const remote = arguments_.includes("--remote");
  const targetIndex = arguments_.indexOf("--target");
  const target = targetIndex >= 0 ? arguments_[targetIndex + 1] : undefined;
  if (remote && (!target || target.startsWith("--"))) {
    throw new Error("Remote seed import requires an explicit --target <environment>.");
  }
  return { mode: remote ? "remote" : "local", target: remote ? target : "local" };
}

export async function loadSeedManifest(bundleDirectory = defaultBundleDirectory) {
  const bundleRoot = resolve(bundleDirectory);
  const manifest = JSON.parse(await readFile(join(bundleRoot, "manifest.json"), "utf8"));
  const metadata = JSON.parse(await readFile(join(bundleRoot, "meta.json"), "utf8"));
  if (
    !Array.isArray(manifest.items) ||
    manifest.items.length !== 100 ||
    !Array.isArray(metadata.items) ||
    metadata.items.length !== 100
  ) {
    throw new Error("Expected exactly 100 credited seed manifest items.");
  }
  const provenanceById = new Map(manifest.items.map((item) => [item.id, item]));
  return Promise.all(
    metadata.items.map(async (item) => {
      const provenance = provenanceById.get(item.id) ?? item;
      const sourcePath = String(item.thumb);
      if (!sourcePath.startsWith(`thumbs${sep}`) && !sourcePath.startsWith("thumbs/")) {
        throw new Error(`Seed path escapes thumbs: ${sourcePath}`);
      }
      const absolutePath = resolve(bundleRoot, sourcePath);
      if (
        !relative(join(bundleRoot, "thumbs"), absolutePath) ||
        relative(join(bundleRoot, "thumbs"), absolutePath).startsWith("..")
      ) {
        throw new Error(`Invalid seed thumbnail path: ${sourcePath}`);
      }
      const bytes = new Uint8Array(await readFile(absolutePath));
      return {
        sourcePath: sourcePath.replaceAll(sep, "/"),
        filename: basename(sourcePath),
        bytes,
        mimeType: "image/jpeg",
        checksum: createHash("sha256").update(bytes).digest("hex"),
        sourceUrl:
          typeof item.source === "string"
            ? item.source
            : typeof provenance.source === "string"
              ? provenance.source
              : null,
        licenseName:
          typeof item.license === "string"
            ? item.license
            : typeof provenance.license === "string"
              ? provenance.license
              : null,
        licenseUrl: null,
        authorName:
          typeof item.author === "string"
            ? item.author
            : typeof provenance.author === "string"
              ? provenance.author
              : null,
        authorUrl: null,
      };
    }),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = parseSeedTarget(process.argv.slice(2));
  const entries = await loadSeedManifest();
  console.log(
    JSON.stringify({ target, entries: entries.length, importer: "worker/features/photos/seed.ts" }),
  );
}
