// Packages Poko for macOS. With a Developer ID certificate (CSC_LINK or CSC_NAME) the app is
// signed with it, and notarized when Apple credentials are set (APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD,
// APPLE_TEAM_ID, or an App Store Connect API key). Otherwise it is ad-hoc signed: it runs on the
// Mac that built it, and macOS asks for Screen Recording and Accessibility again after each build.
import { execFileSync } from "node:child_process";

const env = process.env;
const developerId = Boolean(env.CSC_LINK || env.CSC_NAME);
const notarize = developerId && Boolean((env.APPLE_ID && env.APPLE_TEAM_ID) || env.APPLE_API_KEY);
const args = ["electron-builder", "--mac", "--publish", "never"];
// The hardened runtime is for notarization; an ad-hoc build without it launches reliably.
if (!developerId) args.push("-c.mac.identity=-", "-c.mac.hardenedRuntime=false");
if (notarize) args.push("-c.mac.notarize=true");

console.log(
  `poko dist: ${developerId ? "Developer ID signing" : "ad-hoc signing"}${notarize ? " + notarization" : ""}`,
);
execFileSync("pnpm", ["exec", ...args], { stdio: "inherit" });
