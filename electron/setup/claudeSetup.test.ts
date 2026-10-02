import { describe, expect, it } from "vitest";
import { checkClaudeSetup, parseClaudeLogin, parseClaudeVersion } from "./claudeSetup";

const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });
const help = "--input-format --include-partial-messages --safe-mode --setting-sources";

describe("Claude Code setup", () => {
  it("reads the version and the sign-in", () => {
    expect(parseClaudeVersion("2.1.287 (Claude Code)\n")).toBe("2.1.287");
    expect(parseClaudeLogin(ok('{"loggedIn":true,"authMethod":"claude.ai"}'))).toBe("signed_in");
    expect(parseClaudeLogin(ok('{"loggedIn":false}'))).toBe("signed_out");
    expect(parseClaudeLogin({ code: 1, stdout: "", stderr: "error" })).toBe("signed_out");
  });

  it("is ready only when installed, signed in, and new enough", async () => {
    const run =
      (login: string, helpText = help) =>
      async (args: string[]) =>
        args[0] === "--version"
          ? ok("2.1.287 (Claude Code)")
          : args[0] === "auth"
            ? ok(login)
            : ok(helpText);
    expect(await checkClaudeSetup({ claudePath: null, run: run("") })).toMatchObject({
      installed: false,
      ready: false,
    });
    expect(
      await checkClaudeSetup({ claudePath: "/bin/claude", run: run('{"loggedIn":true}') }),
    ).toMatchObject({ installed: true, version: "2.1.287", login: "signed_in", ready: true });
    expect(
      await checkClaudeSetup({ claudePath: "/bin/claude", run: run('{"loggedIn":false}') }),
    ).toMatchObject({ login: "signed_out", ready: false });
    expect(
      await checkClaudeSetup({
        claudePath: "/bin/claude",
        run: run('{"loggedIn":true}', "--input-format"),
      }),
    ).toMatchObject({ featuresOk: false, ready: false });
  });
});
