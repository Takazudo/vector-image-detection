// Timeout ceilings for the workerd test suite, measured rather than guessed.
//
// Source: the worker-suite invocations logged by 16 GitHub Actions CI runs
// (ubuntu-latest, 2026-08-08 to 2026-08-10), roughly 4x slower than a local run.
// Worst duration observed per file across those runs:
//
//   fast tier     13 of 17 files                 <= 22 ms
//                 readiness / router             2.7 s / 1.9 s
//   integration   purge.integration              3.0 s
//                 seed.integration               23.2 s in-suite, 26.5 s under `test:seed`
//
// The first test in each file absorbs its isolate's cold module import, which is
// why even the trivial files need seconds rather than milliseconds of headroom.
// The two tiers are ~10x apart, so one blanket ceiling is necessarily either too
// loose to catch a regression in the fast files or too tight for the seed import.
//
// Worth knowing before "simplifying" these back into one number: the integration
// tests' own duration scales with runner load far more than the fast files' does
// (seed ranged 1.8 s to 26.5 s, purge 112 ms to 3.0 s, while the 13 trivial files
// never moved off single-digit milliseconds). Load stretches real D1/R2 work much
// harder than it stretches isolate startup.

/**
 * Ceiling for every worker test that is not an integration test: ~4x the worst
 * fast-tier file observed on CI (2.7 s). Tolerates a loaded runner while still
 * failing on a real regression — the previous blanket 30 s would have let a 22 ms
 * test degrade by three orders of magnitude without anyone noticing.
 */
export const WORKER_TEST_TIMEOUT_MS = 10_000;

/**
 * Ceiling for `*.integration.worker.test.ts`, which drive real D1/R2 work: ~2.3x
 * the worst observed (26.5 s, the seed import under `test:seed`). This is not a
 * new allowance — the seed test has carried an inline 60 s since it was written,
 * so it never ran under the config's ceiling at all. Folding it back into a
 * shared 30 s would leave its worst observed run only ~12% of headroom.
 */
export const WORKER_INTEGRATION_TIMEOUT_MS = 60_000;
