import type { ApiErrorResponse, HealthResponse, OperatorPurgeResponse } from "./contracts/api";
import { requestOperatorPurge } from "./features/maintenance/purge";
import { createPlatformProviders, type PlatformProviders } from "./providers";
import { configurationReadiness, deepReadiness } from "./readiness";

export interface ApiRequestContext {
  env: Env;
  execution: ExecutionContext;
  providers: PlatformProviders;
  params: Readonly<Record<string, string>>;
}

export type ApiRouteHandler = (
  request: Request,
  context: ApiRequestContext,
) => Response | Promise<Response>;

export interface ApiRoute {
  method: "GET" | "POST" | "PUT" | "DELETE";
  pattern: URLPattern;
  handle: ApiRouteHandler;
}

export function defineApiRoute(
  method: ApiRoute["method"],
  pathname: string,
  handle: ApiRouteHandler,
): ApiRoute {
  return { method, pattern: new URLPattern({ pathname }), handle };
}

export async function routeRequest(
  request: Request,
  env: Env,
  execution: ExecutionContext,
  featureRoutes: readonly ApiRoute[],
): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

  const providers = createPlatformProviders(env);
  if (request.method === "GET" && url.pathname === "/api/v1/health") {
    const body: HealthResponse = {
      version: "v1",
      status: "ok",
      service: "vector-image-detection-demo",
      now: providers.clock.now().toISOString(),
    };
    return json(body);
  }
  if (request.method === "GET" && url.pathname === "/api/v1/readiness") {
    const body = configurationReadiness(providers);
    return json(body, body.status === "ready" ? 200 : 503);
  }
  if (request.method === "GET" && url.pathname === "/api/v1/operator/readiness") {
    if (!(await authorizedOperatorRequest(request, env.OPERATOR_PREFLIGHT_TOKEN))) {
      return apiError(
        providers.ids.generate(),
        401,
        "unauthorized",
        "Operator authorization required.",
      );
    }
    const body = await deepReadiness(providers);
    return json(body, body.status === "ready" ? 200 : 503);
  }
  const purgeMatch = new URLPattern({ pathname: "/api/v1/operator/photos/:photoId/purge" }).exec(
    request.url,
  );
  if (request.method === "POST" && purgeMatch) {
    if (!(await authorizedOperatorRequest(request, env.OPERATOR_PREFLIGHT_TOKEN))) {
      return apiError(
        providers.ids.generate(),
        401,
        "unauthorized",
        "Operator authorization required.",
      );
    }
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
    if (contentType !== "application/json") {
      return apiError(
        providers.ids.generate(),
        415,
        "unsupported_media_type",
        "Operator purge requires application/json.",
      );
    }
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > 4_096) {
      return apiError(
        providers.ids.generate(),
        413,
        "body_too_large",
        "Request body is too large.",
      );
    }
    let payload: unknown;
    try {
      const body = await request.text();
      if (new TextEncoder().encode(body).byteLength > 4_096) {
        return apiError(
          providers.ids.generate(),
          413,
          "body_too_large",
          "Request body is too large.",
        );
      }
      payload = JSON.parse(body);
    } catch {
      return apiError(providers.ids.generate(), 400, "invalid_json", "Request body is invalid.");
    }
    const reason =
      typeof payload === "object" &&
      payload !== null &&
      "reason" in payload &&
      typeof payload.reason === "string"
        ? payload.reason.trim()
        : "";
    if (reason.length < 1 || reason.length > 1_000) {
      return apiError(
        providers.ids.generate(),
        400,
        "invalid_reason",
        "Purge reason must contain 1 to 1000 characters.",
      );
    }
    const photoId = purgeMatch.pathname.groups.photoId;
    if (!photoId) {
      return apiError(providers.ids.generate(), 404, "not_found", "Photo not found.");
    }
    try {
      const message = await requestOperatorPurge(providers, photoId, "operator-api", reason);
      const response: OperatorPurgeResponse = {
        version: "v1",
        operationId: message.operationId,
        photoId: message.photoId,
        tombstoneRevision: message.tombstoneRevision,
        state: "pending",
      };
      return json(response, 202);
    } catch (error) {
      if (error instanceof Error && error.message === "Photo not found or already tombstoned.") {
        return apiError(
          providers.ids.generate(),
          404,
          "not_found",
          "Photo not found or already scheduled for purge.",
        );
      }
      throw error;
    }
  }

  for (const route of featureRoutes) {
    if (request.method !== route.method) continue;
    const match = route.pattern.exec(request.url);
    if (!match) continue;
    return route.handle(request, {
      env,
      execution,
      providers,
      params: stringParams(match.pathname.groups),
    });
  }

  return apiError(providers.ids.generate(), 404, "not_found", "API route not found.");
}

export function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

export function apiError(
  requestId: string,
  status: number,
  code: string,
  message: string,
  retryable = false,
): Response {
  const body: ApiErrorResponse = {
    version: "v1",
    error: { code, message, requestId, retryable },
  };
  return json(body, status);
}

async function authorizedOperatorRequest(
  request: Request,
  expected: string | undefined,
): Promise<boolean> {
  const authorization = request.headers.get("authorization");
  const provided = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected ?? "")),
  ]);
  return (
    provided.length > 0 &&
    expected !== undefined &&
    crypto.subtle.timingSafeEqual(providedHash, expectedHash)
  );
}

function stringParams(
  groups: Record<string, string | undefined>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(groups).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}
