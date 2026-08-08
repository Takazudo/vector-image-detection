#!/usr/bin/env node
// Downloads license-safe sample images into data/samples/ for the photo vector
// search PoC. Two sources:
//
//   - Pets (cats & dogs): Oxford-IIIT Pet dataset via the Hugging Face
//     datasets-server rows API (CC BY-SA 4.0, no auth). Each row's image URL is
//     signed and expires within hours, so it must be downloaded in this same run.
//   - Electronic components: Wikimedia Commons API, filtered per-file against a
//     license allowlist (CC0 / Public domain / CC BY / CC BY-SA).
//
// Usage:
//   node scripts/fetch-samples.mjs [--limit-pets N] [--limit-components N]
//
// Idempotent: re-running skips any file that already exists on disk and exits 0
// with nothing new downloaded. Per-item failures are logged and skipped; the
// script still exits 0 as long as >=80% of the requested count landed per category.
//
// Fallback (documented, not implemented here): if the datasets-server API is ever
// unavailable, the full Oxford-IIIT Pet tarball can be used instead:
// https://thor.robots.ox.ac.uk/~vgg/data/pets/images.tar.gz (792MB, same CC BY-SA 4.0 license).
//
// No dependencies beyond Node's built-in global fetch (Node 24+).

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PET_LABEL_NAMES,
  PET_CAT_DOG_NAMES,
  catOrDogFromBreed,
  mapClassLabel,
  isLicenseAllowed,
  hasJpegExtension,
  distributeTargets,
  petFileName,
  componentFileName,
  buildManifestItem,
  stripHtml,
} from "./lib/fetch-helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SAMPLES_DIR = path.join(REPO_ROOT, "data", "samples");
const PETS_DIR = path.join(SAMPLES_DIR, "pets");
const COMPONENTS_DIR = path.join(SAMPLES_DIR, "components");
const MANIFEST_PATH = path.join(SAMPLES_DIR, "manifest.json");
const CREDITS_PATH = path.join(SAMPLES_DIR, "CREDITS.md");

// Wikimedia policy: identify the client with a descriptive User-Agent.
const USER_AGENT =
  "vector-image-detection-sample-fetcher/0.1 (https://github.com/Takazudo/vector-image-detection; sample dataset download script)";

const DEFAULT_PETS_TARGET = 60;
const DEFAULT_COMPONENTS_TARGET = 40;
const SUCCESS_RATIO = 0.8;
const WIKIMEDIA_THROTTLE_MS = 1000; // ~1 req/sec, per Wikimedia API etiquette

const COMPONENT_CATEGORIES = [
  { category: "Capacitors", knownLabel: "capacitor" },
  { category: "Resistors", knownLabel: "resistor" },
  { category: "Electrical_connectors", knownLabel: "connector" },
  { category: "Light-emitting_diodes", knownLabel: "led" },
];

const PETS_LICENSE = "CC BY-SA 4.0";
const PETS_SOURCE = "https://huggingface.co/datasets/timm/oxford-iiit-pet";
const PETS_DATASET_URL = "https://www.robots.ox.ac.uk/~vgg/data/pets/";

function parseArgs(argv) {
  const args = { limitPets: DEFAULT_PETS_TARGET, limitComponents: DEFAULT_COMPONENTS_TARGET };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--limit-pets") {
      args.limitPets = Number(argv[++i]);
    } else if (arg === "--limit-components") {
      args.limitComponents = Number(argv[++i]);
    } else if (arg.startsWith("--limit-pets=")) {
      args.limitPets = Number(arg.split("=")[1]);
    } else if (arg.startsWith("--limit-components=")) {
      args.limitComponents = Number(arg.split("=")[1]);
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/fetch-samples.mjs [--limit-pets N] [--limit-components N]");
      process.exit(0);
    }
  }
  if (!Number.isFinite(args.limitPets) || args.limitPets <= 0) {
    throw new Error(`Invalid --limit-pets: ${args.limitPets}`);
  }
  if (!Number.isFinite(args.limitComponents) || args.limitComponents <= 0) {
    throw new Error(`Invalid --limit-components: ${args.limitComponents}`);
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

async function downloadFile(url, destPath) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buffer);
  return buffer.length;
}

async function countJpegs(dir) {
  if (!existsSync(dir)) return 0;
  const entries = await readdir(dir);
  return entries.filter((f) => f.toLowerCase().endsWith(".jpg")).length;
}

