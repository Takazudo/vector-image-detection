import assert from "node:assert/strict";
import test from "node:test";

import {
  readDeployedVersionId,
  versionIdFromDeployLog,
  versionIdFromOutputFile,
} from "./deployed-version.mjs";

const ESC = String.fromCharCode(27);
const NEW_VERSION = "0e5bbd12-3f4a-4b8c-9d1e-2f3a4b5c6d7e";
const OLD_VERSION = "11111111-2222-3333-4444-555555555555";

function outputFile(...entries) {
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

function reader(files) {
  return async (path) => {
    if (!(path in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return files[path];
  };
}

test("the version id comes off the machine-readable deploy record", () => {
  const contents = outputFile(
    { type: "version-upload", version: 1, version_id: OLD_VERSION },
    { type: "deploy", version: 1, worker_name: "demo", version_id: NEW_VERSION },
  );
  assert.equal(versionIdFromOutputFile(contents), NEW_VERSION);
});

test("only a deploy record counts, and the last one wins", () => {
  // The file is append-only, so an earlier wrangler invocation in the same job
  // can have left records of its own ahead of this deploy's.
  const contents = outputFile(
    { type: "deploy", version: 1, version_id: OLD_VERSION },
    { type: "session-login", version: 1 },
    { type: "deploy", version: 1, version_id: NEW_VERSION },
  );
  assert.equal(versionIdFromOutputFile(contents), NEW_VERSION);
});

test("a truncated or non-JSON line cannot break the scan", () => {
  const contents = `{"type":"deploy","version_id":"${OLD_VERSION}"\nnot json\n${outputFile({
    type: "deploy",
    version_id: NEW_VERSION,
  })}`;
  assert.equal(versionIdFromOutputFile(contents), NEW_VERSION);
});

test("a deploy record with no version id yields nothing", () => {
  assert.equal(versionIdFromOutputFile(outputFile({ type: "deploy", version: 1 })), undefined);
  assert.equal(versionIdFromOutputFile(""), undefined);
});

test("the log fallback reads the human line through terminal colouring", () => {
  const log = `Uploaded demo\n${ESC}[32mCurrent Version ID:${ESC}[0m ${NEW_VERSION}\n`;
  assert.equal(versionIdFromDeployLog(log), NEW_VERSION);
});

test("the log fallback ignores anything that is not a version id", () => {
  assert.equal(versionIdFromDeployLog("Deployed demo triggers (0.63 sec)\n"), undefined);
  assert.equal(versionIdFromDeployLog("Current Version ID: unknown\n"), undefined);
});

test("the machine-readable record is preferred over the log", async () => {
  const versionId = await readDeployedVersionId({
    outputFilePath: "output.ndjson",
    logPath: "deploy.log",
    read: reader({
      "output.ndjson": outputFile({ type: "deploy", version_id: NEW_VERSION }),
      "deploy.log": `Current Version ID: ${OLD_VERSION}\n`,
    }),
  });
  assert.equal(versionId, NEW_VERSION);
});

test("the log is used when the output file has no deploy record", async () => {
  const versionId = await readDeployedVersionId({
    outputFilePath: "output.ndjson",
    logPath: "deploy.log",
    read: reader({
      "output.ndjson": outputFile({ type: "version-upload", version_id: OLD_VERSION }),
      "deploy.log": `Current Version ID: ${NEW_VERSION}\n`,
    }),
  });
  assert.equal(versionId, NEW_VERSION);
});

test("a missing output file falls through to the log instead of throwing", async () => {
  const versionId = await readDeployedVersionId({
    outputFilePath: "output.ndjson",
    logPath: "deploy.log",
    read: reader({ "deploy.log": `Current Version ID: ${NEW_VERSION}\n` }),
  });
  assert.equal(versionId, NEW_VERSION);
});

test("nothing is invented when neither source carries an id", async () => {
  // The workflow turns this into a failed step. Passing an empty expected
  // version to the post-deploy gate would silently restore the propagation race
  // with no signal in the log that it had happened.
  const versionId = await readDeployedVersionId({
    outputFilePath: "output.ndjson",
    logPath: "deploy.log",
    read: reader({ "output.ndjson": "", "deploy.log": "Deployed demo\n" }),
  });
  assert.equal(versionId, undefined);
});
