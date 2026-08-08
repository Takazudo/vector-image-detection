# Research: making unlabeled photos findable

This document is the research deliverable behind this PoC. It answers one question: **how do you make an unorganized pile of unlabeled item photos findable?** The findings below were verified during planning research (August 2026) and directly shape the architecture and scope decisions made elsewhere in this repo.

## 1. Problem statement

A customer has a large number of rough, informally-shot photos of items — for example, electrical components — sitting in cloud storage. The photos have no filenames, tags, or other text attached to them. The goal is to be able to find a specific photo by describing what's in it ("the photo of that capacitor") without first manually organizing, renaming, or labeling the entire collection.

This is fundamentally a search problem, not a filing problem: the photos don't need folders or a taxonomy imposed on them ahead of time. They need to become *queryable by meaning*.

## 2. Reference architecture and its local mapping

The starting point for this PoC's architecture is a production case study: [Search a dance movie with Vertex AI and Qdrant](https://dev.classmethod.jp/articles/search-dance-movie-with-vertexai-and-qdrant/) (Classmethod, dev.classmethod.jp). That article builds video-to-video search over dance clips using Google Cloud's Vertex AI Multimodal Embeddings model (`multimodalembedding`, 1408-dim, via the Python `MultiModalEmbeddingModel` SDK) to embed 16-second video segments, storing the resulting vectors and payload metadata in Qdrant (run via Docker) using a collection configured with `Distance.COSINE`, then querying by cosine similarity with payload-based metadata filters.

Stripped of its video-specific details, the transferable core of that architecture is a three-stage pipeline:

**embed → store vectors + payload → cosine search**

This PoC reproduces that same pipeline for still photos, but swaps every paid/cloud component for a free/local equivalent so the whole thing can be run and iterated on without a cloud budget or API keys:

| Reference (production) | This PoC (local) |
|---|---|
| Vertex AI `multimodalembedding` API | transformers.js SigLIP model (local, ONNX, free) |
| Qdrant (Docker) | `VectorStore` interface — in-memory implementation by default, Qdrant adapter available |
| Google Cloud Storage (photo source) | Local folder |
| Cosine distance search in Qdrant | Same cosine similarity semantics, computed in-process or via the Qdrant adapter |

Because the PoC is built against a `VectorStore` interface rather than a concrete database, and because the embedding step is model-agnostic beyond dimension/model bookkeeping, the same architecture can move from local/free back to the original Vertex AI + Qdrant production shape (or a similar cloud stack) by swapping implementations rather than redesigning the pipeline. Section 8 details that migration path.

## 3. Model choice

The embedding model is the one component where "swap it later" has a real cost — see the note on re-indexing below — so it was chosen carefully, with license compatibility as a hard constraint alongside size and quality.

| Model | Dim | q8 size | License | Verdict |
|---|---|---|---|---|
| `Xenova/siglip-base-patch16-224` | 768 | ~201MB | Apache-2.0 | **default** |
| `Xenova/clip-vit-base-patch32` | 512 | ~147MB | no license tag on Hugging Face (openai/clip repo) | swappable, A/B comparison only |
| `Xenova/mobileclip_s0` | 512 | ~52MB | apple-amlr | smallest footprint, license needs caution |
| jina-clip-v2 | 1024 | – | CC-BY-NC-4.0 | rejected — non-commercial license |

`Xenova/siglip-base-patch16-224` is the default: a clean Apache-2.0 license, a reasonable 768-dimension embedding, and a manageable ~201MB quantized (q8) footprint. `clip-vit-base-patch32` and `mobileclip_s0` are kept available for A/B comparisons but are not the default — CLIP's Hugging Face mirror carries no explicit license tag, and MobileCLIP ships under Apple's AMLR license, which warrants caution before commercial use. jina-clip-v2 was evaluated and rejected outright: CC-BY-NC-4.0 forbids commercial use, conflicting with this PoC's eventual production intent.

