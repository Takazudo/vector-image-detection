import type { SupportedImageMimeType } from "../worker/contracts/domain";

export const MAXIMUM_UPLOAD_BYTES = 5 * 1024 * 1024;
const SUPPORTED_TYPES = new Set<SupportedImageMimeType>(["image/jpeg", "image/png", "image/webp"]);

export function validateUploadFile(file: File): string | null {
  if (!SUPPORTED_TYPES.has(file.type as SupportedImageMimeType)) {
    return `${file.name}: choose a JPEG, PNG, or WebP image.`;
  }
  if (file.size > MAXIMUM_UPLOAD_BYTES) {
    return `${file.name}: file exceeds the 5 MiB limit.`;
  }
  if (file.size === 0) return `${file.name}: empty files cannot be uploaded.`;
  return null;
}