async function loadExistingManifestItems() {
  if (!existsSync(MANIFEST_PATH)) return [];
  try {
    const raw = await readFile(MANIFEST_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch (err) {
    console.warn(
      `Warning: could not parse existing manifest.json (${err.message}); starting fresh.`,
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// Pets: Oxford-IIIT Pet via HF datasets-server
// ---------------------------------------------------------------------------

async function fetchPets(targetTotal, existingFileSet) {
  const newItems = [];
  let downloaded = 0; // actual network downloads, as opposed to reconciled-from-disk entries
  const perClassTarget = Math.ceil(targetTotal / 2);
  const counts = { cat: 0, dog: 0 };
  const breedCounters = new Map(); // "cat:maine_coon" -> n so far

  const PAGE_LENGTH = 100;
  const MAX_OFFSET = 3680; // full train split size; hard stop so a bug can't spin forever
  let offset = 0;

  console.log(`\nFetching pets (target ${targetTotal}, ~${perClassTarget}/class)...`);

  while (counts.cat + counts.dog < targetTotal && offset < MAX_OFFSET) {
    const url = `https://datasets-server.huggingface.co/rows?dataset=timm%2Foxford-iiit-pet&config=default&split=train&offset=${offset}&length=${PAGE_LENGTH}`;
    let page;
    try {
      page = await fetchJson(url);
    } catch (err) {
      console.warn(`Warning: pets page fetch failed at offset ${offset}: ${err.message}`);
      break;
    }
    const rows = page.rows ?? [];
    if (rows.length === 0) break;

    for (const rowEntry of rows) {
      if (counts.cat + counts.dog >= targetTotal) break;
      const row = rowEntry.row ?? {};
      const breed = mapClassLabel(row.label, PET_LABEL_NAMES) ?? "unknown-breed";
      let catOrDog =
        typeof row.label_cat_dog === "number"
          ? mapClassLabel(row.label_cat_dog, PET_CAT_DOG_NAMES)
          : null;
      if (!catOrDog) catOrDog = catOrDogFromBreed(breed);
      if (!catOrDog) continue; // can't classify this row, skip it

      if (counts[catOrDog] >= perClassTarget) continue; // keep roughly balanced

      const key = `${catOrDog}:${breed}`;
      const n = (breedCounters.get(key) ?? 0) + 1;
      breedCounters.set(key, n);
      const file = petFileName({ catOrDog, breed, index: n });
      const destPath = path.join(SAMPLES_DIR, file);

      if (existingFileSet.has(file)) {
        counts[catOrDog]++;
        continue; // already recorded in manifest from a previous run
      }
      if (existsSync(destPath)) {
        // File landed in a previous (possibly interrupted) run but isn't in the
        // manifest yet — record it now without re-downloading.
        counts[catOrDog]++;
        newItems.push(
          buildManifestItem({
            id: file,
            file,
            knownLabel: catOrDog,
            breed,
            source: PETS_SOURCE,
            license: PETS_LICENSE,
          }),
        );
        continue;
      }

      const imageUrl = row.image?.src;
      if (!imageUrl) continue;
      try {
        await downloadFile(imageUrl, destPath);
        counts[catOrDog]++;
        downloaded++;
        newItems.push(
          buildManifestItem({
            id: file,
            file,
            knownLabel: catOrDog,
            breed,
            source: PETS_SOURCE,
            license: PETS_LICENSE,
          }),
        );
        console.log(`  + ${file}`);
        await sleep(150); // light politeness delay between image downloads
      } catch (err) {
        console.warn(
          `Warning: failed to download pet image (${row.image_id ?? "?"}): ${err.message}`,
        );
      }
    }
    offset += PAGE_LENGTH;
  }

  return { items: newItems, downloaded };
}

// ---------------------------------------------------------------------------
// Electronics: Wikimedia Commons API
// ---------------------------------------------------------------------------

function commonsPageUrl(title) {
  return `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

async function fetchComponentCategoryMembers({ gcmtitle, gcmtype, extraParams = {} }) {
  const params = new URLSearchParams({
    action: "query",
    generator: "categorymembers",
    gcmtitle,
    gcmtype,
    gcmlimit: "50",
    format: "json",
    ...extraParams,
  });
  const url = `https://commons.wikimedia.org/w/api.php?${params}`;
  const data = await fetchJson(url);
  await sleep(WIKIMEDIA_THROTTLE_MS);
  return data;
}

async function fetchComponentCategory({ category, knownLabel, target, existingFileSet }) {
  const newItems = [];
  let n = 0;
  let downloaded = 0; // actual network downloads, as opposed to reconciled-from-disk entries

  async function processFileMembers(gcmtitle) {
    let gcmcontinue;
    let pagesFetched = 0;
    const MAX_PAGES = 4;
    while (n < target && pagesFetched < MAX_PAGES) {
      let data;
      try {
        data = await fetchComponentCategoryMembers({
          gcmtitle,
          gcmtype: "file",
          extraParams: {
            prop: "imageinfo",
            iiprop: "url|extmetadata",
            iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist",
            iiurlwidth: "640",
            ...(gcmcontinue ? { gcmcontinue } : {}),
          },
        });
      } catch (err) {
        console.warn(`Warning: Commons file listing failed for ${gcmtitle}: ${err.message}`);
        return;
      }
      const pages = Object.values(data.query?.pages ?? {});
      for (const page of pages) {
        if (n >= target) break;
        const info = page.imageinfo?.[0];
        if (!info) continue;
        if (!hasJpegExtension(page.title)) continue; // skip PNG/GIF/PDF/etc. sources
        const license = info.extmetadata?.LicenseShortName?.value;
        if (!isLicenseAllowed(license)) continue;

        n++;
        const file = componentFileName({ label: knownLabel, index: n });
        const destPath = path.join(SAMPLES_DIR, file);
        const source = page.title ? commonsPageUrl(page.title) : info.descriptionurl;
        const author = stripHtml(info.extmetadata?.Artist?.value ?? "");

        if (existingFileSet.has(file)) continue; // already recorded from a previous run
        if (existsSync(destPath)) {
          newItems.push(buildManifestItem({ id: file, file, knownLabel, source, license, author }));
          continue;
        }

        try {
          await downloadFile(info.thumburl, destPath);
          downloaded++;
          newItems.push(buildManifestItem({ id: file, file, knownLabel, source, license, author }));
          console.log(`  + ${file} (${license})`);
          await sleep(WIKIMEDIA_THROTTLE_MS);
        } catch (err) {
          n--; // slot wasn't actually claimed — let the next candidate reuse the index
          console.warn(
            `Warning: failed to download component image (${page.title}): ${err.message}`,
          );
        }
      }
      gcmcontinue = data.continue?.gcmcontinue;
      pagesFetched++;
      if (!gcmcontinue) break;
    }
  }

  await processFileMembers(`Category:${category}`);

  if (n < target) {
    // Sparse top-level category (e.g. Resistors) — walk one level of subcategories.
    let subcatData;
    try {
      subcatData = await fetchComponentCategoryMembers({
        gcmtitle: `Category:${category}`,
        gcmtype: "subcat",
      });
    } catch (err) {
      console.warn(`Warning: Commons subcategory listing failed for ${category}: ${err.message}`);
      subcatData = null;
    }
    const subcatTitles = Object.values(subcatData?.query?.pages ?? {}).map((p) => p.title);
    const MAX_SUBCATS = 12;
    for (const subcatTitle of subcatTitles.slice(0, MAX_SUBCATS)) {
      if (n >= target) break;
      await processFileMembers(subcatTitle);
    }
  }

  return { items: newItems, downloaded };
}

async function fetchComponents(targetTotal, existingFileSet) {
  const perCategoryTargets = distributeTargets(targetTotal, COMPONENT_CATEGORIES.length);
  console.log(
    `\nFetching components (target ${targetTotal}, split ${perCategoryTargets.join("/")} across categories)...`,
  );
  const newItems = [];
  let downloaded = 0;

  for (let i = 0; i < COMPONENT_CATEGORIES.length; i++) {
    const { category, knownLabel } = COMPONENT_CATEGORIES[i];
    const target = perCategoryTargets[i];
    if (target <= 0) continue; // total smaller than category count — this one gets none
    console.log(`  Category: ${category} (target ${target})`);
    const result = await fetchComponentCategory({ category, knownLabel, target, existingFileSet });
    newItems.push(...result.items);
    downloaded += result.downloaded;
  }

  return { items: newItems, downloaded };
}

// ---------------------------------------------------------------------------
// Output: manifest.json + CREDITS.md
// ---------------------------------------------------------------------------

async function writeManifest(items) {
  const manifest = { generatedAt: new Date().toISOString(), items };
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function writeCredits(items) {
  const componentItems = items.filter((item) =>
    ["capacitor", "resistor", "connector", "led"].includes(item.knownLabel),
  );

  const lines = [
    "# Credits",
    "",
    "## Pets (cats & dogs)",
    "",
    `Sourced from the [Oxford-IIIT Pet dataset](${PETS_DATASET_URL}) via the`,
    `[timm/oxford-iiit-pet](${PETS_SOURCE}) mirror on Hugging Face.`,
    `License: ${PETS_LICENSE}. See \`manifest.json\` for the per-file breed labels.`,
    "",
    "## Electronic components",
    "",
    "Sourced from [Wikimedia Commons](https://commons.wikimedia.org/), filtered per-file",
    "to a permissive license allowlist (Public domain / CC0 / CC BY / CC BY-SA).",
    "",
    "| File | Source | Author | License |",
    "| --- | --- | --- | --- |",
    ...componentItems.map(
      (item) => `| ${item.file} | ${item.source} | ${item.author ?? "—"} | ${item.license} |`,
    ),
    "",
  ];
  await writeFile(CREDITS_PATH, lines.join("\n"), "utf8");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  await mkdir(PETS_DIR, { recursive: true });
  await mkdir(COMPONENTS_DIR, { recursive: true });

  // A manifest entry only counts as "already have it" if its file is still on
  // disk — otherwise a deleted/moved image would be silently treated as present
  // forever and never re-fetched. Drop stale entries here so both fetchers'
  // per-item existsSync checks (and the final written manifest) reflect reality.
  const rawExistingManifestItems = await loadExistingManifestItems();
  const existingManifestItems = [];
  for (const item of rawExistingManifestItems) {
    if (existsSync(path.join(SAMPLES_DIR, item.file))) {
      existingManifestItems.push(item);
    } else {
      console.warn(`Warning: dropping stale manifest entry for missing file "${item.file}".`);
    }
  }
  const existingFileSet = new Set(existingManifestItems.map((item) => item.file));

  // Always run the fetchers rather than short-circuiting on directory file
  // counts: each fetcher reconciles any file already on disk (recording a
  // manifest entry without re-downloading) as it walks its source, so a
  // blanket "already have enough" skip here would leave files that landed
  // outside the manifest (e.g. an interrupted prior run) unreconciled.
  const pets = await fetchPets(args.limitPets, existingFileSet);
  const components = await fetchComponents(args.limitComponents, existingFileSet);

  const allItems = [...existingManifestItems, ...pets.items, ...components.items];
  await writeManifest(allItems);
  await writeCredits(allItems);

  const finalPetCount = await countJpegs(PETS_DIR);
  const finalComponentCount = await countJpegs(COMPONENTS_DIR);

  console.log("\nDone.");
  console.log(
    `  Pets:       ${finalPetCount}/${args.limitPets} (${pets.downloaded} downloaded, ${pets.items.length - pets.downloaded} reconciled from disk)`,
  );
  console.log(
    `  Components: ${finalComponentCount}/${args.limitComponents} (${components.downloaded} downloaded, ${components.items.length - components.downloaded} reconciled from disk)`,
  );
  console.log(
    `  Manifest:   ${path.relative(REPO_ROOT, MANIFEST_PATH)} (${allItems.length} items)`,
  );
  console.log(`  Credits:    ${path.relative(REPO_ROOT, CREDITS_PATH)}`);

  const petsRatio = finalPetCount / args.limitPets;
  const componentsRatio = finalComponentCount / args.limitComponents;
  let exitCode = 0;
  if (petsRatio < SUCCESS_RATIO) {
    console.error(
      `\nError: only ${finalPetCount}/${args.limitPets} pet images landed (<${SUCCESS_RATIO * 100}%).`,
    );
    exitCode = 1;
  }
  if (componentsRatio < SUCCESS_RATIO) {
    console.error(
      `\nError: only ${finalComponentCount}/${args.limitComponents} component images landed (<${SUCCESS_RATIO * 100}%).`,
    );
    exitCode = 1;
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(`\nFatal: ${err.stack ?? err.message}`);
  process.exit(1);
});
