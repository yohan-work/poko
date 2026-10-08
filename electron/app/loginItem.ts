import { app } from "electron";
import type { LoginItemState } from "../shared";

type SystemLoginItem = Pick<
  Electron.LoginItemSettings,
  "openAtLogin" | "wasOpenedAtLogin" | "status"
>;

/** What the login item depends on, so the decisions below can be tested without Electron. */
export interface LoginItemHost {
  packaged: boolean;
  platform: NodeJS.Platform;
  /** macOS registers only an app that is in the Applications folder reliably. */
  inApplications: () => boolean;
  read: () => SystemLoginItem;
  write: (openAtLogin: boolean) => void;
}

const electronHost = (): LoginItemHost => ({
  packaged: app.isPackaged,
  platform: process.platform,
  inApplications: () => app.isInApplicationsFolder(),
  read: () => app.getLoginItemSettings(),
  write: (openAtLogin) => app.setLoginItemSettings({ openAtLogin }),
});

/**
 * 로그인할 때 포코 열기, as macOS has it (Poko keeps no copy). Only an installed app in the
 * Applications folder can have one: a development build's login item would open bare Electron,
 * and macOS often refuses an app elsewhere (a downloaded, quarantined, or moved copy).
 */
export function loginItemState(host: LoginItemHost = electronHost()): LoginItemState {
  if (!host.packaged || host.platform !== "darwin")
    return { available: false, unavailable: "development", enabled: false, needsApproval: false };
  if (!host.inApplications())
    return { available: false, unavailable: "location", enabled: false, needsApproval: false };
  const { status, openAtLogin } = host.read();
  const needsApproval = status === "requires-approval";
  // Waiting for the user's approval still counts as on: the user turned it on, and another
  // click would take it back.
  return {
    available: true,
    unavailable: null,
    enabled: status === "enabled" || needsApproval || openAtLogin,
    needsApproval,
  };
}

/**
 * Turns the login item on or off and reads back what macOS did. macOS can refuse silently
 * (Electron only logs it), so a switch turned on that didn't take says so.
 */
export function setLoginItem(
  enabled: boolean,
  host: LoginItemHost = electronHost(),
): LoginItemState {
  if (!loginItemState(host).available) return loginItemState(host);
  host.write(enabled);
  const after = loginItemState(host);
  return enabled && !after.enabled ? { ...after, failed: true } : after;
}

/**
 * Whether this start came from the login item, so Poko starts without its window. Read once at
 * startup. When macOS doesn't say, the window shows: Poko still runs, just not quietly.
 */
export function openedAtLogin(host: LoginItemHost = electronHost()): boolean {
  if (!host.packaged || host.platform !== "darwin") return false;
  try {
    return host.read().wasOpenedAtLogin === true;
  } catch {
    return false;
  }
}
