import { randomUUID } from "node:crypto";
import type {
  AgentEvent,
  AgentTask,
  ApprovalChoice,
  EngineId,
  TaskEventPayload,
  TaskUsage,
  UsageLimitWindow,
} from "../shared";
import { takeMemorySuggestion } from "../shared";
import type { AgentProvider, SessionReport } from "./AgentProvider";
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
  /**
   * A conversation task that keeps an engine session on `engine` (Phase 20): it continues
   * `resumeId` when given, with `catchUp` (answers that session never saw) instead of history.
   */
  session?: { engine: EngineId; resumeId?: string; catchUp: TaskContext["history"] };
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

const EDITS_RULE =
  "Edits are allowed in this workspace. When the user asks for a change, propose it right away with your file-editing (patch) tool, even if earlier messages said the workspace was read-only; Poko shows the diff and the user approves or declines it, so the sandbox needs no write access. Don't move or rename files, and don't change binary files. Safety: Shell commands that need approval are always declined, so don't use the shell to write files. Never broaden permissions, use network access, delete data, change git state, deploy, or affect external services. Stop and explain when the requested action cannot be approved safely.";

const READ_ONLY_RULE =
  "Safety: this workspace is read-only. Do not propose file changes; the user has not turned on edits. If the request needs changes, describe them and say the user can allow edits with the ‘읽기 전용’ button under the message box. Shell commands that need approval are always declined. Never broaden permissions, use network access, delete data, change git state, deploy, or affect external services.";

const terminalEvents = new Set<AgentEvent["type"]>(["completed", "cancelled", "error"]);

export class AgentCore {
  private readonly activeTasks = new Map<string, AbortController>();
  private idleWaiters = new Set<() => void>();
  private idleListeners = new Set<() => void>();

  constructor(
    private readonly provider: AgentProvider,
    private readonly publish: (payload: TaskEventPayload) => void,
    private readonly codingSkill = "",
    /** What runs report besides events: their session (Phase 20) and usage (Phase 21). */
    private readonly hooks: {
      onSession?: (taskId: string, report: SessionReport) => void;
      onUsage?: (taskId: string, usage: TaskUsage) => void;
      onLimits?: (engine: EngineId, windows: Record<string, UsageLimitWindow>) => void;
    } = {},
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
          // A routine run never keeps a session: each run reports the state now.
          ...(input.session && !input.routine
            ? {
                engine: input.session.engine,
                session: input.session.resumeId
                  ? {
                      resumeId: input.session.resumeId,
                      resumePrompt: this.buildResumePrompt(
                        input.prompt,
                        input.context,
                        input.editsEnabled === true,
                        input.session.catchUp,
                      ),
                    }
                  : {},
              }
            : {}),
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

  /**
   * Called each time the last active task has fully ended, after its terminal event. A task
   * may start from here (a terminal event arrives while the task still counts as active).
   */
  onIdle(listener: () => void): () => void {
    this.idleListeners.add(listener);
    return () => this.idleListeners.delete(listener);
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
      routine ? ROUTINE_NOTE : editsEnabled ? EDITS_RULE : READ_ONLY_RULE,
      this.codingSkill ? `Project guidance:\n${this.codingSkill}` : "",
      routine ? "" : MEMORY_NOTE,
      ...formatContext(context),
      `User request:\n${userPrompt}`,
    ];
    return sections.filter(Boolean).join("\n\n");
  }

  /**
   * The prompt for a resumed session: it has the earlier conversation, so only what may have
   * changed is sent, and it says that it replaces earlier rules and memory lists.
   */
  private buildResumePrompt(
    userPrompt: string,
    context: TaskContext | undefined,
    editsEnabled: boolean,
    catchUp: TaskContext["history"],
  ): string {
    const sections = [
      "Poko context for this turn. It replaces any earlier memory list and any earlier rule about edits in this conversation: where earlier messages say otherwise, follow this.",
      editsEnabled ? EDITS_RULE : READ_ONLY_RULE,
      MEMORY_NOTE,
      ...formatContext(context ? { memories: context.memories, history: [] } : undefined),
      catchUp.length > 0
        ? [
            "Exchanges in this conversation since your last answer here (Poko answered them separately), oldest first:",
            ...catchUp.map((exchange) => `User: ${exchange.request}\nPoko: ${exchange.answer}`),
          ].join("\n\n")
        : "",
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
      for await (const raw of this.provider.runTask(task, {
        signal: controller.signal,
        onSession: (report) => this.hooks.onSession?.(task.id, report),
        onUsage: (usage) => this.hooks.onUsage?.(task.id, usage),
        onLimits: (engine, windows) => this.hooks.onLimits?.(engine, windows),
      })) {
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
        for (const listener of this.idleListeners) listener();
      }
    }
  }
}
