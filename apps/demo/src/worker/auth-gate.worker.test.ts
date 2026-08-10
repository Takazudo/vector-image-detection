import { describe, expect, it } from "vitest";

import { AUTH_COOKIE_NAME, type AuthGateEnv, handleAuthGate, validateNext } from "./auth-gate";

// Throwaway literals. The real AUTH_PASSWORD / AUTH_PASS_COOKIE values must
// never appear in this repository.
const PASSWORD = "test-password";
const COOKIE_VALUE = "test-cookie-token";

describe("auth gate configuration states", () => {
  it("stays inert outside production when both secrets are absent", async () => {
    for (const environment of ["local", "ci", undefined]) {
      const response = await handleAuthGate(get("/"), { APP_ENV: environment });
      expect(response).toBeNull();
    }
  });

  it("refuses to serve ungated in production when both secrets are absent", async () => {
    const response = await handleAuthGate(get("/"), { APP_ENV: "production" });
    expect(response?.status).toBe(503);
    await expect(response?.text()).resolves.toContain("auth_gate_unconfigured");
  });

  it("refuses in every environment when exactly one secret is present", async () => {
    for (const environment of ["local", "ci", "production"]) {
      const passwordOnly = await handleAuthGate(get("/"), {
        APP_ENV: environment,
        AUTH_PASSWORD: PASSWORD,
      });
      expect(passwordOnly?.status).toBe(503);
      await expect(passwordOnly?.text()).resolves.toContain("auth_gate_misconfigured");

      const cookieOnly = await handleAuthGate(get("/"), {
        APP_ENV: environment,
        AUTH_PASS_COOKIE: COOKIE_VALUE,
      });
      expect(cookieOnly?.status).toBe(503);
      await expect(cookieOnly?.text()).resolves.toContain("auth_gate_misconfigured");
    }
  });

  it("treats an empty secret as absent rather than as a usable session", async () => {
    const bothEmpty = await handleAuthGate(get("/"), {
      APP_ENV: "ci",
      AUTH_PASSWORD: "",
      AUTH_PASS_COOKIE: "",
    });
    expect(bothEmpty).toBeNull();

    const emptyCookie = await handleAuthGate(get("/"), {
      APP_ENV: "ci",
      AUTH_PASSWORD: PASSWORD,
      AUTH_PASS_COOKIE: "",
    });
    expect(emptyCookie?.status).toBe(503);
  });

  it("refuses a cookie value that cannot be safely serialised into Set-Cookie", async () => {
    const response = await handleAuthGate(get("/"), {
      ...activeEnv(),
      AUTH_PASS_COOKIE: "bad value; injected=1",
    });
    expect(response?.status).toBe(503);
    await expect(response?.text()).resolves.toContain("auth_gate_misconfigured");
  });

  it("challenges an unauthenticated request once both secrets are present", async () => {
    const response = await handleAuthGate(get("/"), activeEnv());
    expect(response?.status).toBe(401);
  });
});

describe("auth gate cookie matching", () => {
  it("passes through on an exact name and value match", async () => {
    const response = await handleAuthGate(
      get("/", { cookie: `${AUTH_COOKIE_NAME}=${COOKIE_VALUE}` }),
      activeEnv(),
    );
    expect(response).toBeNull();
  });

  it("tolerates surrounding cookies and whitespace", async () => {
    const response = await handleAuthGate(
      get("/", { cookie: `theme=dark; ${AUTH_COOKIE_NAME}=${COOKIE_VALUE} ; other=1` }),
      activeEnv(),
    );
    expect(response).toBeNull();
  });

  it("rejects a superset value and a prefix-sharing cookie name", async () => {
    const supersetValue = await handleAuthGate(
      get("/", { cookie: `${AUTH_COOKIE_NAME}=prefix-${COOKIE_VALUE}-suffix` }),
      activeEnv(),
    );
    expect(supersetValue?.status).toBe(401);

    const supersetName = await handleAuthGate(
      get("/", { cookie: `${AUTH_COOKIE_NAME}-extra=${COOKIE_VALUE}` }),
      activeEnv(),
    );
    expect(supersetName?.status).toBe(401);
  });

  it("splits each entry on the first equals sign only", async () => {
    const response = await handleAuthGate(get("/", { cookie: `${AUTH_COOKIE_NAME}=a=b` }), {
      ...activeEnv(),
      AUTH_PASS_COOKIE: "a=b",
    });
    expect(response).toBeNull();
  });

  it("rejects a missing cookie header and a valueless entry", async () => {
    expect((await handleAuthGate(get("/"), activeEnv()))?.status).toBe(401);
    expect(
      (await handleAuthGate(get("/", { cookie: AUTH_COOKIE_NAME }), activeEnv()))?.status,
    ).toBe(401);
  });
});

