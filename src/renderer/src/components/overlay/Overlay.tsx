import { useEffect, useState } from "react";
import type { OverlayScene } from "../../../../../electron/shared";
import { Character } from "../character/Character";

/** Must match the per-point time in the main process overlay. */
const POINT_MS = 3200;
const ORB = 64;
const GAP = 14;
/** The bubble's widest size (CSS max-width) plus its gap from the orb. */
const BUBBLE_SPACE = 268;

type Frame = OverlayScene["points"][number]["frame"];

/** Where the orb sits for a target: above-left of it, kept on the display. */
export function orbPosition(frame: Frame, display: OverlayScene["display"]) {
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 8), max - ORB - 8);
  const above = frame.y - ORB - GAP;
  return {
    x: clamp(frame.x - ORB / 2, display.width),
    y: clamp(above >= 8 ? above : frame.y + frame.height + GAP, display.height),
  };
}

/** Poko on top of the user's screen, pointing at what it talked about. Click-through. */
export function Overlay() {
  const [scene, setScene] = useState<OverlayScene | null>(null);
  const [index, setIndex] = useState(-1);

  useEffect(() => {
    const offScene = window.poko.overlay.onScene((next) => {
      setScene(next);
      setIndex(-1);
    });
    const offHide = window.poko.overlay.onHide(() => setScene(null));
    return () => {
      offScene();
      offHide();
    };
  }, []);

  useEffect(() => {
    if (!scene) return;
    // Start at the window's corner, then fly to each point in turn.
    const timers = scene.points.map((_, i) =>
      window.setTimeout(() => setIndex(i), i === 0 ? 80 : i * POINT_MS),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [scene]);

  if (!scene) return null;
  const point = index >= 0 ? scene.points[index] : null;
  const start = {
    x: Math.max(scene.origin.x + scene.origin.width - ORB - 24, 8),
    y: Math.max(scene.origin.y + scene.origin.height - ORB - 24, 8),
  };
  const orb = point ? orbPosition(point.frame, scene.display) : start;
  const bubbleLeft = orb.x + ORB + BUBBLE_SPACE > scene.display.width;

  return (
    <div className="overlay">
      {point && (
        <div
          key={index}
          className="overlay__ring"
          style={{
            left: point.frame.x - 6,
            top: point.frame.y - 6,
            width: point.frame.width + 12,
            height: point.frame.height + 12,
          }}
        />
      )}
      <div className="overlay__poko" style={{ transform: `translate(${orb.x}px, ${orb.y}px)` }}>
        <Character state={point ? "listening" : "thinking"} size={ORB} />
        {point && (
          <p
            key={index}
            className={`overlay__bubble${bubbleLeft ? " overlay__bubble--left" : ""}`}
            role="status"
          >
            {point.say}
          </p>
        )}
      </div>
    </div>
  );
}
