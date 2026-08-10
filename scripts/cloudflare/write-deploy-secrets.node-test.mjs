import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildDeploySecrets,
  resolveSecretsTarget,
  writeDeploySecrets,
} from "./write-deploy-secrets.mjs";

const gateSecrets = { AUTH_PASSWORD: "pw", AUTH_PASS_COOKIE: "cookie" };

test("the gate secrets ship with every deployment", () => {
  assert.deepEqual(buildDeploySecrets({ ...gateSecrets, OPERATOR_PREFLIGHT_TOKEN: "token" }), {
    AUTH_PASSWORD: "pw",
    AUTH_PASS_COOKIE: "cookie",
    OPERATOR_PREFLIGHT_TOKEN: "token",
  });
});

test("a missing operator token skips its entry instead of failing the job", () => {
  assert.deepEqual(buildDeploySecrets(gateSecrets), gateSecrets);
  assert.deepEqual(
    buildDeploySecrets({ ...gateSecrets, OPERATOR_PREFLIGHT_TOKEN: "" }),
    gateSecrets,
  );
});

test("a half-configured access gate is refused before anything is deployed", () => {
  assert.throws(() => buildDeploySecrets({ AUTH_PASSWORD: "pw" }), /AUTH_PASS_COOKIE/);
  assert.throws(() => buildDeploySecrets({ AUTH_PASS_COOKIE: "cookie" }), /AUTH_PASSWORD/);
  assert.throws(() => buildDeploySecrets({}), /required/);
});

test("the secrets file may not be written inside the checkout", () => {
  const insideRepository = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "..",
    "demo-secrets.json",
  );
  assert.throws(() => resolveSecretsTarget(insideRepository), /outside the repository/);
  assert.throws(() => resolveSecretsTarget(""), /path argument is required/);
  assert.equal(resolveSecretsTarget("/tmp/demo-secrets.json"), "/tmp/demo-secrets.json");
});

test("the written file is owner-only JSON and no value is logged", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "demo-secrets-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, "demo-deploy-secrets.json");
  const values = {
    AUTH_PASSWORD: "sentinel-password-value",
    AUTH_PASS_COOKIE: "sentinel-cookie-value",
    OPERATOR_PREFLIGHT_TOKEN: "sentinel-operator-value",
  };
  const logged = [];

  const names = await writeDeploySecrets({
    environment: values,
    target,
    log: (message) => logged.push(message),
    warn: (message) => logged.push(message),
  });

  assert.deepEqual(names, Object.keys(values));
  assert.deepEqual(JSON.parse(await readFile(target, "utf8")), values);
  assert.equal((await stat(target)).mode & 0o777, 0o600);
  for (const value of Object.values(values)) {
    assert.ok(
      logged.every((message) => !message.includes(value)),
      `a secret value reached the log: ${value}`,
    );
  }
});

test("an omitted operator token is announced as a warning", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "demo-secrets-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const warnings = [];

  await writeDeploySecrets({
    environment: gateSecrets,
    target: path.join(directory, "demo-deploy-secrets.json"),
    log: () => {},
    warn: (message) => warnings.push(message),
  });

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^::warning::OPERATOR_PREFLIGHT_TOKEN was not supplied/);
});
