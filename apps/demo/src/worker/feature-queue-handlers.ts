import type { QueueMessageHandlers } from "./contracts/queue";

async function notImplemented(): Promise<never> {
  throw new Error("Queue feature handler is not installed");
}

/** Feature issues replace individual handlers; dispatch and validation remain central. */
export const featureQueueHandlers: QueueMessageHandlers = {
  enrich: notImplemented,
  reindex: notImplemented,
  repair: notImplemented,
  purge: notImplemented,
};
