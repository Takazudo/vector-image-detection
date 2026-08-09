import { z } from "zod";

import type { IsoTimestamp, PhotoId, QueueOperationId } from "./domain";

export const QUEUE_PAYLOAD_VERSION = 1 as const;

interface QueueMessageBase {
  version: typeof QUEUE_PAYLOAD_VERSION;
  operationId: QueueOperationId;
  photoId: PhotoId;
  enqueuedAt: IsoTimestamp;
}

export interface EnrichQueueMessage extends QueueMessageBase {
  type: "enrich";
  requestedDocumentRevision: number;
}

export interface ReindexQueueMessage extends QueueMessageBase {
  type: "reindex";
  requestedDocumentRevision: number;
}

export interface RepairQueueMessage extends QueueMessageBase {
  type: "repair";
  repairKind: "upload" | "outbox" | "processing" | "vector";
  requestedDocumentRevision?: number;
}

export interface PurgeQueueMessage extends QueueMessageBase {
  type: "purge";
  tombstoneRevision: number;
}

/** Message content is only an instruction. Consumers reload canonical state from D1. */
export type PhotoQueueMessage =
  EnrichQueueMessage | ReindexQueueMessage | RepairQueueMessage | PurgeQueueMessage;

const baseShape = {
  version: z.literal(QUEUE_PAYLOAD_VERSION),
  operationId: z.string().min(1).max(128),
  photoId: z.string().min(1).max(47),
  enqueuedAt: z.iso.datetime({ offset: true }),
};

const documentRevision = z.number().int().positive();

export const photoQueueMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...baseShape,
    type: z.literal("enrich"),
    requestedDocumentRevision: documentRevision,
  }),
  z.strictObject({
    ...baseShape,
    type: z.literal("reindex"),
    requestedDocumentRevision: documentRevision,
  }),
  z.strictObject({
    ...baseShape,
    type: z.literal("repair"),
    repairKind: z.enum(["upload", "outbox", "processing", "vector"]),
    requestedDocumentRevision: documentRevision.optional(),
  }),
  z.strictObject({ ...baseShape, type: z.literal("purge"), tombstoneRevision: documentRevision }),
]);

export type QueueMessageHandler<T extends PhotoQueueMessage["type"]> = (
  message: Extract<PhotoQueueMessage, { type: T }>,
) => Promise<void>;

export interface QueueMessageHandlers {
  enrich: QueueMessageHandler<"enrich">;
  reindex: QueueMessageHandler<"reindex">;
  repair: QueueMessageHandler<"repair">;
  purge: QueueMessageHandler<"purge">;
}

export async function dispatchQueueMessage(
  message: PhotoQueueMessage,
  handlers: QueueMessageHandlers,
): Promise<void> {
  switch (message.type) {
    case "enrich":
      return handlers.enrich(message);
    case "reindex":
      return handlers.reindex(message);
    case "repair":
      return handlers.repair(message);
    case "purge":
      return handlers.purge(message);
  }
}
