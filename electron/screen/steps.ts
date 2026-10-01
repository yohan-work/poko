import type { AxElement, Frame, WindowSnapshot } from "./axHelper";
import { listedElements } from "./lookPrompt";

/** One proposed step, as Codex must reply it. Anything else ends the task. */
export type ScreenStep =
  | { say: string; action: { kind: "done" } }
  | { say: string; action: { kind: "click" | "reveal"; elementId: number } }
  | { say: string; action: { kind: "type"; elementId: number; text: string } };

const MAX_SAY = 300;
const MAX_TEXT = 2000;

/**
 * Parses Codex's reply into a step. The reply must be one JSON object (optionally in a ```json
 * fence) and may only target elements Codex was shown. Returns null for anything else.
 */
export function parseStep(reply: string, snapshot: WindowSnapshot): ScreenStep | null {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(reply);
  let data: unknown;
  try {
    data = JSON.parse(fenced ? fenced[1] : reply.trim());
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const { say, action } = data as { say?: unknown; action?: unknown };
  if (typeof say !== "string" || !say.trim() || say.length > MAX_SAY) return null;
  if (typeof action !== "object" || action === null) return null;
  const { kind, elementId, text } = action as Record<string, unknown>;
  if (kind === "done") return { say: say.trim(), action: { kind } };
  if (kind !== "click" && kind !== "reveal" && kind !== "type") return null;
  if (!Number.isSafeInteger(elementId)) return null;
  if (!listedElements(snapshot).some((element) => element.id === elementId)) return null;
  if (kind !== "type") return { say: say.trim(), action: { kind, elementId: elementId as number } };
  if (typeof text !== "string" || !text || text.length > MAX_TEXT) return null;
  return { say: say.trim(), action: { kind, elementId: elementId as number, text } };
}

/**
 * The target's rectangle in the window capture, in image pixels. Element frames are global
 * points; the capture is the window at the display's scale. Returns null when the element
 * isn't fully inside the image, so the card never shows a partial or wrong crop.
 */
export function cropRect(
  element: Frame,
  window: Frame,
  image: { width: number; height: number },
): Frame | null {
  if (window.width <= 0 || image.width <= 0) return null;
  const scale = image.width / window.width;
  const rect = {
    x: Math.round((element.x - window.x) * scale),
    y: Math.round((element.y - window.y) * scale),
    width: Math.round(element.width * scale),
    height: Math.round(element.height * scale),
  };
  const fits =
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.width <= image.width &&
    rect.y + rect.height <= image.height;
  return fits ? rect : null;
}

/** A channel difference above this counts the pixel as changed (ignores capture noise). */
const PIXEL_TOLERANCE = 24;

/**
 * Above this share of changed pixels, the fresh crop is shown and the user is asked again;
 * Poko never acts silently on a changed crop. A mean difference was measured in Safari and
 * dilutes small changes (one changed letter in a 120×36 crop scores far below any useful
 * limit), so the share of changed pixels is used instead. About 9 pixels of a 120×36 crop:
 * a caret or one letter re-asks, while capture noise doesn't. The accessibility re-check, not
 * pixels, proves the element is the same one.
 */
export const MAX_SILENT_CHANGE = 0.002;

/** Share of pixels (0 to 1) that differ between two same-size BGRA bitmaps; 1 if sizes differ. */
export function changedPixelShare(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0 || a.length % 4 !== 0) return 1;
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (
      Math.abs(a[i] - b[i]) > PIXEL_TOLERANCE ||
      Math.abs(a[i + 1] - b[i + 1]) > PIXEL_TOLERANCE ||
      Math.abs(a[i + 2] - b[i + 2]) > PIXEL_TOLERANCE
    )
      changed += 1;
  }
  return changed / (a.length / 4);
}

export function elementById(snapshot: WindowSnapshot, id: number): AxElement | undefined {
  return listedElements(snapshot).find((element) => element.id === id);
}
