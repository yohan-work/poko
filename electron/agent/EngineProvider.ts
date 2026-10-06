import type { AgentEvent, AgentTask, ApprovalChoice, EngineId, ReasoningEffort } from "../shared";
import type { AgentProvider } from "./AgentProvider";

/**
 * Runs each task with the engine chosen when it starts; a change applies to the next task.
 * Screen tasks always use Codex.
 * Approvals go back to the provider that ran the task.
 */
export class EngineProvider implements AgentProvider {
  private readonly byTask = new Map<string, AgentProvider>();

  constructor(
    private readonly providers: Record<EngineId, AgentProvider>,
    private readonly engine: () => EngineId,
    private readonly model: (engine: EngineId) => string | null = () => null,
    private readonly effort: (engine: EngineId) => ReasoningEffort | null = () => null,
  ) {}

  async *runTask(input: AgentTask, options?: { signal?: AbortSignal }): AsyncIterable<AgentEvent> {
    // Screen tasks run on the chosen engine with its default model and effort.
    const screen = input.profile === "screen";
    const engine = this.engine();
    const provider = this.providers[engine];
    const model = screen ? null : this.model(engine);
    const effort = screen ? null : this.effort(engine);
    this.byTask.set(input.id, provider);
    try {
      yield* provider.runTask(
        { ...input, ...(model ? { model } : {}), ...(effort ? { effort } : {}) },
        options,
      );
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

  async prepareApproval(taskId: string, requestId: string): Promise<void> {
    await this.byTask.get(taskId)?.prepareApproval?.(taskId, requestId);
  }

  respondToApproval(taskId: string, requestId: string, choice: ApprovalChoice): boolean {
    return this.byTask.get(taskId)?.respondToApproval?.(taskId, requestId, choice) ?? false;
  }
}
