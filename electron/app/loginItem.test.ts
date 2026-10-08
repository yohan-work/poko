import { describe, expect, it, vi } from "vitest";
import type { LoginItemHost } from "./loginItem";

vi.mock("electron", () => ({ app: {} }));
const { loginItemState, openedAtLogin, setLoginItem } = await import("./loginItem");

function fake(overrides: Partial<LoginItemHost> = {}) {
  const system: ReturnType<LoginItemHost["read"]> = {
    openAtLogin: false,
    wasOpenedAtLogin: false,
    status: "not-registered",
  };
  const writes: boolean[] = [];
  const host: LoginItemHost = {
    packaged: true,
    platform: "darwin",
    inApplications: () => true,
    read: () => ({ ...system }),
    write: (openAtLogin) => {
      writes.push(openAtLogin);
      system.openAtLogin = openAtLogin;
      system.status = openAtLogin ? "enabled" : "not-registered";
    },
    ...overrides,
  };
  return { system, writes, host };
}

describe("login item", () => {
  it("shows and changes what macOS has, in the installed app", () => {
    const { host, writes } = fake();
    expect(loginItemState(host)).toMatchObject({ available: true, enabled: false });
    expect(setLoginItem(true, host)).toEqual({
      available: true,
      unavailable: null,
      enabled: true,
      needsApproval: false,
    });
    expect(setLoginItem(false, host).enabled).toBe(false);
    expect(writes).toEqual([true, false]);
  });

  it("is unavailable in a development build, off macOS, or outside the Applications folder", () => {
    const cases: Array<[Partial<LoginItemHost>, string]> = [
      [{ packaged: false }, "development"],
      [{ platform: "win32" }, "development"],
      [{ inApplications: () => false }, "location"],
    ];
    for (const [overrides, reason] of cases) {
      const { host, writes } = fake(overrides);
      expect(setLoginItem(true, host)).toMatchObject({ available: false, unavailable: reason });
      expect(writes).toEqual([]);
    }
  });

  it("reads as on while macOS waits for approval, so another click doesn't take it back", () => {
    const { host, system } = fake();
    system.status = "requires-approval";
    expect(loginItemState(host)).toMatchObject({ enabled: true, needsApproval: true });
  });

  it("says so when macOS didn't register it", () => {
    const { host } = fake({ write: () => undefined });
    expect(setLoginItem(true, host)).toMatchObject({ enabled: false, failed: true });
  });

  it("starts hidden only when macOS says the login item opened it", () => {
    const { host, system } = fake();
    expect(openedAtLogin(host)).toBe(false);
    system.wasOpenedAtLogin = true;
    expect(openedAtLogin(host)).toBe(true);
    expect(openedAtLogin({ ...host, packaged: false })).toBe(false);
    expect(
      openedAtLogin({
        ...host,
        read: () => {
          throw new Error("unavailable");
        },
      }),
    ).toBe(false);
  });
});
