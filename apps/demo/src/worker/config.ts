import { isAuthGateConfigured } from "./auth-gate";

export const MODEL_CONFIG = {
  vision: "@cf/moondream/moondream3.1-9B-A2B",
  embedding: "@cf/google/embeddinggemma-300m",
  vectorDimensions: 768,
  vectorMetric: "cosine",
  documentVersion: 1,
  queuePayloadVersion: 1,
} as const;

export const VALIDATION_LIMITS = {
  supportedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  maximumUploadBytes: 5 * 1024 * 1024,
  minimumImageDimension: 32,
  maximumImageDimension: 12_000,
  maximumImagePixels: 40_000_000,
  maximumTagLength: 64,
  maximumTagsPerPhoto: 32,
  maximumBulkPhotoCount: 50,
  maximumPageSize: 100,
  defaultPageSize: 24,
  maximumQueryLength: 256,
  maximumAiCaptionLength: 4_096,
  maximumAiOutputBytes: 16 * 1024,
  maximumAiWordCount: 64,
  maximumAiWordLength: 64,
  dailyUploadQuota: 500,
  dailyTagMutationQuota: 250,
  globalStoredPhotoQuota: 10_000,
  processingLeaseSeconds: 5 * 60,
  uploadOperationExpirySeconds: 15 * 60,
  failedUploadRetentionSeconds: 24 * 60 * 60,
  tombstoneRetentionSeconds: 30 * 24 * 60 * 60,
  maximumQueueAttempts: 8,
} as const;

export type RuntimeEnvironment = "local" | "ci" | "production";

export interface RuntimeSettings {
  environment: RuntimeEnvironment;
  publicWritesEnabled: boolean;
  acknowledgeAnonymousPublicWrites: boolean;
  acknowledgeRetainedImageMetadata: boolean;
  acknowledgeReactivePurgeOnlyModeration: boolean;
  /** Derived, never the values: readiness may only ever observe pass/fail here. */
  authGateConfigured: boolean;
}

export function readRuntimeSettings(env: Env): RuntimeSettings {
  return {
    environment: parseRuntimeEnvironment(env.APP_ENV),
    publicWritesEnabled: isTrue(env.PUBLIC_WRITES_ENABLED),
    acknowledgeAnonymousPublicWrites: isTrue(env.ACK_ANONYMOUS_PUBLIC_WRITES),
    acknowledgeRetainedImageMetadata: isTrue(env.ACK_RETAINED_IMAGE_METADATA),
    acknowledgeReactivePurgeOnlyModeration: isTrue(env.ACK_REACTIVE_PURGE_ONLY),
    authGateConfigured: isAuthGateConfigured(env),
  };
}

function isTrue(value: string): boolean {
  return value === "true";
}

function parseRuntimeEnvironment(value: string): RuntimeEnvironment {
  return value === "ci" || value === "production" ? value : "local";
}
