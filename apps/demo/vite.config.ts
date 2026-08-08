import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  worker: {
    // Vite's default worker format (iife) cannot code-split, so it would inline
    // the worker's dynamic import of the transformers.js runtime — making a
    // mock-mode visit download half a megabyte it never executes. ES workers
    // keep that import a separate chunk, fetched only in real-model mode.
    format: "es",
  },
  optimizeDeps: {
    // Pre-bundling transformers.js pulls its onnxruntime WASM assets into the
    // dev server's dep cache, where the worker's dynamic import cannot reach
    // them. Leaving it unbundled keeps the real-model path working in dev.
    exclude: ["@huggingface/transformers"],
  },
});
