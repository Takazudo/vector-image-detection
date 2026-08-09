import { bulkHumanTagMutationSchema } from "../../validation";
import { apiError, defineApiRoute, json, type ApiRequestContext } from "../../router";
import { mutateHumanTag, TagMutationQuotaError } from "./mutation";
import { TagWordValidationError } from "./normalization";

const MAXIMUM_JSON_BODY_BYTES = 16 * 1024;

export const humanTagRoutes = [
  defineApiRoute("POST", "/api/v1/human-tags/bulk", handleBulkMutation),
] as const;

async function handleBulkMutation(request: Request, context: ApiRequestContext): Promise<Response> {
  const requestId = context.providers.ids.generate();
  const settings = context.providers.operator.settings();
  if (!settings.publicWritesEnabled) {
    return apiError(requestId, 403, "public_writes_disabled", "Public writes are disabled.");
  }
  if (!isSameOriginRequest(request)) {
    return apiError(requestId, 403, "cross_origin_write", "A same-origin request is required.");
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAXIMUM_JSON_BODY_BYTES) {
    return apiError(requestId, 413, "request_too_large", "The request body is too large.");
  }
  const subject = request.headers.get("cf-connecting-ip")?.trim() || "unknown-client";
  const rateLimit = await context.providers.rateLimit.limit({ key: `human-tag:${subject}` });
  if (!rateLimit.success) {
    return apiError(requestId, 429, "rate_limited", "Too many human-tag requests.", true);
  }

  let input: unknown;
  try {
    input = await readBoundedJson(request);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return apiError(requestId, 413, "request_too_large", "The request body is too large.");
    }
    return apiError(requestId, 400, "invalid_json", "The request body must be valid JSON.");
  }
  const parsed = bulkHumanTagMutationSchema.safeParse(input);
  if (!parsed.success || parsed.data.humanTagNames.length !== 1) {
    return apiError(
      requestId,
      400,
      "invalid_human_tag_mutation",
      "Provide exactly one valid human tag and a bounded set of unique photo IDs.",
    );
  }

  try {
    const quotaSubject = await privateQuotaSubject(subject);
    const response = await mutateHumanTag(
      parsed.data,
      {
        quotaSubject,
        background: (promise) => context.execution.waitUntil(promise),
      },
      context.providers,
    );
    return json(response);
  } catch (error) {
    if (error instanceof TagMutationQuotaError) {
      return apiError(requestId, 429, "tag_mutation_quota_exceeded", error.message, true);
    }
    if (error instanceof TagWordValidationError || error instanceof RangeError) {
      return apiError(requestId, 400, "invalid_human_tag_mutation", error.message);
    }
    throw error;
  }
}

async function privateQuotaSubject(subject: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(subject));
  return `client-${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

class RequestBodyTooLargeError extends Error {}

async function readBoundedJson(request: Request): Promise<unknown> {
  if (request.body === null) throw new SyntaxError("Missing JSON body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAXIMUM_JSON_BODY_BYTES) {
      await reader.cancel();
      throw new RequestBodyTooLargeError();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body));
}

function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return (
    origin === new URL(request.url).origin && (fetchSite === null || fetchSite === "same-origin")
  );
}
