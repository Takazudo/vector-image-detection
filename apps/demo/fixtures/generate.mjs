#!/usr/bin/env node
// Regenerates apps/demo/fixtures/bundle/ — a committed stand-in for what
// `vis ingest && vis export-demo` produces, so the demo is fully functional
// with no model download and no sample-photo fetch.
//
// The images are synthetic SVG-derived shapes, not photos. That is the point:
// the bundle's vectors come from FakeEmbedder, which seeds from the filename's
// first token (`cat-01.png` -> `cat`), so text and image land close together in
// the fake space and every downstream feature (search, zero-shot tagging,
// propagation, clustering) genuinely works on it. The pixels only have to be
// visually distinguishable to a human; they are never embedded.
//
// Layout mirrors the CLI's index bundle exactly, including the thumb naming
// rule from packages/cli/src/lib/thumbs.ts (`<relPath>.jpg`, appended rather
// than substituted). Regenerate with: pnpm --filter @vector-image-detection/demo fixture:generate

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { FakeEmbedder, encodeVectors } from "@vector-image-detection/core/browser";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE_DIR = path.join(HERE, "bundle");

const SIZE = 192;
const VARIANTS_PER_CATEGORY = 4;
const JPEG_QUALITY = 80;

// Frozen so the committed bundle never churns on a regeneration that changed
// nothing else. `vis ingest` stamps the real wall clock here.
const CREATED_AT = "2026-01-01T00:00:00.000Z";

const ATTRIBUTION = {
  source: "https://github.com/Takazudo/vector-image-detection",
  license: "CC0-1.0",
  author: "vector-image-detection fixture generator",
};

// hsl(), not oklch() — sharp rasterizes SVG through librsvg, which silently
// resolves any CSS Color 4 function to black. Chroma is expressed on the OKLCH
// scale here purely because it reads better at these call sites; the factor
// just widens it to an HSL saturation percentage.
function shade(hue, lightness, chroma) {
  return `hsl(${hue}, ${Math.min(90, Math.round(chroma * 420))}%, ${lightness}%)`;
}

function cat(hue) {
  return `
    <path d="M52 96 L64 40 L100 74 Z" fill="${shade(hue, 62, 0.14)}" />
    <path d="M140 96 L128 40 L92 74 Z" fill="${shade(hue, 62, 0.14)}" />
    <circle cx="96" cy="112" r="52" fill="${shade(hue, 72, 0.12)}" />
    <circle cx="78" cy="104" r="7" fill="${shade(hue, 25, 0.04)}" />
    <circle cx="114" cy="104" r="7" fill="${shade(hue, 25, 0.04)}" />
    <path d="M88 128 Q96 136 104 128" stroke="${shade(hue, 25, 0.04)}" stroke-width="5" fill="none" stroke-linecap="round" />`;
}

function dog(hue) {
  return `
    <ellipse cx="46" cy="104" rx="20" ry="38" fill="${shade(hue, 52, 0.1)}" />
    <ellipse cx="146" cy="104" rx="20" ry="38" fill="${shade(hue, 52, 0.1)}" />
    <ellipse cx="96" cy="102" rx="48" ry="46" fill="${shade(hue, 70, 0.09)}" />
    <ellipse cx="96" cy="132" rx="26" ry="20" fill="${shade(hue, 86, 0.04)}" />
    <circle cx="96" cy="126" r="8" fill="${shade(hue, 25, 0.03)}" />
    <circle cx="78" cy="94" r="7" fill="${shade(hue, 25, 0.03)}" />
    <circle cx="114" cy="94" r="7" fill="${shade(hue, 25, 0.03)}" />`;
}

function capacitor(hue) {
  return `
    <rect x="16" y="90" width="58" height="12" rx="6" fill="${shade(hue, 60, 0.03)}" />
    <rect x="118" y="90" width="58" height="12" rx="6" fill="${shade(hue, 60, 0.03)}" />
    <rect x="72" y="44" width="16" height="104" rx="4" fill="${shade(hue, 55, 0.16)}" />
    <rect x="104" y="44" width="16" height="104" rx="4" fill="${shade(hue, 55, 0.16)}" />
    <rect x="92" y="86" width="8" height="20" rx="3" fill="${shade(hue, 78, 0.08)}" />`;
}

