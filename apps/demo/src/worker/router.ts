import type { ApiErrorResponse, HealthResponse } from "./contracts/api";
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
