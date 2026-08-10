import { MODEL_CONFIG } from "./config";
import type { ReadinessCheck, ReadinessResponse } from "./contracts/api";
import type { PlatformProviders } from "./providers";

const EXPECTED_MIGRATION = "0001_public_photo_library.sql";

function check(name: ReadinessCheck["name"], passed: boolean, detail: string): ReadinessCheck {
  return { name, status: passed ? "pass" : "fail", detail };
}

function deferred(name: ReadinessCheck["name"], detail: string): ReadinessCheck {
  return { name, status: "deferred", detail };
}

export function configurationReadiness(providers: PlatformProviders): ReadinessResponse {
  const settings = providers.operator.settings();
  const acknowledgements =
    settings.acknowledgeAnonymousPublicWrites &&
    settings.acknowledgeRetainedImageMetadata &&
    settings.acknowledgeReactivePurgeOnlyModeration;
  const checks: ReadinessCheck[] = [
    check(
      "configuration",
      settings.environment !== "production" || !settings.publicWritesEnabled || acknowledgements,
      "Pinned model and write-safety configuration is internally consistent.",
    ),
    deferred("d1", "Use authenticated operator readiness to verify the D1 binding."),
    deferred("r2", "Use authenticated operator readiness to verify the private R2 binding."),
    deferred("queue", "Use authenticated operator readiness to verify Queue metrics."),
    deferred("dlq", "Use authenticated operator readiness to verify DLQ metrics."),
    deferred("workers_ai", "Workers AI binding shape is checked during authenticated preflight."),
    deferred("vectorize", "Use authenticated operator readiness to verify index configuration."),
    deferred(
      "rate_limit",
      "Use authenticated operator readiness to exercise the rate-limit binding.",
    ),
    deferred("migrations", "Use authenticated operator readiness to verify applied migrations."),
    check(
      "operator_acknowledgements",
      !settings.publicWritesEnabled || acknowledgements,
      settings.publicWritesEnabled
        ? "Anonymous public writes, retained original image metadata, and reactive-purge-only moderation are explicitly acknowledged."
        : "Public writes are disabled; anonymous writes, retained original image metadata, and reactive-purge-only moderation are not yet acknowledged.",
    ),
    check(
      "auth_gate",
      settings.environment !== "production" ||
        !settings.publicWritesEnabled ||
        settings.authGateConfigured,
      // Deliberately invariant: this endpoint is unauthenticated, so `status` is
      // the only thing the check may disclose. A detail that named the absent
      // secret would hand an anonymous caller a checklist for the password wall.
      "Demo access-gate configuration is consistent with this deployment's environment and write posture.",
    ),
  ];

  return response(settings.environment, settings.publicWritesEnabled, checks);
}

