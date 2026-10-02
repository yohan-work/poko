# Phase 07 — Multiple conversations

## Goal

Let the user keep separate conversations, the way Claude's sidebar does: start a new one, switch between them, rename one, and delete one. Each conversation keeps its own messages and its own follow-up context, so a question about Gmail doesn't pull in yesterday's project analysis.

## Today

- The database already has a `conversations` table, and `messages` and `tasks` point to a conversation (`tasks.conversation_id ON DELETE SET NULL`).
- But `ensureConversation()` always returns the oldest one, so everything lands in a single conversation called "대화".
- Context (`getTaskContext`) already uses only exchanges from the task's own conversation, so separating conversations also separates context.
- The sidebar lists "최근 작업" (recent tasks), which mixes everything.

## What the user experiences

- The sidebar shows **conversations**, newest activity first. Each shows its title and when it was last active. A **새 대화** button sits on top.
- 새 대화 shows the empty greeting screen. The conversation is created only when the first message is sent, so empty conversations never pile up. Its title comes from that first message (first 40 characters).
- Clicking a conversation shows its messages. While Poko is working (a task is running or waiting for approval), switching is disabled, with a hint saying why. This keeps a running task's messages, streaming text, and approval card in the conversation they belong to.
- Each conversation can be renamed and deleted from a small menu. Deleting asks for confirmation in the app and removes its messages. Its tasks and Activity stay, detached from the conversation, so the audit trail is kept.
- Screen tasks (화면 보기, 대신 해 줘) belong to the conversation they were started from, like chat tasks.
- Poko reopens the conversation that was active last.

## Design

- **Database**
  - `Database` gets `listConversations`, `getConversationMessages(id)`, `renameConversation`, and `deleteConversation`.
  - `createTask(message, workspace, conversationId | null)` creates the conversation when the id is null and returns both ids.
  - `recordTaskEvent` saves a finished task's reply into **the task's own** `tasks.conversation_id`, not the oldest conversation. This fixes a bug that one conversation hid. A task whose conversation was deleted keeps its result on the task and adds no message.
  - `ensureConversation()` goes away: bootstrap and every write path never create an empty conversation.
- **Active conversation**
  - The active conversation id is a setting (`activeConversationId`).
  - Bootstrap opens it if it still exists. Otherwise it opens the most recently active conversation, or the greeting screen (no conversation) when there are none.
  - Deleting the active conversation clears the setting.
- **Migration:** backfills the existing conversation's title from its first user message, and deletes conversations with no messages (the auto-created ones). No schema change is needed.
- **IPC**
  - `conversations:list`, `conversations:open`, `conversations:rename`, and `conversations:delete`. All are trusted-renderer only, and ids and titles are validated (title 1–80 characters).
  - `tasks:start`, `screen:look`, and `screen:act` take the conversation id (or null for a new one) and return the conversation id they used.
  - A conversation id that no longer exists is refused with a plain message ("이 대화를 찾을 수 없어. 새 대화로 다시 보내 줘."), never a database error.
  - Main refuses to delete a conversation with a running task, and refuses to open another conversation while one runs, even if the renderer allows it.
- **Renderer**
  - The store holds `conversations` and `activeConversationId`. The sidebar replaces "최근 작업" with the conversation list; the 작업 page still lists every task.
  - Rename is inline, and delete uses the app's own confirm dialog.
- **Context:** unchanged: memories plus the last exchanges of *this* conversation.

## Milestones

1. **Conversations in the sidebar:** new conversation, switch, title from the first message, reopen the last one, screen tasks in the current conversation, and the migration.
2. **Rename and delete:** an inline rename, a delete with an in-app confirmation, and refusals while a task is running.

## Milestone 1 notes (implemented)

- The sidebar lists conversations under 대화, each with a relative time and a 새 대화 button. The active one is highlighted and shows a dot while Poko works; the others and 새 대화 are disabled with a hint. The 작업 page still lists every task.
- Main refuses `conversation:open` while any task runs, and `tasks:start`, `screen:look`, and `screen:act` return `{ taskId, conversation }` and make that conversation active.
- Real run (Codex 0.159.3, separate data folder):
  - two conversations stayed apart;
  - switching showed only each one's messages;
  - a restart reopened the last active one;
  - a follow-up ("방금 한 자기소개를 영어로 바꿔 줘") used only its own conversation;
  - during the task, switching was disabled and main refused it.

## Milestone 2 notes (implemented)

- Each conversation row has a "…" menu with 이름 바꾸기 and 삭제. The menu is fixed-positioned so the list's scroll area can't clip it.
- **Rename:** inline. Enter or blur saves, Escape cancels. Main flattens whitespace and accepts 1–80 characters.
- **Delete:** an in-app dialog says the messages go and tasks and Activity stay. Main refuses while a task in that conversation is queued, running, or waiting for approval. Deleting the active conversation clears the saved setting, and the app shows the greeting screen.
- **Real run:**
  - renamed a conversation;
  - deleted another one;
  - deleting the active conversation while its task ran was refused ("포코가 이 대화에서 작업 중이라 지금은 지울 수 없어.");
  - after the task, deleting it led to the greeting screen.

## Explicitly deferred

- Searching across conversations, pinning, and folders.
- Running tasks in two conversations at the same time (one task at a time stays the rule).
- Per-conversation workspace folders (the workspace stays global).

## Acceptance criteria

- New conversations start empty, and their follow-ups use only their own history (checked through `getTaskContext`).
- Switching, renaming, and deleting work and persist across restarts. Deleting keeps tasks and Activity.
- Nothing can switch away from, or delete, a conversation while its task runs.
- Existing data migrates into one conversation titled from its first message.
- `pnpm check`, format check, and build pass, plus a GUI check of the sidebar in light and dark.
