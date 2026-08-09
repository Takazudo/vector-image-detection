import { describe, expect, it } from "vitest";

import { detectImage, ImageValidationError, validateImageFile } from "./image";
import { photoRoutes, validateUploadRequestHeaders } from "./routes";
import { seedImportAction, stableSeedId } from "./seed";

describe("photo upload validation", () => {
  it("rejects disabled writes and cross-site requests before reading a body", () => {
    const sameOrigin = new Request("https://example.test/api/v1/photos", {
      method: "POST",
      headers: { origin: "https://example.test", "sec-fetch-site": "same-origin" },
    });
    expect(() => validateUploadRequestHeaders(sameOrigin, false)).toThrow(/disabled/i);
    const crossSite = new Request("https://example.test/api/v1/photos", {
      method: "POST",
      headers: { origin: "https://evil.test", "sec-fetch-site": "cross-site" },
    });
    expect(() => validateUploadRequestHeaders(crossSite, true)).toThrow(/same-origin/i);
  });

  it("recognizes PNG dimensions and rejects MIME spoofing", async () => {
    const bytes = pngHeader(32, 48);
    expect(detectImage(bytes)).toEqual({ mimeType: "image/png", width: 32, height: 48 });
    await expect(
      validateImageFile(new File([bytes], "fake.jpg", { type: "image/jpeg" })),
    ).rejects.toMatchObject({ code: "mime_spoof" } satisfies Partial<ImageValidationError>);
  });

  it("rejects dimension bombs from the header without decoding pixels", async () => {
    await expect(
      validateImageFile(new File([pngHeader(12_000, 12_000)], "bomb.png", { type: "image/png" })),
    ).rejects.toMatchObject({ code: "invalid_dimensions" } satisfies Partial<ImageValidationError>);
  });

  it("rejects oversized files before reading their bytes", async () => {
    const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", {
      type: "image/png",
    });
    await expect(validateImageFile(oversized)).rejects.toMatchObject({
      code: "invalid_size",
    } satisfies Partial<ImageValidationError>);
  });

  it("exports isolated upload, list, detail, status, and private media routes", () => {
    expect(photoRoutes.map((route) => `${route.method} ${route.pattern.pathname}`)).toEqual([
      "POST /api/v1/photos",
      "GET /api/v1/photos",
      "GET /api/v1/photos/:photoId",
      "GET /api/v1/uploads/:operationId",
      "GET /api/v1/photos/:photoId/media",
    ]);
  });

  it("uses deterministic bounded seed identities", async () => {
    const first = await stableSeedId("thumbs/pets/cat-bengal-1.jpg.jpg");
    expect(await stableSeedId("thumbs/pets/cat-bengal-1.jpg.jpg")).toBe(first);
    expect(first).toMatch(/^[a-f0-9]{32}$/);
    await expect(stableSeedId("embeddings.bin")).rejects.toThrow(/credited thumbnail/);
  });

  it("plans first, unchanged, interrupted, and changed-checksum seed runs idempotently", () => {
    expect(seedImportAction(null, "a")).toBe("import");
    expect(seedImportAction({ checksum: "a", operationState: "completed" }, "a")).toBe("unchanged");
    expect(seedImportAction({ checksum: "a", operationState: "pending" }, "a")).toBe("replace");
    expect(seedImportAction({ checksum: "a", operationState: "completed" }, "b")).toBe("replace");
  });
});

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
