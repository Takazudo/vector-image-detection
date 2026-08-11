import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { JPEG_FIXTURE_PATH, login } from "./support.ts";

test.beforeEach(async ({ request }) => {
  await login(request);
});

// `validateUploadRequestHeaders` (routes.ts) enforces same-origin before anything else in
// `uploadPhoto` runs — a valid session cookie alone must not be enough to write. This is
// what stops a cookie leaked to a third-party page (e.g. via an XSS elsewhere) from being
// replayed as a cross-site write.
test("rejects an upload with a valid session but no Origin header", async ({ request }) => {
  const response = await request.post("/api/v1/photos", {
    multipart: {
      file: {
        name: "cat-ragdoll-1.jpg",
        mimeType: "image/jpeg",
        buffer: fs.readFileSync(JPEG_FIXTURE_PATH),
      },
    },
  });
  expect(response.status()).toBe(403);
  const body = await response.json();
  expect(body.error.code).toBe("cross_site_request");
});

test("accepts a same-origin multipart upload and starts the write path", async ({
  request,
  baseURL,
}) => {
  const response = await request.post("/api/v1/photos", {
    headers: { origin: baseURL ?? "" },
    multipart: {
      file: {
        name: "cat-ragdoll-1.jpg",
        mimeType: "image/jpeg",
        buffer: fs.readFileSync(JPEG_FIXTURE_PATH),
      },
    },
  });
  expect(response.status()).toBe(202);
  const body = await response.json();
  expect(body.version).toBe("v1");
  expect(typeof body.operationId).toBe("string");
  expect(typeof body.photoId).toBe("string");
  // "completed" here is `createPhotoUpload`'s *write-path* terminal state — the R2 object
  // is stored, the D1 rows are written, and the enrichment message is enqueued, all within
  // this same request. It is not the photo becoming `ready`: that needs the queue
  // consumer's AI enrichment, which this credential-free config has no binding for and
  // which runs on its own async schedule. Never assert readiness here — that depends on
  // queue-consumer timing this spec must not couple to.
  expect(body.state).toBe("completed");
  expect(body.retryable).toBe(false);
  expect(body.errorCode).toBeNull();
});
