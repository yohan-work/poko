import type { AgentEvent, ApprovalChoice, ScreenActionPreview } from "../shared";
import {
  type ActKind,
  type ActRequest,
  type AxElement,
  type Frame,
  HelperError,
  actRequest,
} from "./axHelper";
import type { WindowSnapshot } from "./axHelper";
import { elementName } from "./overlayScene";
import {
  buildStepPrompt,
  changedPixelShare,
  cropRect,
  elementById,
  MAX_SILENT_CHANGE,
  parseStep,
  riskWarning,
  type ScreenStep,
  type StepRecord,
} from "./steps";

export const MAX_STEPS = 8;
const MAX_REFUSALS = 3;
const MAX_REASKS = 2;
const APPROVAL_TIMEOUT_MS = 5 * 60_000;

/** One capture of the picked window. `release` removes its temp files. */
export interface Capture {
  snapshot: WindowSnapshot;
  imagePath: string;
  workDir: string;
  imageSize: { width: number; height: number };
  /** A PNG data URL and raw BGRA pixels of one rectangle of the image. */
  crop(rect: Frame): { dataUrl: string; bitmap: Uint8Array };
  release(): Promise<void>;
}

export interface ScreenAgentDeps {
  capture(windowId: number): Promise<Capture>;
  /** One Codex turn on the screen profile; resolves to its final answer. */
  ask(prompt: string, capture: Capture, signal: AbortSignal): Promise<string>;
  /** Runs the helper's `act`; throws HelperError when a check fails. */
  act(windowId: number, request: ActRequest): Promise<{ valueMatches?: boolean }>;
  emit(event: AgentEvent): void;
  /** Shows Poko at the target on screen; hidden again by `hideOverlay`. */
  point(snapshot: WindowSnapshot, element: AxElement, say: string): void;
  hideOverlay(): Promise<void>;
  ownPid: number;
}

const intentFor: Record<"click" | "type" | "reveal", Exclude<ActKind, "check">> = {
  click: "press",
  type: "type",
  reveal: "reveal",
};

const refusals: Record<string, string> = {
  not_pressable: "this browser doesn't let Poko press it",
  not_typable: "it can't be typed into",
  covered: "something covers it",
  inner_control: "another control sits where Poko would click; target that control instead",
  not_visible: "it isn't fully on screen; reveal it first",
  unsafe_link: "the link isn't a safe web page",
  not_web_content: "it isn't part of the web page",
  look_only_app: "Poko can't act in this app",
  target_changed: "it changed",
  target_gone: "it is gone",
  window_not_found: "the window is gone",
  window_not_matched: "the window couldn't be found",
  window_ambiguous: "the window couldn't be told apart from another",
  bad_request: "the request was invalid",
};

class Stopped extends Error {}

type ActionStep = Exclude<ScreenStep, { action: { kind: "done" } }>;

/**
 * Runs one screen task: look, propose one step, wait for the user's approval on the card,
 * check again, act, and look again. Every action needs its own approval, a stop ends it at
 * once, and nothing runs after a stop.
 */
export class ScreenAgent {
  private readonly controller = new AbortController();
  private pending: {
    requestId: string;
    resolve: (choice: ApprovalChoice | "expired") => void;
  } | null = null;
  private requestCount = 0;

  constructor(private readonly deps: ScreenAgentDeps) {}

  get stopped(): boolean {
    return this.controller.signal.aborted;
  }

  hasPending(requestId: string): boolean {
    return this.pending?.requestId === requestId;
  }

  respond(requestId: string, choice: ApprovalChoice): boolean {
    if (!this.pending || this.pending.requestId !== requestId) return false;
    this.pending.resolve(choice);
    return true;
  }

  /** Stops everything. A step waiting for approval is declined; nothing acts afterwards. */
  stop(): void {
    this.controller.abort();
    this.pending?.resolve("decline");
  }

  async run(windowId: number, goal: string): Promise<void> {
    const { deps } = this;
    deps.emit({ type: "started" });
    const history: StepRecord[] = [];
    let refusedInRow = 0;
    try {
      for (let step = 0; step < MAX_STEPS; step += 1) {
        this.throwIfStopped();
        deps.emit({ type: "thinking", message: "화면을 보고 다음 단계를 정하고 있어." });
        await deps.hideOverlay();
        const capture = await deps.capture(windowId);
        try {
          const reply = await deps.ask(
            buildStepPrompt(goal, history, capture.snapshot),
            capture,
            this.controller.signal,
          );
          this.throwIfStopped();
          const proposed = parseStep(reply, capture.snapshot);
          if (!proposed) {
            deps.emit({
              type: "error",
              error: "포코가 다음 단계를 정하지 못했어. 다시 시도해 줘.",
            });
            return;
          }
          if (proposed.action.kind === "done") {
            deps.emit({ type: "completed", result: proposed.say });
            return;
          }
          const outcome = await this.runStep(windowId, proposed as ActionStep, capture);
          this.throwIfStopped();
          if (outcome === "declined" || outcome === "expired") {
            deps.emit({
              type: "completed",
              result:
                outcome === "declined"
                  ? "알겠어. 여기서 멈출게."
                  : "확인을 오래 기다려서 여기서 멈췄어.",
            });
            return;
          }
          history.push({ say: proposed.say, outcome: outcome.text });
          refusedInRow = outcome.refused ? refusedInRow + 1 : 0;
          if (refusedInRow >= MAX_REFUSALS) {
            deps.emit({
              type: "error",
              error: "안전하게 할 수 있는 단계를 찾지 못해서 멈췄어.",
            });
            return;
          }
        } finally {
          await capture.release();
        }
      }
      deps.emit({ type: "completed", result: `${MAX_STEPS}단계까지 진행해서 여기서 멈췄어.` });
    } catch (error) {
      if (error instanceof Stopped || this.stopped) {
        deps.emit({ type: "cancelled" });
        return;
      }
      console.error("Screen task failed.", error);
      deps.emit({ type: "error", error: "화면 작업을 마치지 못했어. 다시 시도해 줘." });
    } finally {
      this.pending = null;
      await deps.hideOverlay();
    }
  }

