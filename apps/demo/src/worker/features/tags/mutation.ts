import type {
  BulkHumanTagMutationRequest,
  BulkHumanTagMutationResponse,
  BulkHumanTagMutationResult,
} from "../../contracts/api";
import { VALIDATION_LIMITS } from "../../config";
import type { HumanTag, PhotoId } from "../../contracts/domain";
import type { ReindexQueueMessage } from "../../contracts/queue";
import type { PlatformProviders } from "../../providers";
import { normalizeTagWord } from "./normalization";

export const TAG_MUTATION_DAILY_QUOTA = 250;
const QUOTA_WINDOW_SECONDS = 24 * 60 * 60;

interface PhotoMutationRow {
  id: string;
  state: string;
  document_revision: number;
  tag_id: string | null;
  tag_count: number;
}

interface TagRow {
  id: string;
  name: string;
  normalized_name: string;
  created_at: string;
}

interface QuotaRow {
  used: number;
}

interface PlannedMutation {
  photoId: string;
  oldRevision: number;
  newRevision: number;
  outboxId: string;
  message: ReindexQueueMessage;
}

export interface MutationRequestContext {
  quotaSubject: string;
  background?: (promise: Promise<void>) => void;
}

export class TagMutationQuotaError extends Error {
  constructor() {
    super("The daily human-tag mutation quota has been reached.");
    this.name = "TagMutationQuotaError";
  }
}

export async function mutateHumanTag(
  request: BulkHumanTagMutationRequest,
  context: MutationRequestContext,
  providers: PlatformProviders,
): Promise<BulkHumanTagMutationResponse> {
  const [humanTagName] = request.humanTagNames;
  if (request.humanTagNames.length !== 1 || humanTagName === undefined) {
    throw new RangeError("Exactly one human tag is required per bulk mutation.");
  }
  const normalizedTag = normalizeTagWord(humanTagName);
  const now = providers.clock.now();
  const nowIso = now.toISOString();
  const tag = await findTag(providers.database, normalizedTag);
  const tagId = tag?.id ?? (await stableTagId(normalizedTag));
  const rows = await loadMutationRows(
    providers.database,
    request.photoIds,
    tag?.id ?? "__missing_tag__",
  );
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const statuses = new Map<PhotoId, BulkHumanTagMutationResult["status"]>();
  const planned: PlannedMutation[] = [];

  for (const photoId of request.photoIds) {
    const row = rowsById.get(photoId);
    if (!row || row.state !== "ready") {
      statuses.set(photoId, "not_found");
      continue;
    }
    const expected = request.expectedRevisions?.[photoId];
    if (expected !== undefined && expected !== row.document_revision) {
      statuses.set(photoId, "conflict");
      continue;
    }
    const isAttached = row.tag_id !== null;
    if (
      (request.action === "attach" && isAttached) ||
      (request.action === "remove" && !isAttached)
    ) {
      statuses.set(photoId, "unchanged");
      continue;
    }
    if (request.action === "attach" && row.tag_count >= VALIDATION_LIMITS.maximumTagsPerPhoto) {
      statuses.set(photoId, "conflict");
      continue;
    }
    const operationId = providers.ids.generate();
    const newRevision = row.document_revision + 1;
    planned.push({
      photoId,
      oldRevision: row.document_revision,
      newRevision,
      outboxId: providers.ids.generate(),
      message: {
        version: 1,
        type: "reindex",
        operationId,
        photoId,
        requestedDocumentRevision: newRevision,
        enqueuedAt: nowIso,
      },
    });
    statuses.set(photoId, "updated");
  }

  if (planned.length > 0) {
    await commitMutationBatch({
      providers,
      action: request.action,
      tagId,
      normalizedTag,
      now,
      nowIso,
      quotaSubject: context.quotaSubject,
      planned,
      createTag: tag === null && request.action === "attach",
    });
    const immediateDispatch = async (): Promise<void> => {
      for (const item of planned) {
        try {
          await providers.queue.send(item.message, { contentType: "json" });
          await providers.database
            .prepare(
              `UPDATE queue_outbox SET state = 'dispatched', dispatched_at = ?, updated_at = ?
               WHERE operation_id = ? AND state = 'pending'`,
            )
            .bind(nowIso, nowIso, item.message.operationId)
            .run();
        } catch (error) {
          console.error(
            JSON.stringify({
              message: "best-effort reindex dispatch failed",
              operationId: item.message.operationId,
              photoId: item.photoId,
              error: error instanceof Error ? error.message : "unknown error",
            }),
          );
        }
      }
    };
    const dispatchPromise = immediateDispatch();
    if (context.background) context.background(dispatchPromise);
    else await dispatchPromise;
  }

  const current = await loadCurrentResults(providers.database, request.photoIds);
  const currentById = new Map(current.map((item) => [item.photoId, item]));
  return {
    version: "v1",
    results: request.photoIds.map((photoId) => {
      const item = currentById.get(photoId);
      const status = statuses.get(photoId) ?? "not_found";
      return {
        photoId,
        status,
        documentRevision: status === "not_found" ? null : (item?.documentRevision ?? null),
        humanTags: status === "not_found" ? null : (item?.humanTags ?? []),
      };
    }),
  };
}

