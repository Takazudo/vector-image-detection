import { defineConfig } from "@takazudo/zfb/config";

export default defineConfig({
  framework: "react",
  outDir: "dist",
  publicDir: "public",
  output: "static",
  tailwind: { enabled: true },
});
