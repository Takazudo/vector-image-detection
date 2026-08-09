import { describe, expect, it } from "vitest";

import type { BulkHumanTagMutationRequest } from "../../contracts/api";
import type { PlatformProviders } from "../../providers";
import { mutateHumanTag, TagMutationQuotaError } from "./mutation";

describe("transactional human-tag mutation", () => {
  it("batches tag attachment, quota, revision, required revision, and outbox before Queue send", async () => {
    const harness = mutationHarness({
      mutationRows: [mutationRow("photo-1", "ready", 4, null)],
      currentPhotos: [{ id: "photo-1", document_revision: 5 }],
    });
    const response = await mutateHumanTag(
      request("attach", ["photo-1"]),
      { quotaSubject: "ip" },
      harness.providers,
    );

    expect(response.results).toMatchObject([
      { photoId: "photo-1", status: "updated", documentRevision: 5 },
    ]);
    expect(harness.batches).toHaveLength(1);
    expect(harness.batches[0]?.join("\n")).toContain("INSERT INTO quota_counters");
    expect(harness.batches[0]?.join("\n")).toContain("INSERT OR IGNORE INTO photo_human_tags");
    expect(harness.batches[0]?.join("\n")).toContain("document_revision = ?");
    expect(harness.batches[0]?.join("\n")).toContain("reindex_required_revision = ?");
    expect(harness.batches[0]?.join("\n")).toContain("INSERT INTO queue_outbox");
    expect(harness.events.at(-1)).toBe("queue-send");
  });

  it("does not send Queue work when the atomic D1 batch rolls back", async () => {
    const harness = mutationHarness({
      mutationRows: [mutationRow("photo-1", "ready", 1, null)],
      currentPhotos: [],
      rejectBatch: true,
    });
    await expect(
      mutateHumanTag(request("attach", ["photo-1"]), { quotaSubject: "ip" }, harness.providers),
    ).rejects.toThrow("transaction rolled back");
    expect(harness.events).not.toContain("queue-send");
  });

  it("returns mixed remove results and mutates only a present tag on a ready photo", async () => {
    const harness = mutationHarness({
      existingTag: true,
      mutationRows: [
        mutationRow("ready-present", "ready", 2, "tag-cat"),
        mutationRow("ready-missing", "ready", 3, null),
        mutationRow("pending", "pending", 1, "tag-cat"),
      ],
      currentPhotos: [
        { id: "ready-present", document_revision: 3 },
        { id: "ready-missing", document_revision: 3 },
        { id: "pending", document_revision: 1 },
      ],
    });
    const response = await mutateHumanTag(
      request("remove", ["ready-present", "ready-missing", "pending", "absent"]),
      { quotaSubject: "ip" },
      harness.providers,
    );

    expect(response.results.map(({ photoId, status }) => ({ photoId, status }))).toEqual([
      { photoId: "ready-present", status: "updated" },
      { photoId: "ready-missing", status: "unchanged" },
      { photoId: "pending", status: "not_found" },
      { photoId: "absent", status: "not_found" },
    ]);
    expect(harness.batches[0]?.join("\n")).toContain("DELETE FROM photo_human_tags");
  });

  it("does not attach beyond the shared per-photo tag cap", async () => {
    const harness = mutationHarness({
      mutationRows: [mutationRow("full", "ready", 9, null, 32)],
      currentPhotos: [{ id: "full", document_revision: 9 }],
    });
    const response = await mutateHumanTag(
      request("attach", ["full"]),
      { quotaSubject: "ip" },
      harness.providers,
    );
    expect(response.results).toMatchObject([
      { photoId: "full", status: "conflict", documentRevision: 9 },
    ]);
    expect(harness.batches).toHaveLength(0);
    expect(harness.events).not.toContain("queue-send");
  });

  it("keeps duplicate attachment idempotent without consuming quota or emitting work", async () => {
    const harness = mutationHarness({
      existingTag: true,
      mutationRows: [mutationRow("photo-1", "ready", 4, "tag-cat")],
      currentPhotos: [{ id: "photo-1", document_revision: 4 }],
    });
    const response = await mutateHumanTag(
      request("attach", ["photo-1"]),
      { quotaSubject: "ip" },
      harness.providers,
    );
    expect(response.results).toMatchObject([
      { photoId: "photo-1", status: "unchanged", documentRevision: 4 },
    ]);
    expect(harness.batches).toHaveLength(0);
    expect(harness.events).not.toContain("queue-send");
  });

  it("rejects the full feature-local daily quota before mutation", async () => {
    const harness = mutationHarness({
      mutationRows: [mutationRow("photo-1", "ready", 1, null)],
      currentPhotos: [],
      quotaUsed: 250,
    });
    await expect(
      mutateHumanTag(request("attach", ["photo-1"]), { quotaSubject: "ip" }, harness.providers),
    ).rejects.toBeInstanceOf(TagMutationQuotaError);
    expect(harness.batches).toHaveLength(0);
    expect(harness.events).not.toContain("queue-send");
  });
});

