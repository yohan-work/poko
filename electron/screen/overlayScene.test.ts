import { describe, expect, it } from "vitest";
import { orbPosition } from "../../src/renderer/src/components/overlay/Overlay";
import { parseSnapshot } from "./axHelper";
import { buildOverlayScene, citedElements, elementName, replaceCitations } from "./overlayScene";

const snapshotJson = () => ({
  window: {
    id: 1,
    pid: 2,
    owner: "Safari",
    title: "",
    frame: { x: 1800, y: 100, width: 800, height: 600 },
    scale: 2,
  },
  elements: [
    { id: 0, role: "AXButton", label: "Reply", frame: { x: 1900, y: 150, width: 60, height: 24 } },
    {
      id: 1,
      role: "AXLink",
      label: "Docs `x` [y]",
      frame: { x: 2000, y: 300, width: 80, height: 20 },
    },
    { id: 2, role: "AXButton", frame: { x: 2100, y: 400, width: 40, height: 40 } },
    { id: 3, role: "AXButton", label: "Hidden" },
    {
      id: 4,
      role: "AXButton",
      label: "Offscreen",
      frame: { x: 100, y: 100, width: 40, height: 40 },
    },
    { id: 5, role: "AXButton", label: "Fifth", frame: { x: 2200, y: 500, width: 40, height: 40 } },
  ],
});
const snapshot = parseSnapshot(snapshotJson());

const display = { x: 1728, y: 0, width: 1920, height: 1080 };

describe("overlay scene", () => {
  it("finds cited elements in order, once each, only with a frame, at most three", () => {
    const cited = citedElements(
      "Press [1], then [0], again [1], not [3] or [99], then [2] and [5].",
      snapshot,
      display,
    );
    expect(cited.map((element) => element.id)).toEqual([1, 0, 2]);
  });

  it("skips elements outside the window before applying the limit", () => {
    const cited = citedElements("[4] [4] [0] [1] [2] [5]", snapshot, display);
    expect(cited.map((element) => element.id)).toEqual([0, 1, 2]);
  });

  it("ignores citations of elements Codex wasn't shown, and code", () => {
    const many = parseSnapshot({
      ...snapshotJson(),
      elements: Array.from({ length: 300 }, (_, id) => ({
        id,
        role: "AXButton",
        label: `B${id}`,
        frame: { x: 1900, y: 150, width: 10, height: 10 },
      })),
    });
    expect(citedElements("[260] `items[1]` [2]", many, display).map((e) => e.id)).toEqual([2]);
    expect(replaceCitations("Use [260] and `items[1]`, then [2].\n```\nlist[3]\n```", many)).toBe(
      "Use [260] and `items[1]`, then ‘B2’.\n```\nlist[3]\n```",
    );
  });

  it("names elements in the chat instead of numbers, without letting labels add Markdown", () => {
    expect(replaceCitations("Press [0] or [1]. See [2] and [42].", snapshot)).toBe(
      "Press ‘Reply’ or ‘Docs x y’. See ‘버튼’ and [42].",
    );
    expect(elementName({ ...snapshot.elements[0], label: "a".repeat(60) })).toHaveLength(40);
  });

  it("maps frames onto the display holding the window and drops points outside it", () => {
    const scene = buildOverlayScene(
      snapshot,
      [snapshot.elements[0], snapshot.elements[4]],
      display,
    );
    expect(scene).toEqual({
      display: { width: 1920, height: 1080 },
      origin: { x: 72, y: 100, width: 800, height: 600 },
      points: [{ frame: { x: 172, y: 150, width: 60, height: 24 }, say: "여기야: Reply" }],
    });
    expect(buildOverlayScene(snapshot, [], display)).toBeNull();
  });

  it("keeps the orb on the display, below the target when there is no room above", () => {
    const screen = { width: 1000, height: 800 };
    expect(orbPosition({ x: 300, y: 300, width: 40, height: 20 }, screen)).toEqual({
      x: 268,
      y: 222,
    });
    expect(orbPosition({ x: 0, y: 10, width: 40, height: 20 }, screen)).toEqual({ x: 8, y: 44 });
    expect(orbPosition({ x: 990, y: 790, width: 10, height: 10 }, screen).x).toBe(928);
  });
});
