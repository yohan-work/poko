import { execFile } from "node:child_process";

/**
 * Finds the processes running under one command task's sandbox profile (see poko-ax): they may
 * write the task's temp folder and the workspace, and may not read /Users.
 */
export type TaskProcessFinder = (writableTempDir: string, workspace: string) => Promise<number[]>;

/** The live descendants of a process, so the CLI's own helpers are spared mid-task. */
export function descendantsOf(rootPid: number): Promise<Set<number>> {
  return new Promise((resolve) => {
    execFile("ps", ["-axo", "pid=,ppid="], { timeout: 5000 }, (error, stdout) => {
      const found = new Set<number>();
      if (error) return resolve(found);
      const children = new Map<number, number[]>();
      for (const line of String(stdout).split("\n")) {
        const [pid, ppid] = line.trim().split(/\s+/).map(Number);
        if (!pid || !ppid) continue;
        children.set(ppid, [...(children.get(ppid) ?? []), pid]);
      }
      const queue = [rootPid];
      while (queue.length > 0) {
        const parent = queue.shift() as number;
        for (const child of children.get(parent) ?? []) {
          if (found.has(child)) continue;
          found.add(child);
          queue.push(child);
        }
      }
      resolve(found);
    });
  });
}

type Signal = (pid: number, signal: NodeJS.Signals) => void;

const sendSignal: Signal = (pid, signal) => {
  try {
    process.kill(pid, signal);
  } catch {
    /* already gone */
  }
};

/**
 * Stops a task's leftover processes. Each one is paused first and checked again, so a pid that
 * was reused by another process in between is resumed instead of killed. Returns how many
 * were stopped.
 */
export async function stopTaskProcesses(
  find: TaskProcessFinder,
  writableTempDir: string,
  workspace: string,
  spare: ReadonlySet<number> = new Set(),
  signal: Signal = sendSignal,
): Promise<number> {
  const candidates = (await find(writableTempDir, workspace).catch(() => [])).filter(
    (pid) => !spare.has(pid) && pid !== process.pid,
  );
  if (candidates.length === 0) return 0;
  for (const pid of candidates) signal(pid, "SIGSTOP");
  const confirmed = new Set(await find(writableTempDir, workspace).catch(() => [] as number[]));
  let stopped = 0;
  for (const pid of candidates) {
    if (confirmed.has(pid)) {
      signal(pid, "SIGKILL");
      stopped += 1;
    } else signal(pid, "SIGCONT");
  }
  return stopped;
}
