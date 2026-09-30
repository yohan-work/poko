import type { AgentTask, AgentEvent } from "../shared";

export interface AgentProvider {
  runTask(input: AgentTask, options?: { signal?: AbortSignal }): AsyncIterable<AgentEvent>;
}
