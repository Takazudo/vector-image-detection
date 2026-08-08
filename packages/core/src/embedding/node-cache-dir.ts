// Configures transformers.js's on-disk model cache to a shared, well-known
// location outside any single package's node_modules, so every worktree /
// package in this monorepo (and the CLI, once implemented) reuses the same
// downloaded model weights instead of re-downloading per-package.
//
// This module must stay import-safe in browser bundles: `node:os` and
// `node:path` are only ever reached via dynamic import, and only after a
// runtime Node.js environment check, so a browser bundler never needs to
// resolve them.
//
// Typed structurally (just the one field we touch) rather than against
// transformers.js's `TransformersEnvironment` type, which isn't re-exported
// from its package root.
interface CacheDirEnv {
  cacheDir: string | null;
}

const CACHE_DIR_SEGMENTS = [".cache", "vector-image-detection", "models"];

function isNodeRuntime(): boolean {
  return typeof process !== "undefined" && process.versions?.node != null;
}

let configured: Promise<void> | undefined;

/**
 * Points transformers.js's `env.cacheDir` at
 * `~/.cache/vector-image-detection/models` when running under Node.js.
 * No-op (and import-safe) in browsers, where the default Cache API-backed
 * behavior is left untouched. Idempotent and safe to call before every
 * model load.
 */
export function configureNodeCacheDir(env: CacheDirEnv): Promise<void> {
  if (!configured) {
    configured = isNodeRuntime()
      ? (async () => {
          const [{ default: os }, { default: path }] = await Promise.all([
            import("node:os"),
            import("node:path"),
          ]);
          env.cacheDir = path.join(os.homedir(), ...CACHE_DIR_SEGMENTS);
        })()
      : Promise.resolve();
  }
  return configured;
}
