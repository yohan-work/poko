#include "sandbox_shim.h"
#include <libproc.h>
#include <stdlib.h>
#include <unistd.h>

// Private but stable libsystem_sandbox call; it is variadic, so it is called from C.
enum { POKO_FILTER_NONE = 0, POKO_FILTER_PATH = 1 };
extern int sandbox_check(pid_t pid, const char *operation, int type, ...);

int poko_task_process_matches(pid_t pid, const char *writable, const char *workspace) {
  if (pid <= 0 || pid == getpid()) return 0;
  if (sandbox_check(pid, NULL, POKO_FILTER_NONE) != 1) return 0;
  // 0 means allowed: only this task's profile may write its unique temp folder.
  if (sandbox_check(pid, "file-write-data", POKO_FILTER_PATH, writable) != 0) return 0;
  // App Sandbox apps (and system services) can't write an arbitrary project folder.
  if (sandbox_check(pid, "file-write-data", POKO_FILTER_PATH, workspace) != 0) return 0;
  // 1 means denied: only Poko's read rules deny /Users.
  if (sandbox_check(pid, "file-read-data", POKO_FILTER_PATH, "/Users") != 1) return 0;
  return 1;
}

int poko_task_processes(const char *writable, const char *workspace, pid_t *out, int capacity) {
  int bytes = proc_listpids(PROC_UID_ONLY, getuid(), NULL, 0);
  if (bytes <= 0) return 0;
  pid_t *pids = malloc((size_t)bytes);
  if (!pids) return 0;
  bytes = proc_listpids(PROC_UID_ONLY, getuid(), pids, bytes);
  int found = 0;
  for (int i = 0; i < bytes / (int)sizeof(pid_t) && found < capacity; i++)
    if (poko_task_process_matches(pids[i], writable, workspace)) out[found++] = pids[i];
  free(pids);
  return found;
}
