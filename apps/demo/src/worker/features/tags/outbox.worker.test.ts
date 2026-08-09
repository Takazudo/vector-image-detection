import { describe, expect, it } from "vitest";

import type { PlatformProviders } from "../../providers";
import { dispatchPendingReindexOutbox } from "./outbox";

const message = {
  version: 1,
  type: "reindex",
  operationId: "operation-1",
  photoId: "photo-1",
  requestedDocumentRevision: 2,
  enqueuedAt: "2026-01-01T00:00:00.000Z",
} as const;

describe("reindex outbox dispatch", () => {
  it("sends before marking dispatched so an interruption can only duplicate", async () => {
    const events: string[] = [];
    const providers = fakeProviders(events);

    expect(await dispatchPendingReindexOutbox(providers)).toEqual({
      attempted: 1,
      dispatched: 1,
      failed: 0,
    });
    expect(events).toEqual(["claim", "send", "mark-dispatched"]);
  });

  it("leaves failed delivery eligible for delayed repair", async () => {
    const events: string[] = [];
    const providers = fakeProviders(events, true);

    expect(await dispatchPendingReindexOutbox(providers)).toEqual({
      attempted: 1,
      dispatched: 0,
      failed: 1,
    });
    expect(events).toEqual(["claim", "send", "mark-failed"]);
  });
});

function fakeProviders(events: string[], failSend = false): PlatformProviders {
  const database: D1Database = Object.create(null);
  database.prepare = (sql: string) => statement(sql, events);
  const providers: PlatformProviders = {
    assets: Object.create(null),
    database,
    photos: Object.create(null),
    queue: {
      async send() {
        events.push("send");
        if (failSend) throw new Error("queue unavailable");
        return Object.create(null);
      },
      async metrics() {
        return Object.create(null);
      },
    },
    deadLetterQueue: Object.create(null),
    ai: Object.create(null),
    vectorize: Object.create(null),
    rateLimit: Object.create(null),
    clock: { now: () => new Date("2026-01-01T00:00:00.000Z") },
    ids: { generate: () => "lease-1" },
    operator: Object.create(null),
  };
  return providers;
}

function statement(sql: string, events: string[]): D1PreparedStatement {
  const prepared: D1PreparedStatement = Object.create(null);
  prepared.bind = () => prepared;
  prepared.all = async <T>() =>
    d1Result(
      (sql.includes("SELECT id, payload_json")
        ? [{ id: "outbox-1", payload_json: JSON.stringify(message) }]
        : []) as T[],
    );
  prepared.run = async <T>() => {
    if (sql.includes("state = 'dispatched'")) events.push("mark-dispatched");
    else if (sql.includes("state = 'failed'")) events.push("mark-failed");
    else if (sql.includes("state = 'dispatching'")) events.push("claim");
    return d1Result<T>([], 1);
  };
  return prepared;
}

function d1Result<T>(results: T[], changes = 0): D1Result<T> {
  return { success: true, meta: Object.assign(Object.create(null), { changes }), results };
}
