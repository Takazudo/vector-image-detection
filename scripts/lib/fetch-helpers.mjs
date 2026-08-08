// Pure, network-free helpers for scripts/fetch-samples.mjs.
// Kept separate so they can be unit-tested with node:test without hitting the network.

// Oxford-IIIT Pet breed classes, split by cat/dog. Mirrors the `label` ClassLabel
// names from https://datasets-server.huggingface.co/info?dataset=timm%2Foxford-iiit-pet&config=default
// Used as a fallback when a row doesn't carry `label_cat_dog` directly.
export const CAT_BREEDS = [
  "abyssinian",
  "bengal",
  "birman",
  "bombay",
  "british_shorthair",
  "egyptian_mau",
  "maine_coon",
  "persian",
  "ragdoll",
  "russian_blue",
  "siamese",
  "sphynx",
];

export const DOG_BREEDS = [
  "american_bulldog",
  "american_pit_bull_terrier",
  "basset_hound",
  "beagle",
  "boxer",
  "chihuahua",
  "english_cocker_spaniel",
  "english_setter",
  "german_shorthaired",
  "great_pyrenees",
  "havanese",
  "japanese_chin",
  "keeshond",
  "leonberger",
  "miniature_pinscher",
  "newfoundland",
  "pomeranian",
  "pug",
  "saint_bernard",
  "samoyed",
  "scottish_terrier",
  "shiba_inu",
  "staffordshire_bull_terrier",
  "wheaten_terrier",
  "yorkshire_terrier",
];

const CAT_BREED_SET = new Set(CAT_BREEDS);
const DOG_BREED_SET = new Set(DOG_BREEDS);

// Oxford-IIIT Pet `label` ClassLabel names, in the exact index order returned by
// https://datasets-server.huggingface.co/info?dataset=timm%2Foxford-iiit-pet&config=default
// (verified during implementation). Index into this array with a row's `label` field
// to get the breed slug.
export const PET_LABEL_NAMES = [
  "abyssinian",
  "american_bulldog",
  "american_pit_bull_terrier",
  "basset_hound",
  "beagle",
  "bengal",
  "birman",
  "bombay",
  "boxer",
  "british_shorthair",
  "chihuahua",
  "egyptian_mau",
  "english_cocker_spaniel",
  "english_setter",
  "german_shorthaired",
  "great_pyrenees",
  "havanese",
  "japanese_chin",
  "keeshond",
  "leonberger",
  "maine_coon",
  "miniature_pinscher",
  "newfoundland",
  "persian",
  "pomeranian",
  "pug",
  "ragdoll",
  "russian_blue",
  "saint_bernard",
  "samoyed",
  "scottish_terrier",
  "shiba_inu",
  "siamese",
  "sphynx",
  "staffordshire_bull_terrier",
  "wheaten_terrier",
  "yorkshire_terrier",
];

// Oxford-IIIT Pet `label_cat_dog` ClassLabel names, in index order (0 = cat, 1 = dog),
// per the same /info endpoint.
export const PET_CAT_DOG_NAMES = ["cat", "dog"];

/**
 * Fallback classifier: derive "cat" | "dog" from a breed slug (e.g. "maine_coon").
 * Only needed when a dataset row lacks the `label_cat_dog` field directly.
 * Returns null for an unrecognized breed.
 */
export function catOrDogFromBreed(breedSlug) {
  if (typeof breedSlug !== "string") return null;
  const normalized = breedSlug.trim().toLowerCase();
  if (CAT_BREED_SET.has(normalized)) return "cat";
  if (DOG_BREED_SET.has(normalized)) return "dog";
  return null;
}

/**
 * Map a ClassLabel integer index to its name, given the feature's `names` array
 * (as returned by the HF datasets-server /info endpoint). Returns null if out of range.
 */
export function mapClassLabel(index, names) {
  if (!Array.isArray(names) || typeof index !== "number") return null;
  return names[index] ?? null;
}

// Wikimedia Commons LicenseShortName allowlist: public domain / CC0 / CC BY / CC BY-SA,
// any version. Explicitly excludes NC (non-commercial) and ND (no-derivatives) variants,
// which are not compatible with unrestricted reuse in this dataset.
const CC_BY_PATTERN = /^cc[\s-]?by(?:[\s-]?sa)?(?:[\s-]?\d+(?:\.\d+)?)?$/;

export function isLicenseAllowed(licenseShortName) {
  if (typeof licenseShortName !== "string") return false;
  const s = licenseShortName.trim().toLowerCase();
  if (s.length === 0) return false;
  if (s.startsWith("cc0")) return true;
  if (s.startsWith("public domain") || s === "pd" || s.startsWith("pd-")) return true;
  return CC_BY_PATTERN.test(s);
}

/**
 * Filesystem/URL-safe slug: lowercase, non-alphanumerics collapsed to single hyphens,
 * leading/trailing hyphens trimmed.
 */
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Relative (to data/samples/) filename for a pet image. */
export function petFileName({ catOrDog, breed, index }) {
  return `pets/${slugify(catOrDog)}-${slugify(breed)}-${index}.jpg`;
}

/** Relative (to data/samples/) filename for a component image. */
export function componentFileName({ label, index }) {
  return `components/${slugify(label)}-${index}.jpg`;
}

/**
 * Shape a single manifest entry, dropping optional fields that weren't supplied.
 * Matches the contract: { id, file, knownLabel, breed?, source, license, author? }
 */
export function buildManifestItem({ id, file, knownLabel, breed, source, license, author }) {
  const item = { id, file, knownLabel, source, license };
  if (breed !== undefined && breed !== null) item.breed = breed;
  if (author !== undefined && author !== null && author !== "") item.author = author;
  return item;
}

/**
 * Split `total` as evenly as possible across `count` buckets, favoring giving
 * every bucket at least one unit (the remainder is handed out one-per-bucket,
 * starting from the first) over a naive per-bucket ceiling — a ceiling-based
 * split can let earlier buckets exhaust the whole total before later ones are
 * ever touched (e.g. total=6 across 4 categories at ceil(6/4)=2 each would
 * fill 3 categories and leave the 4th with nothing).
 */
export function distributeTargets(total, count) {
  if (!Number.isFinite(total) || !Number.isFinite(count) || count <= 0) return [];
  const base = Math.floor(total / count);
  const remainder = total % count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * True if a Wikimedia Commons file title (e.g. "File:Foo.jpg") has a JPEG
 * extension. Commons category listings mix in PNG/GIF/SVG/PDF/DjVu files
 * whose `thumburl` doesn't necessarily come back as an actual JPEG — since
 * every sample is saved as `{label}-{n}.jpg`, only genuinely-JPEG sources
 * are accepted so the file extension always matches its content.
 */
export function hasJpegExtension(title) {
  if (typeof title !== "string") return false;
  return /\.jpe?g$/i.test(title.trim());
}

/**
 * Strip the HTML markup Wikimedia's extmetadata.Artist field commonly wraps author
 * names in (e.g. `<a href="...">Name</a>` or `<div class="fn value">Name</div>`).
 */
export function stripHtml(html) {
  if (typeof html !== "string") return "";
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
