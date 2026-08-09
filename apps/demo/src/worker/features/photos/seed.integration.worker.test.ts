import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { PlatformProviders } from "../../providers";
import { createPhotoQueueHandlers } from "../processing/handlers";
import { importSeedCollection } from "./seed";
import migration from "../../../../migrations/0001_public_photo_library.sql?raw";

describe("credited local seed import", () => {
  it("imports 100 thumbnails through D1/R2 and leaves an unchanged rerun idempotent", async () => {
    await applyMigration(env.DB, migration);
    const messages: unknown[] = [];
    const vectors = new Map<string, number[]>();
    let nextId = 0;
    const providers = {
      assets: env.ASSETS,
      database: env.DB,
      photos: env.PHOTOS,
      queue: {
        send: async (message: unknown) => {
          messages.push(message);
          return {};
        },
        metrics: async () => ({}),
      },
      deadLetterQueue: { send: async () => ({}), metrics: async () => ({}) },
      ai: {
        run: async (model: string) =>
          model.includes("moondream")
            ? { caption: "A credited seed image", words: ["seed", "image"] }
            : { data: [Array.from({ length: 768 }, () => 0.125)] },
      },
      vectorize: {
        upsert: async (values: { id: string; values: number[] }[]) => {
          for (const value of values) vectors.set(value.id, value.values);
        },
        deleteByIds: async (ids: string[]) => {
          for (const id of ids) vectors.delete(id);
        },
      },
      rateLimit: { limit: async () => ({ success: true }) },
      clock: { now: () => new Date("2026-08-10T00:00:00.000Z") },
      ids: { generate: () => `seed-test-${++nextId}` },
      operator: { settings: () => ({ environment: "ci", publicWritesEnabled: false }) },
    } as unknown as PlatformProviders;
    const entries = await loadSeedEntries();
    const first = await importSeedCollection(providers, entries);
    expect(first).toMatchObject({ imported: 100, unchanged: 0, replaced: 0, failures: [] });

    const handlers = createPhotoQueueHandlers(providers);
    while (messages.length > 0) {
      const message = messages.shift() as { type: keyof typeof handlers };
      await handlers[message.type](message as never);
    }
    const ready = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM photos WHERE state = 'ready'",
    ).first<{ count: number }>();
    const labels = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM photo_ai_words WHERE normalized_word IN ('cat', 'dog')",
    ).first<{ count: number }>();
    expect(ready?.count).toBe(100);
    expect(vectors.size).toBe(100);
    expect(labels?.count).toBe(0);

    await expect(importSeedCollection(providers, entries)).resolves.toEqual({
      imported: 0,
      unchanged: 100,
      replaced: 0,
      failures: [],
    });
  }, 60_000);
});

async function applyMigration(database: D1Database, source: string): Promise<void> {
  let statement = "";
  let inTrigger = false;
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("CREATE TRIGGER ")) inTrigger = true;
    statement += `${line}\n`;
    if (!trimmed.endsWith(";") || (inTrigger && trimmed !== "END;")) continue;
    await database.exec(statement.replace(/\s+/g, " "));
    statement = "";
    inTrigger = false;
  }
  expect(statement.trim()).toBe("");
}

async function loadSeedEntries() {
  const responses = await Promise.all(
    ["/manifest.json", "/meta.json"].map(async (pathname) => {
      const response = await env.ASSETS.fetch(`https://seed.test${pathname}`);
      expect(response.ok).toBe(true);
      return response.json() as Promise<{
        items: { id: string; thumb: string; source?: string; license?: string; author?: string }[];
      }>;
    }),
  );
  const manifest = responses[0]!;
  const metadata = responses[1]!;
  expect(manifest.items).toHaveLength(100);
  expect(metadata.items).toHaveLength(100);
  const sourceById = new Map(manifest.items.map((item) => [item.id, item]));
  return Promise.all(
    metadata.items.map(async (item) => {
      const source = sourceById.get(item.id) ?? item;
      const response = await env.ASSETS.fetch(`https://seed.test/${item.thumb}`);
      expect(response.ok).toBe(true);
      return {
        sourcePath: item.thumb,
        filename: item.thumb.split("/").at(-1)!,
        bytes: new Uint8Array(await response.arrayBuffer()),
        mimeType: "image/jpeg" as const,
        sourceUrl: item.source ?? source.source ?? null,
        licenseName: item.license ?? source.license ?? null,
        licenseUrl: null,
        authorName: item.author ?? source.author ?? null,
        authorUrl: null,
      };
    }),
  );
}
