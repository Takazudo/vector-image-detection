PRAGMA foreign_keys = ON;

CREATE TABLE app_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

INSERT INTO app_metadata (key, value, updated_at) VALUES
  ('schema_version', '1', '2026-08-10T00:00:00.000Z'),
  ('vision_model_id', '@cf/moondream/moondream3.1-9B-A2B', '2026-08-10T00:00:00.000Z'),
  ('embedding_model_id', '@cf/google/embeddinggemma-300m', '2026-08-10T00:00:00.000Z'),
  ('vector_dimensions', '768', '2026-08-10T00:00:00.000Z'),
  ('vector_metric', 'cosine', '2026-08-10T00:00:00.000Z');

CREATE TABLE photos (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 47),
  state TEXT NOT NULL CHECK (state IN ('pending', 'enqueue_failed', 'processing', 'ready', 'failed', 'tombstoned')),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
  width INTEGER NOT NULL CHECK (width BETWEEN 32 AND 12000),
  height INTEGER NOT NULL CHECK (height BETWEEN 32 AND 12000),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  r2_object_key TEXT NOT NULL UNIQUE,
  r2_version TEXT,
  upload_operation_id TEXT NOT NULL UNIQUE,
  ai_caption TEXT,
  document_revision INTEGER NOT NULL DEFAULT 1 CHECK (document_revision >= 1),
  reindex_required_revision INTEGER CHECK (reindex_required_revision IS NULL OR reindex_required_revision >= 1),
  canonical_indexed_revision INTEGER CHECK (canonical_indexed_revision IS NULL OR canonical_indexed_revision >= 1),
  canonical_vector_id TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  last_error_retryable INTEGER NOT NULL DEFAULT 0 CHECK (last_error_retryable IN (0, 1)),
  source_url TEXT,
  license_name TEXT,
  license_url TEXT,
  author_name TEXT,
  author_url TEXT,
  seed_collection_version TEXT,
  seed_source_path TEXT,
  seed_sha256 TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ready_at TEXT,
  retention_until TEXT,
  tombstoned_at TEXT,
  CHECK (width * height <= 40000000),
  CHECK (canonical_indexed_revision IS NULL OR canonical_indexed_revision <= document_revision),
  CHECK (reindex_required_revision IS NULL OR reindex_required_revision <= document_revision),
  CHECK (
    (canonical_indexed_revision IS NULL AND canonical_vector_id IS NULL) OR
    (canonical_indexed_revision IS NOT NULL AND canonical_vector_id = id || ':' || canonical_indexed_revision)
  )
) STRICT;

