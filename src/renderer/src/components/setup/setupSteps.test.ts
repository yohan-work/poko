import { describe, expect, it } from "vitest";
import { setupSteps } from "./SetupScreen";

const base = {
  installed: true,
  path: "/x/codex",
  version: "0.160.0",
  missingNode: false,
  login: "chatgpt" as const,
  featuresOk: true,
  ready: true,
};

describe("setupSteps", () => {
  it("asks only for the install when Codex is missing", () => {
    const steps = setupSteps({
      ...base,
      installed: false,
      path: null,
      version: null,
      login: "unknown",
      featuresOk: false,
      ready: false,
    });
    expect(steps.map((step) => step.action)).toEqual(["install", "login", undefined]);
    expect(steps[2].detail).toContain("설치하면");
  });

  it("names API-key sign-in and an old version", () => {
    const steps = setupSteps({ ...base, login: "api_key", featuresOk: false, ready: false });
    expect(steps[1].detail).toContain("API 키");
    expect(steps[2].action).toBe("update");
    expect(steps[2].command).toBe("npm install -g @openai/codex");
    const brew = setupSteps({ ...base, source: "homebrew", featuresOk: false, ready: false });
    expect(brew[2].command).toBe("brew upgrade codex");
    expect(brew[2].detail).toContain("/x/codex");
  });
});
