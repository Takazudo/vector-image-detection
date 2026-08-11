import { MODEL_CONFIG, VALIDATION_LIMITS } from "../../config";
import { vectorIdFor } from "../../contracts/domain";
import type { EnrichQueueMessage, ReindexQueueMessage } from "../../contracts/queue";
import type { PlatformProviders } from "../../providers";
import type { EnrichmentProviders } from "./providers";

const VISION_PROMPT = `Return only a JSON object with keys "caption" and "words". Caption must be concise English. Words must be an array of short English search terms. Do not include markdown.`;

export class ProcessingError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "ProcessingError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface EnrichmentHandlerDependencies {
  platform: PlatformProviders;
  enrichment: EnrichmentProviders;
}

export function createEnrichmentHandlers(dependencies: EnrichmentHandlerDependencies) {
  return {
    enrich: (message: EnrichQueueMessage) => processDocument(dependencies, message, true),
    reindex: (message: ReindexQueueMessage) => processDocument(dependencies, message, false),
  };
}

async function processDocument(
  dependencies: EnrichmentHandlerDependencies,
  message: EnrichQueueMessage | ReindexQueueMessage,
  runVision: boolean,
): Promise<void> {
  const { platform, enrichment } = dependencies;
  const existing = await platform.database
    .prepare(
      "SELECT state FROM processing_runs WHERE operation_id = ? AND state IN ('succeeded', 'superseded', 'terminal_error') LIMIT 1",
    )
    .bind(message.operationId)
    .first<{ state: string }>();
  if (existing?.state === "terminal_error") {
    await platform.deadLetterQueue.send(message);
    return;
  }
  if (existing) return;

  const photo = await loadPhoto(platform.database, message.photoId);
  if (!photo || photo.state === "tombstoned" || photo.state === "failed") return;
  if (
    photo.state === "ready" &&
    photo.canonical_indexed_revision === photo.document_revision &&
    photo.reindex_required_revision === null
  )
    return;

  const now = platform.clock.now();
  const timestamp = now.toISOString();
  const leaseToken = platform.ids.generate();
  const runId = platform.ids.generate();
  const attempt = await nextAttempt(
    platform.database,
    message.photoId,
    message.type,
    photo.document_revision,
  );
  const leaseExpiry = new Date(
    now.getTime() + VALIDATION_LIMITS.processingLeaseSeconds * 1_000,
  ).toISOString();
  try {
    const acquired = await platform.database
      .prepare(
        `INSERT INTO processing_runs
       (id, operation_id, photo_id, message_type, requested_document_revision, state,
        attempt_number, lease_token, lease_acquired_at, lease_expires_at, started_at, updated_at)
       SELECT ?, ?, ?, ?, ?, 'processing', ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM processing_runs WHERE operation_id = ? AND state = 'processing')`,
      )
      .bind(
        runId,
        message.operationId,
        message.photoId,
        message.type,
        photo.document_revision,
        attempt,
        leaseToken,
        timestamp,
        leaseExpiry,
        timestamp,
        timestamp,
        message.operationId,
      )
      .run();
    if (acquired.meta.changes !== 1) return;
  } catch (error) {
    if (isConstraint(error)) return;
    throw error;
  }

  await platform.database
    .prepare(
      "UPDATE photos SET state = 'processing', updated_at = ? WHERE id = ? AND state NOT IN ('tombstoned', 'failed')",
    )
    .bind(timestamp, photo.id)
    .run();

  let vectorWritten = false;
  try {
    const object = await platform.photos.get(photo.r2_object_key);
    if (!object)
      throw new ProcessingError("missing_object", "Stored image object is missing.", false);
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (bytes.byteLength !== photo.byte_size)
      throw new ProcessingError("object_size_mismatch", "Stored image size changed.", false);

    let caption = photo.ai_caption;
    let words = await currentAiWords(platform.database, photo.id, photo.document_revision);
    let modelRunId: string | null = null;
    if (runVision) {
      const raw = await enrichment.describe(bytes, VISION_PROMPT);
      const parsed = parseVisionOutput(raw);
      caption = parsed.caption;
      words = parsed.words;
      modelRunId = platform.ids.generate();
      const rawBytes = new TextEncoder().encode(JSON.stringify(raw)).byteLength;
      if (rawBytes > VALIDATION_LIMITS.maximumAiOutputBytes) {
        throw new ProcessingError(
          "ai_output_too_large",
          "Vision output exceeded the allowed size.",
          false,
        );
      }
      await saveVisionResult(platform.database, {
        modelRunId,
        operationId: message.operationId,
        photoId: photo.id,
        revision: photo.document_revision,
        caption,
        words,
        timestamp,
        rawBytes,
      });
    }

    await renewLease(platform, runId, leaseToken);
    const humanTags = await currentHumanTags(platform.database, photo.id);
    const document = canonicalDocument(caption, words, humanTags);
    const embedding = parseEmbedding(await enrichment.embed(document));
    const vectorId = vectorIdFor(photo.id, photo.document_revision);
    await enrichment.upsertVector(vectorId, embedding, {
      photoId: photo.id,
      documentRevision: photo.document_revision,
      documentVersion: MODEL_CONFIG.documentVersion,
    });
    vectorWritten = true;

    const completedAt = platform.clock.now().toISOString();
    const promoted = await platform.database
      .prepare(
        `UPDATE photos SET state = 'ready', ai_caption = COALESCE(?, ai_caption),
       canonical_indexed_revision = ?, canonical_vector_id = ?, reindex_required_revision = NULL,
       last_error_code = NULL, last_error_message = NULL, last_error_retryable = 0,
       ready_at = COALESCE(ready_at, ?), updated_at = ?
       WHERE id = ? AND document_revision = ? AND state NOT IN ('tombstoned', 'failed')`,
      )
      .bind(
        caption,
        photo.document_revision,
        vectorId,
        completedAt,
        completedAt,
        photo.id,
        photo.document_revision,
      )
      .run();
    await finishRun(
      platform.database,
      runId,
      leaseToken,
      promoted.meta.changes === 1 ? "succeeded" : "superseded",
      completedAt,
      null,
      null,
      false,
    );
  } catch (error) {
    const processingError = classifyError(error);
    const failedAt = platform.clock.now().toISOString();
    const terminal =
      !processingError.retryable || attempt >= VALIDATION_LIMITS.maximumQueueAttempts;
    await finishRun(
      platform.database,
      runId,
      leaseToken,
      terminal ? "terminal_error" : "retryable_error",
      failedAt,
      processingError.code,
      processingError.message,
      !terminal,
    );
    await platform.database
      .prepare(
        `UPDATE photos SET state = ?, last_error_code = ?, last_error_message = ?,
       last_error_retryable = ?, updated_at = ? WHERE id = ? AND document_revision = ?
       AND (canonical_indexed_revision IS NULL OR canonical_indexed_revision <> document_revision)`,
      )
      .bind(
        terminal ? "failed" : "enqueue_failed",
        processingError.code,
        processingError.message.slice(0, 1_000),
        terminal ? 0 : 1,
        failedAt,
        photo.id,
        photo.document_revision,
      )
      .run();
    if (terminal) {
      await platform.deadLetterQueue.send(message);
      return;
    }
    throw processingError;
  } finally {
    if (!vectorWritten) {
      // No vector generation exists to reconcile when provider work failed before upsert.
    }
  }
}

