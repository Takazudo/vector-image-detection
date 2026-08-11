# Enable public uploads: operator runbook

This is the exact, ordered, copy-pasteable list of actions a human operator still has to take
before the hosted demo can accept anonymous public uploads. It assumes only `gh` (authenticated
against `zudolab/vector-image-detection`), `wrangler` (via `pnpm exec`), and a Cloudflare account
with billing enabled.

Every command was checked against `apps/demo/scripts/render-production-config.mjs` and
`scripts/cloudflare/demo-preflight.mjs`, not written from memory. Where this runbook needed to
correct a command that appears elsewhere in the repo's docs, that is called out inline.

## What was deliberately not done for you, and why

No agent created Cloudflare resources, wrote repository variables or secrets, ran a remote D1
migration, or flipped `DEMO_DEPLOYMENT_ENABLED`. Every one of those actions either creates a
billable Cloudflare resource or turns on anonymous public writes on a public internet host, so
they belong to a human operator making an explicit, informed decision — not to automation.

**The exact gap, stated plainly:** `gh variable list --repo zudolab/vector-image-detection` returns
empty — zero repository variables exist yet. The `deploy-demo` job needs eleven of them (the seven
`DEMO_*` resource names in step 1, the three `ACK_*` sentinels in step 2, and `DEMO_PREFLIGHT_URL`
in step 3) before `DEMO_DEPLOYMENT_ENABLED` — a twelfth variable — can safely go to `true` as the
very last step. `gh secret list --repo zudolab/vector-image-detection` returns exactly four:
`AUTH_PASSWORD`, `AUTH_PASS_COOKIE`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_API_TOKEN` (verified
while writing this runbook). Do not recreate those four — the password wall is already live and
the Cloudflare API token already has whatever scope it was issued with. The only secret you still
need to create is `DEMO_PREFLIGHT_TOKEN` (step 4).

## 0. Identify or provision the account resources

The committed `apps/demo/wrangler.production.jsonc` only ever contains inert placeholders (a
zeroed database ID, `replace-with-production-*` names). That proves nothing about whether the
underlying account resources exist — it is a template, not a status report. **Identify** each
resource if it already exists in your Cloudflare account, or **provision** it if it does not; the
commands below are for the provisioning path.

Two things are commonly assumed to need provisioning and don't:

- The rate-limit `namespace_id` is not a resource. It is any positive integer, unique among the
  rate-limit namespaces already used in this Cloudflare account — you just pick one, e.g. by
  incrementing past the local (`1000001`) and preview/staging namespace IDs already in use.
- Workers AI needs no named resource either. It is account-level binding access; if the account
  can already call Workers AI, there is nothing to create.

The genuinely provisioned resources are D1, the private R2 bucket, the photo Queue, a **separate**
DLQ, and the Vectorize index.

### Run these from the repository root, not from `apps/demo`

**Do not use `pnpm --filter @vector-image-detection/demo exec wrangler` for the create commands.**
That runs wrangler with `apps/demo/` as its working directory, where it discovers
`apps/demo/wrangler.jsonc` and **appends a binding entry to it** derived from the resource name you
just created. Create a D1 database and an R2 bucket with the same name and you get two bindings with
the same derived name, which makes the config invalid — and then every subsequent wrangler command
fails while parsing it, including ones that have nothing to do with the resource:

```
✘ [ERROR] Processing wrangler.jsonc configuration:
    - vector_image_detection_demo assigned to D1 Database and R2 Bucket bindings.
    - Bindings must have unique names, ...
