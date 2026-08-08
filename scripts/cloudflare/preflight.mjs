#!/usr/bin/env node

const API_BASE = "https://api.cloudflare.com/client/v4";
export const ZONE_NAME = "takazudomodular.com";
export const SITES = [
  {
    hostname: "doc-vector-image-detection.takazudomodular.com",
    service: "doc-vector-image-detection",
  },
  {
    hostname: "vector-image-detection.takazudomodular.com",
    service: "vector-image-detection-demo",
  },
];

function requiredEnvironment(environment) {
  const accountId = environment.CLOUDFLARE_ACCOUNT_ID;
  const token = environment.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required for the authenticated preflight.",
    );
  }
  return { accountId, token };
}

async function apiGet(fetchImpl, token, path, label) {
  const response = await fetchImpl(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`${label} request failed (${response.status}).`);
  }

  const payload = await response.json();
  if (!payload.success) {
    throw new Error(`${label} request was rejected by Cloudflare.`);
  }
  return payload.result ?? [];
}

function routeMatchesHostname(pattern, hostname) {
  const routeHostname = pattern
    .replace(/^https?:\/\//, "")
    .split("/", 1)[0]
    .toLowerCase();
  const expression = new RegExp(
    `^${routeHostname.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`,
  );
  return expression.test(hostname.toLowerCase());
}

export function inspectExistingConfiguration({
  zone,
  domains,
  dnsRecords,
  routes,
  site,
  accountId,
}) {
  if (zone.name !== ZONE_NAME || zone.status !== "active" || zone.account?.id !== accountId) {
    throw new Error(`The configured account does not own the active ${ZONE_NAME} zone.`);
  }

  const matchingDomains = domains.filter(
    (domain) => domain.hostname?.toLowerCase() === site.hostname,
  );
  if (matchingDomains.some((domain) => domain.service !== site.service)) {
    throw new Error(`${site.hostname} is already attached to another Worker custom domain.`);
  }

  const matchingRoutes = routes.filter((route) =>
    routeMatchesHostname(route.pattern ?? "", site.hostname),
  );
  if (matchingRoutes.some((route) => route.script !== site.service)) {
    throw new Error(`${site.hostname} is already attached to an unrelated Worker route.`);
  }

  const hostnameHasCustomDomain = matchingDomains.some((domain) => domain.service === site.service);
  const blockingRecord = dnsRecords.find((record) => ["A", "AAAA", "CNAME"].includes(record.type));
  if (blockingRecord && !hostnameHasCustomDomain) {
    throw new Error(
      `${site.hostname} already has an A, AAAA, or CNAME record and will not be claimed.`,
    );
  }
}

export async function preflight({ environment = process.env, fetchImpl = fetch } = {}) {
  const { accountId, token } = requiredEnvironment(environment);
  const zoneResults = await apiGet(
    fetchImpl,
    token,
    `/zones?name=${encodeURIComponent(ZONE_NAME)}&status=active&per_page=50`,
    "Zone lookup",
  );
  const zone = zoneResults.find(
    (candidate) => candidate.name === ZONE_NAME && candidate.account?.id === accountId,
  );
  if (!zone) {
    throw new Error(`The configured account does not own the active ${ZONE_NAME} zone.`);
  }

  const [domains, routes] = await Promise.all([
    apiGet(fetchImpl, token, `/accounts/${accountId}/workers/domains`, "Worker-domain lookup"),
    apiGet(fetchImpl, token, `/zones/${zone.id}/workers/routes`, "Worker-route lookup"),
  ]);

  for (const site of SITES) {
    const dnsRecords = await apiGet(
      fetchImpl,
      token,
      `/zones/${zone.id}/dns_records?name=${encodeURIComponent(site.hostname)}&per_page=100`,
      `DNS lookup for ${site.hostname}`,
    );
    inspectExistingConfiguration({ zone, domains, dnsRecords, routes, site, accountId });
    console.log(`Cloudflare preflight passed: ${site.hostname} -> ${site.service}`);
  }
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  preflight().catch((error) => {
    console.error(`Cloudflare preflight failed: ${error.message}`);
    process.exitCode = 1;
  });
}
