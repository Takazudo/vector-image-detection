import { dispatchQueueMessage, photoQueueMessageSchema } from "./contracts/queue";
import { featureQueueHandlers } from "./feature-queue-handlers";
import { featureRoutes } from "./feature-routes";
import { routeRequest } from "./router";

export default {
  fetch(request, env, ctx) {
    return routeRequest(request, env, ctx, featureRoutes);
  },
  async queue(batch) {
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
        queued.ack();
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
