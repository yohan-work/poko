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
  options: { pixels?: () => number; act?: ScreenAgentDeps["act"] } = {},
) {
  const events: AgentEvent[] = [];
  const acts: ActRequest[] = [];
  let captures = 0;
  let released = 0;
  const capture = async (): Promise<Capture> => {
    captures += 1;
    const value = options.pixels?.() ?? 0;
    return {
      snapshot,
      imagePath: "/tmp/screen.png",
      workDir: "/tmp/work",
      imageSize: { width: 800, height: 600 },
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

  it("ends on a reply that isn't one valid step", async () => {
    const world = setup(["Sure, I'll click Add one."]);
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
});
