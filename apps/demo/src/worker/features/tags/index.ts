import type { QueueMessageHandlers } from "../../contracts/queue";
import type { PlatformProviders } from "../../providers";
import { handleReindexMessage } from "./reindex";

export { TAG_MUTATION_DAILY_QUOTA, mutateHumanTag } from "./mutation";
export { normalizeTagWord } from "./normalization";
export { dispatchPendingReindexOutbox } from "./outbox";
export { canonicalTextDocument, handleReindexMessage } from "./reindex";
export { humanTagRoutes } from "./routes";

export function createTagQueueHandlers(
  providers: PlatformProviders,
): Pick<QueueMessageHandlers, "reindex"> {
  return { reindex: (message) => handleReindexMessage(message, providers).then(() => undefined) };
}