CREATE TABLE upload_operations (
  id TEXT PRIMARY KEY,
  photo_id TEXT UNIQUE REFERENCES photos(id) ON DELETE SET NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'object_stored', 'enqueue_failed', 'completed', 'failed', 'expired', 'purge_pending')),
  client_filename TEXT NOT NULL,
  declared_mime_type TEXT NOT NULL CHECK (declared_mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  detected_mime_type TEXT CHECK (detected_mime_type IS NULL OR detected_mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  expected_byte_size INTEGER NOT NULL CHECK (expected_byte_size BETWEEN 1 AND 5242880),
  actual_byte_size INTEGER,
  expected_sha256 TEXT NOT NULL CHECK (length(expected_sha256) = 64),
  actual_sha256 TEXT,
  r2_object_key TEXT NOT NULL UNIQUE,
  r2_version TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  error_code TEXT,
  error_message TEXT,
  error_retryable INTEGER NOT NULL DEFAULT 0 CHECK (error_retryable IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  object_stored_at TEXT,
  completed_at TEXT
) STRICT;

CREATE TABLE ai_model_runs (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  requested_document_revision INTEGER NOT NULL CHECK (requested_document_revision >= 1),
  vision_model_id TEXT NOT NULL,
  embedding_model_id TEXT NOT NULL,
  prompt_version INTEGER NOT NULL CHECK (prompt_version >= 1),
  document_version INTEGER NOT NULL CHECK (document_version >= 1),
  caption TEXT,
  raw_output_bytes INTEGER CHECK (raw_output_bytes IS NULL OR raw_output_bytes >= 0),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (photo_id, operation_id)
) STRICT;

CREATE TABLE photo_ai_words (
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  model_run_id TEXT NOT NULL REFERENCES ai_model_runs(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  normalized_word TEXT NOT NULL,
  confidence REAL,
  position INTEGER NOT NULL CHECK (position >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (photo_id, model_run_id, normalized_word)
) STRICT;

CREATE TABLE human_tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  CHECK (length(name) BETWEEN 1 AND 64),
  CHECK (length(normalized_name) BETWEEN 1 AND 64)
) STRICT;

CREATE TABLE photo_human_tags (
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES human_tags(id) ON DELETE CASCADE,
  attached_revision INTEGER NOT NULL CHECK (attached_revision >= 1),
  created_at TEXT NOT NULL,
  PRIMARY KEY (photo_id, tag_id)
) STRICT;

CREATE TABLE queue_outbox (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  requested_document_revision INTEGER CHECK (requested_document_revision IS NULL OR requested_document_revision >= 1),
  message_type TEXT NOT NULL CHECK (message_type IN ('enrich', 'reindex', 'repair', 'purge')),
  payload_version INTEGER NOT NULL CHECK (payload_version = 1),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'dispatching', 'dispatched', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TEXT NOT NULL,
  lease_token TEXT,
  lease_expires_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  dispatched_at TEXT,
  CHECK (
    (state = 'dispatching' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL) OR
    (state <> 'dispatching')
  )
) STRICT;

CREATE TABLE processing_runs (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  message_type TEXT NOT NULL CHECK (message_type IN ('enrich', 'reindex', 'repair', 'purge')),
  requested_document_revision INTEGER CHECK (requested_document_revision IS NULL OR requested_document_revision >= 1),
  state TEXT NOT NULL CHECK (state IN ('pending', 'processing', 'succeeded', 'retryable_error', 'terminal_error', 'superseded')),
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  lease_token TEXT,
  lease_acquired_at TEXT,
  lease_expires_at TEXT,
  error_code TEXT,
  error_message TEXT,
  error_retryable INTEGER NOT NULL DEFAULT 0 CHECK (error_retryable IN (0, 1)),
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (operation_id, attempt_number),
  CHECK (
    (state = 'processing' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL) OR
    state <> 'processing'
  )
) STRICT;

CREATE TABLE quota_counters (
  scope TEXT NOT NULL CHECK (scope IN ('ip_upload', 'global_upload', 'global_stored_photo', 'tag_mutation')),
  subject_key TEXT NOT NULL,
  window_start TEXT NOT NULL,
  window_seconds INTEGER NOT NULL CHECK (window_seconds > 0),
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  quota_limit INTEGER NOT NULL CHECK (quota_limit > 0),
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (scope, subject_key, window_start)
) STRICT;

CREATE TABLE tombstones (
  photo_id TEXT PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
  tombstone_revision INTEGER NOT NULL CHECK (tombstone_revision >= 1),
  reason TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  purge_state TEXT NOT NULL DEFAULT 'pending' CHECK (purge_state IN ('pending', 'processing', 'complete', 'failed')),
  r2_deleted_at TEXT,
  vectors_deleted_at TEXT,
  database_purged_at TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  retain_until TEXT NOT NULL
) STRICT;

CREATE TABLE purge_progress (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('r2_object', 'vector_generation', 'database_rows')),
  resource_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'processing', 'complete', 'failed')),
  cursor TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_token TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (photo_id, resource_type, resource_key)
) STRICT;

CREATE INDEX photos_gallery_order_idx
  ON photos (created_at DESC, id DESC)
  WHERE state = 'ready';
CREATE INDEX photos_sha256_idx ON photos (sha256);
CREATE INDEX photos_seed_checksum_idx
  ON photos (seed_collection_version, seed_source_path, seed_sha256)
  WHERE seed_collection_version IS NOT NULL;
CREATE INDEX photos_reindex_repair_idx
  ON photos (reindex_required_revision, updated_at, id)
  WHERE reindex_required_revision IS NOT NULL;
CREATE INDEX photos_state_repair_idx ON photos (state, updated_at, id);
CREATE INDEX photos_retention_idx
  ON photos (retention_until, id)
  WHERE retention_until IS NOT NULL;

CREATE INDEX upload_operations_repair_idx
  ON upload_operations (state, expires_at, updated_at, id);
CREATE INDEX upload_operations_checksum_idx
  ON upload_operations (expected_sha256, expected_byte_size);

CREATE INDEX photo_ai_words_exact_idx
  ON photo_ai_words (normalized_word, photo_id);
CREATE INDEX photo_ai_words_photo_order_idx
  ON photo_ai_words (photo_id, position, normalized_word);
CREATE INDEX photo_human_tags_photo_idx ON photo_human_tags (photo_id, tag_id);
CREATE INDEX photo_human_tags_exact_idx ON photo_human_tags (tag_id, photo_id);
CREATE INDEX human_tags_normalized_idx ON human_tags (normalized_name, id);

CREATE INDEX queue_outbox_drain_idx
  ON queue_outbox (state, available_at, lease_expires_at, created_at, id);
CREATE INDEX queue_outbox_photo_revision_idx
  ON queue_outbox (photo_id, requested_document_revision, message_type);
CREATE INDEX processing_runs_lease_idx
  ON processing_runs (state, lease_expires_at, updated_at, id);
CREATE UNIQUE INDEX processing_runs_one_active_operation_idx
  ON processing_runs (operation_id)
  WHERE state = 'processing';
CREATE INDEX processing_runs_photo_revision_idx
  ON processing_runs (photo_id, requested_document_revision, message_type, started_at);

CREATE INDEX quota_counters_expiry_idx ON quota_counters (expires_at, scope, subject_key);
CREATE INDEX tombstones_retention_idx ON tombstones (purge_state, retain_until, photo_id);
CREATE INDEX purge_progress_scan_idx
  ON purge_progress (state, lease_expires_at, updated_at, id);
