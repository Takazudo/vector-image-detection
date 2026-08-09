#!/usr/bin/env node

export function readPurgeInput(environment) {
  const baseUrl = environment.DEMO_PURGE_URL;
  const token = environment.DEMO_PURGE_TOKEN;
  const photoId = environment.DEMO_PURGE_PHOTO_ID?.trim();
  const reason = environment.DEMO_PURGE_REASON?.trim();
  if (!baseUrl || !token || !photoId || !reason) {
    throw new Error(
      "DEMO_PURGE_URL, DEMO_PURGE_TOKEN, DEMO_PURGE_PHOTO_ID, and DEMO_PURGE_REASON are required.",
    );
  }
  const parsedUrl = new URL(baseUrl);
  if (parsedUrl.protocol !== "https:") throw new Error("DEMO_PURGE_URL must use HTTPS.");
  if (photoId.length > 47) throw new Error("DEMO_PURGE_PHOTO_ID is invalid.");
  if (reason.length > 1_000) throw new Error("DEMO_PURGE_REASON is too long.");
  return { baseUrl: parsedUrl, token, photoId, reason };
}

export async function demoPurge({
  environment = process.env,
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  const { baseUrl, token, photoId, reason } = readPurgeInput(environment);
  const endpoint = new URL(`/api/v1/operator/photos/${encodeURIComponent(photoId)}/purge`, baseUrl);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ reason }),
  });
  if (!response.ok) {
    throw new Error(`Operator purge request failed (${response.status}).`);
  }
  const result = await response.json();
  if (
    result?.version !== "v1" ||
    result?.photoId !== photoId ||
    result?.state !== "pending" ||
    typeof result?.operationId !== "string"
  ) {
    throw new Error("Operator purge returned an unexpected response.");
  }
  log(`Operator purge accepted for ${photoId}; operation ${result.operationId}.`);
  return result;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  demoPurge().catch((error) => {
    console.error(`Cloudflare demo purge failed: ${error.message}`);
    process.exitCode = 1;
  });
}
