import { describe, expect, it } from "vitest";
import {
  commandEnvironment,
  commandRefusal,
  commandSettings,
  commandsBlockedReason,
} from "./claudeCommands";

describe("commandsBlockedReason", () => {
  const home = "/Users/me";
  it("allows a project folder on macOS with a verified Claude Code", () => {
    expect(commandsBlockedReason("/Users/me/code/app", home, "darwin", "2.1.287")).toBeNull();
    expect(commandsBlockedReason("/Users/me/code/app", home, "darwin", "2.2.0")).toBeNull();
  });

  it("blocks other platforms, older or unknown versions, and broad folders", () => {
    expect(commandsBlockedReason("/Users/me/app", home, "linux", "2.1.287")).toContain("macOS");
    expect(commandsBlockedReason("/Users/me/app", home, "darwin", "2.1.286")).toContain("2.1.287");
    expect(commandsBlockedReason("/Users/me/app", home, "darwin", null)).toContain("2.1.287");
    for (const folder of ["/Users/me", "/Users", "/", "/Volumes"])
      expect(commandsBlockedReason(folder, home, "darwin", "2.1.287")).toContain("너무 넓어서");
  });
});

describe("commandSettings", () => {
  it("asks for every command, keeps the sandbox closed, and denies reads by default", () => {
    const settings = JSON.parse(
      commandSettings({ workspace: "/Users/me/app", tempDir: "/tmp/t", reads: ["/Users/me/.nvm"] }),
    );
    expect(settings.permissions).toEqual({ ask: ["Bash"] });
    expect(settings.sandbox).toMatchObject({
      enabled: true,
      autoAllowBashIfSandboxed: false,
      allowUnsandboxedCommands: false,
      network: { allowUnixSockets: [], allowLocalBinding: false },
    });
    expect(settings.sandbox.filesystem.denyRead).toEqual(
      expect.arrayContaining(["/Users", "/Volumes", "/tmp", "/private/tmp"]),
    );
    expect(settings.sandbox.filesystem.allowRead).toEqual([
      "/Users/me/app",
      "/tmp/t",
      "/Users/me/.nvm",
    ]);
  });
});

describe("commandEnvironment", () => {
  it("keeps only what Claude Code needs and drops tokens", () => {
    const env = commandEnvironment(
      {
        PATH: "/bin",
        HOME: "/Users/me",
        LC_ALL: "ko_KR.UTF-8",
        ANTHROPIC_API_KEY: "a",
        CLAUDE_CONFIG_DIR: "c",
        HTTPS_PROXY: "p",
        GITHUB_TOKEN: "secret",
        DATABASE_URL: "postgres://u:p@h",
        AWS_SECRET_ACCESS_KEY: "aws",
        CLAUDE_CODE_MESSAGING_TOKEN: "parent-session",
      },
      "/tmp/t",
    );
    expect(env).toEqual({
      PATH: "/bin",
      HOME: "/Users/me",
      LC_ALL: "ko_KR.UTF-8",
      ANTHROPIC_API_KEY: "a",
      CLAUDE_CONFIG_DIR: "c",
      HTTPS_PROXY: "p",
      CLAUDE_CODE_TMPDIR: "/tmp/t",
      TMPDIR: "/tmp/t",
    });
  });

  it("keeps cloud variables only for the configured provider", () => {
    expect(
      commandEnvironment(
        { CLAUDE_CODE_USE_BEDROCK: "1", AWS_REGION: "us-east-1", GOOGLE_X: "g" },
        "/t",
      ),
    ).toMatchObject({ AWS_REGION: "us-east-1" });
    expect(
      commandEnvironment({ CLAUDE_CODE_USE_BEDROCK: "1", GOOGLE_X: "g" }, "/t").GOOGLE_X,
    ).toBeUndefined();
  });
});

describe("commandRefusal", () => {
  it("accepts a plain command and refuses unsafe or unsupported ones", () => {
    expect(commandRefusal({ command: "npm test", description: "Run tests" })).toBeNull();
    expect(commandRefusal({ command: "npm test", timeout: 300000 })).toBeNull();
    for (const input of [
      {},
      { command: "  " },
      { command: "x".repeat(2001) },
      { command: "npm test", dangerouslyDisableSandbox: true },
      { command: "npm run dev", run_in_background: true },
      { command: "npm test", timeout: 300001 },
      { command: "npm test", timeout: "10" },
    ])
      expect(commandRefusal(input)).not.toBeNull();
  });
});
