/**
 * Password wall for the deployed demo, with a fixed-cookie bypass so agents and
 * CI can skip the prompt. `handleAuthGate` returns `null` for "pass through",
 * so it composes as a wrapper around the real router.
 *
 * The env shape is declared locally rather than imported from the
 * wrangler-generated `Env` so the module stays unit-testable without bindings.
 */
export interface AuthGateEnv {
  APP_ENV?: string;
  AUTH_PASSWORD?: string;
  AUTH_PASS_COOKIE?: string;
}

/** Non-secret. Only the cookie *value* comes from `AUTH_PASS_COOKIE`. */
export const AUTH_COOKIE_NAME = "vid_demo_pass";

export const AUTH_GATE_PATH = "/__auth";

const COOKIE_MAX_AGE_SECONDS = 31_536_000;
const MAXIMUM_SUBMISSION_BYTES = 4_096;

/** RFC 6265 cookie-octet: everything except CTLs, whitespace, `"`, `,`, `;`, `\`. */
const COOKIE_VALUE_PATTERN = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]+$/;

/** CR and LF (header injection) plus every other C0/DEL control character. */
const CONTROL_CHARACTER_PATTERN = /[\x00-\x1F\x7F]/;

type AuthGateConfig =
  | { state: "active"; password: string; cookieValue: string }
  | { state: "inert" }
  | { state: "unconfigured" }
  | { state: "misconfigured" };

export async function handleAuthGate(request: Request, env: AuthGateEnv): Promise<Response | null> {
  const config = resolveAuthGateConfig(env);
  if (config.state === "inert") return null;
  if (config.state === "unconfigured") {
    return configurationError(
      "auth_gate_unconfigured",
      "The demo access gate is not configured, so this deployment refuses to serve ungated.",
    );
  }
  if (config.state === "misconfigured") {
    return configurationError(
      "auth_gate_misconfigured",
      "The demo access gate is only half configured. Both gate secrets must be present.",
    );
  }

  const url = new URL(request.url);
  const authenticated = hasAuthCookie(request.headers.get("cookie"), config.cookieValue);

  if (url.pathname === AUTH_GATE_PATH) {
    if (request.method === "POST") {
      const submission = await readSubmission(request);
      if (await passwordMatches(submission.password, config.password)) {
        return grantAccess(validateNext(submission.next), config.cookieValue);
      }
      // Re-render carrying the raw submitted `next`; validation happens at the
      // redirect sink, so a hostile value never reaches a `Location` header.
      return loginChallenge(submission.next, true);
    }
    const requestedNext = url.searchParams.get("next") ?? "/";
    if (authenticated) return redirectTo(validateNext(requestedNext));
    return loginChallenge(requestedNext, false);
  }

  if (authenticated) return null;
  return loginChallenge(`${url.pathname}${url.search}`, false);
}

/**
 * Rejects anything that could leave the origin, forge a header, or smuggle a
 * control character. Every check runs on the *decoded* value, because that is
 * what a browser ultimately resolves.
 */
export function validateNext(raw: string | null | undefined): string {
  if (!raw) return "/";
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return "/";
  }
  if (!decoded.startsWith("/")) return "/";
  if (decoded.startsWith("//") || decoded.startsWith("/\\")) return "/";
  if (CONTROL_CHARACTER_PATTERN.test(decoded)) return "/";
  return decoded;
}

/**
 * Both secrets absent leaves the gate inert so credential-free CI stays green —
 * except in production, where serving ungated is never acceptable. Exactly one
 * secret is a half-finished setup: an empty cookie value cannot establish a
 * usable session and would make a bare `name=` cookie meaningful.
 */
function resolveAuthGateConfig(env: AuthGateEnv): AuthGateConfig {
  const password = typeof env.AUTH_PASSWORD === "string" ? env.AUTH_PASSWORD : "";
  const cookieValue = typeof env.AUTH_PASS_COOKIE === "string" ? env.AUTH_PASS_COOKIE : "";

  if (password.length === 0 && cookieValue.length === 0) {
    return env.APP_ENV === "production" ? { state: "unconfigured" } : { state: "inert" };
  }
  if (password.length === 0 || cookieValue.length === 0) return { state: "misconfigured" };
  if (!COOKIE_VALUE_PATTERN.test(cookieValue)) return { state: "misconfigured" };
  return { state: "active", password, cookieValue };
}

/**
 * Exact match on both name and value. Substring matching would accept a
 * superset value or a prefix-sharing cookie name, so entries are split on the
 * first `=` only (values may legitimately contain `=`).
 */
