import { describe, expect, it } from "vitest";
import { actRequest, type Frame, HelperError, parseActResult, parseSnapshot } from "./axHelper";
import { changedPixelShare, cropRect, MAX_SILENT_CHANGE, parseStep } from "./steps";

const snapshot = parseSnapshot({
  window: {
    id: 9,
    pid: 3,
    owner: "Safari",
    bundleId: "com.apple.Safari",
    title: "Test",
    frame: { x: -960, y: 30, width: 960, height: 1003 },
    scale: 2,
  },
  elements: [
    {
      id: 4,
      role: "AXButton",
      label: "Add one",
      frame: { x: -944, y: 234, width: 60, height: 18 },
      path: [0, 2, 1],
    },
    {
      id: 7,
      role: "AXTextField",
      label: "Hidden",
      frame: { x: -944, y: 900, width: 60, height: 0 },
    },
  ],
});

describe("step replies", () => {
  it("accepts one well-formed step for a listed element", () => {
    expect(parseStep('{"say":"누를게","action":{"kind":"click","elementId":4}}', snapshot)).toEqual(
      {
        say: "누를게",
        action: { kind: "click", elementId: 4 },
      },
    );
    expect(
      parseStep(
        '```json\n{"say":"쓸게","action":{"kind":"type","elementId":4,"text":"hi"}}\n```',
        snapshot,
      ),
    ).toMatchObject({ action: { kind: "type", text: "hi" } });
    expect(parseStep('{"say":"끝났어","action":{"kind":"done"}}', snapshot)).toEqual({
      say: "끝났어",
      action: { kind: "done" },
    });
  });

  it("rejects anything else", () => {
    const bad = [
      "I'll click it.",
      '{"say":"x","action":{"kind":"click","elementId":7}}', // not shown to Codex
      '{"say":"x","action":{"kind":"click","elementId":99}}',
      '{"say":"x","action":{"kind":"drag","elementId":4}}',
      '{"say":"x","action":{"kind":"type","elementId":4}}',
      '{"say":"","action":{"kind":"done"}}',
      '{"say":"x","action":{"kind":"click","elementId":"4"}}',
      'Sure! {"say":"x","action":{"kind":"done"}}',
      `{"say":"${"x".repeat(301)}","action":{"kind":"done"}}`,
    ];
    for (const reply of bad) expect(parseStep(reply, snapshot)).toBeNull();
  });
});

describe("crops", () => {
  it("maps a global element frame onto window capture pixels", () => {
    const window = snapshot.window.frame;
    expect(
      cropRect(snapshot.elements[0].frame as Frame, window, { width: 1920, height: 2006 }),
    ).toEqual({
      x: 32,
      y: 408,
      width: 120,
      height: 36,
    });
  });

  it("refuses crops that leave the image", () => {
    const window = snapshot.window.frame;
    const image = { width: 1920, height: 2006 };
    expect(cropRect({ x: -970, y: 40, width: 30, height: 10 }, window, image)).toBeNull();
    expect(cropRect({ x: -100, y: 1020, width: 200, height: 30 }, window, image)).toBeNull();
    expect(cropRect({ x: -900, y: 40, width: 0, height: 10 }, window, image)).toBeNull();
  });

  it("counts changed pixels, so one changed letter in a normal crop re-asks", () => {
    const black = new Uint8Array(16);
    const white = new Uint8Array(16).fill(255);
    expect(changedPixelShare(black, black)).toBe(0);
    expect(changedPixelShare(black, white)).toBe(1);
    expect(changedPixelShare(black, new Uint8Array(8))).toBe(1);
    // A 120×36 crop where one letter (about 30 pixels) changed.
    const crop = new Uint8Array(120 * 36 * 4);
    const letter = crop.slice();
    for (let p = 0; p < 30; p += 1) letter.set([255, 255, 255], p * 4 * 7);
    expect(changedPixelShare(crop, letter)).toBeGreaterThan(MAX_SILENT_CHANGE);
    // Capture noise of a few levels per channel is not a change.
    const noisy = crop.map((value, index) => (index % 4 === 3 ? value : value + 10));
    expect(changedPixelShare(crop, noisy)).toBe(0);
  });
});

describe("act requests", () => {
  it("carries what the helper needs to find the element again", () => {
    expect(actRequest(snapshot.elements[0], "check", { intent: "press", ignorePid: 42 })).toEqual({
      kind: "check",
      intent: "press",
      path: [0, 2, 1],
      role: "AXButton",
      label: "Add one",
      frame: { x: -944, y: 234, width: 60, height: 18 },
      ignorePid: 42,
    });
  });

  it("parses results and surfaces refusals", () => {
    expect(parseActResult({ ok: true, valueMatches: false })).toEqual({
      frame: null,
      valueMatches: false,
    });
    expect(() => parseActResult({ error: "not_pressable", message: "no" })).toThrow(HelperError);
    expect(() => parseActResult({})).toThrow(HelperError);
  });
});