async function commitMutationBatch(input: {
  providers: PlatformProviders;
  action: "attach" | "remove";
  tagId: string;
  normalizedTag: string;
  now: Date;
  nowIso: string;
  quotaSubject: string;
  planned: PlannedMutation[];
  createTag: boolean;
}): Promise<void> {
  const { providers, planned, nowIso } = input;
  const windowStart = utcDayStart(input.now).toISOString();
  const expiresAt = new Date(
    utcDayStart(input.now).getTime() + QUOTA_WINDOW_SECONDS * 1000,
  ).toISOString();
  const previousQuota = await providers.database
    .prepare(
      `SELECT used FROM quota_counters
       WHERE scope = 'tag_mutation' AND subject_key = ? AND window_start = ?`,
    )
    .bind(input.quotaSubject, windowStart)
    .first<QuotaRow>();
  const expectedUsed = previousQuota?.used ?? 0;
  const cost = planned.length;
  if (expectedUsed + cost > TAG_MUTATION_DAILY_QUOTA) throw new TagMutationQuotaError();

  const quotaGuard = `EXISTS (
    SELECT 1 FROM quota_counters
    WHERE scope = 'tag_mutation' AND subject_key = ? AND window_start = ? AND used = ?
  )`;
  const quotaBindings = [input.quotaSubject, windowStart, expectedUsed + cost] as const;
  const statements: D1PreparedStatement[] = [
    providers.database
      .prepare(
        `INSERT INTO quota_counters (
           scope, subject_key, window_start, window_seconds, used, quota_limit, updated_at, expires_at
         ) VALUES ('tag_mutation', ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (scope, subject_key, window_start) DO UPDATE SET
           used = excluded.used,
           quota_limit = excluded.quota_limit,
           updated_at = excluded.updated_at,
           expires_at = excluded.expires_at
         WHERE quota_counters.used = ? AND excluded.used <= excluded.quota_limit`,
      )
      .bind(
        input.quotaSubject,
        windowStart,
        QUOTA_WINDOW_SECONDS,
        expectedUsed + cost,
        TAG_MUTATION_DAILY_QUOTA,
        nowIso,
        expiresAt,
        expectedUsed,
      ),
  ];
  if (input.createTag) {
    statements.push(
      providers.database
        .prepare(
          `INSERT OR IGNORE INTO human_tags (id, name, normalized_name, created_at)
           SELECT ?, ?, ?, ? WHERE ${quotaGuard}`,
        )
        .bind(input.tagId, input.normalizedTag, input.normalizedTag, nowIso, ...quotaBindings),
    );
  }

  for (const item of planned) {
    statements.push(
      providers.database
        .prepare(
          `SELECT CASE WHEN ${quotaGuard}
             AND EXISTS (
               SELECT 1 FROM photos WHERE id = ? AND state = 'ready' AND document_revision = ?
             )
             AND ${input.action === "attach" ? "NOT EXISTS" : "EXISTS"} (
               SELECT 1 FROM photo_human_tags WHERE photo_id = ? AND tag_id = ?
             )
             ${
               input.action === "attach"
                 ? `AND (
               SELECT COUNT(*) FROM photo_human_tags WHERE photo_id = ?
             ) < ${VALIDATION_LIMITS.maximumTagsPerPhoto}`
                 : ""
             }
           THEN 1 ELSE json_extract('mutation_conflict', '$') END AS mutation_guard`,
        )
        .bind(
          ...quotaBindings,
          item.photoId,
          item.oldRevision,
          item.photoId,
          input.tagId,
          ...(input.action === "attach" ? [item.photoId] : []),
        ),
    );
    if (input.action === "attach") {
      statements.push(
        providers.database
          .prepare(
            `INSERT OR IGNORE INTO photo_human_tags (photo_id, tag_id, attached_revision, created_at)
             SELECT id, ?, ?, ? FROM photos
             WHERE id = ? AND state = 'ready' AND document_revision = ? AND ${quotaGuard}`,
          )
          .bind(
            input.tagId,
            item.newRevision,
            nowIso,
            item.photoId,
            item.oldRevision,
            ...quotaBindings,
          ),
      );
    }
    statements.push(outboxStatement(providers.database, input, item, quotaGuard, quotaBindings));
    statements.push(
      providers.database
        .prepare(
          `UPDATE photos SET
             document_revision = ?, reindex_required_revision = ?, updated_at = ?
           WHERE id = ? AND state = 'ready' AND document_revision = ?
             AND EXISTS (
               SELECT 1 FROM photo_human_tags WHERE photo_id = ? AND tag_id = ?
             ) AND ${quotaGuard}`,
        )
        .bind(
          item.newRevision,
          item.newRevision,
          nowIso,
          item.photoId,
          item.oldRevision,
          item.photoId,
          input.tagId,
          ...quotaBindings,
        ),
    );
    if (input.action === "remove") {
      statements.push(
        providers.database
          .prepare(
            `DELETE FROM photo_human_tags
             WHERE photo_id = ? AND tag_id = ?
               AND EXISTS (
                 SELECT 1 FROM photos WHERE id = ? AND document_revision = ?
               ) AND ${quotaGuard}`,
          )
          .bind(item.photoId, input.tagId, item.photoId, item.newRevision, ...quotaBindings),
      );
    }
  }

  const results = await providers.database.batch(statements);
  if ((results[0]?.meta.changes ?? 0) !== 1) throw new TagMutationQuotaError();
}

