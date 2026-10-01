import { describe, expect, it, vi } from "vitest";
import { applyDeltas, createDeltaBuffer, type OutputDelta } from "./streaming";

const delta = (content: string, itemId: string | null = "m1", taskId = "t1"): OutputDelta => ({
  taskId,
  itemId,
  content,
});

describe("applyDeltas", () => {
  it("appends deltas for the same message item", () => {
    expect(applyDeltas(null, [delta("안녕"), delta("하세요")])).toEqual({
      taskId: "t1",
      itemId: "m1",
      text: "안녕하세요",
    });
  });

  it("replaces the text when Codex starts a new message item or a new task begins", () => {
    const first = applyDeltas(null, [delta("살펴볼게요.", "m1")]);
    expect(applyDeltas(first, [delta("결과는", "m2"), delta(" 이래.", "m2")])?.text).toBe(
      "결과는 이래.",
    );
    expect(applyDeltas(first, [delta("새 작업", "m1", "t2")])).toEqual({
      taskId: "t2",
      itemId: "m1",
      text: "새 작업",
    });
  });
});

describe("createDeltaBuffer", () => {
  function setup() {
    let scheduled: (() => void) | null = null;
    const onFlush = vi.fn();
    const cancel = vi.fn(() => {
      scheduled = null;
    });
    const buffer = createDeltaBuffer(
      onFlush,
      (flush) => {
        scheduled = flush;
        return 1;
      },
      cancel,
    );
    return { buffer, onFlush, runFrame: () => scheduled?.(), cancel };
  }

  it("delivers all deltas from one frame together", () => {
    const { buffer, onFlush, runFrame } = setup();
    buffer.push(delta("a"));
    buffer.push(delta("b"));
    expect(onFlush).not.toHaveBeenCalled();
    runFrame();
    expect(onFlush).toHaveBeenCalledExactlyOnceWith([delta("a"), delta("b")]);
  });

  it("can flush immediately and discard a finished task's leftovers", () => {
    const { buffer, onFlush, cancel } = setup();
    buffer.push(delta("a"));
    buffer.flushNow();
    expect(cancel).toHaveBeenCalled();
    expect(onFlush).toHaveBeenCalledWith([delta("a")]);

    buffer.push(delta("x", "m1", "t1"));
    buffer.push(delta("y", "m1", "t2"));
    buffer.discard("t1");
    buffer.flushNow();
    expect(onFlush).toHaveBeenLastCalledWith([delta("y", "m1", "t2")]);
  });
});
