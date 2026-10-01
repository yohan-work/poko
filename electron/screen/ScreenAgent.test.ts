import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../shared";
import { type ActRequest, HelperError, parseSnapshot } from "./axHelper";
import { type Capture, ScreenAgent, type ScreenAgentDeps } from "./ScreenAgent";

const snapshot = parseSnapshot({
  window: {
    id: 9,
    pid: 3,
    owner: "Safari",
    bundleId: "com.apple.Safari",
    title: "Shop",
    frame: { x: 0, y: 0, width: 400, height: 300 },
    scale: 2,
  },
  elements: [
    {
      id: 4,
      role: "AXButton",
      label: "Add one",
      frame: { x: 10, y: 20, width: 60, height: 20 },
      path: [0, 1],
    },
    {
      id: 5,
      role: "AXTextField",
      label: "Search",
      frame: { x: 10, y: 60, width: 120, height: 20 },
      path: [0, 2],
    },
  ],
});

const click = '{"say":"‘Add one’을 누를게","action":{"kind":"click","elementId":4}}';
const done = '{"say":"다 했어","action":{"kind":"done"}}';

/** A fake world: scripted Codex replies, a pixel source, and a recording helper. */
function setup(
  replies: string[],
  options: {
    pixels?: () => number;
    /** The whole window's look; changing it after an action means the page reacted. */
    page?: () => number;
    act?: ScreenAgentDeps["act"];
    snapshot?: typeof snapshot;
    /** Makes the capture after the given number of captures fail. */
    failCaptureAfter?: number;
  } = {},
) {
  const events: AgentEvent[] = [];
  const acts: ActRequest[] = [];
  let captures = 0;
  let released = 0;
  const capture = async (): Promise<Capture> => {
    captures += 1;
    if (options.failCaptureAfter !== undefined && captures > options.failCaptureAfter)
      throw new HelperError("window_not_found", "gone");
    const value = options.pixels?.() ?? 0;
    return {
      snapshot: options.snapshot ?? snapshot,
      imagePath: "/tmp/screen.png",
      workDir: "/tmp/work",
      imageSize: { width: 800, height: 600 },
      fingerprint: new Uint8Array(400).fill(options.page?.() ?? 0),
      crop: () => ({
        dataUrl: "data:image/png;base64,AA",
        bitmap: new Uint8Array(400).fill(value),
      }),
      release: async () => {
        released += 1;
      },
    };
  };
  let onApproval: (requestId: string) => void = () => undefined;
  const agent = new ScreenAgent({
    capture,
    ask: async () => {
      const reply = replies.shift();
      if (reply === undefined) throw new Error("no more replies");
      return reply;
    },
    act:
      options.act ??
      (async (_id, request) => {
        acts.push(request);
        return request.kind === "type" ? { valueMatches: true } : {};
      }),
    emit: (event) => {
      events.push(event);
      if (event.type === "approvalRequired") queueMicrotask(() => onApproval(event.requestId));
    },
    point: () => undefined,
    hideOverlay: async () => undefined,
    ownPid: 42,
    settleMs: 0,
  });
  return {
    agent,
    events,
    acts,
    counts: () => ({ captures, released }),
    whenAsked: (handler: (requestId: string) => void) => {
      onApproval = handler;
    },
  };
}

const types = (events: AgentEvent[]) => events.map((event) => event.type);