```

This happened during the first real run of this runbook. If you hit it, `git checkout --
apps/demo/wrangler.jsonc` and re-run from the root. Nothing in this runbook should ever leave a diff
on that file — it is the _local dev_ config, every resource in it is `…-local`, and production names
only ever reach a deploy through `render-production-config.mjs`.

Invoking the binary by path from the repository root avoids the whole problem: the root has no
wrangler config, and wrangler searches upward from the working directory, never downward into
`apps/demo`. It also pins wrangler `4.120.0` (the demo's version) rather than the older `4.72.0` that
a bare `pnpm exec wrangler` resolves to at the root.

```sh
cd <repository root>
export CLOUDFLARE_ACCOUNT_ID=<your account id>   # required if your wrangler login has more than one

# D1 — the output includes the database_id you need in step 1.
./apps/demo/node_modules/.bin/wrangler d1 create <production-d1-name>

# Private R2 bucket — R2 buckets are private by default; no extra flag needed.
./apps/demo/node_modules/.bin/wrangler r2 bucket create <production-r2-bucket-name>

# Photo queue and a separate DLQ. Do not reuse one queue as both.
./apps/demo/node_modules/.bin/wrangler queues create <production-photo-queue-name>
./apps/demo/node_modules/.bin/wrangler queues create <production-photo-dlq-name>

# Vectorize — dimensions and metric are FIXED AT CREATION and cannot be changed
# later. They must match the pinned embedding model
# (@cf/google/embeddinggemma-300m, 768-dimensional, cosine), so these two flags
# are mandatory, not defaults to accept.
./apps/demo/node_modules/.bin/wrangler vectorize create <production-vectorize-index-name> --dimensions=768 --metric=cosine
```

### Verify the index exists before you deploy — this one is not optional

Wrangler **auto-provisions missing queues** during `wrangler deploy` (you will see
`🌀 Creating new Queue … ✨ provisioned` in the job log), so a missed `queues create` self-heals.
**Vectorize does not.** A missing index fails the deploy outright, after the binding table has
already printed, with:

```
Vectorize binding 'PHOTO_VECTORS' references index '<name>' which was not found. [code: 10159]
```

The dry-run will not catch it — dry-run does not resolve remote resources. So confirm explicitly,
and check the dimensions and metric in the output rather than just the name. This manual check is
also the only place the metric is ever verified: the `Vectorize` binding's `describe()` (V2) does not
report the distance metric at runtime at all, so the deployed app's readiness checks can confirm
dimensions but never metric — this creation-time check is the floor.

```sh
cd <repository root>
./apps/demo/node_modules/.bin/wrangler vectorize list
./apps/demo/node_modules/.bin/wrangler queues list
```

The Queue/DLQ _consumer_ wiring (batch size, retries, which DLQ backs which queue) is declarative
in `wrangler.production.jsonc` and gets applied automatically on deploy — there is no separate
`wrangler queues consumer add` step.

Use environment-specific names for everything above; do not point a production resource name at a
local/preview one, and never commit a real resource name into `wrangler.production.jsonc` itself
— it must stay the inert template.

## 1. Set the seven `DEMO_*` resource-name repository variables

These are the only place real resource names enter a deploy — `render-production-config.mjs`
substitutes them into the generated config at deploy time and refuses to run if any is missing.

```sh
gh variable set DEMO_D1_DATABASE_NAME --repo zudolab/vector-image-detection --body "<production-d1-name>"
gh variable set DEMO_D1_DATABASE_ID --repo zudolab/vector-image-detection --body "<database_id from step 0>"
gh variable set DEMO_R2_BUCKET_NAME --repo zudolab/vector-image-detection --body "<production-r2-bucket-name>"
gh variable set DEMO_QUEUE_NAME --repo zudolab/vector-image-detection --body "<production-photo-queue-name>"
gh variable set DEMO_DLQ_NAME --repo zudolab/vector-image-detection --body "<production-photo-dlq-name>"
gh variable set DEMO_VECTORIZE_INDEX_NAME --repo zudolab/vector-image-detection --body "<production-vectorize-index-name>"
gh variable set DEMO_RATE_LIMIT_NAMESPACE_ID --repo zudolab/vector-image-detection --body "<chosen positive integer>"
```

## 2. Set the three `ACK_*` acknowledgement repository variables

**These take fixed sentinel strings, not `"true"`.** This is the single most likely mistake:
setting them to `true` — the intuitive move — makes `validateAcknowledgements` throw and blocks
both the config render and the preflight, everywhere.

```sh
gh variable set ACK_ANONYMOUS_PUBLIC_WRITES --repo zudolab/vector-image-detection --body "I_ACKNOWLEDGE_ANONYMOUS_PUBLIC_WRITES"
gh variable set ACK_RETAINED_IMAGE_METADATA --repo zudolab/vector-image-detection --body "I_ACKNOWLEDGE_RETAINED_IMAGE_METADATA"
gh variable set ACK_REACTIVE_PURGE_ONLY --repo zudolab/vector-image-detection --body "I_ACKNOWLEDGE_REACTIVE_PURGE_ONLY_MODERATION"
```

Note `ACK_REACTIVE_PURGE_ONLY`'s value ends in `_MODERATION` even though the variable name
doesn't — copy the value exactly, don't infer it from the variable name.

This is a **separate namespace** from the same-named `vars` the _deployed Worker_ reads. The
renderer always writes the literal string `"true"` into those (see
`apps/demo/scripts/render-production-config.mjs:44-46`) — you never set that value yourself, and
you never use the sentinel string there either. Two namespaces, identical names, opposite accepted
values; this is why the CI-side variables above must be the long sentinel strings, not `"true"`.

By acknowledging these three, you are personally confirming: uploads and human-tag edits will be
anonymous; uploaded originals are not re-encoded, so embedded image metadata can remain visible;
and there is no automated moderation — takedown is a reactive operator purge only, not a review
queue.

## 3. Set `DEMO_PREFLIGHT_URL`

The production origin the readiness and rollback checks target — the custom domain already
configured in `apps/demo/wrangler.production.jsonc`'s `routes`:

```sh
gh variable set DEMO_PREFLIGHT_URL --repo zudolab/vector-image-detection --body "https://vector-image-detection.takazudomodular.com"
```

A missing `DEMO_PREFLIGHT_URL` or `DEMO_PREFLIGHT_TOKEN` (step 4) fails the pre-deploy gate
_before anything deploys_, and deliberately isn't bootstrap-tolerated — see
`scripts/cloudflare/demo-preflight.mjs`: `"DEMO_PREFLIGHT_URL and DEMO_PREFLIGHT_TOKEN are
required."` is thrown outright, before the network call that bootstrap tolerance even applies to.
A config error is not evidence about whether a Worker exists, so if the failing job's log says
exactly that, the fix is "set the missing variable/secret," not "investigate the deploy."

