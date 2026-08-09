import type { PlatformProviders } from "../../providers";
import { validateImageFile } from "./image";
import { createPhotoUpload } from "./service";

export interface SeedPhotoInput {
  sourcePath: string;
  filename: string;
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  sourceUrl: string | null;
  licenseName: string | null;
  licenseUrl: string | null;
  authorName: string | null;
  authorUrl: string | null;
}

export interface SeedImportResult {
  imported: number;
  unchanged: number;
  replaced: number;
  failures: { sourcePath: string; message: string }[];
}

export function seedImportAction(
  existing: { checksum: string; operationState: string } | null,
  checksum: string,
): "import" | "unchanged" | "replace" {
  if (!existing) return "import";
  return existing.checksum === checksum && existing.operationState === "completed"
    ? "unchanged"
    : "replace";
}

/**
 * Imports trusted repository fixtures through the same byte validation,
 * durable upload, R2, and outbox path as anonymous uploads. Seed inputs
 * deliberately have no knownLabel, AI-word, or human-tag fields.
 */
export async function importSeedCollection(
  providers: PlatformProviders,
  entries: readonly SeedPhotoInput[],
): Promise<SeedImportResult> {
  const result: SeedImportResult = { imported: 0, unchanged: 0, replaced: 0, failures: [] };
  for (const entry of entries) {
    try {
      requireSeedPath(entry.sourcePath);
      const image = await validateImageFile(
        new File([entry.bytes], entry.filename, { type: entry.mimeType }),
      );
      const existing = await providers.database
        .prepare(
          `SELECT p.id, p.seed_sha256 AS checksum, p.r2_object_key AS objectKey,
         p.upload_operation_id AS operationId, u.state AS operationState
         FROM photos p JOIN upload_operations u ON u.id = p.upload_operation_id
         WHERE p.seed_collection_version = 'public-ai-photo-library-v1' AND p.seed_source_path = ?
         ORDER BY p.created_at DESC LIMIT 1`,
        )
        .bind(entry.sourcePath)
        .first<{
          id: string;
          checksum: string;
          objectKey: string;
          operationId: string;
          operationState: string;
        }>();
      const action = seedImportAction(existing, image.sha256);
      if (action === "unchanged") {
        result.unchanged++;
        continue;
      }
      if (action === "replace" && existing) {
        await providers.database
          .prepare(
            "UPDATE photos SET state = 'tombstoned', tombstoned_at = ?, updated_at = ? WHERE id = ?",
          )
          .bind(
            providers.clock.now().toISOString(),
            providers.clock.now().toISOString(),
            existing.id,
          )
          .run();
        await providers.photos.delete(existing.objectKey);
        await providers.database.batch([
          providers.database.prepare("DELETE FROM photos WHERE id = ?").bind(existing.id),
          providers.database
            .prepare("DELETE FROM upload_operations WHERE id = ?")
            .bind(existing.operationId),
          providers.database
            .prepare(
              `UPDATE quota_counters SET used = MAX(0, used - 1), updated_at = ?
             WHERE scope = 'global_stored_photo' AND subject_key = 'all'
             AND window_start = '1970-01-01T00:00:00.000Z'`,
            )
            .bind(providers.clock.now().toISOString()),
        ]);
        result.replaced++;
      }
      await createPhotoUpload(providers, {
        image,
        filename: entry.filename,
        attribution: {
          sourceUrl: entry.sourceUrl,
          licenseName: entry.licenseName,
          licenseUrl: entry.licenseUrl,
          authorName: entry.authorName,
          authorUrl: entry.authorUrl,
        },
        seed: {
          id: await stableSeedId(entry.sourcePath),
          sourcePath: entry.sourcePath,
          checksum: image.sha256,
        },
      });
      result.imported++;
    } catch (error) {
      result.failures.push({
        sourcePath: entry.sourcePath,
        message: error instanceof Error ? error.message : "seed import failure",
      });
    }
  }
  return result;
}

export async function stableSeedId(sourcePath: string): Promise<string> {
  requireSeedPath(sourcePath);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sourcePath));
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function requireSeedPath(sourcePath: string): void {
  if (!/^thumbs\/(?:pets|components)\/[a-z0-9][a-z0-9-]*\.jpg\.jpg$/.test(sourcePath)) {
    throw new Error("Seed source must be a credited thumbnail beneath fixtures/bundle/thumbs.");
  }
}
