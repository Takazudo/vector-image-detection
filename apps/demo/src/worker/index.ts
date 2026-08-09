import { dispatchQueueMessage, photoQueueMessageSchema } from "./contracts/queue";
import { featureRoutes } from "./feature-routes";
import { tombstoneExpiredPhotos } from "./features/maintenance/purge";
import {
  cleanupStaleVectors,
  drainOutbox,
  recoverExpiredLeases,
  repairExpiredUploads,
} from "./features/maintenance/repair";
import { createPhotoQueueHandlers } from "./features/processing/handlers";
import { createEnrichmentProviders } from "./features/processing/providers";
import { createTagSearchQueueHandlers } from "./features/tag-search";
import { createPlatformProviders } from "./providers";
import { apiError, routeRequest } from "./router";

export default {
  async fetch(request, env, ctx) {
    try {
      return await routeRequest(request, env, ctx, featureRoutes);
    } catch (error) {
      const requestId = crypto.randomUUID();
      console.error(
        JSON.stringify({
          message: "request handler failed",
          requestId,
          method: request.method,
          path: new URL(request.url).pathname,
          error: error instanceof Error ? error.message : "unknown error",
        }),
      );
      return apiError(requestId, 500, "internal_error", "Internal server error.", true);
    }
  },
  async queue(batch, env) {
    // Bindings are event-scoped. Construct adapters here rather than retaining
    // request state at module scope, and let the tags feature replace only the
    // reindex handler supplied by the photos feature.
    const providers = createPlatformProviders(env);
    const queueHandlers = {
      ...createPhotoQueueHandlers(providers),
      ...createTagSearchQueueHandlers(providers),
    };
    for (const queued of batch.messages) {
      const parsed = photoQueueMessageSchema.safeParse(queued.body);
      if (!parsed.success) {
        console.error(
          JSON.stringify({
            message: "discarding invalid Queue payload",
            queueMessageId: queued.id,
            issues: parsed.error.issues.map(({ code, path }) => ({ code, path })),
          }),
        );
        try {
          await env.PHOTO_DLQ.send(queued.body, { contentType: "json" });
          queued.ack();
        } catch (error) {
          console.error(
            JSON.stringify({
              message: "failed to preserve invalid Queue payload in DLQ",
              queueMessageId: queued.id,
              error: error instanceof Error ? error.message : "unknown error",
            }),
          );
          queued.retry();
        }
        continue;
      }

      try {
        await dispatchQueueMessage(parsed.data, queueHandlers);
        queued.ack();
      } catch (error) {
        console.error(
          JSON.stringify({
            message: "Queue handler failed",
            queueMessageId: queued.id,
            operationId: parsed.data.operationId,
            type: parsed.data.type,
            error: error instanceof Error ? error.message : "unknown error",
          }),
        );
        queued.retry();
      }
    }
  },
  async scheduled(_controller, env, _ctx) {
    const providers = createPlatformProviders(env);
    const enrichment = createEnrichmentProviders(providers);
    const repairs = await Promise.allSettled([
      drainOutbox(providers),
      repairExpiredUploads(providers),
      recoverExpiredLeases(providers),
      cleanupStaleVectors(providers, enrichment),
      tombstoneExpiredPhotos(providers),
    ]);
    for (const result of repairs) {
      if (result.status === "rejected") {
        console.error(
          JSON.stringify({
            message: "scheduled photo-library repair failed",
            error: result.reason instanceof Error ? result.reason.message : "unknown error",
          }),
        );
      }
    }
  },
} satisfies ExportedHandler<Env, unknown>;
