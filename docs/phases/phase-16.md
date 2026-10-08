# Phase 16 — Conversations and project memories belong to a folder

## Goal

Keep one project's context out of another project's answers.

Today a conversation has no folder: a follow-up runs in whatever folder is selected now, while it carries the earlier answers of the conversation's own project. Every memory, including "this project uses pnpm", also goes to every task in every folder. Both mix projects silently, and the user can't tell from the answer.

## What the user experiences

- **A conversation remembers its folder.** It is the folder of the conversation's first task.
  - If another folder is selected when the user opens it, a line above the message box says "이 대화는 {A} 폴더에서 나눈 대화야." with a **{A}로 바꾸기** button. One click switches the selected folder, with no folder dialog.
  - Sending a follow-up while another folder is selected is refused with the same message, so it can never run against the wrong project.
  - If the conversation's folder no longer exists, the line says so and suggests a new conversation.
  - The sidebar shows nothing new; the line appears only when the folders differ.
- **Project memories belong to a folder.**
  - A memory of type **프로젝트** or **결정**, whether typed on the 기억 page or saved from a suggestion, belongs to the folder selected when it is saved.
  - It goes only to tasks in that folder. 취향, 사람, 정보, and 루틴 still go to every task.
  - The 기억 page shows a folder name on each folder memory, and can show **이 폴더만** or **모두**.
- **Older data:**
  - Existing conversations take the folder of their latest task. A conversation with no task (rare) has no folder and works as today.
  - Existing project and decision memories have no known folder, so they stay shared. The 기억 page marks them **모든 폴더**, and the user can delete them.

## Design

- **Storage** (one migration):
  - `conversations.workspace_path` (nullable). It is filled when the conversation's first task is recorded, from the task's resolved folder (`realpath`, as tasks already store it). The migration backfills it from each conversation's latest task.
  - `memories.workspace_path` (nullable). The migration leaves existing rows null.
- **Comparing folders:** both sides are resolved paths. The selected folder is resolved with `resolveWorkspaceDirectory` before comparing, as `startConversationTask` already does.
- **Sending:**
  - `startConversationTask` refuses when the conversation's folder differs from the resolved selected folder, or no longer exists.
  - This replaces the routine-only check from Phase 15, since a routine's conversation now has the routine's folder like any other.
- **Switching:**
  - a new IPC call, `workspace:use-conversation-folder(conversationId)`, sets the selected folder to that conversation's stored folder after checking that the folder exists;
  - the renderer never sends a path;
  - it is refused while a task runs or starts, as selecting a folder should be.
- **Renderer:**
  - `PersistedConversation` gains `workspacePath`, and `WorkspaceInfo` gains `realPath`, the selected folder resolved in main. The store compares the two; the paths are already shown to the user in the folder button's tooltip;
  - the chat panel shows the line and the button.
- **Memories in context:**
  - `getTaskContext` selects memories where `workspace_path IS NULL OR workspace_path = <the task's folder>`, ordered as today;
  - `saveMemory` stores the resolved selected folder for `project` and `decision`, and null for the other types;
  - the duplicate check (#69) compares within the same scope.
- **Quick panel and routines:**
  - a quick-panel question always starts a new conversation in the selected folder, so it gets that folder;
  - a routine run records its conversation with the routine's folder.

## Milestones (one PR each)

1. **Conversations:** the migration (both columns), recording and backfilling the conversation folder, the send refusal, `workspace:use-conversation-folder`, and the chat-panel line. Tests cover the refusal, the switch call's checks, and the backfill.
2. **Memories:** scoped saving, the context filter, the duplicate scope, and the 기억 page's folder names and filter. Tests cover the context filter and the save scope.

## Explicitly deferred

- Moving a conversation or memory to another folder.
- Several folders open at once.
