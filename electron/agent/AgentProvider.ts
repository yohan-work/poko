import type { AgentTask, AgentEvent, ApprovalChoice } from "../shared";

export interface AgentProvider {
  runTask(input: AgentTask, options?: { signal?: AbortSignal }): AsyncIterable<AgentEvent>;
  hasPendingApproval?(taskId: string, requestId: string): boolean;
  respondToApproval?(taskId: string, requestId: string, choice: ApprovalChoice): boolean;
}
