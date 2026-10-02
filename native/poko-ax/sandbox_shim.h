#include <sys/types.h>

/// Writes the pids of the user's processes that run under one Poko task's sandbox profile, and
/// returns how many. A process matches when it is sandboxed, may write both `writable` (the
/// task's own temp folder) and `workspace`, and may not read `/Users`. App Sandbox apps can't
/// write an arbitrary project folder, and a process can't change its profile.
int poko_task_processes(const char *writable, const char *workspace, pid_t *out, int capacity);

/// Whether one process matches the same profile rule (1) or not (0).
int poko_task_process_matches(pid_t pid, const char *writable, const char *workspace);
