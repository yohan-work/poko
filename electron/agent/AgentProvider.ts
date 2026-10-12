import type { AgentTask, AgentEvent, ApprovalChoice } from "../shared";

/**
 * Which engine session a task ran in (Phase 20): `kept` when it may be continued later (not an
 * ephemeral fallback), `resumed` when it continued the stored one, and `forgetPrevious` when the
 * stored one can't be continued again (the engine refused it).
 */
export interface SessionReport {
  id: string;
  resumed: boolean;
  kept: boolean;
  forgetPrevious: boolean;
}

export interface RunOptions {
  signal?: AbortSignal;
  onSession?: (report: SessionReport) => void;
}

export interface AgentProvider {
  runTask(input: AgentTask, options?: RunOptions): AsyncIterable<AgentEvent>;
  hasPendingApproval?(taskId: string, requestId: string): boolean;
  /** Whether a pending request may still be approved right now. */
  canStillApprove?(taskId: string, requestId: string): boolean;
  /** Absolute paths a pending file change writes, or null when there is none. */
  fileChangePaths?(taskId: string, requestId: string): string[] | null;
  respondToApproval?(taskId: string, requestId: string, choice: ApprovalChoice): boolean;
  /** Runs right before an approval is allowed, for example to stop leftover processes. */
  prepareApproval?(taskId: string, requestId: string): Promise<void>;
}
