// Run with: node --test scripts/lib/
// Deliberately node:test, not vitest — these must never run inside the vitest
// suite (see filename: *.node-test.mjs, not *.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAT_BREEDS,
  DOG_BREEDS,
  PET_LABEL_NAMES,
  PET_CAT_DOG_NAMES,
  catOrDogFromBreed,
  mapClassLabel,
  isLicenseAllowed,
  hasJpegExtension,
  slugify,
  petFileName,
  componentFileName,
  buildManifestItem,
  stripHtml,
} from "./fetch-helpers.mjs";

test("catOrDogFromBreed classifies known cat breeds", () => {
  assert.equal(catOrDogFromBreed("maine_coon"), "cat");
  assert.equal(catOrDogFromBreed("siamese"), "cat");
  assert.equal(catOrDogFromBreed("Bengal"), "cat"); // case-insensitive
});

test("catOrDogFromBreed classifies known dog breeds", () => {
  assert.equal(catOrDogFromBreed("american_bulldog"), "dog");
  assert.equal(catOrDogFromBreed("yorkshire_terrier"), "dog");
  assert.equal(catOrDogFromBreed("  pug  "), "dog"); // trims whitespace
});

test("catOrDogFromBreed returns null for unknown or invalid input", () => {
  assert.equal(catOrDogFromBreed("tarantula"), null);
  assert.equal(catOrDogFromBreed(""), null);
  assert.equal(catOrDogFromBreed(undefined), null);
  assert.equal(catOrDogFromBreed(42), null);
});

test("breed lists cover all 37 Oxford-IIIT Pet classes with no overlap", () => {
  assert.equal(CAT_BREEDS.length, 12);
  assert.equal(DOG_BREEDS.length, 25);
  const overlap = CAT_BREEDS.filter((b) => DOG_BREEDS.includes(b));
  assert.deepEqual(overlap, []);
});

test("PET_LABEL_NAMES has 37 unique entries, each classifiable as cat or dog", () => {
  assert.equal(PET_LABEL_NAMES.length, 37);
  assert.equal(new Set(PET_LABEL_NAMES).size, 37);
  for (const breed of PET_LABEL_NAMES) {
    assert.notEqual(catOrDogFromBreed(breed), null, `expected "${breed}" to classify`);
  }
  const combined = new Set([...CAT_BREEDS, ...DOG_BREEDS]);
  assert.equal(combined.size, PET_LABEL_NAMES.length);
  for (const breed of PET_LABEL_NAMES) {
    assert.equal(combined.has(breed), true, `"${breed}" missing from CAT_BREEDS/DOG_BREEDS`);
  }
});

test("PET_CAT_DOG_NAMES matches the label_cat_dog ClassLabel order (0=cat, 1=dog)", () => {
  assert.deepEqual(PET_CAT_DOG_NAMES, ["cat", "dog"]);
  assert.equal(mapClassLabel(0, PET_CAT_DOG_NAMES), "cat");
  assert.equal(mapClassLabel(1, PET_CAT_DOG_NAMES), "dog");
});

test("mapClassLabel resolves an index against a names array", () => {
  assert.equal(mapClassLabel(0, ["cat", "dog"]), "cat");
  assert.equal(mapClassLabel(1, ["cat", "dog"]), "dog");
});

test("mapClassLabel returns null for out-of-range index or bad input", () => {
  assert.equal(mapClassLabel(5, ["cat", "dog"]), null);
  assert.equal(mapClassLabel(0, null), null);
  assert.equal(mapClassLabel("0", ["cat", "dog"]), null);
});

test("isLicenseAllowed accepts CC0, public domain, and CC BY / BY-SA variants", () => {
  for (const license of [
    "CC0",
    "CC0 1.0",
    "Public domain",
    "PD-old-70",
    "CC BY 2.0",
    "CC BY 3.0",
    "CC BY 4.0",
    "CC BY-SA 2.5",
    "CC BY-SA 3.0",
    "CC BY-SA 4.0",
    "cc by-sa 4.0", // case-insensitive
  ]) {
    assert.equal(isLicenseAllowed(license), true, `expected "${license}" to be allowed`);
  }
});

test("isLicenseAllowed rejects NC, ND, and unknown licenses", () => {
  for (const license of [
    "CC BY-NC 2.0",
    "CC BY-ND 2.0",
    "CC BY-NC-SA 2.0",
    "All rights reserved",
    "Copyrighted",
    "GFDL",
    "FAL",
    "",
    null,
    undefined,
  ]) {
    assert.equal(isLicenseAllowed(license), false, `expected "${license}" to be rejected`);
  }
});

test("hasJpegExtension accepts only .jpg/.jpeg Commons file titles", () => {
  assert.equal(hasJpegExtension("File:Capacitors Various.jpg"), true);
  assert.equal(hasJpegExtension("File:Old Photo.JPEG"), true);
  assert.equal(hasJpegExtension("File:Plaatcondensator.gif"), false);
  assert.equal(hasJpegExtension("File:Diagram.png"), false);
  assert.equal(hasJpegExtension("File:Scan.pdf"), false);
  assert.equal(hasJpegExtension(undefined), false);
});

test("slugify produces filesystem-safe lowercase hyphenated text", () => {
  assert.equal(slugify("Maine Coon"), "maine-coon");
  assert.equal(slugify("english_cocker_spaniel"), "english-cocker-spaniel");
  assert.equal(slugify("  LED!! "), "led");
});

test("petFileName and componentFileName build the documented relative paths", () => {
  assert.equal(
    petFileName({ catOrDog: "cat", breed: "maine_coon", index: 3 }),
    "pets/cat-maine-coon-3.jpg",
  );
  assert.equal(
    componentFileName({ label: "capacitor", index: 7 }),
    "components/capacitor-7.jpg",
  );
});

test("buildManifestItem includes optional fields only when present", () => {
  const full = buildManifestItem({
    id: "pets/cat-maine-coon-3.jpg",
    file: "pets/cat-maine-coon-3.jpg",
    knownLabel: "cat",
    breed: "maine_coon",
    source: "https://example.com",
    license: "CC BY-SA 4.0",
    author: "Jane Doe",
  });
  assert.deepEqual(full, {
    id: "pets/cat-maine-coon-3.jpg",
    file: "pets/cat-maine-coon-3.jpg",
    knownLabel: "cat",
    source: "https://example.com",
    license: "CC BY-SA 4.0",
    breed: "maine_coon",
    author: "Jane Doe",
  });

  const minimal = buildManifestItem({
    id: "components/capacitor-1.jpg",
    file: "components/capacitor-1.jpg",
    knownLabel: "capacitor",
    source: "https://example.com",
    license: "Public domain",
  });
  assert.deepEqual(minimal, {
    id: "components/capacitor-1.jpg",
    file: "components/capacitor-1.jpg",
    knownLabel: "capacitor",
    source: "https://example.com",
    license: "Public domain",
  });
  assert.equal("breed" in minimal, false);
  assert.equal("author" in minimal, false);
});

test("stripHtml removes markup and collapses whitespace", () => {
  assert.equal(stripHtml('<div class="fn value">\nMartin Brown</div>'), "Martin Brown");
  assert.equal(
    stripHtml('<a href="//commons.wikimedia.org/wiki/User:Foo">Foo</a>'),
    "Foo",
  );
  assert.equal(stripHtml(undefined), "");
});
