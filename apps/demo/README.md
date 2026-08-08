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
version-matched ONNX WebAssembly runtime into `public/onnxruntime/`; mock mode
does not request those files or the real model.

That is the zero-download path: the fixture's vectors come from core's
`FakeEmbedder`, so the app embeds queries with the same deterministic stand-in
and every view works offline.

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

## Mock mode

Whichever embedder built the index has to embed the queries too — a query vector
is only comparable to vectors from the same space. So the app reads
`meta.modelId`: `fake-embedder-v1` selects `FakeEmbedder`, anything else loads
the real model. There is no UI toggle, because there is no valid way to mix them.

## Tag persistence

Confirmed tags go to `localStorage`, keyed by index identity
(`modelId` + `createdAt`) so they never leak across bundles, and are merged over
the bundle's own tags at load. This is demo-scoped: a real deployment writes
confirmed tags back into the index bundle (`vis tag`) or a database. The tag bar
exposes JSON export and a reset.

## Fixture

`fixtures/bundle/` is committed and mirrors a `vis export-demo` output exactly,
thumbnail naming included. Regenerate it with:

```sh
pnpm --filter @vector-image-detection/demo fixture:generate
```

`fixtures/bundle.test.ts` is its acceptance test — it drives every view's
underlying core call against the committed bundle, so a broken regeneration
fails in CI rather than in a browser.

## Production checks

```sh
pnpm --filter @vector-image-detection/demo test:output
pnpm --filter @vector-image-detection/demo test:smoke
```

The first command builds and asserts the root URLs, hydrated island, worker,
fixture, and ONNX output. The Playwright smoke drives missing-bundle retry, all
five views, similarity, persistence, and verifies that mock mode downloads no
model.
