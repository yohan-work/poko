import type { AgentEvent, AgentTask, ApprovalChoice, EngineId } from "../shared";
import type { AgentProvider } from "./AgentProvider";

/**
 * Runs each task with the engine chosen when it starts; a change applies to the next task.
 * Approvals go back to the provider that ran the task.
 */
export class EngineProvider implements AgentProvider {
  private readonly byTask = new Map<string, AgentProvider>();

  constructor(
    private readonly providers: Record<EngineId, AgentProvider>,
    private readonly engine: () => EngineId,
  ) {}

  async *runTask(input: AgentTask, options?: { signal?: AbortSignal }): AsyncIterable<AgentEvent> {
    const provider = this.providers[this.engine()];
    this.byTask.set(input.id, provider);
    try {
      yield* provider.runTask(input, options);
    } finally {
      this.byTask.delete(input.id);
    }
  }

  hasPendingApproval(taskId: string, requestId: string): boolean {
    return this.byTask.get(taskId)?.hasPendingApproval?.(taskId, requestId) ?? false;
  }

  canStillApprove(taskId: string, requestId: string): boolean {
    const provider = this.byTask.get(taskId);
    return provider ? (provider.canStillApprove?.(taskId, requestId) ?? true) : false;
  }

  fileChangePaths(taskId: string, requestId: string): string[] | null {
    return this.byTask.get(taskId)?.fileChangePaths?.(taskId, requestId) ?? null;
  }

  respondToApproval(taskId: string, requestId: string, choice: ApprovalChoice): boolean {
    return this.byTask.get(taskId)?.respondToApproval?.(taskId, requestId, choice) ?? false;
  }
}
