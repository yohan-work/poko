# Phase 05 — Conversation quality

## Goal

Make Poko feel like one continuous conversation instead of a series of unrelated requests. Poko should use what the user asked it to remember and what was just discussed, show its answer as it is written, and render that answer as readable formatted text.

## Why now

Today every request starts from scratch. `AgentCore.buildPrompt` sends only the fixed instructions, the coding skill, and the current message. Memories saved in the Memory tab are stored but never reach the model, and a follow-up like "아까 그거 다시 설명해 줘" has no context. Answers appear only when the task completes, and Markdown from Codex (code blocks, lists) is shown as raw text. None of this widens permissions, so it improves the experience without adding execution risk.

## Decisions

### Context: memories and recent conversation

- The main process assembles context from SQLite. The renderer does not send history or memories with a task request.
- Agent Core receives a typed `TaskContext { memories, history }` from main and formats the prompt. That keeps formatting provider-independent and unit-testable. A future Claude provider gets the same context.
- **Memories:** include saved memories ordered by importance, then most recently updated. Cap at 40 entries and about 6,000 characters total, and truncate each entry to 1,000 characters. Label the section as user-written preferences and facts that never override the safety rules.
- **History:** include the most recent completed exchanges from the current conversation, as the user request plus Poko's final answer. Cap at 5 exchanges and about 8,000 characters, truncating each side to 2,000 characters. Select newest first until a cap is reached, then reverse into chronological order. That way the cap drops the oldest exchange, never the one a follow-up refers to. Failed and cancelled tasks are left out so error text doesn't become context.
- To get clean, conversation-scoped exchanges, one migration adds two nullable columns to `tasks`:
  - `result`, set when a task completes. Don't infer exchanges from the `messages` table, which also holds failure and cancellation messages.
  - `conversation_id`, a foreign key to `conversations`, set when a task is created. History is filtered by it, so Phase 07's multiple conversations don't leak into each other.
  - The foreign key uses `ON DELETE SET NULL`. Tasks are separate from the conversation (see `AGENTS.md`), so deleting a conversation in Phase 07 keeps the task, Activity, and approval history. Set this in the first migration: changing a delete action later makes drizzle-kit rebuild `tasks`, and inside the migrator's transaction that `DROP TABLE` would cascade into `activities` and `approvals`.
- The migration backfills both columns. Existing tasks get the single existing conversation. Completed tasks get their result from the assistant message written in the same transaction, which has exactly the same timestamp as `completed_at`. Rows that still have no result are skipped, not sent as empty answers.
- Prompt order: role, safety rules, project guidance, saved memories, recent conversation, current request.
- Keep prompt-based context instead of resuming Codex threads (`thread/resume`). Threads would tie conversation state to one provider and replay tool output. This decision can be revisited when multiple conversations arrive.
- **Transparency:** saved memories and recent exchanges are now sent to the configured provider with each request. Say so in the Memory page description and in the README security section.

### Formatted answers (Markdown)

- Render assistant messages with `react-markdown` and `remark-gfm` (tables, task lists, strikethrough). User messages stay plain text.
- Never render raw HTML. `react-markdown` escapes it by default, and Poko does not add `rehype-raw`.
- Don't load remote images: render an image as its alt text. Render links as text with the URL in a tooltip. The renderer stays unable to navigate or open windows, and opening links externally can be added later through a narrow main-process API if needed.
- Code blocks get monospace styling, horizontal scrolling, and a copy button (renderer clipboard API).

### Streaming answers

- The provider already emits `output` deltas from `item/agentMessage/delta`, but the renderer only uses them to change the progress text. Extend the `output` event with the agent message item id, so the renderer can show the latest message and replace it when Codex starts a new message item.
- The renderer keeps the in-progress text for the active task and shows it as Poko's reply while the task runs. Deltas are batched per animation frame to avoid re-rendering on every token.
- When the task completes, the persisted final result replaces the streamed text. On cancel or error, the partial text is discarded and only the existing cancel or error message stays. Partial output is never persisted.

## Milestones

Each milestone is its own PR with review.

1. **Context:** one migration that adds and backfills `tasks.result` and `tasks.conversation_id`, a context query in `PokoDatabase`, `TaskContext` in Agent Core with prompt formatting, and the transparency copy. Tests cover caps and newest-first selection, exclusion of failed tasks, the backfill, history staying within one conversation, and prompt layout.
2. **Markdown:** assistant message rendering, safe link and image handling, and code block copy. Tests cover HTML escaping and the link and image overrides.
3. **Streaming:** item ids on `output` events through provider, preload validation, and renderer, plus streaming display and batching. Tests cover delta grouping by item and the cancel and error cleanup.

## Explicitly deferred

- Multiple conversations and the sidebar conversation list (Phase 07).
- Automatic memory extraction, embeddings, and relevance ranking. Explicit memories are included by the simple ordering above.
- A per-request or global switch to leave memories out of the prompt. Revisit if users ask for it.
- Token counting. Character caps keep the prompt bounded for now.

## Acceptance criteria

- A saved memory visibly changes the answer, for example a tone preference.
- A follow-up that refers to the previous answer works without restating it.
- Failed and cancelled tasks never appear in the prompt history.
- Assistant answers show formatted code blocks, lists, and tables. Raw HTML is shown as text, and remote images are not loaded.
- The answer appears progressively while Codex writes it, and a cancelled task leaves no partial answer behind.
- `pnpm check`, `pnpm format:check`, and the new tests pass.

## Implementation status

- **Milestone 1 (context):** done.
  - Migration `20261001020914_task_context` adds `tasks.conversation_id` (`ON DELETE SET NULL`) and `tasks.result` with plain `ALTER TABLE` statements and an index, and backfills both columns.
  - `PokoDatabase.getTaskContext` reads memories and same-conversation exchanges. `limitContext` and `formatContext` in `electron/agent/context.ts` apply the caps and build the prompt sections.
  - Startup task DTOs now select explicit columns, so prompts and results stay in main.
  - Tests cover the caps and newest-first selection, prompt order, failed and cancelled exclusion, conversation isolation, and the backfill on a database created with the earlier migrations.
- **Milestone 2 (Markdown):** done.
  - `components/chat/Markdown.tsx` renders assistant answers with `react-markdown` 10 and `remark-gfm` 4. Its default escapes raw HTML, inline and block, so it shows as text and never becomes an element.
  - Links render as text with the URL as a tooltip, and images render as their alt text. Code blocks get a copy button.
  - Server-rendered tests cover the formatting, the HTML escaping, and the link and image overrides.
