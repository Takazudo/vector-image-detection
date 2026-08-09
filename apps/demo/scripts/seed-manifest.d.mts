export interface SeedManifestEntry {
  sourcePath: string;
  filename: string;
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  checksum: string;
  sourceUrl: string | null;
  licenseName: string | null;
  licenseUrl: string | null;
  authorName: string | null;
  authorUrl: string | null;
}

export function parseSeedTarget(arguments_: string[]): {
  mode: "local" | "remote";
  target: string;
};
export function loadSeedManifest(bundleDirectory?: string): Promise<SeedManifestEntry[]>;
