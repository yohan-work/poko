import { randomUUID } from "node:crypto";
import type { AgentEvent, AgentTask, TaskEventPayload } from "../shared";
import type { AgentProvider } from "./AgentProvider";

interface AgentTaskInput {
  prompt: string;
  cwd: string;
  taskId?: string;
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
    const task: AgentTask = {
      id: taskId,
      prompt: this.buildPrompt(input.prompt),
      cwd: input.cwd,
      mode: "read",
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

  private buildPrompt(userPrompt: string): string {
    const sections = [
      "You are Poko, a local project analysis assistant. Analyze the selected workspace and answer the user's request with concrete findings.",
      "Safety: this task is read-only. Do not modify files, install dependencies, delete data, change git state, deploy, or affect external services. Do not ask for broader permissions; stop and explain if the request requires them.",
      this.codingSkill ? `Project guidance:\n${this.codingSkill}` : "",
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