## 4. Generate and set the `DEMO_PREFLIGHT_TOKEN` secret

This is a bearer token _you_ generate — it is not issued by Cloudflare. It authenticates the
`/api/v1/operator/**` endpoints (readiness and purge). CI stages it into the deployed Worker as
`OPERATOR_PREFLIGHT_TOKEN` (see `.github/workflows/deploy-cloudflare.yml`, "Stage deployment
secrets" step) — same value, different name on each side of the deploy.

Unlike `AUTH_PASSWORD`/`AUTH_PASS_COOKIE` (which keep un-prefixed names because they're also the
keys the local `.env` uses, so one name covers CI, the Worker, and local dev — see the demo
README's deployment-secrets table), `DEMO_PREFLIGHT_TOKEN` keeps its `DEMO_` prefix. It has no such
constraint: it predates this epic and already follows the established CI-side pattern where the
repository secret name differs from the deployed binding name, exactly as `DEMO_PURGE_TOKEN` is
documented to be the same value as `OPERATOR_PREFLIGHT_TOKEN` for the purge tool. Not an
inconsistency — renaming it would just churn the existing purge docs for nothing.

```sh
openssl rand -base64 32
# copy the output somewhere safe (password manager) before it scrolls away —
# you need it again for pnpm run cloudflare:demo-purge later, and it cannot be
# read back out of GitHub once set.
gh secret set DEMO_PREFLIGHT_TOKEN --repo zudolab/vector-image-detection --body "<the value you just generated>"
```

## 5. Apply the D1 migration against the real remote database

**Do not run `wrangler d1 migrations apply <name> --remote --config apps/demo/wrangler.production.jsonc` directly.**
That config's `database_id` is the committed placeholder
(`00000000-0000-0000-0000-000000000000`). Wrangler's D1 lookup (`getDatabaseByNameOrBinding` /
`hasUuid` in the `wrangler` package) treats "config already has a non-empty `uuid`" as a hit and
returns it **without** ever querying Cloudflare by name — so `--remote` would silently target that
placeholder UUID against your real account and fail. You must render the generated config (which
carries the real database ID from step 1) first, and migrate against _that_ file — the same
pattern the deploy job already uses for its dry-run and deploy.

```sh
# From the repository root. All ten values below are the same ones you just set
# as repository variables — export them locally too, only for this render.
DEMO_D1_DATABASE_NAME=<value> \
DEMO_D1_DATABASE_ID=<value> \
DEMO_R2_BUCKET_NAME=<value> \
DEMO_QUEUE_NAME=<value> \
DEMO_DLQ_NAME=<value> \
DEMO_VECTORIZE_INDEX_NAME=<value> \
DEMO_RATE_LIMIT_NAMESPACE_ID=<value> \
ACK_ANONYMOUS_PUBLIC_WRITES=I_ACKNOWLEDGE_ANONYMOUS_PUBLIC_WRITES \
ACK_RETAINED_IMAGE_METADATA=I_ACKNOWLEDGE_RETAINED_IMAGE_METADATA \
ACK_REACTIVE_PURGE_ONLY=I_ACKNOWLEDGE_REACTIVE_PURGE_ONLY_MODERATION \
node apps/demo/scripts/render-production-config.mjs

# Then apply the migration against the file that render just wrote
# (apps/demo/.wrangler.production.generated.json), using your own Cloudflare
# credentials (either `wrangler login` first, or export
# CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN for this one command).
pnpm --filter @vector-image-detection/demo exec wrangler d1 migrations apply DB --remote --config .wrangler.production.generated.json
```

A command **without** `--remote` targets your local D1 (the one `wrangler dev` uses) and does
nothing to production — never use it here. The generated file
(`.wrangler.production.generated.json`) is gitignored and mode `0600`; delete it locally once
you're done if you'd rather not leave real resource names on disk.

## 6. Know what is already live at `DEMO_PREFLIGHT_URL`

This rollout is an _upgrade_, not a true first deploy. The production domain is not empty:

```sh
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' \
  https://vector-image-detection.takazudomodular.com/api/v1/health
```

At the time of writing that answers `200 text/html` — the SPA shell, not the
`{version, status, service, now}` JSON body `router.ts` defines. `/api/v1/operator/readiness`
behaves the same way regardless of the `authorization` header. That is a pre-epic deployment
predating the JSON API and the auth gate.

**The pre-deploy gate handles this.** A reachable target that answers with a non-JSON body is
treated as "this Worker's readiness endpoint is not live here yet" — the same bootstrap class as
an unresolved hostname — so the gate downgrades to a `::warning::` and the deploy proceeds. The
deploy then replaces the stale Worker in place; you do **not** need to delete anything first.

The distinction the gate draws is between _unparseable_ and _failing_:

| Pre-deploy response                                               | Result                           |
| ----------------------------------------------------------------- | -------------------------------- |
| DNS failure, connection refused, Cloudflare 1000-series, `530`    | bootstrap → warn and continue    |
| `200` with a non-JSON body (a stale build, the SPA shell)         | bootstrap → warn and continue    |
| `200` with valid readiness JSON missing a check this release adds | warn and continue (schema drift) |
| `200` with valid readiness JSON reporting a failed check          | **hard fail**                    |
| `401`, `404`, or any other answered status                        | **hard fail**                    |

A body that parses means this Worker answered, so a failure in it is real and blocks the deploy.
A body that does not parse means something else is answering.

The same logic covers schema drift. The gate interrogates the Worker that is _already_
running, which cannot report a readiness check the release being shipped introduces — so a
_missing_ required check is forgiven pre-deploy and only warned about. Without that, every
future release that adds a required check would be unable to deploy itself. Only absence is
forgiven: a check the deployed Worker does report, and reports as failing, still blocks.

None of this relaxes the **post-deploy** gate, which runs with bootstrap tolerance off: after the
deploy, the freshly deployed Worker must return fully passing readiness JSON or the job goes red
and prints the rollback command. On a bootstrap run that does mean traffic switches before
verification — the password wall is the compensating control, since nothing is publicly reachable
without it.

## 7. Turn on the deploy job

This is the twelfth variable, and it must be the **last** one you set — everything above (the
eleven variables from steps 1–3, the secret from step 4, the migration in step 5, the check in
step 6) needs to already be in place first:

```sh
gh variable set DEMO_DEPLOYMENT_ENABLED --repo zudolab/vector-image-detection --body "true"
```

`deploy-cloudflare.yml` has no `workflow_dispatch` trigger — it only runs on `push` to `main`.
Setting this variable does not deploy anything by itself.

The cleanest trigger is to re-run the most recent deploy workflow. A job-level `if:` is re-evaluated
on re-run, so the `deploy-demo` job that was skipped while the variable was unset will execute this
time — no throwaway commit needed:

```sh
gh run list --workflow "Deploy Cloudflare static sites" --branch main --limit 1
gh run rerun <the run id from above>
```

Re-running also re-runs `deploy-docs`, which is idempotent. If you would rather trigger from a push:

```sh
git commit --allow-empty -m "chore: trigger demo deploy" && git push origin main
```

Either way, watch the `deploy-demo` job. A failure at the **Deploy demo** step with `Verify the
deployed demo` skipped means nothing was deployed and whatever was previously live is untouched —
that is the safe failure shape, and step 0's Vectorize check is the usual cause.

## 8. What the bootstrap run will and will not verify

The pre-deploy gate (`Gate production demo deployment` in the workflow) calls the _already
deployed_ Worker's readiness endpoint. Once step 6 above is clear, that target is genuinely
unreachable, so the gate is bootstrap-tolerant: an unresolvable target or a Cloudflare 1000-series
edge error downgrades to a warning and the job continues to deploy. It does **not** silently pass a
deployed-but-broken Worker — a `401`, or a `200` with a failed check, still hard-fails exactly as
on every later deploy.

The trade-off this buys: **on this one bootstrap run, traffic switches before verification.** The
password wall is the compensating control — nothing is publicly reachable even if the deploy is
wrong, because the gate secrets ship atomically with the same deploy. `DEMO_DEPLOYMENT_ENABLED` is
the outer human opt-in you just set. The **post-deploy gate is strict and mandatory** — no
bootstrap tolerance — so the freshly deployed Worker must answer a fully passing readiness
(configuration, D1, migrations, R2, Queue, DLQ, Workers AI, Vectorize, rate limit, operator
acknowledgements, auth gate) or the job goes red.

## 9. If post-deploy verification comes back red

The failing job prints the exact commands. Roll back with:

```sh
pnpm --filter @vector-image-detection/demo exec wrangler versions list --name vector-image-detection-demo
pnpm --filter @vector-image-detection/demo exec wrangler rollback --name vector-image-detection-demo
```

The password wall still protects the site while you investigate — a failed post-deploy check does
not mean the site was ever publicly exposed with writes on; it means the _new_ version didn't pass
and traffic should move back to the last version that did.
