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

const source = join(root, "native", "poko-ax");
const output = join(root, "native", "build", "poko-ax");
mkdirSync(dirname(output), { recursive: true });
// sandbox_check is variadic, so it is called from a small C file compiled alongside.
const shim = join(root, "native", "build", "sandbox_shim.o");
execFileSync("clang", ["-O2", "-c", join(source, "sandbox_shim.c"), "-o", shim], {
  stdio: "inherit",
});
execFileSync(
  "swiftc",
  [
    "-O",
    "-import-objc-header",
    join(source, "sandbox_shim.h"),
    join(source, "main.swift"),
    shim,
    "-o",
    output,
  ],
  { stdio: "inherit" },
);
console.log(`poko-ax: built ${output}`);