interface MutationRow {
  id: string;
  state: string;
  document_revision: number;
  tag_id: string | null;
  tag_count: number;
}

interface CurrentPhoto {
  id: string;
  document_revision: number;
}

function mutationHarness(options: {
  mutationRows: MutationRow[];
  currentPhotos: CurrentPhoto[];
  existingTag?: boolean;
  rejectBatch?: boolean;
  quotaUsed?: number;
}) {
  const events: string[] = [];
  const batches: string[][] = [];
  const sqlByStatement = new Map<D1PreparedStatement, string>();
  const database: D1Database = Object.create(null);
  database.prepare = (sql: string) => {
    const prepared: D1PreparedStatement = Object.create(null);
    sqlByStatement.set(prepared, sql);
    prepared.bind = () => prepared;
    prepared.first = async () => {
      if (sql.includes("FROM human_tags")) {
        return options.existingTag
          ? {
              id: "tag-cat",
              name: "cat",
              normalized_name: "cat",
              created_at: "2026-01-01T00:00:00.000Z",
            }
          : null;
      }
      if (sql.includes("SELECT used FROM quota_counters")) {
        return options.quotaUsed === undefined ? null : { used: options.quotaUsed };
      }
      return null;
    };
    prepared.all = async <T>() => {
      let results: object[] = [];
      if (sql.includes("LEFT JOIN photo_human_tags")) results = options.mutationRows;
      else if (sql.includes("SELECT id, document_revision FROM photos"))
        results = options.currentPhotos;
      return d1Result(results as T[]);
    };
    prepared.run = async <T>() => d1Result<T>([], 1);
    return prepared;
  };
  database.batch = async <T = unknown>(statements: D1PreparedStatement[]) => {
    events.push("d1-batch");
    batches.push(statements.map((statement) => sqlByStatement.get(statement) ?? ""));
    if (options.rejectBatch) throw new Error("transaction rolled back");
    return statements.map(() => d1Result<T>([], 1));
  };
  let id = 0;
  const providers: PlatformProviders = {
    assets: Object.create(null),
    database,
    photos: Object.create(null),
    queue: {
      async send() {
        events.push("queue-send");
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
    clock: { now: () => new Date("2026-01-01T12:00:00.000Z") },
    ids: { generate: () => `generated-${++id}` },
    operator: Object.create(null),
  };
  return { providers, events, batches };
}

function d1Result<T>(results: T[], changes = 0): D1Result<T> {
  return { success: true, meta: Object.assign(Object.create(null), { changes }), results };
}

function mutationRow(
  id: string,
  state: string,
  documentRevision: number,
  tagId: string | null,
  tagCount = tagId === null ? 0 : 1,
): MutationRow {
  return { id, state, document_revision: documentRevision, tag_id: tagId, tag_count: tagCount };
}

function request(
  action: BulkHumanTagMutationRequest["action"],
  photoIds: string[],
): BulkHumanTagMutationRequest {
  return { version: "v1", action, photoIds, humanTagNames: [" Cat "] };
}
