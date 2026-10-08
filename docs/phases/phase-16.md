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
  - `conversations.workspace_path` (nullable) and `memories.workspace_path` (nullable);
  - the migration backfills a conversation's folder from its latest task **whose workspace is a real path** (starts with `/`). Screen tasks store `screen:{app}` and are skipped, so a conversation that only has screen tasks stays without a folder;
  - existing memories stay null (shared).
- **When a conversation gets its folder:**
  - `createTask` sets it whenever the conversation's folder is still null and the task's workspace is a real path. That covers new conversations, old folderless ones, and conversations that only had screen tasks;
  - `ensureRoutineConversation(id, folder)` creates a 🔁 conversation with the routine's resolved folder already set, so it has one even if its first task never gets recorded.
- **Comparing folders:** both sides are resolved paths (`realpath`). The selected folder is resolved with `resolveWorkspaceDirectory`, as `startConversationTask` already does.
- **Sending:**
  - `startConversationTask` refuses when the conversation has a folder and it differs from the resolved selected folder ("이 대화는 {A} 폴더에서 나눈 대화야. {A}로 바꾼 뒤 이어서 물어봐 줘."), or when that folder no longer exists ("…폴더를 찾지 못했어. 새 대화에서 물어봐 줘.");
  - this replaces the routine-only check from Phase 15.
- **Switching:**
  - `workspace:use-conversation-folder(conversationId)` sets the selected folder to that conversation's stored folder after checking that it still exists;
  - the renderer never sends a path;
  - main refuses it while `anyTaskBusy()` or `ctx.deletingData`. `workspace:select` gets the same guard, because it has none today.
- **The renderer's view:**
  - `PersistedConversation` gains `workspacePath` (and `workspaceName`), added to every conversation query (`listConversations`, `getConversation`, `searchConversations`, the task-start reply, and the `taskStarted` notice), so the copy the renderer holds updates when a conversation gets its folder;
  - `WorkspaceInfo` gains `realPath`, resolved in main. `workspaceInfo()` and `bootstrapData()` become async for this, and `realPath` is null when the selected folder is missing;
  - the chat panel shows the line when the active conversation has a folder and it differs from `realPath`.
- **Memories in context:** `getTaskContext` selects memories where `workspace_path IS NULL OR workspace_path = <the task's real folder>`. A screen task (no real folder) gets only shared memories.
- **Saving a memory:**
  - the IPC handler, not the database, resolves the scope: `project` and `decision` belong to a folder, and the other types are shared;
  - **from a suggestion**, the scope is the suggesting task's folder (`getTaskWorkspace`), not whatever is selected when the user clicks 기억하기. The renderer sends the task id with the suggestion, and the quick panel uses the task it kept. A suggestion from a screen task is saved shared;
  - **typed on the 기억 page**, the scope is the selected folder, resolved. If no folder is selected or it is missing, a 프로젝트 or 결정 memory is refused ("먼저 작업할 폴더를 선택해 줘.") rather than quietly saved as shared;
  - `saveMemory(input, folder | null)` takes the resolved scope.
- **Duplicates:**
  - a memory counts as a duplicate when type and content match and the existing one is either shared or in the same folder;
  - the same rule applies to the suggestion filter in `deliverTaskEvent`, which uses the suggesting task's folder;
  - so a folder memory never repeats a shared one, and folder B can still learn something folder A already knows.
- **Quick panel and routines:**
  - a quick-panel question always starts a new conversation in the selected folder;
  - a routine's conversation carries the routine's folder (see above).

## Milestones (one PR each)

1. **Conversations:**
   - the migration (both columns, the backfill skipping screen tasks);
   - setting the folder in `createTask` and `ensureRoutineConversation`;
   - the send refusal;
   - `workspace:use-conversation-folder`, plus the busy guard on both folder calls;
   - `realPath`, and the chat-panel line.

   Tests cover the refusal, a screen-only conversation, a routine conversation without tasks, the switch call's checks, and the backfill.
2. **Memories:**
   - scoped saving, from a suggestion's task or the selected folder;
   - the context filter;
   - the duplicate rule in both places;
   - the 기억 page's folder names and filter.

   Tests cover the context filter, the suggestion scope after a folder switch, the refusal without a folder, and duplicates against shared memories.

## Explicitly deferred

- Moving a conversation or memory to another folder.
- Several folders open at once.

## Status

- **Milestone 1 (conversations) is done.** Checked in the real app by upgrading a test profile made with the previous build:
  - the conversation got its folder from the backfill;
  - with another folder selected, it showed the line, refused a follow-up with the same message, switched with one click, and then answered from the right project.
- **Milestone 2 (memories) is done.**
  - 프로젝트 and 결정 memories are saved in a folder: a suggestion's in the folder of the task that made it, and a typed one in the selected folder (refused without one).
  - Tasks get shared memories plus their own folder's, and screen tasks get only shared ones.
  - One duplicate rule (`isSameMemory`) serves saving and the suggestion filter.
  - The 기억 page shows "· {folder} 폴더" or "· 모든 폴더", and can filter to what the selected folder uses.
  - **Real app:** with a project memory in projA and another in projB, a question in projB answered with projB's, and the page's filter showed only shared and projB memories.