function resistor(hue) {
  return `
    <rect x="8" y="90" width="44" height="12" rx="6" fill="${shade(hue, 60, 0.03)}" />
    <rect x="140" y="90" width="44" height="12" rx="6" fill="${shade(hue, 60, 0.03)}" />
    <rect x="46" y="66" width="100" height="60" rx="26" fill="${shade(hue, 78, 0.07)}" />
    <rect x="66" y="66" width="12" height="60" fill="${shade(hue, 45, 0.14)}" />
    <rect x="90" y="66" width="12" height="60" fill="${shade(hue, 30, 0.06)}" />
    <rect x="114" y="66" width="12" height="60" fill="${shade(hue, 60, 0.15)}" />`;
}

function led(hue) {
  return `
    <path d="M60 104 A36 36 0 0 1 132 104 Z" fill="${shade(hue, 68, 0.18)}" />
    <rect x="60" y="104" width="72" height="28" fill="${shade(hue, 62, 0.18)}" />
    <rect x="52" y="130" width="88" height="12" rx="4" fill="${shade(hue, 48, 0.1)}" />
    <rect x="72" y="140" width="10" height="40" rx="3" fill="${shade(hue, 60, 0.02)}" />
    <rect x="110" y="140" width="10" height="30" rx="3" fill="${shade(hue, 60, 0.02)}" />
    <ellipse cx="82" cy="84" rx="10" ry="16" fill="${shade(hue, 92, 0.05)}" opacity="0.75" />`;
}

function connector(hue) {
  const pins = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      pins.push(
        `<rect x="${52 + col * 24}" y="${74 + row * 28}" width="16" height="16" rx="3" fill="${shade(hue, 55, 0.05)}" />`,
      );
    }
  }
  return `
    <rect x="38" y="58" width="116" height="76" rx="8" fill="${shade(hue, 72, 0.12)}" />
    <rect x="46" y="66" width="100" height="60" rx="4" fill="${shade(hue, 84, 0.06)}" />
    ${pins.join("\n    ")}`;
}

// Hue is the only per-category color knob; each variant nudges it and the
// backdrop lightness so four same-category images are distinguishable without
// being confusable with another category.
const CATEGORIES = [
  { keyword: "cat", hue: 28, draw: cat },
  { keyword: "dog", hue: 210, draw: dog },
  { keyword: "capacitor", hue: 272, draw: capacitor },
  { keyword: "resistor", hue: 158, draw: resistor },
  { keyword: "led", hue: 352, draw: led },
  { keyword: "connector", hue: 48, draw: connector },
];

function svgFor(category, variant) {
  const hue = (category.hue + variant * 9) % 360;
  const backdrop = shade(hue, 96 - variant * 3, 0.02);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${backdrop}" />
  ${category.draw(hue)}
</svg>`;
}

async function main() {
  await fs.rm(BUNDLE_DIR, { recursive: true, force: true });
  await fs.mkdir(path.join(BUNDLE_DIR, "thumbs"), { recursive: true });

  const embedder = new FakeEmbedder();
  const items = [];
  const imageKeys = [];

  for (const category of CATEGORIES) {
    for (let variant = 0; variant < VARIANTS_PER_CATEGORY; variant++) {
      const name = `${category.keyword}-${String(variant + 1).padStart(2, "0")}.png`;
      const relPath = `${category.keyword}/${name}`;
      const thumbRelPath = `${relPath}.jpg`;
      const destPath = path.join(BUNDLE_DIR, "thumbs", ...thumbRelPath.split("/"));

      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await sharp(Buffer.from(svgFor(category, variant)))
        .jpeg({ quality: JPEG_QUALITY })
        .toFile(destPath);

      // Two capacitors ship with a tag no vocabulary would ever produce, so the
      // "meta tags merged under localStorage overrides" path has something to
      // merge on a first visit. The last item of each category is left without
      // attribution, exercising the partial-credit branch of the info popover.
      const isLastVariant = variant === VARIANTS_PER_CATEGORY - 1;
      items.push({
        id: relPath,
        file: relPath,
        thumb: `thumbs/${thumbRelPath}`,
        knownLabel: category.keyword,
        tags: category.keyword === "capacitor" && variant < 2 ? ["through-hole"] : [],
        ...(isLastVariant ? {} : ATTRIBUTION),
      });
      imageKeys.push(relPath);
    }
  }

  const vectors = await embedder.embedImages(imageKeys);
  const meta = {
    formatVersion: 1,
    modelId: embedder.modelId,
    dim: embedder.dim,
    createdAt: CREATED_AT,
    items,
  };

  await fs.writeFile(
    path.join(BUNDLE_DIR, "meta.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(BUNDLE_DIR, "embeddings.bin"),
    Buffer.from(encodeVectors(vectors, embedder.dim)),
  );

  console.log(
    `fixtures: wrote ${items.length} item(s) (${embedder.modelId}, dim=${embedder.dim}) to fixtures/bundle`,
  );
}

await main();
