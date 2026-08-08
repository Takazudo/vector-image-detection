import { describe, expect, it } from "vitest";
import { toQdrantPointId } from "./qdrant-point-id.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("toQdrantPointId", () => {
  it("produces a syntactically valid UUID string", () => {
    expect(toQdrantPointId("cat-1.jpg")).toMatch(UUID_RE);
    expect(toQdrantPointId("")).toMatch(UUID_RE);
    expect(toQdrantPointId("a very long id with spaces and symbols !@#$%")).toMatch(UUID_RE);
  });

  it("is deterministic — same id always maps to the same point id", () => {
    expect(toQdrantPointId("cat-1.jpg")).toBe(toQdrantPointId("cat-1.jpg"));
  });

  it("maps distinct ids to distinct point ids", () => {
    const ids = ["cat-1.jpg", "cat-2.jpg", "dog-1.jpg", "a", "b", "c"];
    const mapped = new Set(ids.map(toQdrantPointId));
    expect(mapped.size).toBe(ids.length);
  });
});
