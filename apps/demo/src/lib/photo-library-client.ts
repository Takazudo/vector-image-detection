import type {
  BulkHumanTagMutationRequest,
  BulkHumanTagMutationResponse,
  CreateUploadRequest,
  CreateUploadResponse,
  GetPhotoResponse,
  ListPhotosResponse,
  ReadinessResponse,
  SearchResponse,
  UploadStatusResponse,
} from "../worker/contracts/api";

export interface PhotoLibraryClient {
  readiness(signal?: AbortSignal): Promise<ReadinessResponse>;
  listPhotos(signal?: AbortSignal): Promise<ListPhotosResponse>;
  createUpload(request: CreateUploadRequest, signal?: AbortSignal): Promise<CreateUploadResponse>;
  uploadFile(url: string, file: File, signal?: AbortSignal): Promise<void>;
  uploadStatus(operationId: string, signal?: AbortSignal): Promise<UploadStatusResponse>;
  getPhoto(photoId: string, signal?: AbortSignal): Promise<GetPhotoResponse>;
  mutateTags(
    request: BulkHumanTagMutationRequest,
    signal?: AbortSignal,
  ): Promise<BulkHumanTagMutationResponse>;
  search(query: string, signal?: AbortSignal): Promise<SearchResponse>;
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(message: string, code: string, retryable: boolean, status: number) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

async function apiRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { Accept: "application/json", ...init.headers },
  });
  if (!response.ok) {
    let body: { error?: { message?: string; code?: string; retryable?: boolean } } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      // Non-JSON edge failures still receive a useful generic message.
    }
    throw new ApiClientError(
      body.error?.message ?? `Request failed (${response.status})`,
      body.error?.code ?? "request_failed",
      body.error?.retryable ?? response.status >= 500,
      response.status,
    );
  }
  return (await response.json()) as T;
}

export const browserPhotoLibraryClient: PhotoLibraryClient = {
  readiness: (signal) => apiRequest("/api/v1/readiness", { signal }),
  listPhotos: (signal) => apiRequest("/api/v1/photos?version=v1&limit=100", { signal }),
  createUpload: (request, signal) =>
    apiRequest("/api/v1/uploads", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }),
  uploadFile: async (url, file, signal) => {
    const response = await fetch(url, {
      method: "PUT",
      body: file,
      signal,
      headers: { "Content-Type": file.type },
    });
    if (!response.ok) {
      throw new ApiClientError(
        `Upload failed (${response.status})`,
        "upload_failed",
        true,
        response.status,
      );
    }
  },
  uploadStatus: (operationId, signal) =>
    apiRequest(`/api/v1/uploads/${encodeURIComponent(operationId)}`, { signal }),
  getPhoto: (photoId, signal) =>
    apiRequest(`/api/v1/photos/${encodeURIComponent(photoId)}`, { signal }),
  mutateTags: (request, signal) =>
    apiRequest("/api/v1/human-tags/bulk", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }),
  search: (query, signal) =>
    apiRequest(`/api/v1/search?version=v1&query=${encodeURIComponent(query)}&limit=100`, {
      signal,
    }),
};

export async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
