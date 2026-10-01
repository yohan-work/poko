import { execFile } from "node:child_process";

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenWindowInfo {
  id: number;
  pid: number;
  owner: string;
  bundleId: string | null;
  title: string;
  frame: Frame;
}

export interface AxElement {
  id: number;
  role: string;
  subrole: string | null;
  label: string | null;
  value: string | null;
  url: string | null;
  frame: Frame | null;
  enabled: boolean;
  settable: boolean;
  secure: boolean;
  path: number[];
}

export interface WindowSnapshot {
  window: ScreenWindowInfo & { scale: number };
  elements: AxElement[];
  truncated: boolean;
}

export class HelperError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown) => (typeof value === "string" ? value : null);

function parseFrame(value: unknown): Frame | null {
  if (!isObject(value)) return null;
  const { x, y, width, height } = value;
  return [x, y, width, height].every((n) => typeof n === "number" && Number.isFinite(n))
    ? { x: x as number, y: y as number, width: width as number, height: height as number }
    : null;
}

function parseWindow(value: unknown): ScreenWindowInfo | null {
  if (!isObject(value)) return null;
  const frame = parseFrame(value.frame);
  if (!Number.isSafeInteger(value.id) || !Number.isSafeInteger(value.pid) || !frame) return null;
  return {
    id: value.id as number,
    pid: value.pid as number,
    owner: str(value.owner) ?? "",
    bundleId: str(value.bundleId),
    title: str(value.title) ?? "",
    frame,
  };
}

function checkError(value: unknown): Json {
  if (!isObject(value)) throw new HelperError("malformed", "The helper returned malformed output.");
  if (typeof value.error === "string")
    throw new HelperError(value.error, str(value.message) ?? value.error);
  return value;
}

export function parsePermissions(value: unknown): { accessibility: boolean; screen: boolean } {
  const data = checkError(value);
  return { accessibility: data.accessibility === true, screen: data.screen === true };
}

export function parseWindows(value: unknown): ScreenWindowInfo[] {
  const data = checkError(value);
  if (!Array.isArray(data.windows)) throw new HelperError("malformed", "Missing window list.");
  return data.windows.map(parseWindow).filter((window) => window !== null);
}

export function parseSnapshot(value: unknown): WindowSnapshot {
  const data = checkError(value);
  const window = parseWindow(data.window);
  const scale = isObject(data.window) ? data.window.scale : undefined;
  if (!window || typeof scale !== "number" || !(scale > 0) || !Array.isArray(data.elements))
    throw new HelperError("malformed", "The snapshot is incomplete.");
  const elements: AxElement[] = [];
  for (const raw of data.elements) {
    if (!isObject(raw) || !Number.isSafeInteger(raw.id) || typeof raw.role !== "string") continue;
    const path = Array.isArray(raw.path) && raw.path.every(Number.isSafeInteger) ? raw.path : [];
    elements.push({
      id: raw.id as number,
      role: raw.role,
      subrole: str(raw.subrole),
      label: str(raw.label),
      // Secure fields never carry a value, even if the helper sent one.
      value: raw.secure === true ? null : str(raw.value),
      url: str(raw.url),
      frame: parseFrame(raw.frame),
      enabled: raw.enabled !== false,
      settable: raw.settable === true,
      secure: raw.secure === true,
      path: path as number[],
    });
  }
  return { window: { ...window, scale }, elements, truncated: data.truncated === true };
}

/** Runs the read-only helper and returns its parsed JSON. */
export function runHelper(executable: string, args: string[], timeoutMs = 8000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        // The helper prints a JSON error and exits non-zero; prefer that message.
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(
            new HelperError(
              error?.killed ? "timeout" : "unavailable",
              "The screen helper did not respond.",
            ),
          );
        }
      },
    );
  });
}
