import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4397;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const preview = spawn(
  "pnpm",
  ["exec", "zfb", "preview", "--host", "127.0.0.1", "--port", String(PORT)],
  {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  },
);

const browser = await chromium.launch();
try {
  await waitForPreview();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const failures = [];
  const requested = [];
  page.on("request", (request) => requested.push(request.url()));
  page.on("requestfailed", (request) => failures.push(`${request.method()} ${request.url()}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });

  let failMetaOnce = true;
  await page.route("**/data/meta.json", async (route) => {
    if (failMetaOnce) {
      failMetaOnce = false;
      await route.fulfill({ status: 404, body: "missing once" });
    } else {
      await route.continue();
    }
  });
  await page.goto(ORIGIN, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "No index bundle loaded" }).waitFor();
  await page.getByRole("button", { name: "Retry" }).click();
  await page.getByRole("heading", { name: "Gallery" }).waitFor();
  assert.equal(await page.locator("figure").count(), 24);

  await page.locator("figure button").first().click();
  await page.getByRole("heading", { name: "Similar photos" }).waitFor();

  await page.getByRole("button", { name: "Auto-categorize" }).click();
  await page.getByRole("button", { name: "Group by words" }).click();
  await page
    .getByText("No photo is closest to this word.")
    .or(page.locator("figure"))
    .first()
    .waitFor();

  await page.getByRole("button", { name: "Search" }).click();
  await page.getByLabel("Describe what you are looking for").fill("fixture 1");
  await page.locator("form").getByRole("button", { name: "Search", exact: true }).click();
  await page.getByText(/Top \d+ of 24/).waitFor();

  await page.getByRole("button", { name: "Vocabulary tags" }).click();
  await page.getByRole("button", { name: "Score vocabulary" }).click();
  await page.getByText(/photos tagged/).waitFor();

  await page.getByRole("button", { name: "Attach a word" }).click();
  await page.locator("figure button").first().click();
  await page.getByLabel("Your word").fill("smoke-tag");
  await page.getByRole("button", { name: "Attach to selected" }).click();
  assert.match(await page.getByText(/confirmed tag/).textContent(), /1 confirmed tag/);

  await page.reload({ waitUntil: "networkidle" });
  assert.match(await page.getByText(/confirmed tag/).textContent(), /1 confirmed tag/);
  assert.deepEqual(failures, []);
  assert.equal(
    requested.some((url) => /huggingface|resolve\/main|model\.onnx/i.test(url)),
    false,
  );
  for (const rootPath of ["/data/meta.json", "/data/embeddings.bin", "/assets/", "/favicon.svg"]) {
    assert.ok(
      requested.some((url) => new URL(url).pathname.startsWith(rootPath)),
      rootPath,
    );
  }
} finally {
  await browser.close();
  preview.kill("SIGTERM");
  await Promise.race([once(preview, "exit"), new Promise((resolve) => setTimeout(resolve, 2_000))]);
}

async function waitForPreview() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(ORIGIN);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("zfb preview did not become ready");
}
