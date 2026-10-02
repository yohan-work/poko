import { randomUUID } from "node:crypto";
import type { AgentEvent, AgentTask, ApprovalChoice, TaskEventPayload } from "../shared";
import type { AgentProvider } from "./AgentProvider";
import { formatContext, type TaskContext } from "./context";

interface AgentTaskInput {
  prompt: string;
  cwd: string;
  taskId?: string;
  context?: TaskContext;
  /** A screen task: the prompt is already complete and a screenshot is attached. */
  screen?: { images: string[] };
  /** The user allowed edits in this workspace. */
  editsEnabled?: boolean;
}

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
        }
      : {
          id: taskId,
          prompt: this.buildPrompt(input.prompt, input.context, input.editsEnabled),
          cwd: input.cwd,
          mode: "read",
          profile: "project",
          editsEnabled: input.editsEnabled === true,
        };

    this.activeTasks.set(taskId, controller);
    void this.run(task, controller);
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

  get hasActiveTasks(): boolean {
    return this.activeTasks.size > 0;
  }

  whenIdle(): Promise<void> {
    if (!this.hasActiveTasks) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  private buildPrompt(userPrompt: string, context?: TaskContext, editsEnabled = false): string {
    const sections = [
      "You are Poko, a local project assistant. Analyze the selected workspace and answer the user's request with concrete findings.",
      editsEnabled
        ? "Edits are allowed in this workspace. When the user asks for a change, propose it right away with your file-editing (patch) tool, even if earlier messages said the workspace was read-only; Poko shows the diff and the user approves or declines it, so the sandbox needs no write access. Don't move or rename files, and don't change binary files. Safety: Shell commands that need approval are always declined, so don't use the shell to write files. Never broaden permissions, use network access, delete data, change git state, deploy, or affect external services. Stop and explain when the requested action cannot be approved safely."
        : "Safety: this workspace is read-only. Do not propose file changes; the user has not turned on edits. If the request needs changes, describe them and say the user can allow edits from the folder menu. Shell commands that need approval are always declined. Never broaden permissions, use network access, delete data, change git state, deploy, or affect external services.",
      this.codingSkill ? `Project guidance:\n${this.codingSkill}` : "",
      ...formatContext(context),
      `User request:\n${userPrompt}`,
    ];
    return sections.filter(Boolean).join("\n\n");
  }

  private async run(task: AgentTask, controller: AbortController): Promise<void> {
    let terminalSeen = false;

    try {
      for await (const event of this.provider.runTask(task, { signal: controller.signal })) {
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