interface PhotoProcessingRow {
  id: string;
  state: string;
  byte_size: number;
  r2_object_key: string;
  ai_caption: string | null;
  document_revision: number;
  reindex_required_revision: number | null;
  canonical_indexed_revision: number | null;
}

async function loadPhoto(
  database: D1Database,
  photoId: string,
): Promise<PhotoProcessingRow | null> {
  return database
    .prepare(
      `SELECT id, state, byte_size, r2_object_key, ai_caption, document_revision,
     reindex_required_revision, canonical_indexed_revision FROM photos WHERE id = ?`,
    )
    .bind(photoId)
    .first<PhotoProcessingRow>();
}

export function parseVisionOutput(value: unknown): { caption: string; words: string[] } {
  let candidate = unwrapVisionPayload(value);
  if (typeof candidate === "string") {
    if (new TextEncoder().encode(candidate).byteLength > VALIDATION_LIMITS.maximumAiOutputBytes) {
      throw new ProcessingError(
        "ai_output_too_large",
        "Vision output exceeded the allowed size.",
        false,
      );
    }
    const cleaned = candidate
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    try {
      candidate = JSON.parse(cleaned);
    } catch {
      const recovered = recoverTruncatedJson(cleaned);
      if (recovered === undefined) {
        throw new ProcessingError(
          "malformed_ai_output",
          "Vision output was not valid JSON.",
          false,
        );
      }
      candidate = recovered;
    }
  }
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw new ProcessingError("malformed_ai_output", "Vision output was not an object.", false);
  }
  const record = candidate as Record<string, unknown>;
  if (typeof record.caption !== "string" || !Array.isArray(record.words)) {
    throw new ProcessingError(
      "malformed_ai_output",
      "Vision output omitted caption or words.",
      false,
    );
  }
  const caption = record.caption.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!caption || caption.length > VALIDATION_LIMITS.maximumAiCaptionLength) {
    throw new ProcessingError(
      "malformed_ai_output",
      "Vision caption was empty or too long.",
      false,
    );
  }
  const words: string[] = [];
  const seen = new Set<string>();
  for (const item of record.words) {
    if (typeof item !== "string") continue;
    const normalized = item
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .replace(/\s+/g, " ")
      .trim();
    if (
      !normalized ||
      normalized.length > VALIDATION_LIMITS.maximumAiWordLength ||
      seen.has(normalized)
    )
      continue;
    seen.add(normalized);
    words.push(normalized);
    if (words.length === VALIDATION_LIMITS.maximumAiWordCount) break;
  }
  if (words.length === 0)
    throw new ProcessingError("malformed_ai_output", "Vision output had no usable words.", false);
  return { caption, words };
}

