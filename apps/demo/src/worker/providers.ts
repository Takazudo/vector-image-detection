import { readRuntimeSettings, type RuntimeSettings } from "./config";
import type { PhotoQueueMessage } from "./contracts/queue";

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  generate(): string;
}

export interface OperatorControls {
  settings(): RuntimeSettings;
}

export interface MessageQueue<T> {
  send(message: T, options?: QueueSendOptions): Promise<QueueSendResponse>;
  metrics(): Promise<QueueMetrics>;
}

export interface PlatformProviders {
  assets: Fetcher;
  database: D1Database;
  photos: R2Bucket;
  queue: MessageQueue<PhotoQueueMessage>;
  deadLetterQueue: MessageQueue<PhotoQueueMessage>;
  ai: Ai;
  vectorize: Vectorize;
  rateLimit: RateLimit;
  clock: Clock;
  ids: IdGenerator;
  operator: OperatorControls;
}

export function createPlatformProviders(env: Env): PlatformProviders {
  return {
    assets: env.ASSETS,
    database: env.DB,
    photos: env.PHOTOS,
    queue: {
      send: (message, options) => env.PHOTO_QUEUE.send(message, options),
      metrics: () => env.PHOTO_QUEUE.metrics(),
    },
    deadLetterQueue: {
      send: (message, options) => env.PHOTO_DLQ.send(message, options),
      metrics: () => env.PHOTO_DLQ.metrics(),
    },
    ai: env.AI,
    // env.PHOTO_VECTORS is typed VectorizeIndex (V1) because wrangler@4.120.0
    // hardcodes that type string at both of its type-generation call sites in
    // wrangler-dist/cli.js — there is no config knob to make `wrangler types`
    // emit V2. The real binding answers the V2 (`Vectorize`) shape, so this
    // cast is the single place that lie is contained; everything downstream
    // sees the honest type.
    vectorize: env.PHOTO_VECTORS as unknown as Vectorize,
    rateLimit: env.WRITE_RATE_LIMIT,
    clock: { now: () => new Date() },
    ids: { generate: () => crypto.randomUUID() },
    operator: { settings: () => readRuntimeSettings(env) },
  };
}