  /** Checks, asks, re-checks, and acts for one proposed step. */
  private async runStep(
    windowId: number,
    step: ActionStep,
    capture: Capture,
  ): Promise<{ text: string; refused: boolean } | "declined" | "expired"> {
    const { deps } = this;
    const { action } = step;
    const element = elementById(capture.snapshot, action.elementId);
    if (!element?.frame) return { text: "refused: the element is gone", refused: true };
    const intent = intentFor[action.kind];
    const text = action.kind === "type" ? action.text : undefined;
    const request = (kind: ActKind) =>
      actRequest(element, kind, {
        ...(kind === "check" ? { intent } : {}),
        ...(text !== undefined ? { text } : {}),
        ignorePid: deps.ownPid,
      });

    try {
      await deps.act(windowId, request("check"));
    } catch (error) {
      return { text: `refused: ${refusalReason(error)}`, refused: true };
    }
    const rect = cropRect(element.frame, capture.snapshot.window.frame, capture.imageSize, {
      visiblePart: action.kind === "reveal",
    });
    if (!rect) return { text: "refused: it isn't fully in the picture", refused: true };

    let shown = capture.crop(rect);
    for (let asks = 0; ; asks += 1) {
      const choice = await this.askUser(
        step.say,
        element,
        action.kind,
        shown.dataUrl,
        text,
        capture,
      );
      if (choice !== "approve") return choice === "expired" ? "expired" : "declined";
      this.throwIfStopped();
      // The overlay leaves before Poko looks again, so the fresh crop shows only the page.
      await deps.hideOverlay();
      const fresh = await deps.capture(windowId);
      try {
        const now = fresh.crop(rect);
        if (changedPixelShare(shown.bitmap, now.bitmap) <= MAX_SILENT_CHANGE) break;
        // The page changed since the user looked: show what is there now and ask again.
        if (asks + 1 >= MAX_REASKS)
          return { text: "refused: the page kept changing", refused: true };
        shown = now;
      } finally {
        await fresh.release();
      }
    }

    this.throwIfStopped();
    let result: { valueMatches?: boolean };
    try {
      result = await deps.act(windowId, request(intent));
    } catch (error) {
      // A check that refused means nothing happened. A timeout or a failed call may have acted
      // anyway, so Codex is told to look before repeating it.
      if (error instanceof HelperError && error.code in refusals)
        return { text: `refused just before acting: ${refusalReason(error)}`, refused: true };
      deps.emit({
        type: "tool",
        tool: "screen",
        detail: "동작 결과를 확인하지 못했어. 화면을 다시 보고 이어갈게.",
      });
      return {
        text: "result unknown: it may or may not have happened; check the screen before repeating it",
        refused: false,
      };
    }
    const name = elementName(element);
    const done =
      action.kind === "type"
        ? result.valueMatches
          ? `‘${name}’에 입력했어.`
          : `‘${name}’에 입력했지만 페이지가 값을 받지 않았어.`
        : action.kind === "click"
          ? `‘${name}’을(를) 눌렀어.`
          : `‘${name}’이(가) 보이게 했어.`;
    deps.emit({ type: "tool", tool: "screen", detail: done });
    return {
      text:
        action.kind === "type" && !result.valueMatches
          ? "done, but the field did not take the text"
          : "done",
      refused: false,
    };
  }

  private askUser(
    say: string,
    element: AxElement,
    action: ScreenActionPreview["action"],
    crop: string,
    text: string | undefined,
    capture: Capture,
  ): Promise<ApprovalChoice | "expired"> {
    const requestId = `step-${++this.requestCount}`;
    const target = elementName(element);
    const warning = riskWarning(element.label, say, text);
    const screen: ScreenActionPreview = {
      action,
      crop,
      target,
      ...(text !== undefined ? { text } : {}),
      ...(warning ? { warning } : {}),
    };
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.pending?.resolve("expired"), APPROVAL_TIMEOUT_MS);
      timer.unref?.();
      this.pending = {
        requestId,
        resolve: (choice) => {
          clearTimeout(timer);
          this.pending = null;
          resolve(choice);
        },
      };
      this.deps.point(capture.snapshot, element, say);
      this.deps.emit({
        type: "approvalRequired",
        requestId,
        kind: "screen_action",
        summary: say,
        cwd: null,
        reason: null,
        screen,
        canApprove: true,
      });
    });
  }

  private throwIfStopped(): void {
    if (this.stopped) throw new Stopped();
  }
}

function refusalReason(error: unknown): string {
  return error instanceof HelperError ? (refusals[error.code] ?? error.code) : "the check failed";
}