function hasAuthCookie(header: string | null, expected: string): boolean {
  if (!header) return false;
  for (const entry of header.split(";")) {
    const trimmed = entry.trim();
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    if (trimmed.slice(0, separator) !== AUTH_COOKIE_NAME) continue;
    if (trimmed.slice(separator + 1) === expected) return true;
  }
  return false;
}

/**
 * The login form posts `application/x-www-form-urlencoded`, so the body is
 * parsed directly rather than through `formData()` — that keeps the size guard
 * meaningful, since a streamed request carries no `content-length` to check.
 * Anything of another media type, unreadable, oversized, or otherwise malformed
 * degrades to an empty submission, which the password compare then rejects.
 */
async function readSubmission(request: Request): Promise<{ password: string; next: string }> {
  const empty = { password: "", next: "" };
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/x-www-form-urlencoded") return empty;
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_SUBMISSION_BYTES) return empty;
  let body: ArrayBuffer;
  try {
    body = await request.arrayBuffer();
  } catch {
    return empty;
  }
  if (body.byteLength > MAXIMUM_SUBMISSION_BYTES) return empty;
  const fields = new URLSearchParams(new TextDecoder().decode(body));
  return { password: fields.get("password") ?? "", next: fields.get("next") ?? "" };
}

/** Mirrors `authorizedOperatorRequest` in `router.ts` — digest, then compare in constant time. */
async function passwordMatches(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return provided.length > 0 && crypto.subtle.timingSafeEqual(providedHash, expectedHash);
}

function grantAccess(next: string, cookieValue: string): Response {
  const headers = gateHeaders();
  headers.set("location", locationValue(next));
  headers.append(
    "set-cookie",
    `${AUTH_COOKIE_NAME}=${cookieValue}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
  );
  return new Response(null, { status: 302, headers });
}

function redirectTo(next: string): Response {
  const headers = gateHeaders();
  headers.set("location", locationValue(next));
  return new Response(null, { status: 302, headers });
}

/**
 * `validateNext` returns a *decoded* path, but a header value is a byte string:
 * workerd warns that a non-ASCII `Location` would raise a TypeError in a real
 * browser, so the validated path is re-encoded on its way into the header.
 */
function locationValue(next: string): string {
  try {
    return encodeURI(next);
  } catch {
    return "/";
  }
}

function loginChallenge(next: string, rejected: boolean): Response {
  const headers = gateHeaders();
  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(renderLoginPage(next, rejected), { status: 401, headers });
}

function configurationError(code: string, message: string): Response {
  const headers = gateHeaders();
  headers.set("content-type", "text/plain; charset=utf-8");
  return new Response(`${code}: ${message}\n`, { status: 503, headers });
}

/** `Vary: Cookie` is what stops an edge cache handing an authenticated page to a stranger. */
function gateHeaders(): Headers {
  return new Headers({
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow",
    vary: "Cookie",
  });
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Self-contained document: inline styles only, zero JavaScript, no external
 * requests. It cannot link the built CSS bundle — `dist/assets/styles-<hash>.css`
 * is hash-versioned per build, so a hardcoded `<link>` would rot silently.
 */
function renderLoginPage(next: string, rejected: boolean): string {
  const notice = rejected
    ? `<p class="notice" role="alert">Incorrect password. Please try again.</p>`
    : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Password required</title>
    <style>
      :root {
        color-scheme: light dark;
        --surface: #ffffff;
        --ink: #1b1f24;
        --muted: #5b6570;
        --line: #d8dee6;
        --accent: #2f5bd7;
        --danger: #b3261e;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --surface: #1c2027;
          --ink: #eef1f5;
          --muted: #a6b0bb;
          --line: #333b45;
          --accent: #7ea2ff;
          --danger: #ff8a80;
        }
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        background: var(--surface);
        color: var(--ink);
        font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      main {
        width: 100%;
        max-width: 22rem;
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 28px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 1.25rem;
      }
      p {
        margin: 0 0 16px;
        color: var(--muted);
      }
      .notice {
        color: var(--danger);
      }
      label {
        display: block;
        margin-bottom: 6px;
        font-size: 0.875rem;
      }
      input {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: transparent;
        color: inherit;
        font: inherit;
      }
      button {
        width: 100%;
        margin-top: 16px;
        padding: 10px 12px;
        border: 0;
        border-radius: 8px;
        background: var(--accent);
        color: #ffffff;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Password required</h1>
      <p>This demo is private. Enter the access password to continue.</p>
      ${notice}
      <form method="post" action="${AUTH_GATE_PATH}">
        <input type="hidden" name="next" value="${htmlEscape(next)}" />
        <label for="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autocomplete="current-password"
          required
          autofocus
        />
        <button type="submit">Enter</button>
      </form>
    </main>
  </body>
</html>
`;
}
