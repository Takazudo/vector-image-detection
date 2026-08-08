export default {
  name: "demo-runtime-assets",
  async preBuild({ logger }) {
    await import("./prepare.mjs");
    logger.info("prepared the demo core bridge and ONNX public assets");
  },
};
