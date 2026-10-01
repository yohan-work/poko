import type { Frame } from "./axHelper";

/** `desktopCapturer` window source ids look like `window:<CGWindowID>:<n>`. */
export function windowIdFromSource(sourceId: string): number | null {
  const match = /^window:(\d+):/.exec(sourceId);
  return match ? Number(match[1]) : null;
}

/**
 * The capture must be the whole window at a single scale, so that element frames (points)
 * map onto image pixels. A thumbnail that was letterboxed or cropped would not.
 */
export function captureMatchesWindow(
  image: { width: number; height: number },
  frame: Frame,
  tolerance = 0.02,
): boolean {
  if (image.width <= 0 || image.height <= 0 || frame.width <= 0 || frame.height <= 0) return false;
  const imageRatio = image.width / image.height;
  const frameRatio = frame.width / frame.height;
  return Math.abs(imageRatio - frameRatio) / frameRatio <= tolerance;
}
