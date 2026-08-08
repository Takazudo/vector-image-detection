# Hosted apps verification record — Issue #27

This record covers the integrated documentation, demo, and Cloudflare static
asset delivery contract from a clean tracked workspace. It is intentionally
offline: no model weights, live VLM calls, authenticated Cloudflare preflight,
deployment, browser, or preview server were used.

## Revision and environment

- Starting integration revision: `94651a1f049698492b1b3d9c2890fdc0bf566619`
- Node.js: `v24.13.1`
- pnpm: `10.30.3`
- Wrangler: `4.120.0`

The workspace had no tracked modifications before the sequence. `pnpm install
--frozen-lockfile` accepted the committed lockfile and downloaded no packages.
pnpm reported that dependency build scripts remained unapproved; the commands
below still built, tested, and validated the two static applications.

## Ordered clean-workspace checks

Run these commands from the repository root, in this order:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm --filter @vector-image-detection/docs run check
pnpm test
pnpm --filter @vector-image-detection/demo run test:output
pnpm run cloudflare:assets
env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID \
  pnpm --filter @vector-image-detection/docs exec wrangler deploy --dry-run
env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID \
  pnpm --filter @vector-image-detection/demo exec wrangler deploy --dry-run
```

All commands passed. Results from this run:

- Root build built the docs' 20 prerendered pages and the demo's production
  island after copying the committed fixture bundle.
- Root typecheck and the explicit docs `zfb check` completed without errors.
- `pnpm test`: 44 test files / 274 tests passed; 2 files / 5 tests were skipped
  because their live or model gates were not enabled. The script test suite
  additionally passed 21 tests.
- `demo test:output` passed its production-output assertion. It verifies the
  React island marker, root-relative favicon and island URLs, the separate mock
  and real workers, fixture data/thumbnails, and all emitted ONNX/WASM runtime
  files. It also proves the mock coordinator worker contains none of the
  Transformers.js, ONNX Runtime, or Hugging Face references; the real worker is
  a separate lazy asset and addresses its WASM files at `/onnxruntime/...`.
- `cloudflare:assets` passed for both applications. It checks each Worker name,
  hostname, custom-domain route, `./dist` asset directory, HTML/404 behavior,
  and required generated output files.
- The docs dry-run read 370 files from `apps/docs/dist`; the demo dry-run read
  49 files from `apps/demo/dist`. Both ran Wrangler `4.120.0`, reported no
  bindings, and ended with `--dry-run: exiting now.` No Cloudflare credentials
  were available to either command.

## Documentation routes and links

After the build, a deterministic static validation read
`apps/docs/dist/__zfb/routes.json` and every MDX file under
`apps/docs/src/content`.

- All 6 internal `/docs/...` Markdown links resolve to one of the 20 generated
  routes.
- Category and leaf output exists for getting started, concepts, guides,
  overview, and reference, including representative leaf pages such as
  `/docs/overview/what-it-does` and `/docs/guides/demo-and-own-photos`.
- The hosted-demo link is present in the generated Guides output and targets
  `https://vector-image-detection.takazudomodular.com`.
- Generated `llms.txt`, `llms-full.txt`, `404.html`, and `sitemap.xml` are all
  present and non-empty. The generated docs shell also contains the configured
  GitHub link.

The link validation was the following portable read-only check, performed
after `pnpm build`:

```sh
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("apps/docs");
const routes = JSON.parse(await readFile(path.join(root, "dist/__zfb/routes.json"), "utf8")).routes;
const urls = new Set(routes.map(({ url }) => url));
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(target);
    else if (entry.name.endsWith(".mdx")) files.push(target);
  }
}
await walk(path.join(root, "src/content"));
const broken = [];
for (const file of files) {
  const source = await readFile(file, "utf8");
  for (const [, target] of source.matchAll(/\]\(([^)]+)\)/g)) {
    if (!target.startsWith("/docs/")) continue;
    if (!urls.has(target.split(/[?#]/, 1)[0].replace(/\/$/, ""))) broken.push(`${file} -> ${target}`);
  }
}
assert.deepEqual(broken, []);
for (const file of ["llms.txt", "llms-full.txt", "404.html", "sitemap.xml"]) {
  assert.ok((await stat(path.join(root, "dist", file))).size > 0);
}
NODE
```

## Manager-owned browser verification

Browser tooling and servers are intentionally not invoked by this worker. The
following is the remaining manager-owned acceptance check, against the built
applications at both a desktop viewport (for example 1440×900) and narrow
mobile viewport (390×844). Use the existing
`apps/demo/tests/browser-smoke.mjs` as the basis for the demo's deterministic
scenario, expanding it to desktop, focus/touch, motion, and color-scheme
coverage.

Expected:

- Demo: a hydrated React island; 24-item fixture gallery; Gallery,
  Auto-categorize, Search, Vocabulary tags, and Attach a word views; selection
  and Similar photos panel; mock text search; categorize/vocabulary/attach
  interactions; tag persistence across reload; missing-bundle retry;
  attribution; keyboard focus; touch-safe controls; reduced motion; and light
  and dark schemes.
- Docs: category and leaf navigation, representative deep links, search, theme
  toggle, sidebar filter/resizer/toggle, TOC behavior, GitHub and hosted-demo
  links, generated `llms.txt`/`llms-full.txt`, and intentional 404 behavior.

Observed:

- The offline artifact checks above establish the generated routes, links,
  root-relative files, fixture boundary, lazy real-model worker, and static
  Cloudflare asset contract. They do not observe a rendered browser session.

Still different:

- The runtime interaction, responsive geometry, focus/touch, reduced-motion,
  color-scheme, console, and network portions of both applications must be
  observed by the manager.

Forbidden states checked:

- Static output confirms the mock worker does not bundle or request real-model
  runtime code and that required root-relative static files exist.
- The manager must additionally confirm no console errors, unexpected network
  failures, broken internal links, or model/Hugging Face download occur in mock
  mode at either viewport.

Verdict: INCONCLUSIVE for browser behavior; deterministic build, link, output,
asset, and unauthenticated dry-run checks PASS.

## Deliberately unrun remote checks

`pnpm run cloudflare:preflight` was not run because it requires
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` and performs authenticated
Cloudflare API requests. Production deployment was not run. Those account and
live-host checks belong to the post-merge process, not this pre-merge gate.