describe("ScreenAgent", () => {
  it("finishes when Codex says the goal is done", async () => {
    const world = setup([done]);
    await world.agent.run(9, "goal");
    expect(world.events.at(-1)).toEqual({ type: "completed", result: "다 했어" });
    expect(world.acts).toEqual([]);
    expect(world.counts().released).toBe(world.counts().captures);
  });

  it("checks, asks with a crop, checks again, and acts once approved", async () => {
    const world = setup([click, done]);
    world.whenAsked((id) => world.agent.respond(id, "approve"));
    await world.agent.run(9, "add one");
    const approval = world.events.find((event) => event.type === "approvalRequired");
    expect(approval).toMatchObject({
      kind: "screen_action",
      summary: "‘Add one’을 누를게",
      canApprove: true,
      screen: { action: "click", target: "Add one", crop: "data:image/png;base64,AA" },
    });
    expect(world.acts.map((request) => [request.kind, request.intent])).toEqual([
      ["check", "press"],
      ["press", undefined],
    ]);
    expect(world.acts[1]).toMatchObject({ path: [0, 1], role: "AXButton", ignorePid: 42 });
    expect(world.events.at(-1)).toEqual({ type: "completed", result: "다 했어" });
    expect(world.counts().released).toBe(world.counts().captures);
  });

  it("stops without acting when the user declines", async () => {
    const world = setup([click]);
    world.whenAsked((id) => world.agent.respond(id, "decline"));
    await world.agent.run(9, "add one");
    expect(world.acts.map((request) => request.kind)).toEqual(["check"]);
    expect(world.events.at(-1)).toEqual({ type: "completed", result: "알겠어. 여기서 멈출게." });
  });

  it("never acts after a stop, even one that arrives while waiting for approval", async () => {
    const world = setup([click]);
    world.whenAsked(() => world.agent.stop());
    await world.agent.run(9, "add one");
    expect(world.acts.map((request) => request.kind)).toEqual(["check"]);
    expect(world.events.at(-1)).toEqual({ type: "cancelled" });
  });

  it("shows the new crop and asks again when the page changed after approval", async () => {
    let pixel = 0;
    const world = setup([click, done], { pixels: () => pixel });
    let asked = 0;
    world.whenAsked((id) => {
      asked += 1;
      if (asked === 1) pixel = 200; // the page changes while the user looks
      world.agent.respond(id, "approve");
    });
    await world.agent.run(9, "add one");
    expect(asked).toBe(2);
    expect(world.acts.map((request) => request.kind)).toEqual(["check", "press"]);
  });

  it("gives Codex one more try after a reply that isn't a step", async () => {
    const world = setup(["요청한 작업을 마쳤어.", done]);
    await world.agent.run(9, "goal");
    expect(world.events.at(-1)).toEqual({ type: "completed", result: "다 했어" });
  });

  it("ends when the second reply isn't one valid step either", async () => {
    const world = setup(["Sure, I'll click Add one.", "Still not JSON."]);
    await world.agent.run(9, "add one");
    expect(types(world.events)).toEqual(["started", "thinking", "error"]);
    expect(world.acts).toEqual([]);
  });

  it("tells Codex about refusals and stops after three in a row", async () => {
    const world = setup([click, click, click], {
      act: async () => {
        throw new HelperError("not_pressable", "no");
      },
    });
    await world.agent.run(9, "add one");
    expect(world.events.at(-1)).toMatchObject({ type: "error" });
    expect(world.events.some((event) => event.type === "approvalRequired")).toBe(false);
  });

  it("shows the full text to type and reports when the page didn't take it", async () => {
    const acts: ActRequest[] = [];
    const world = setup(
      ['{"say":"검색할게","action":{"kind":"type","elementId":5,"text":"buy now"}}', done],
      {
        act: async (_id, request) => {
          acts.push(request);
          return request.kind === "type" ? { valueMatches: false } : {};
        },
      },
    );
    world.whenAsked((id) => world.agent.respond(id, "approve"));
    await world.agent.run(9, "search");
    expect(world.events.find((event) => event.type === "approvalRequired")).toMatchObject({
      screen: { action: "type", text: "buy now", warning: expect.any(String) },
    });
    expect(acts.at(-1)).toMatchObject({ kind: "type", text: "buy now" });
    expect(world.events.find((event) => event.type === "tool")).toMatchObject({
      detail: expect.stringContaining("받지 않았어"),
    });
  });

  it("says the result is unknown, not refused, when acting times out", async () => {
    const world = setup([click, done], {
      act: async (_id, request) => {
        if (request.kind === "press") throw new HelperError("timeout", "slow");
        return {};
      },
    });
    world.whenAsked((id) => world.agent.respond(id, "approve"));
    await world.agent.run(9, "add one");
    expect(world.events.find((event) => event.type === "tool")).toMatchObject({
      detail: expect.stringContaining("확인하지 못했어"),
    });
    expect(world.events.at(-1)).toEqual({ type: "completed", result: "다 했어" });
  });

  it("offers reveal for an element that is only partly on screen", async () => {
    const partial = parseSnapshot({
      ...JSON.parse(JSON.stringify(snapshot)),
      elements: [
        {
          id: 6,
          role: "AXButton",
          label: "Below",
          frame: { x: 10, y: 290, width: 60, height: 30 },
          path: [0, 3],
        },
      ],
    });
    const world = setup(['{"say":"보이게 할게","action":{"kind":"reveal","elementId":6}}', done], {
      snapshot: partial,
    });
    world.whenAsked((id) => world.agent.respond(id, "approve"));
    await world.agent.run(9, "show it");
    expect(world.acts.map((request) => request.kind)).toEqual(["check", "reveal"]);
  });

  it("tells Codex when an action changed nothing on the page", async () => {
    let page = 0;
    const world = setup([click, done], { page: () => page });
    world.whenAsked((id) => world.agent.respond(id, "approve"));
    await world.agent.run(9, "add one");
    expect(world.events.find((event) => event.type === "tool")).toMatchObject({
      detail: expect.stringContaining("바뀌지 않았어"),
    });
    page = 0;
  });

  it("reports a click that changed the page as done", async () => {
    let page = 0;
    const world = setup([click, done], {
      page: () => page,
      act: async (_id, request) => {
        if (request.kind === "press") page = 200;
        return {};
      },
    });
    world.whenAsked((id) => world.agent.respond(id, "approve"));
    await world.agent.run(9, "add one");
    expect(world.events.find((event) => event.type === "tool")).toMatchObject({
      detail: "‘Add one’을(를) 눌렀어.",
    });
  });

  it("counts typing as done when the field holds the text, even if little changed", async () => {
    const world = setup([
      '{"say":"쓸게","action":{"kind":"type","elementId":5,"text":"poko"}}',
      done,
    ]);
    world.whenAsked((id) => world.agent.respond(id, "approve"));
    await world.agent.run(9, "type");
    expect(world.events.find((event) => event.type === "tool")).toMatchObject({
      detail: "‘Search’에 입력했어.",
    });
  });

  it("keeps an action that ran when the look afterwards fails", async () => {
    // Captures: the step's look (1) and the check after approval (2); the third fails.
    const world = setup([click], { failCaptureAfter: 2 });
    world.whenAsked((id) => world.agent.respond(id, "approve"));
    await world.agent.run(9, "add one");
    expect(world.acts.map((request) => request.kind)).toEqual(["check", "press"]);
    expect(world.events.find((event) => event.type === "tool")).toMatchObject({
      detail: "‘Add one’을(를) 눌렀어.",
    });
    // The next step's look finds the window gone and ends the task plainly.
    expect(world.events.at(-1)).toEqual({
      type: "error",
      error: "고른 창이 닫히거나 사라져서 멈췄어.",
    });
  });
});