/**
 * Workers AI nests the pinned Moondream model's payload one level deep — the
 * binding answers `{result: {answer, caption, …}, usage}` — so the generated
 * text is only reachable after peeling the envelope and then the payload key.
 * `description` covers the shape other vision models document. Peeling is
 * layer-by-layer rather than a single choice because envelope and payload key
 * are independent; a nullish layer is left in place so the caller still reports
 * the outer shape it actually received.
 */
function unwrapVisionPayload(value: unknown): unknown {
  let candidate = value;
  for (const key of ["result", "answer", "description"]) {
    if (typeof candidate !== "object" || candidate === null || !(key in candidate)) continue;
    const unwrapped = (candidate as Record<string, unknown>)[key];
    if (unwrapped !== null && unwrapped !== undefined) candidate = unwrapped;
  }
  return candidate;
}

/**
 * Salvages a JSON object the model stopped emitting mid-value. Moondream can
 * fall into a repetition loop and hit `max_tokens` (`finish_reason: "length"`),
 * which leaves a syntactically incomplete but semantically usable answer — the
 * caption and the completed array entries are all present. Retrying is futile
 * because the run is temperature 0, so the truncated prefix is the only output
 * that will ever exist for that image.
 *
 * Structural boundaries (a closed string literal, a closed object/array) are the
 * only candidate cut points, walked newest-first and closed with whatever is
 * still open. Every candidate must survive `JSON.parse` and then the same
 * caption/word validation as untruncated output, so a prefix that only looks
 * like JSON is rejected rather than salvaged. Returns `undefined` when nothing
 * parses.
 */
function recoverTruncatedJson(text: string): unknown {
  const boundaries: { end: number; closers: string }[] = [];
  const open: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') {
        inString = false;
        boundaries.push({ end: index + 1, closers: [...open].reverse().join("") });
      }
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") open.push("}");
    else if (character === "[") open.push("]");
    else if (character === "}" || character === "]") {
      open.pop();
      boundaries.push({ end: index + 1, closers: [...open].reverse().join("") });
    }
  }
  for (let index = boundaries.length - 1; index >= 0; index -= 1) {
    const boundary = boundaries[index];
    if (!boundary || boundary.closers.length === 0) continue;
    const head = text.slice(0, boundary.end).replace(/[\s,]+$/, "");
    try {
      return JSON.parse(head + boundary.closers);
    } catch {
      // An incomplete key or value at this cut point; try an earlier boundary.
    }
  }
  return undefined;
}

export function parseEmbedding(value: unknown): number[] {
  let candidate: unknown = value;
  if (typeof candidate === "object" && candidate !== null && "data" in candidate) {
    const data = (candidate as { data: unknown }).data;
    candidate = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : data;
  }
  if (
    !Array.isArray(candidate) ||
    candidate.length !== MODEL_CONFIG.vectorDimensions ||
    candidate.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))
  ) {
    throw new ProcessingError(
      "invalid_embedding",
      "Embedding must contain exactly 768 finite numbers.",
      false,
    );
  }
  return candidate;
}

export function canonicalDocument(
  caption: string | null,
  words: string[],
  humanTags: string[],
): string {
  return [
    `caption: ${caption ?? ""}`,
    `ai words: ${[...new Set(words)].sort().join(", ")}`,
    `human tags: ${[...new Set(humanTags)].sort().join(", ")}`,
  ].join("\n");
}

