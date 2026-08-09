# Real-photo filter validation

Run on 2026-08-09 with the local `Xenova/siglip-base-patch16-224` model.
This is a repeatable sanity check using photos with retained attribution and
license metadata; downloaded files and generated index data remain ignored by
Git.

## Corpus

`pnpm fetch-samples` downloaded 100 photos into `data/samples/`:

- 60 Oxford-IIIT Pet photos: 30 cats and 30 dogs, CC BY-SA 4.0.
- 40 Wikimedia Commons component photos: 10 each of capacitors, resistors,
  connectors, and LEDs; each file passed the Public Domain/CC0/CC BY/CC BY-SA
  allowlist.

`data/samples/manifest.json` records every file's source, author when supplied,
license, and the known category used below only to measure the results.

## Commands

```sh
pnpm fetch-samples
pnpm build
pnpm vis ingest data/samples --index real-photo-validation
pnpm vis search cat --index real-photo-validation -k 10
pnpm vis search dog --index real-photo-validation -k 10
pnpm vis search capacitor --index real-photo-validation -k 10
pnpm vis search resistor --index real-photo-validation -k 10
pnpm vis search connector --index real-photo-validation -k 10
pnpm vis search "light emitting diode" --index real-photo-validation -k 10
pnpm vis tag vocab cat dog capacitor resistor connector led --index real-photo-validation
```

## Search results

| Query                  | Correct photos in top 10 | Result                                   |
| ---------------------- | -----------------------: | ---------------------------------------- |
| `cat`                  |                       10 | Strong coarse-category retrieval.        |
| `dog`                  |                       10 | Strong coarse-category retrieval.        |
| `capacitor`            |                        3 | Component classes overlap substantially. |
| `resistor`             |                        5 | Component classes overlap substantially. |
| `connector`            |                        5 | Component classes overlap substantially. |
| `light emitting diode` |                        4 | Component classes overlap substantially. |

Image-to-image search was strong for the pet set: using
`pets/cat-abyssinian-2.jpg` returned five cats in the top five (scores
0.824–0.799).

Six-way k-means also separated the pet imagery clearly: one 24-photo cat
cluster plus a six-photo sphynx cluster, and one 30-photo dog cluster. The
components formed mixed clusters, so unsupervised discovery should be treated
as exploratory rather than a component classifier.

## Vocabulary filter

At the CLI's default real-model threshold of `0.04`, `tag vocab` proposed:

| Word      | Photos clearing the filter |
| --------- | -------------------------: |
| cat       |                         30 |
| dog       |                         31 |
| capacitor |                         22 |
| resistor  |                         21 |
| connector |                         24 |
| led       |                         30 |

The low threshold gives useful pet coverage but deliberately permits
cross-category component proposals. It is a review queue, not a calibrated
component classifier. The demo's vocabulary-filter default now matches the
CLI's `0.04`; its former `0.20` real-model default was above the observed
SigLIP score range and could filter every photo out on first use.

## Conclusion

The filter/search workflow is ready to demonstrate broad visual categories and
to surface component candidates for human review. It should not be presented
as reliable fine-grained electronic-component identification without a tuned
vocabulary, confirmed exemplar tags, or a stronger domain-specific model.