All model handling goes through [transformers.js](https://huggingface.co/docs/transformers.js) v4 (package `@huggingface/transformers`, v4 shipped February 2026). The legacy package name, `@xenova/transformers`, is frozen at v2.17.2 and is not the one this project depends on. transformers.js v4 exposes SigLIP's two-tower architecture as separate `SiglipVisionModel` and `SiglipTextModel` classes, which matters for the browser demo: a browser client that only needs to embed a *text* query can download just the text tower rather than the full vision+text model. transformers.js v4 also ships a `zero-shot-image-classification` pipeline, which is the mechanism used for vocabulary-based tagging (Section 4).

One consequence of the model choice shapes the index format directly: the vector index stores both `modelId` and `dim` alongside every embedding, because **embeddings from different models are not comparable to each other**. Swapping the embedding model is not a drop-in change — it requires re-indexing the entire photo collection from scratch.

## 4. "Photos have no words" — feasibility of auto-attaching words

This is the core question the PoC has to answer, and the research surfaced three genuinely distinct mechanisms that get conflated in casual discussion of "AI photo search." They solve different problems, have different costs, and are not interchangeable.

### 4.1 Search without words

The most direct answer to "photos have no words" is: **they don't need any.** Because SigLIP (like CLIP) embeds images and text into the same vector space, a text query ("a photo of a capacitor") and a photo of a capacitor land near each other in that space regardless of whether the photo was ever labeled. This gives two search modes for free, with zero labeling work:

- **Text → image search**: type a description, get back visually matching photos.
- **Similar-image search**: pick a photo you already have, find others like it.

This mechanism alone — no tags, no captions, nothing attached to the photos — already solves a large fraction of "find my photo."

### 4.2 Word amplification ("self-attaching word" feature)

The second mechanism is about producing labels *for* photos, using words the customer already cares about, without a human tagging every photo by hand. It has two parts:

1. **Zero-shot tagging against a customer-supplied vocabulary.** Given a fixed list of candidate labels (e.g. "capacitor", "resistor", "connector"), each photo is scored against a template like `"a photo of a {label}"` for every label, and the highest-scoring label(s) are proposed as tags. It's important to be precise about what these scores mean: they are cosine similarities *relative to the other candidates in the vocabulary*, not calibrated probabilities — a score of 0.31 for "capacitor" means "closer to capacitor than to the other words in this list," not "31% confident." Any accept/reject threshold needs per-domain, per-vocabulary tuning, not a fixed default.

2. **Exemplar tag propagation.** A human tags one photo (e.g. marks it "capacitor"), and the system proposes the same tag on its nearest neighbors in embedding space (a k-NN search), which a human confirms or rejects one by one. This is *label propagation on a k-NN graph*, applied here to cut tagging effort from "label every photo" to "label a few exemplars and confirm suggestions." Prior art: immich's search-by-example feature and Excire's auto-keywording both use this pattern in production photo tools.

**Honest limits.** CLIP-class zero-shot classification is reliable at coarse, everyday categories (cat vs. dog) but degrades on fine-grained, niche domains — exactly the electrical-components use case this PoC targets. One study measured mean zero-shot accuracy around **36%** on domain-specific label sets, and PCB-component classification needed few-shot fine-tuning (not zero-shot) to reach high accuracy. Practically: zero-shot vocabulary tagging is a reasonable *first pass* or *suggestion* mechanism for niche domains, not a reliable auto-labeler on its own — it needs a human in the loop, exemplar propagation, and/or fine-tuning.

### 4.3 True auto-word-generation (captioning)

The third mechanism is generating novel descriptive text for a photo from scratch — captioning, not classification against a fixed vocabulary.

- **Local captioning is cut from this PoC.** BLIP, the most common local captioning model, is unsupported in transformers.js v4. `Xenova/vit-gpt2-image-captioning` runs, but produces generic, COCO-style captions ("a black electronic device on a table") — shallow-accurate but not useful for search, since it adds noise rather than distinguishing detail. Florence-2 (`onnx-community/Florence-2-base-ft`, MIT license, ~205MB) is a promising future local option, but realistically needs WebGPU to run at usable speed, putting it out of scope here.

- **VLM API tagging is the quality ceiling.** Sending a photo to a vision-language model API (Claude, GPT-4o, Gemini) produces far better results: it can read printed part numbers off components and emit domain-specific tags directly in the target language (e.g. Japanese), sidestepping the translation problem in Section 5 entirely. Approximate per-image costs, verified August 2026 and cited here as ballparks rather than guarantees (providers change pricing):

  - Claude's image token cost is roughly `(width × height) / 750` tokens.
  - `claude-haiku-4-5` ≈ $0.002–0.004 per image.
  - `claude-sonnet-5` ≈ $0.005–0.01 per image.
  - GPT-4o ≈ $0.002 per image.
  - Gemini Flash-Lite ≈ hundredths of a cent per image.
  - Batch APIs cut these costs roughly in half.

  For a collection of 1,000 photos, full VLM tagging costs on the order of **$2–10**.

  **This carries a mandatory privacy note: using a VLM API means the photos leave the local machine and are sent to a third-party service.** For a customer with sensitive or proprietary item photos, this is a real trade-off against the fully local mechanisms above, not just a cost line item.

## 5. Japanese-language support

The customer's queries and vocabulary are expected to be Japanese, but vanilla CLIP and SigLIP text towers are trained predominantly on English text and are English-centric. The options evaluated:

- **(a) Translate Japanese queries to English before embedding** — recommended for this PoC. A tiny LLM call (or even manual translation during testing) sidesteps the multilingual-model problem entirely and keeps the embedding model choice from Section 3 unchanged.
- **(b) SigLIP2 multilingual models** (`onnx-community/siglip2-*-ONNX`) — natively multilingual, but only the FixRes variants are usable; the NaFlex variants are unsupported in transformers.js (tracked as [transformers.js issue #1402](https://github.com/huggingface/transformers.js/issues/1402)).
- **(c) Japanese-native CLIP models** — `line-corporation/clip-japanese-base` (Apache-2.0) and rinna's Japanese CLIP (Apache-2.0) both exist and are appropriately licensed, but neither ships an official ONNX or transformers.js build, which would require converting and maintaining the conversion ourselves.
- **(d) jina-clip-v2** — handles Japanese natively, but as noted in Section 3, its CC-BY-NC-4.0 license rules it out for anything beyond evaluation.

Separately, the VLM tagging mechanism from Section 4.3 sidesteps this whole problem for the tags it generates: a VLM can be asked to emit Japanese tags directly, no translation layer required.

## 6. Vector store comparison

### In-memory exact search

Benchmarked on Node 24, using 512-dimension `Float32Array` vectors, on this-class development hardware:

| Collection size | Query latency |
|---|---|
| 500 vectors | 0.33 ms |
| 2,000 vectors | 1.3 ms |
| 5,000 vectors | 3.35 ms |
| 20,000 vectors | 15.9 ms |

Memory footprint scales predictably: 5,000 vectors × 512 dims × 4 bytes ≈ 10MB. The practical conclusion is that **exact brute-force cosine search stays fast and correct up to roughly tens of thousands of images** — an approximate nearest-neighbor (ANN) index buys nothing at PoC scale and would only add complexity.

### Qdrant

Qdrant is the reference production vector database (Section 2), but it has no embedded / in-process mode for JavaScript — the `:memory:` mode is Python-only, and Qdrant Edge (a beta embedded mode) is Python/Rust only. For JS, Qdrant means running the server via Docker:

```
docker run -p 6333:6333 -p 6334:6334 -v "$(pwd)/qdrant_storage:/qdrant/storage:z" qdrant/qdrant
```

and talking to it via the official `@qdrant/js-client-rest` client, using `createCollection({ size, distance: 'Cosine' })`, `upsert`, and `query`. This is the adapter path used when the PoC needs to demonstrate the "production-shaped" storage backend rather than the default in-memory store.

### Middle-ground options (not needed yet, noted for later)

If the in-memory store's scale ceiling is ever reached before a full Qdrant migration is justified, three intermediate options exist: **sqlite-vec** (still pre-v1, brute-force search), **LanceDB** (embedded, but ships native binaries), and **hnswlib-node** (true ANN, but requires `node-gyp` native compilation). None of these are used in this PoC — they're recorded here as the known next steps.

### Prior-art scale references

- **rclip** — SQLite + brute-force numpy search; indexing 50,000 images takes about 7 minutes on an M1 Max.
- **immich** — Postgres + VectorChord for its smart search feature.
- **clip-retrieval** — uses FAISS, at LAION scale (billions of images).

These confirm the general shape: brute-force/SQL-backed exact search is a legitimate choice up to tens of thousands of images, and ANN only becomes necessary well beyond that.

## 7. Prior art

Several existing projects validate that this embed-store-search architecture is a well-trodden, production-proven pattern, not a novel bet:

- **[rclip](https://github.com/yurijmikhalevich/rclip)** — OpenCLIP embeddings + SQLite + brute-force search, a minimal single-user version of exactly this PoC's approach.
- **[immich](https://immich.app/) smart search** — an ONNX-based CLIP/SigLIP model registry, search-by-example, and duplicate detection via embedding distance, all running against a production photo library. This is the closest full-featured analog to what this PoC is building toward.
- **Hugging Face `semantic-image-search-web` demo** — runs the text tower in a Web Worker against precomputed image embeddings with brute-force `cos_sim`, entirely in-browser. This is exactly the browser-side pattern this PoC's web demo follows.
- **[clip-retrieval](https://github.com/rom1504/clip-retrieval)** — demonstrates the embed → index → serve pipeline staged at much larger scale (LAION-level).
- **[PhotoPrism](https://www.photoprism.app/)** — included as the counter-example. It relies on a fixed label-classifier taxonomy rather than CLIP-style embedding search, which illustrates concretely why a fixed taxonomy loses against embedding search for the "find without predefined words" problem this PoC targets: a taxonomy only helps you find what someone already thought to name in advance.

## 8. Production path

This PoC is deliberately built local-first and free, but every piece maps onto a production-shaped equivalent, following the same substitution pattern shown in Section 2:

- **Embedding**: local SigLIP → Vertex AI `multimodalembedding` (the reference architecture's original choice), or a self-hosted SigLIP2 deployment on GPU for lower per-call cost at volume.
- **Vector storage**: in-memory store → Qdrant or pgvector, both horizontally scalable with metadata filtering alongside vector search.
- **Ingestion**: local folder walk → event-driven ingestion triggered by cloud storage upload events (e.g. GCS object-finalize), so new photos are embedded and indexed automatically rather than in a batch run.
- **Cost/latency**: per-image embedding and optional VLM tagging costs and latencies (Section 4.3) need to be budgeted at production ingestion volume, not just PoC demo scale.
- **Scale threshold for ANN**: per Section 6, exact search stays adequate through the tens-of-thousands range; a deployment expecting **more than roughly 100,000 images** should plan for an ANN-backed index.
- **Fine-grained accuracy**: per Section 4.2, zero-shot tagging on niche domains is a first pass, not a finished labeler — production needs either few-shot fine-tuning or continued VLM-assisted tagging for labels zero-shot can't reliably produce.

## Sources

- [Search a dance movie with Vertex AI and Qdrant](https://dev.classmethod.jp/articles/search-dance-movie-with-vertexai-and-qdrant/) — dev.classmethod.jp
- [transformers.js documentation](https://huggingface.co/docs/transformers.js) — Hugging Face
- [`Xenova/siglip-base-patch16-224`](https://huggingface.co/Xenova/siglip-base-patch16-224) — Hugging Face
- [`Xenova/clip-vit-base-patch32`](https://huggingface.co/Xenova/clip-vit-base-patch32) — Hugging Face
- [`Xenova/mobileclip_s0`](https://huggingface.co/Xenova/mobileclip_s0) — Hugging Face
- [`jinaai/jina-clip-v2`](https://huggingface.co/jinaai/jina-clip-v2) — Hugging Face
- [`onnx-community/Florence-2-base-ft`](https://huggingface.co/onnx-community/Florence-2-base-ft) — Hugging Face
- [`onnx-community/siglip2-base-patch16-224-ONNX`](https://huggingface.co/onnx-community/siglip2-base-patch16-224) — Hugging Face
- [transformers.js issue #1402 (SigLIP2 NaFlex support)](https://github.com/huggingface/transformers.js/issues/1402) — GitHub
- [`line-corporation/clip-japanese-base`](https://huggingface.co/line-corporation/clip-japanese-base) — Hugging Face
- [immich documentation — smart search](https://immich.app/docs/features/searching) — immich.app
- [rclip](https://github.com/yurijmikhalevich/rclip) — GitHub
- [clip-retrieval](https://github.com/rom1504/clip-retrieval) — GitHub
- [Qdrant documentation](https://qdrant.tech/documentation/) — qdrant.tech
- [`@qdrant/js-client-rest`](https://www.npmjs.com/package/@qdrant/js-client-rest) — npm
- [PhotoPrism](https://www.photoprism.app/) — photoprism.app
