import { VALIDATION_LIMITS } from "../../config";
import type { SupportedImageMimeType } from "../../contracts/domain";
import { validateImageDimensions } from "../../validation";

export interface ValidatedImage {
  bytes: Uint8Array;
  mimeType: SupportedImageMimeType;
  byteSize: number;
  width: number;
  height: number;
  sha256: string;
}

export class ImageValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ImageValidationError";
    this.code = code;
  }
}

export async function validateImageFile(file: File): Promise<ValidatedImage> {
  if (file.size < 1 || file.size > VALIDATION_LIMITS.maximumUploadBytes) {
    throw new ImageValidationError("invalid_size", "Image must be between 1 byte and 5 MiB.");
  }
  if (!VALIDATION_LIMITS.supportedMimeTypes.some((mimeType) => mimeType === file.type)) {
    throw new ImageValidationError(
      "unsupported_media_type",
      "Only JPEG, PNG, and WebP are supported.",
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size || bytes.byteLength > VALIDATION_LIMITS.maximumUploadBytes) {
    throw new ImageValidationError("invalid_size", "Image byte length did not match the upload.");
  }
  const detected = detectImage(bytes);
  if (!detected || detected.mimeType !== file.type) {
    throw new ImageValidationError(
      "mime_spoof",
      "Declared image type does not match its contents.",
    );
  }
  if (!validateImageDimensions(detected.width, detected.height)) {
    throw new ImageValidationError(
      "invalid_dimensions",
      "Image dimensions exceed the supported bounds.",
    );
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return {
    bytes,
    mimeType: detected.mimeType,
    byteSize: bytes.byteLength,
    width: detected.width,
    height: detected.height,
    sha256: hex(digest),
  };
}

export function detectImage(
  bytes: Uint8Array,
): Pick<ValidatedImage, "mimeType" | "width" | "height"> | null {
  return detectPng(bytes) ?? detectJpeg(bytes) ?? detectWebp(bytes);
}

function detectPng(bytes: Uint8Array) {
  if (
    bytes.length < 24 ||
    !matches(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
    !matches(bytes, 12, [0x49, 0x48, 0x44, 0x52])
  )
    return null;
  return { mimeType: "image/png" as const, width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

function detectJpeg(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = u16be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (isStartOfFrame(marker)) {
      if (length < 7) return null;
      return {
        mimeType: "image/jpeg" as const,
        height: u16be(bytes, offset + 3),
        width: u16be(bytes, offset + 5),
      };
    }
    offset += length;
  }
  return null;
}

function detectWebp(bytes: Uint8Array) {
  if (
    bytes.length < 30 ||
    !matches(bytes, 0, [0x52, 0x49, 0x46, 0x46]) ||
    !matches(bytes, 8, [0x57, 0x45, 0x42, 0x50])
  )
    return null;
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  if (chunk === "VP8X") {
    return {
      mimeType: "image/webp" as const,
      width: u24le(bytes, 24) + 1,
      height: u24le(bytes, 27) + 1,
    };
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const bits = u32le(bytes, 21);
    return {
      mimeType: "image/webp" as const,
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === "VP8 " && matches(bytes, 23, [0x9d, 0x01, 0x2a])) {
    return {
      mimeType: "image/webp" as const,
      width: u16le(bytes, 26) & 0x3fff,
      height: u16le(bytes, 28) & 0x3fff,
    };
  }
  return null;
}

function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

function matches(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function u16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function u16le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function u24le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function u32be(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
}

function u32le(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function hex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
