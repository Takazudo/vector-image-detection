import { spawn } from "node:child_process";
import { parseSeedTarget } from "./seed-manifest.mjs";

const target = parseSeedTarget(process.argv.slice(2));
if (target.mode === "remote") {
  throw new Error(
    `Remote seed target ${JSON.stringify(target.target)} requires provisioned production bindings and ` +
      "an authenticated operator execution path; it is intentionally not selected by this credential-free command.",
  );
}

const child = spawn("pnpm", ["run", "test:seed"], { stdio: "inherit" });
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});
