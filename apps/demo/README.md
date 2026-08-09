# @vector-image-detection/demo

Customer-facing demo for the photo vector search PoC. It loads a precomputed
index bundle and runs search, categorization, and tagging entirely in the
browser — there is no server component.

The static shell is built by zfb. The complete React application is one
`when="load"` client island, styled with Tailwind v4 utilities and a deliberately
small semantic theme in `styles/global.css`.

## Run it

```sh
pnpm demo:fixture   # copy the committed fixture bundle into public/data/
pnpm demo:dev
```

`zfb preview` serves the last production build. `predev` and `prebuild` copy the
version-matched ONNX WebAssembly runtime into `public/onnxruntime/`. The
committed bundle has 100 real, license-attributed photos; its first text query
downloads the matching SigLIP text tower into the browser cache.

To run against real photos instead, point the CLI at a directory and export:

```sh
vis ingest ./photos
vis export-demo      # writes meta.json + embeddings.bin + thumbs/ to public/data/
```

With a real bundle the app switches to the SigLIP text tower automatically —
about 100 MB on a first visit, cached by the browser afterwards.

## Views

| View            | Backed by                                                |
| --------------- | -------------------------------------------------------- |
| Gallery         | the bundle's items, tags, and attribution fields         |
| Auto-categorize | `classifyByVocab` (primary) and `kmeans` / `suggestK`    |
| Search          | text embedding in a worker, then `VectorStore.search`    |
| Similar         | `VectorStore.search` against a stored vector             |
| Vocabulary tags | `zeroShotTag` plus `softmaxOverVocab` for the share bars |
| Attach a word   | `proposeTagPropagation` with per-proposal confirm/reject |

## Model compatibility

Whichever embedder built the index has to embed the queries too — a query vector
is only comparable to vectors from the same space. The app reads `meta.modelId`
and loads the corresponding text tower. There is no UI toggle, because there is
no valid way to mix models.

## Tag persistence

Confirmed tags go to `localStorage`, keyed by index identity
(`modelId` + `createdAt`) so they never leak across bundles, and are merged over
the bundle's own tags at load. This is demo-scoped: a real deployment writes
confirmed tags back into the index bundle (`vis tag`) or a database. The tag bar
exposes JSON export and a reset.

## Fixture

`fixtures/bundle/` is committed and mirrors a `vis export-demo` output exactly,
including 100 real photo thumbnails, vectors, `manifest.json`, and
`CREDITS.md`. The latter two files retain each published image's source,
author, and license. `fixtures/bundle.test.ts` verifies the bundle integrity
and attribution metadata in CI.

## Production checks

```sh
pnpm --filter @vector-image-detection/demo test:output
pnpm --filter @vector-image-detection/demo test:smoke
```

The first command builds and asserts the root URLs, hydrated island, worker,
photo bundle, attribution files, and ONNX output. The Playwright smoke drives
missing-bundle retry, gallery, similarity, persistence, and verifies that the
real model remains lazy until a text-driven feature is used.
