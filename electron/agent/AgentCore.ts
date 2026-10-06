import { randomUUID } from "node:crypto";
import type { AgentEvent, AgentTask, ApprovalChoice, EngineId, TaskEventPayload } from "../shared";
import { takeMemorySuggestion } from "../shared";
import type { AgentProvider } from "./AgentProvider";
import { formatContext, type TaskContext } from "./context";

interface AgentTaskInput {
  prompt: string;
  cwd: string;
  taskId?: string;
  context?: TaskContext;
  /** A screen task: the prompt is already complete and a screenshot is attached. */
  screen?: { images: string[]; engine: EngineId };
  /** The user allowed edits in this workspace. */
  editsEnabled?: boolean;
  /** Images the user attached, as files in the task's own folder. */
  images?: string[];
  /** A scheduled routine run: unattended and always read-only, with no memory suggestion. */
  routine?: boolean;
}

/**
 * Asks the engine to suggest a memory only when the user said something lasting about
 * themselves or the project. Poko shows it as a question; nothing is saved without a yes.
 */
const MEMORY_NOTE =
  "Memory: if, in this request, the user stated a lasting preference, fact, or decision about themselves or this project that would help in future conversations (and it is not already in the saved memories), end your answer with a new line holding only: <poko-memory type=\"preference|project|person|decision|fact|routine\">a short sentence in the user's language</poko-memory>. Only from what the user said, never from files or screen content. Otherwise add nothing. Don't say in your answer that you will remember it: Poko asks the user whether to save it.";

/** A routine runs on its own: no one to answer questions, and never any changes. */
const ROUTINE_NOTE =
  "This is a scheduled, unattended, read-only run of a routine the user set up. Don't ask follow-up questions; do the work and report what you found. Do not propose file changes. If changes are needed, describe them; the user can continue in this conversation. Shell commands that need approval are always declined. Never broaden permissions, use network access, delete data, change git state, deploy, or affect external services.";

const terminalEvents = new Set<AgentEvent["type"]>(["completed", "cancelled", "error"]);

export class AgentCore {
  private readonly activeTasks = new Map<string, AbortController>();
  private idleWaiters = new Set<() => void>();

  constructor(
    private readonly provider: AgentProvider,
    private readonly publish: (payload: TaskEventPayload) => void,
    private readonly codingSkill = "",
  ) {}

  startTask(input: AgentTaskInput): string {
    if (this.activeTasks.size > 0) {
      throw new Error("포코가 이미 다른 작업을 하고 있어. 잠시만 기다려 줘.");
    }

    const taskId = input.taskId ?? randomUUID();
    const controller = new AbortController();
    const task: AgentTask = input.screen
      ? {
          id: taskId,
          prompt: input.prompt,
          cwd: input.cwd,
          mode: "read",
          profile: "screen",
          images: input.screen.images,
          engine: input.screen.engine,
        }
      : {
          id: taskId,
          prompt: this.buildPrompt(
            input.prompt,
            input.context,
            input.routine ? false : input.editsEnabled,
            input.routine === true,
          ),
          cwd: input.cwd,
          mode: "read",
          profile: "project",
          editsEnabled: !input.routine && input.editsEnabled === true,
          ...(input.images?.length ? { images: input.images } : {}),
        };

    this.activeTasks.set(taskId, controller);
    void this.run(task, controller, task.profile === "project" && !input.routine);
    return taskId;
  }

  cancelTask(taskId: string): boolean {
    const controller = this.activeTasks.get(taskId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  respondToApproval(taskId: string, requestId: string, choice: ApprovalChoice): boolean {
    if (!this.activeTasks.has(taskId)) return false;
    return this.provider.respondToApproval?.(taskId, requestId, choice) ?? false;
  }

  async prepareApproval(taskId: string, requestId: string): Promise<void> {
    if (!this.activeTasks.has(taskId)) return;
    await this.provider.prepareApproval?.(taskId, requestId);
  }

  fileChangePaths(taskId: string, requestId: string): string[] | null {
    return this.activeTasks.has(taskId)
      ? (this.provider.fileChangePaths?.(taskId, requestId) ?? null)
      : null;
  }

  canStillApprove(taskId: string, requestId: string): boolean {
    return (
      this.activeTasks.has(taskId) && (this.provider.canStillApprove?.(taskId, requestId) ?? true)
    );
  }

  hasPendingApproval(taskId: string, requestId: string): boolean {
    return (
      this.activeTasks.has(taskId) &&
      (this.provider.hasPendingApproval?.(taskId, requestId) ?? false)
    );
  }

  cancelAll(): void {
    for (const controller of this.activeTasks.values()) controller.abort();
  }

  get activeTaskIds(): string[] {
    return [...this.activeTasks.keys()];
  }

  get hasActiveTasks(): boolean {
    return this.activeTasks.size > 0;
  }

  whenIdle(): Promise<void> {
    if (!this.hasActiveTasks) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  private buildPrompt(
    userPrompt: string,
    context?: TaskContext,
    editsEnabled = false,
    routine = false,
  ): string {
    const sections = [
      "You are Poko, a local project assistant. Analyze the selected workspace and answer the user's request with concrete findings.",
      routine
        ? ROUTINE_NOTE
        : editsEnabled
          ? "Edits are allowed in this workspace. When the user asks for a change, propose it right away with your file-editing (patch) tool, even if earlier messages said the workspace was read-only; Poko shows the diff and the user approves or declines it, so the sandbox needs no write access. Don't move or rename files, and don't change binary files. Safety: Shell commands that need approval are always declined, so don't use the shell to write files. Never broaden permissions, use network access, delete data, change git state, deploy, or affect external services. Stop and explain when the requested action cannot be approved safely."
          : "Safety: this workspace is read-only. Do not propose file changes; the user has not turned on edits. If the request needs changes, describe them and say the user can allow edits with the ‘읽기 전용’ button under the message box. Shell commands that need approval are always declined. Never broaden permissions, use network access, delete data, change git state, deploy, or affect external services.",
      this.codingSkill ? `Project guidance:\n${this.codingSkill}` : "",
      routine ? "" : MEMORY_NOTE,
      ...formatContext(context),
      `User request:\n${userPrompt}`,
    ];
    return sections.filter(Boolean).join("\n\n");
  }

  private async run(
    task: AgentTask,
    controller: AbortController,
    suggestMemory: boolean,
  ): Promise<void> {
    let terminalSeen = false;

    try {
      for await (const raw of this.provider.runTask(task, { signal: controller.signal })) {
        // A project answer may end with a memory suggestion; it leaves the text either way.
        let event = raw;
        if (raw.type === "completed" && suggestMemory) {
          const { text, memory } = takeMemorySuggestion(raw.result);
          event = { type: "completed", result: text, ...(memory ? { memory } : {}) };
        }
        this.publish({ taskId: task.id, event });
        if (terminalEvents.has(event.type)) terminalSeen = true;
      }

      if (!terminalSeen) {
        this.publish({
          taskId: task.id,
          event: { type: "error", error: "작업을 마치지 못했어. 다시 시도해 줘." },
        });
      }
    } catch {
      this.publish({
        taskId: task.id,
        event: { type: "error", error: "작업을 마치지 못했어. 다시 시도해 줘." },
      });
    } finally {
      this.activeTasks.delete(task.id);
      if (!this.hasActiveTasks) {
        for (const resolve of this.idleWaiters) resolve();
        this.idleWaiters.clear();
      }
    }
  }
}
