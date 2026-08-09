import { describe, expect, it } from "vitest";

import { retryBackoffMilliseconds } from "./repair";

describe("maintenance retry policy", () => {
  it("uses bounded exponential backoff", () => {
    expect(retryBackoffMilliseconds(1)).toBe(30_000);
    expect(retryBackoffMilliseconds(2)).toBe(60_000);
    expect(retryBackoffMilliseconds(8)).toBe(3_600_000);
    expect(retryBackoffMilliseconds(100)).toBe(3_600_000);
  });
});