describe("validateNext", () => {
  it("rejects every escape from the origin", () => {
    expect(validateNext("https://attacker.test/steal")).toBe("/");
    expect(validateNext("//attacker.test/steal")).toBe("/");
    expect(validateNext("%2F%2Fattacker.test/steal")).toBe("/");
    expect(validateNext("/\\attacker.test")).toBe("/");
    expect(validateNext("%2F%5Cattacker.test")).toBe("/");
    expect(validateNext("javascript:alert(1)")).toBe("/");
    expect(validateNext("relative/path")).toBe("/");
  });

  it("rejects header injection and control characters", () => {
    expect(validateNext("/photos%0D%0ASet-Cookie:%20evil=1")).toBe("/");
    expect(validateNext("/photos\nSet-Cookie: evil=1")).toBe("/");
    expect(validateNext("/photos%00")).toBe("/");
    expect(validateNext("/photos%7F")).toBe("/");
  });

  it("falls back to the root for empty and undecodable input", () => {
    expect(validateNext("")).toBe("/");
    expect(validateNext(null)).toBe("/");
    expect(validateNext(undefined)).toBe("/");
    expect(validateNext("/photos%E0%A4%A")).toBe("/");
  });

  it("preserves a same-origin path with its query", () => {
    expect(validateNext("/photos?tag=cat&page=2")).toBe("/photos?tag=cat&page=2");
    expect(validateNext("%2Fphotos%3Ftag%3Dcat")).toBe("/photos?tag=cat");
    expect(validateNext("/")).toBe("/");
  });
});

describe("auth gate login page", () => {
  it("renders a self-contained zero-JavaScript form in place", async () => {
    const response = await handleAuthGate(get("/photos?tag=cat"), activeEnv());
    expect(response?.status).toBe(401);
    expect(response?.headers.get("content-type")).toContain("text/html");

    const html = await response?.text();
    expect(html).toContain(`method="post"`);
    expect(html).toContain(`action="/__auth"`);
    expect(html).toContain(`type="password"`);
    expect(html).toContain(`name="next" value="/photos?tag=cat"`);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<link");
  });

  it("escapes the next value before interpolating it", async () => {
    // A submitted `next` reaches the template verbatim, unlike a URL path,
    // which the Request constructor has already percent-encoded.
    const response = await handleAuthGate(
      submit("wrong-password", `/a"><img src=x>&b`),
      activeEnv(),
    );
    const html = await response?.text();
    expect(html).toContain("/a&quot;&gt;&lt;img src=x&gt;&amp;b");
    expect(html).not.toContain(`<img src=x>`);
  });

  it("never redirects an unauthenticated request to a login URL", async () => {
    const response = await handleAuthGate(get("/photos"), activeEnv());
    expect(response?.status).toBe(401);
    expect(response?.headers.get("location")).toBeNull();
  });
});