export async function deepReadiness(providers: PlatformProviders): Promise<ReadinessResponse> {
  const settings = providers.operator.settings();
  const checks: ReadinessCheck[] = [];
  const acknowledgements =
    settings.acknowledgeAnonymousPublicWrites &&
    settings.acknowledgeRetainedImageMetadata &&
    settings.acknowledgeReactivePurgeOnlyModeration;

  checks.push(
    check(
      "configuration",
      settings.environment === "production",
      settings.environment === "production"
        ? "Production configuration selected."
        : "Authenticated deployment gate must target the production environment.",
    ),
  );

  await appendAsyncCheck(checks, "d1", async () => {
    const result = await providers.database.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return result?.ok === 1 ? "D1 query succeeded." : null;
  });

  await appendAsyncCheck(checks, "migrations", async () => {
    const migration = await providers.database
      .prepare("SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1")
      .first<{ name: string }>();
    if (migration?.name !== EXPECTED_MIGRATION) return null;

    const metadata = await providers.database
      .prepare(
        "SELECT key, value FROM app_metadata WHERE key IN ('schema_version', 'vision_model_id', 'embedding_model_id', 'vector_dimensions', 'vector_metric')",
      )
      .all<{ key: string; value: string }>();
    const values = Object.fromEntries(metadata.results.map(({ key, value }) => [key, value]));
    const matches =
      values.schema_version === "1" &&
      values.vision_model_id === MODEL_CONFIG.vision &&
      values.embedding_model_id === MODEL_CONFIG.embedding &&
      values.vector_dimensions === String(MODEL_CONFIG.vectorDimensions) &&
      values.vector_metric === MODEL_CONFIG.vectorMetric;
    return matches
      ? `Migration ${EXPECTED_MIGRATION} and pinned model metadata are applied.`
      : null;
  });

  await appendAsyncCheck(checks, "r2", async () => {
    await providers.photos.head("__readiness__/binding-check-does-not-exist");
    return "Private R2 binding responded.";
  });
  await appendAsyncCheck(checks, "queue", async () => {
    await providers.queue.metrics();
    return "Queue binding responded.";
  });
  await appendAsyncCheck(checks, "dlq", async () => {
    await providers.deadLetterQueue.metrics();
    return "DLQ binding responded.";
  });

  checks.push(
    check(
      "workers_ai",
      typeof providers.ai?.run === "function",
      "Workers AI binding exposes inference without performing a billable readiness inference.",
    ),
  );

  await appendAsyncCheck(checks, "vectorize", async () => {
    const description = await providers.vectorize.describe();
    return "dimensions" in description.config &&
      description.config.dimensions === MODEL_CONFIG.vectorDimensions &&
      description.config.metric === MODEL_CONFIG.vectorMetric
      ? `Vectorize reports ${MODEL_CONFIG.vectorDimensions} dimensions with cosine distance.`
      : null;
  });
  await appendAsyncCheck(checks, "rate_limit", async () => {
    await providers.rateLimit.limit({ key: `operator-readiness:${crypto.randomUUID()}` });
    return "Rate-limit binding responded.";
  });

  checks.push(
    check(
      "operator_acknowledgements",
      settings.publicWritesEnabled && acknowledgements,
      settings.publicWritesEnabled && acknowledgements
        ? "Public writes plus anonymous-write, retained-metadata, and reactive-purge-only acknowledgements are explicit."
        : "Production release requires public writes plus explicit anonymous-write, retained-metadata, and reactive-purge-only acknowledgements.",
    ),
  );

  // Operator-authenticated, so this one may name the bindings an operator has to
  // set. It still reports configuration presence only — never a secret value.
  checks.push(
    check(
      "auth_gate",
      settings.publicWritesEnabled && settings.authGateConfigured,
      settings.publicWritesEnabled && settings.authGateConfigured
        ? "Public writes are live behind a fully configured demo access gate."
        : "Production release requires public writes plus a fully configured demo access gate (AUTH_PASSWORD and AUTH_PASS_COOKIE).",
    ),
  );

  return response(settings.environment, settings.publicWritesEnabled, checks);
}

async function appendAsyncCheck(
  checks: ReadinessCheck[],
  name: ReadinessCheck["name"],
  verify: () => Promise<string | null>,
): Promise<void> {
  try {
    const detail = await verify();
    checks.push(
      check(name, detail !== null, detail ?? `${name} returned unexpected configuration.`),
    );
  } catch {
    checks.push(check(name, false, `${name} binding check failed.`));
  }
}

function response(
  environment: ReadinessResponse["environment"],
  publicWritesEnabled: boolean,
  checks: ReadinessCheck[],
): ReadinessResponse {
  return {
    version: "v1",
    status: checks.every(({ status }) => status !== "fail") ? "ready" : "not_ready",
    environment,
    publicWritesEnabled,
    models: {
      vision: MODEL_CONFIG.vision,
      embedding: MODEL_CONFIG.embedding,
      vectorDimensions: MODEL_CONFIG.vectorDimensions,
      vectorMetric: MODEL_CONFIG.vectorMetric,
    },
    checks,
  };
}
