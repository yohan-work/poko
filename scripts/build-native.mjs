// Builds Poko's macOS helper (native/poko-ax) into native/build. Other platforms skip it.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (process.platform !== "darwin") {
  console.log("poko-ax: skipped (macOS only)");
  process.exit(0);
}

const output = join(root, "native", "build", "poko-ax");
mkdirSync(dirname(output), { recursive: true });
execFileSync("swiftc", ["-O", join(root, "native", "poko-ax", "main.swift"), "-o", output], {
  stdio: "inherit",
});
console.log(`poko-ax: built ${output}`);
