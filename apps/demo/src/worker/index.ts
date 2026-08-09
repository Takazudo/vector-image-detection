import { dispatchQueueMessage, photoQueueMessageSchema } from "./contracts/queue";
import { featureQueueHandlers } from "./feature-queue-handlers";
import { featureRoutes } from "./feature-routes";
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
        await dispatchQueueMessage(parsed.data, featureQueueHandlers);
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
  scheduled(_controller, _env, _ctx) {
    // The repair feature installs its outbox/lease/retention scan here. Keeping
    // the event seam now prevents request handlers from owning repair loops.
  },
} satisfies ExportedHandler<Env, unknown>;
