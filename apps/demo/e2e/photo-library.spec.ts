import { expect, test } from "@playwright/test";

const photo = {
  id: "photo-1",
  state: "ready",
  width: 1200,
  height: 800,
  mimeType: "image/jpeg",
  mediaUrl: "/api/v1/photos/photo-1/media",
  createdAt: "2026-08-10T00:00:00.000Z",
  readyAt: "2026-08-10T00:00:01.000Z",
  documentRevision: 1,
  aiWords: [
    {
      kind: "ai-word",
      word: "Cat",
      normalizedWord: "cat",
      confidence: 0.9,
      modelRunId: "run-1",
      documentRevision: 1,
    },
  ],
  humanTags: [
    {
      kind: "human-tag",
      id: "tag-1",
      name: "favorite",
      normalizedName: "favorite",
      createdAt: "2026-08-10T00:00:02.000Z",
    },
  ],
  attribution: null,
};

test.beforeEach(async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (pathname === "/api/v1/readiness") {
      return json({
        version: "v1",
        status: "ready",
        environment: "ci",
        publicWritesEnabled: true,
        models: {
          vision: "vision",
          embedding: "embedding",
          vectorDimensions: 768,
          vectorMetric: "cosine",
        },
        checks: [],
      });
    }
    if (pathname === "/api/v1/photos" && request.method() === "GET") {
      return json({ version: "v1", items: [photo], nextCursor: null });
    }
    if (pathname === "/api/v1/photos" && request.method() === "POST") {
      return json(
        {
          version: "v1",
          operationId: "operation-1",
          photoId: "photo-2",
          state: "completed",
          retryable: false,
          errorCode: null,
          updatedAt: "2026-08-10T00:00:01.000Z",
        },
        202,
      );
    }
    if (pathname === "/api/v1/uploads/operation-1") {
      return json({
        version: "v1",
        operationId: "operation-1",
        photoId: "photo-2",
        state: "completed",
        photoState: "ready",
        retryable: false,
        errorCode: null,
        updatedAt: "2026-08-10T00:00:02.000Z",
      });
    }
    if (pathname === "/api/v1/human-tags/bulk") {
      return json({
        version: "v1",
        results: [{ photoId: "photo-1", status: "updated", documentRevision: 2, humanTags: [] }],
      });
    }
    if (pathname === "/api/v1/search") {
      return json({
        version: "v1",
        query: "cat",
        nextCursor: null,
        degraded: true,
        degradedReason: "Vector provider unavailable",
        items: [
          { photo, reason: { tier: "exact_human_tag", normalizedTag: "cat" } },
          {
            photo: { ...photo, id: "photo-2" },
            reason: { tier: "exact_ai_word", normalizedWord: "cat", modelRunId: "run-1" },
          },
        ],
      });
    }
    return json(
      {
        version: "v1",
        error: { code: "unexpected_route", message: pathname, requestId: "test", retryable: false },
      },
      500,
    );
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await expect.poll(() => consoleErrors, { message: "unexpected console errors" }).toEqual([]);
  await expect.poll(() => pageErrors, { message: "unexpected page errors" }).toEqual([]);
});

test("uploads through the multipart API and presents distinct provenance and search tiers", async ({
  page,
}) => {
  await expect(page.getByLabel("AI suggested words")).toContainText("AI · Cat");
  await expect(page.getByLabel("Human tags")).toContainText("Human · favorite");
  await page.getByLabel("Choose photos").setInputFiles({
    name: "cat.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("photo"),
  });
  await expect(page.getByLabel("Upload status")).toContainText("cat.jpg — Ready");

  await page.getByLabel("Words or description").fill("cat");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("heading", { name: "Human tag" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI word" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Related" })).toBeVisible();
  await expect(page.getByText(/Related results are incomplete/)).toBeVisible();
});

test("keeps the responsive library within its viewport", async ({ page }) => {
  const metrics = await page.evaluate(() => {
    const browser = globalThis as unknown as {
      document: {
        documentElement: { scrollWidth: number };
        querySelector(selector: string): { getBoundingClientRect(): { width: number } } | null;
      };
      innerWidth: number;
    };
    return {
      documentWidth: browser.document.documentElement.scrollWidth,
      viewportWidth: browser.innerWidth,
      cardWidth: browser.document.querySelector("figure")?.getBoundingClientRect().width ?? 0,
    };
  });
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.cardWidth).toBeLessThanOrEqual(420);
});