function outboxStatement(
  database: D1Database,
  input: {
    action: "attach" | "remove";
    tagId: string;
    nowIso: string;
  },
  item: PlannedMutation,
  quotaGuard: string,
  quotaBindings: readonly [string, string, number],
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO queue_outbox (
         id, operation_id, photo_id, requested_document_revision, message_type,
         payload_version, payload_json, state, attempt_count, available_at, created_at, updated_at
       )
       SELECT ?, ?, ?, ?, 'reindex', 1, ?, 'pending', 0, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM photos WHERE id = ? AND state = 'ready' AND document_revision = ?
       ) AND EXISTS (
         SELECT 1 FROM photo_human_tags WHERE photo_id = ? AND tag_id = ?
       ) AND ${quotaGuard}`,
    )
    .bind(
      item.outboxId,
      item.message.operationId,
      item.photoId,
      item.newRevision,
      JSON.stringify(item.message),
      input.nowIso,
      input.nowIso,
      input.nowIso,
      item.photoId,
      item.oldRevision,
      item.photoId,
      input.tagId,
      ...quotaBindings,
    );
}

async function findTag(database: D1Database, normalizedTag: string): Promise<TagRow | null> {
  return database
    .prepare(
      "SELECT id, name, normalized_name, created_at FROM human_tags WHERE normalized_name = ?",
    )
    .bind(normalizedTag)
    .first<TagRow>();
}

async function loadMutationRows(
  database: D1Database,
  photoIds: readonly string[],
  tagId: string,
): Promise<PhotoMutationRow[]> {
  const placeholders = photoIds.map(() => "?").join(", ");
  const result = await database
    .prepare(
      `SELECT p.id, p.state, p.document_revision, pht.tag_id,
              (SELECT COUNT(*) FROM photo_human_tags count_tags WHERE count_tags.photo_id = p.id)
                AS tag_count
       FROM photos p
       LEFT JOIN photo_human_tags pht ON pht.photo_id = p.id AND pht.tag_id = ?
       WHERE p.id IN (${placeholders})`,
    )
    .bind(tagId, ...photoIds)
    .all<PhotoMutationRow>();
  return result.results;
}

interface CurrentResult {
  photoId: string;
  documentRevision: number;
  humanTags: HumanTag[];
}

async function loadCurrentResults(
  database: D1Database,
  photoIds: readonly string[],
): Promise<CurrentResult[]> {
  const placeholders = photoIds.map(() => "?").join(", ");
  const photos = await database
    .prepare(`SELECT id, document_revision FROM photos WHERE id IN (${placeholders})`)
    .bind(...photoIds)
    .all<{ id: string; document_revision: number }>();
  const tags = await database
    .prepare(
      `SELECT pht.photo_id, ht.id, ht.name, ht.normalized_name, ht.created_at
       FROM photo_human_tags pht JOIN human_tags ht ON ht.id = pht.tag_id
       WHERE pht.photo_id IN (${placeholders})
       ORDER BY ht.normalized_name ASC, ht.id ASC`,
    )
    .bind(...photoIds)
    .all<TagRow & { photo_id: string }>();
  return photos.results.map((photo) => ({
    photoId: photo.id,
    documentRevision: photo.document_revision,
    humanTags: tags.results
      .filter((tag) => tag.photo_id === photo.id)
      .map((tag) => ({
        kind: "human-tag",
        id: tag.id,
        name: tag.name,
        normalizedName: tag.normalized_name,
        createdAt: tag.created_at,
      })),
  }));
}

function utcDayStart(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

async function stableTagId(normalizedTag: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizedTag));
  return `tag-${Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}
