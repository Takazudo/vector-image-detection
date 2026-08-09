import { rm } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const outputDirectory = fileURLToPath(new URL("../dist/", import.meta.url));
const publicDirectory = dirname(fileURLToPath(new URL("../public/favicon.svg", import.meta.url)));
const legacyPublicDirectories = [
  fileURLToPath(new URL("../public/data/", import.meta.url)),
  fileURLToPath(new URL("../public/onnxruntime/", import.meta.url)),
];

if (basename(outputDirectory) !== "dist" || dirname(outputDirectory) !== appDirectory) {
  throw new Error("Refusing to clean an unexpected build output directory.");
}

await rm(outputDirectory, { recursive: true, force: true });

for (const directory of legacyPublicDirectories) {
  if (
    dirname(directory) !== publicDirectory ||
    (basename(directory) !== "data" && basename(directory) !== "onnxruntime")
  ) {
    throw new Error("Refusing to clean an unexpected legacy public directory.");
  }
  await rm(directory, { recursive: true, force: true });
}