describe("auth gate submission", () => {
  it("issues the session cookie and redirects on the correct password", async () => {
    const response = await handleAuthGate(submit(PASSWORD, "/photos?tag=cat"), activeEnv());
    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toBe("/photos?tag=cat");

    const cookie = response?.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${AUTH_COOKIE_NAME}=${COOKIE_VALUE}`);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=31536000");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("neutralises a hostile next before it reaches the Location header", async () => {
    const response = await handleAuthGate(submit(PASSWORD, "//attacker.test/steal"), activeEnv());
    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toBe("/");
  });

  it("answers a wrong password with 401, the form, and no cookie", async () => {
    const response = await handleAuthGate(submit("wrong-password", "/photos"), activeEnv());
    expect(response?.status).toBe(401);
    expect(response?.headers.get("set-cookie")).toBeNull();

    const html = await response?.text();
    expect(html).toContain(`action="/__auth"`);
    expect(html).toContain(`name="next" value="/photos"`);
  });

  it("rejects an empty password even when the configured password is compared", async () => {
    const response = await handleAuthGate(submit("", "/"), activeEnv());
    expect(response?.status).toBe(401);
    expect(response?.headers.get("set-cookie")).toBeNull();
  });

  it("re-encodes a validated next so the Location header stays a byte string", async () => {
    const response = await handleAuthGate(submit(PASSWORD, "/写真?tag=猫"), activeEnv());
    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toBe("/%E5%86%99%E7%9C%9F?tag=%E7%8C%AB");
  });

  it("rejects a foreign media type, an unparseable body, and an oversized body", async () => {
    const foreignMediaType = await handleAuthGate(
      new Request("https://demo.test/__auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: PASSWORD }),
      }),
      activeEnv(),
    );
    expect(foreignMediaType?.status).toBe(401);
    expect(foreignMediaType?.headers.get("set-cookie")).toBeNull();

    const unparseable = await handleAuthGate(
      new Request("https://demo.test/__auth", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "%%%not-a-form%%%",
      }),
      activeEnv(),
    );
    expect(unparseable?.status).toBe(401);
    expect(unparseable?.headers.get("set-cookie")).toBeNull();

    const oversized = await handleAuthGate(submit(PASSWORD, `/${"x".repeat(5_000)}`), activeEnv());
    expect(oversized?.status).toBe(401);
    expect(oversized?.headers.get("set-cookie")).toBeNull();
  });

  it("challenges a GET of the auth path and bounces an authenticated one", async () => {
    const challenge = await handleAuthGate(get("/__auth?next=/photos"), activeEnv());
    expect(challenge?.status).toBe(401);
    expect(await challenge?.text()).toContain(`name="next" value="/photos"`);

    const bounce = await handleAuthGate(
      get("/__auth?next=/photos", { cookie: `${AUTH_COOKIE_NAME}=${COOKIE_VALUE}` }),
      activeEnv(),
    );
    expect(bounce?.status).toBe(302);
    expect(bounce?.headers.get("location")).toBe("/photos");
  });
});

describe("auth gate response headers", () => {
  it("sets the cache, indexing, and Vary headers on every intercepted response", async () => {
    const intercepted = [
      await handleAuthGate(get("/"), { APP_ENV: "production" }),
      await handleAuthGate(get("/"), { APP_ENV: "ci", AUTH_PASSWORD: PASSWORD }),
      await handleAuthGate(get("/photos"), activeEnv()),
      await handleAuthGate(submit("wrong-password", "/photos"), activeEnv()),
      await handleAuthGate(submit(PASSWORD, "/photos"), activeEnv()),
      await handleAuthGate(
        get("/__auth", { cookie: `${AUTH_COOKIE_NAME}=${COOKIE_VALUE}` }),
        activeEnv(),
      ),
    ];

    for (const response of intercepted) {
      expect(response).not.toBeNull();
      expect(response?.headers.get("cache-control")).toBe("no-store");
      expect(response?.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(response?.headers.get("vary")).toBe("Cookie");
    }
  });
});

function activeEnv(): AuthGateEnv {
  return { APP_ENV: "production", AUTH_PASSWORD: PASSWORD, AUTH_PASS_COOKIE: COOKIE_VALUE };
}

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://demo.test${path}`, { headers });
}

function submit(password: string, next: string): Request {
  return new Request("https://demo.test/__auth", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password, next }).toString(),
  });
}
