import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  codexEnvironment,
  findNodeDirectory,
  needsNode,
} from "../providers/codex/codexEnvironment";
import { atLeast, checkCodexSetup, parseLogin, parseVersion, type RunResult } from "./codexSetup";

const ok = (stdout = "", stderr = ""): RunResult => ({ code: 0, stdout, stderr });
const features = ok("apps  stable  true\nshell_tool  stable  true\nunified_exec  stable  true\n");

function probe(results: Partial<Record<string, RunResult>>) {
  return {
    codexPath: "/Users/me/.nvm/versions/node/v24/bin/codex",
    missingNode: false,
    run: async (args: string[]) => results[args.join(" ")] ?? { code: 1, stdout: "", stderr: "" },
  };
}

describe("Codex setup parsing", () => {
  it("reads the version and compares it with the minimum", () => {
    expect(parseVersion("codex-cli 0.160.0\n")).toEqual([0, 160, 0]);
    expect(parseVersion("nope")).toBeNull();
    expect(atLeast([0, 160, 0], [0, 159, 0])).toBe(true);
    expect(atLeast([0, 159, 0], [0, 159, 0])).toBe(true);
    expect(atLeast([0, 158, 9], [0, 159, 0])).toBe(false);
    expect(atLeast([1, 0, 0], [0, 159, 0])).toBe(true);
  });

  it("reads the sign-in from stderr and never mistakes 'Not logged in'", () => {
    expect(parseLogin(ok("", "Logged in using ChatGPT\n"))).toBe("chatgpt");
    expect(parseLogin({ code: 1, stdout: "", stderr: "Not logged in\n" })).toBe("signed_out");
    expect(parseLogin(ok("", "Not logged in\n"))).toBe("signed_out");
    expect(parseLogin(ok("", "Logged in using an API key - sk-...\n"))).toBe("api_key");
    expect(parseLogin({ code: 1, stdout: "", stderr: "Logged in using ChatGPT" })).toBe(
      "signed_out",
    );
  });

  it("is ready only with a new enough version, the features, and ChatGPT sign-in", async () => {
    const ready = await checkCodexSetup(
      probe({
        "--version": ok("codex-cli 0.160.0\n"),
        "login status": ok("", "Logged in using ChatGPT\n"),
        "features list": features,
      }),
    );
    expect(ready).toMatchObject({
      installed: true,
      version: "0.160.0",
      login: "chatgpt",
      ready: true,
    });

    const old = await checkCodexSetup(
      probe({
        "--version": ok("codex-cli 0.150.0\n"),
        "login status": ok("", "Logged in using ChatGPT\n"),
        "features list": features,
      }),
    );
    expect(old).toMatchObject({ featuresOk: false, ready: false });

    const noFeatures = await checkCodexSetup(
      probe({
        "--version": ok("codex-cli 0.160.0\n"),
        "login status": ok("", "Logged in using ChatGPT\n"),
        "features list": ok("apps stable true\n"),
      }),
    );
    expect(noFeatures.ready).toBe(false);

    expect(
      await checkCodexSetup({ codexPath: null, missingNode: false, run: async () => ok() }),
    ).toMatchObject({
      installed: false,
      ready: false,
    });
    expect(
      await checkCodexSetup({ codexPath: "/x/codex", missingNode: true, run: async () => ok() }),
    ).toMatchObject({ installed: true, missingNode: true, ready: false });
  });
});

describe("Codex environment for a GUI app", () => {
  it("puts codex's folder, node's folder, and Homebrew before the inherited PATH", () => {
    const env = codexEnvironment("/Users/me/.npm-global/bin/codex", "/usr/local/bin", {
      PATH: "/usr/bin:/bin",
      HOME: "/Users/me",
    });
    expect(env.PATH?.split(delimiter)).toEqual([
      "/Users/me/.npm-global/bin",
      "/usr/local/bin",
      "/opt/homebrew/bin",
      "/usr/bin",
      "/bin",
    ]);
    expect(env.HOME).toBe("/Users/me");
  });

  it("finds a node folder and recognizes node scripts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "poko-node-"));
    try {
      const script = join(dir, "codex");
      await writeFile(script, "#!/usr/bin/env node\nconsole.log(1)\n");
      const binary = join(dir, "other");
      await writeFile(binary, "\u007fELF...");
      expect(await needsNode(script)).toBe(true);
      expect(await needsNode(binary)).toBe(false);
      expect(await needsNode(join(dir, "missing"))).toBe(false);
      const seen: string[] = [];
      const found = await findNodeDirectory(["/a", "/b"], async (path) => {
        seen.push(path);
        return path === "/b/node";
      });
      expect(found).toBe("/b");
      expect(seen).toEqual(["/a/node", "/b/node"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
