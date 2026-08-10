import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../../.github/workflows/deploy-cloudflare.yml", import.meta.url),
  "utf8",
);

const SECRETS_FILE = '"$RUNNER_TEMP/demo-deploy-secrets.json"';
const GENERATED_CONFIG = ".wrangler.production.generated.json";

function stepIndex(name) {
  const index = workflow.indexOf(`- name: ${name}\n`);
  assert.notEqual(index, -1, `the deploy workflow has no step named "${name}"`);
  return index;
}

test("the rendered config is dry-run before it is deployed", () => {
  assert.ok(stepIndex("Render production Wrangler config") < stepIndex("Dry-run demo deployment"));
  assert.ok(stepIndex("Dry-run demo deployment") < stepIndex("Deploy demo"));
});

test("the dry-run and the deploy validate the same generated artifact", () => {
  // Dry-running the inert committed template would pass while the deployed file
  // carried different resource names and the writes-on vars only the renderer
  // sets, so the deploy job must not reach for that script at all.
  assert.doesNotMatch(workflow, /deploy:dry-run:production/);
  const dryRunStep = workflow.slice(
    stepIndex("Dry-run demo deployment"),
    stepIndex("Gate production demo deployment"),
  );
  const deployStep = workflow.slice(
    stepIndex("Deploy demo"),
    stepIndex("Verify the deployed demo"),
  );
  for (const [label, step] of [
    ["dry-run", dryRunStep],
    ["deploy", deployStep],
  ]) {
    assert.ok(
      step.includes(`--config ${GENERATED_CONFIG}`),
      `the ${label} must use the rendered config`,
    );
  }
  assert.match(dryRunStep, /wrangler deploy --dry-run/);
});

test("secrets are staged before the deploy and removed unconditionally after it", () => {
  assert.ok(stepIndex("Stage deployment secrets") < stepIndex("Deploy demo"));
  assert.ok(stepIndex("Deploy demo") < stepIndex("Remove staged deployment secrets"));
  assert.match(
    workflow.slice(stepIndex("Remove staged deployment secrets")),
    /- name: Remove staged deployment secrets\n\s+if: always\(\)\n\s+run: rm -f "\$RUNNER_TEMP\/demo-deploy-secrets\.json"/,
  );
});

test("every step touching the secrets file uses the same path outside the checkout", () => {
  const occurrences = workflow.split(SECRETS_FILE).length - 1;
  assert.equal(occurrences, 3, "stage, deploy, and cleanup must agree on one RUNNER_TEMP path");
});

test("the deploy uploads secrets with the version rather than mutating a live Worker", () => {
  const deployStep = workflow.slice(
    stepIndex("Deploy demo"),
    stepIndex("Verify the deployed demo"),
  );
  assert.match(deployStep, /--secrets-file/);
  const executableLines = workflow
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  assert.doesNotMatch(executableLines, /wrangler secret put/);
});

test("the strict readiness gate runs after the deploy and prints the rollback command", () => {
  assert.ok(stepIndex("Deploy demo") < stepIndex("Verify the deployed demo"));
  const verifyStep = workflow.slice(
    stepIndex("Verify the deployed demo"),
    stepIndex("Remove staged deployment secrets"),
  );
  assert.doesNotMatch(verifyStep, /DEMO_PREFLIGHT_ALLOW_BOOTSTRAP/);
  assert.match(verifyStep, /wrangler rollback/);
  assert.match(verifyStep, /exit 1/);
});

test("only the pre-deploy gate tolerates a target that is not deployed yet", () => {
  const gateStep = workflow.slice(
    stepIndex("Gate production demo deployment"),
    stepIndex("Stage deployment secrets"),
  );
  assert.match(gateStep, /DEMO_PREFLIGHT_ALLOW_BOOTSTRAP: "true"/);
  assert.equal((workflow.match(/DEMO_PREFLIGHT_ALLOW_BOOTSTRAP/g) ?? []).length, 1);
});

test("no secret reaches a run line", () => {
  // Every `secrets.` reference must be a bare step-env assignment. A reviewer
  // can then confirm from the diff alone that no value can be echoed, logged,
  // or word-split by a shell.
  for (const line of workflow.split("\n")) {
    if (!line.includes("${{ secrets.")) continue;
    assert.match(
      line,
      /^\s+[A-Z_][A-Z0-9_]*: \$\{\{ secrets\.[A-Z0-9_]+ \}\}$/,
      `secret reference outside a step env mapping: ${line.trim()}`,
    );
  }
});
