import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.dom.test.{ts,tsx}"],
    setupFiles: ["./tests/dom-setup.ts"],
  },
});
