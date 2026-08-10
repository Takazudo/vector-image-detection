import { describe, expect, it } from "vitest";

import type { PlatformProviders } from "../../providers";
import { mediaHeaders } from "./routes";
import { createPhotoUpload, enforceUploadQuota, PhotoServiceError } from "./service";

describe("durable upload failure ordering", () => {
  it("commits D1 identity before writing R2", async () => {
    const fake = fakeProviders();
    await createPhotoUpload(fake.providers, uploadInput());
    expect(fake.events.slice(0, 3)).toEqual(["d1:batch:1", "r2:put", "d1:batch:2"]);
  });

  it("records an R2 failure after the durable D1 batch", async () => {
    const fake = fakeProviders({ failR2Put: true });
    await expect(createPhotoUpload(fake.providers, uploadInput())).rejects.toMatchObject({
      code: "r2_write_failed",
      retryable: true,
    } satisfies Partial<PhotoServiceError>);
    expect(fake.events[0]).toBe("d1:batch:1");
    expect(fake.events).toContain("r2:put");
    expect(
      fake.queries.some((query) => query.includes("UPDATE upload_operations SET state = 'failed'")),
    ).toBe(true);
  });

  it("attempts immediate R2 compensation when final D1 work fails", async () => {
    const fake = fakeProviders({ failBatch: 2 });
    await expect(createPhotoUpload(fake.providers, uploadInput())).rejects.toMatchObject({
      code: "post_r2_database_failed",
    } satisfies Partial<PhotoServiceError>);
    expect(fake.events).toContain("r2:delete");
  });

  it("leaves outbox work pending when Queue delivery fails", async () => {
    const fake = fakeProviders({ failQueue: true });
    const result = await createPhotoUpload(fake.providers, uploadInput());
    expect(result).toMatchObject({ state: "enqueue_failed", retryable: true });
    expect(
      fake.queries.some((query) => query.includes("UPDATE queue_outbox SET state = 'pending'")),
    ).toBe(true);
  });
});

describe("upload admission and media safety", () => {
  it("rejects rate limiting before touching D1 quota state", async () => {
    const fake = fakeProviders({ rateAllowed: false });
    await expect(enforceUploadQuota(fake.providers, "client")).rejects.toMatchObject({
      code: "rate_limited",
    } satisfies Partial<PhotoServiceError>);
    expect(fake.queries).toEqual([]);
  });

  it("rejects atomic daily and stored-photo quota reservations", async () => {
    const daily = fakeProviders({ dailyAllowed: false });
    await expect(enforceUploadQuota(daily.providers, "client")).rejects.toMatchObject({
      code: "daily_quota_exceeded",
    } satisfies Partial<PhotoServiceError>);

    const stored = fakeProviders({ storedAllowed: false });
    await enforceUploadQuota(stored.providers, "client");
    await expect(createPhotoUpload(stored.providers, uploadInput())).rejects.toMatchObject({
      code: "storage_quota_exceeded",
    } satisfies Partial<PhotoServiceError>);
    expect(stored.events).not.toContain("r2:put");
  });

  it("serves conservative inline media headers", () => {
    const headers = mediaHeaders("image/png", 42, '"etag"');
    expect(headers.get("content-disposition")).toBe("inline");
    expect(headers.get("content-length")).toBe("42");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("content-security-policy")).toContain("sandbox");
    expect(headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });
});

function uploadInput() {
  return {
    filename: "photo.png",
    image: {
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png" as const,
      byteSize: 3,
      width: 32,
      height: 32,
      sha256: "a".repeat(64),
    },
  };
}

function fakeProviders(
  options: {
    failR2Put?: boolean;
    failBatch?: number;
    failQueue?: boolean;
    rateAllowed?: boolean;
    dailyAllowed?: boolean;
    storedAllowed?: boolean;
  } = {},
) {
  const events: string[] = [];
  const queries: string[] = [];
  let batchNumber = 0;
  let id = 0;
  const prepared = (query: string) => {
    queries.push(query);
    const statement = {
      bind: () => statement,
      run: async () => ({
        success: true,
        meta: {
          changes: query.includes("'global_upload'")
            ? options.dailyAllowed === false
              ? 0
              : 1
            : query.includes("'global_stored_photo'")
              ? options.storedAllowed === false
                ? 0
                : 1
              : 1,
        },
      }),
      first: async () => ({ count: 0 }),
      all: async () => ({ success: true, results: [], meta: {} }),
    };
    return statement;
  };
  const database = testDouble<D1Database>({
    prepare: prepared,
    batch: async () => {
      batchNumber++;
      events.push(`d1:batch:${batchNumber}`);
      if (options.failBatch === batchNumber) throw new Error("D1 unavailable");
      return [];
    },
  });
  const photos = testDouble<R2Bucket>({
    put: async () => {
      events.push("r2:put");
      if (options.failR2Put) throw new Error("R2 unavailable");
      return { version: "v1", etag: "etag", customMetadata: {} } as R2Object;
    },
    delete: async () => {
      events.push("r2:delete");
    },
  });
  const providers = testDouble<PlatformProviders>({
    database,
    photos,
    queue: {
      send: async () => {
        events.push("queue:send");
        if (options.failQueue) throw new Error("Queue unavailable");
        return {};
      },
      metrics: async () => ({ messages: 0 }),
    },
    deadLetterQueue: { send: async () => ({}), metrics: async () => ({ messages: 0 }) },
    rateLimit: { limit: async () => ({ success: options.rateAllowed ?? true }) },
    clock: { now: () => new Date("2026-08-10T00:00:00.000Z") },
    ids: { generate: () => `id-${++id}` },
    operator: {
      settings: () => ({
        environment: "ci" as const,
        publicWritesEnabled: false,
        acknowledgeAnonymousPublicWrites: false,
        acknowledgeRetainedImageMetadata: false,
        acknowledgeReactivePurgeOnlyModeration: false,
        authGateConfigured: false,
      }),
    },
    assets: {},
    ai: {},
    vectorize: {},
  });
  return { providers, events, queries };
}

function testDouble<T>(value: object): T {
  return value as T;
}