async function saveVisionResult(
  database: D1Database,
  input: {
    modelRunId: string;
    operationId: string;
    photoId: string;
    revision: number;
    caption: string;
    words: string[];
    timestamp: string;
    rawBytes: number;
  },
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    database
      .prepare("DELETE FROM ai_model_runs WHERE photo_id = ? AND operation_id = ?")
      .bind(input.photoId, input.operationId),
    database
      .prepare(
        `INSERT INTO ai_model_runs
     (id, photo_id, operation_id, requested_document_revision, vision_model_id, embedding_model_id,
      prompt_version, document_version, caption, raw_output_bytes, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)`,
      )
      .bind(
        input.modelRunId,
        input.photoId,
        input.operationId,
        input.revision,
        MODEL_CONFIG.vision,
        MODEL_CONFIG.embedding,
        input.caption,
        input.rawBytes,
        input.timestamp,
        input.timestamp,
      ),
    database
      .prepare("DELETE FROM photo_ai_words WHERE photo_id = ? AND document_revision = ?")
      .bind(input.photoId, input.revision),
  ];
  input.words.forEach((word, position) =>
    statements.push(
      database
        .prepare(
          `INSERT INTO photo_ai_words
     (photo_id, model_run_id, document_revision, word, normalized_word, confidence, position, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .bind(
          input.photoId,
          input.modelRunId,
          input.revision,
          word,
          word,
          position,
          input.timestamp,
        ),
    ),
  );
  await database.batch(statements);
}

async function currentAiWords(
  database: D1Database,
  photoId: string,
  revision: number,
): Promise<string[]> {
  const result = await database
    .prepare(
      "SELECT normalized_word FROM photo_ai_words WHERE photo_id = ? AND document_revision = ? ORDER BY position",
    )
    .bind(photoId, revision)
    .all<{ normalized_word: string }>();
  return result.results.map((row) => row.normalized_word);
}

async function currentHumanTags(database: D1Database, photoId: string): Promise<string[]> {
  const result = await database
    .prepare(
      `SELECT h.normalized_name FROM human_tags h JOIN photo_human_tags p ON p.tag_id = h.id
     WHERE p.photo_id = ? ORDER BY h.normalized_name`,
    )
    .bind(photoId)
    .all<{ normalized_name: string }>();
  return result.results.map((row) => row.normalized_name);
}

async function nextAttempt(
  database: D1Database,
  photoId: string,
  messageType: "enrich" | "reindex",
  revision: number,
): Promise<number> {
  const row = await database
    .prepare(
      `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS attempt FROM processing_runs
       WHERE photo_id = ? AND message_type = ? AND requested_document_revision = ?`,
    )
    .bind(photoId, messageType, revision)
    .first<{ attempt: number }>();
  return row?.attempt ?? 1;
}

async function renewLease(
  platform: PlatformProviders,
  runId: string,
  leaseToken: string,
): Promise<void> {
  const now = platform.clock.now();
  const result = await platform.database
    .prepare(
      "UPDATE processing_runs SET lease_expires_at = ?, updated_at = ? WHERE id = ? AND lease_token = ? AND state = 'processing'",
    )
    .bind(
      new Date(now.getTime() + VALIDATION_LIMITS.processingLeaseSeconds * 1_000).toISOString(),
      now.toISOString(),
      runId,
      leaseToken,
    )
    .run();
  if (result.meta.changes !== 1)
    throw new ProcessingError("lease_lost", "Processing lease was lost.", true);
}

async function finishRun(
  database: D1Database,
  runId: string,
  leaseToken: string,
  state: "succeeded" | "retryable_error" | "terminal_error" | "superseded",
  completedAt: string,
  code: string | null,
  message: string | null,
  retryable: boolean,
): Promise<void> {
  await database
    .prepare(
      `UPDATE processing_runs SET state = ?, lease_token = NULL, lease_expires_at = NULL,
     error_code = ?, error_message = ?, error_retryable = ?, completed_at = ?, updated_at = ?
     WHERE id = ? AND lease_token = ?`,
    )
    .bind(
      state,
      code,
      message?.slice(0, 1_000) ?? null,
      retryable ? 1 : 0,
      completedAt,
      completedAt,
      runId,
      leaseToken,
    )
    .run();
}

function classifyError(error: unknown): ProcessingError {
  if (error instanceof ProcessingError) return error;
  return new ProcessingError(
    "provider_failure",
    error instanceof Error ? error.message : "Provider failure.",
    true,
  );
}

function isConstraint(error: unknown): boolean {
  return error instanceof Error && /constraint|unique/i.test(error.message);
}
