# Phase 20 — Conversations that remember all of themselves

## Goal

A long conversation keeps everything said earlier in it, not only the last few exchanges.

## Why

- **How it works today** ([phase-05](phase-05.md)):
  - every question starts a fresh engine session (`thread/start` for Codex, `claude -p --no-session-persistence` for Claude Code);
  - Poko pastes in the conversation's last 5 completed exchanges, about 8,000 characters at most and 2,000 per side, leaving out failed and cancelled tasks.
- **The cost:** in a longer conversation, what was settled at the start falls out of context. The engine also re-reads the same instructions and memories on every question.

## What the engines offer (checked 2026-10-12: Codex 0.161.0, Claude Code 2.1.296)

- **Codex App Server:**
  - `thread/resume { threadId, cwd, sandbox, approvalPolicy, config }` reopens a stored thread with the same overrides `thread/start` takes, so Poko's read-only permission profile, edit setting, and model can be set on each resume;
  - `turn/start` can override `model`, `effort`, and `sandboxPolicy` per turn;
  - threads are kept on disk unless started `ephemeral`, and Poko's are not;
  - Codex compacts long threads on its own (`thread/compacted`);
  - `thread/tokenUsage/updated` reports token use, for the usage work that follows.
- **Claude Code:**
  - `--session-id <uuid>` names a new session, and `--resume <id>` continues it, both with `-p` and stream-json;
  - this needs session persistence, which Poko turns off today (`--no-session-persistence`);
  - Claude Code compacts long sessions on its own.

## What the user experiences

- A follow-up in a conversation remembers the whole conversation, not only its last five exchanges.
- Nothing else changes: the same messages, cards, folder rule, and memories.
- **When an engine session can't be continued,** for example after switching engines, a session that is gone, or an engine update, Poko starts a new session with today's recent-exchanges context. The answer still comes; it may know less of the early conversation.

## Design

- **Storage:**
  - `conversations.engine_session` (nullable JSON) holds `{ engine, id }`, the engine's session for that conversation;
  - it is written after the engine confirms the session (Codex's thread id, or the `--session-id` Poko chose once Claude Code reports the session), and cleared when the session can't be resumed.
- **Starting a task in a conversation:**
  - **with a stored session for the current engine:**
    - resume it, sending only the new question plus a short "Poko context" block: the current memories (they may have changed) and the current edit/read-only rule;
    - not the past exchanges, since the session has them;
  - **without one** (the first question, another engine, or a cleared session): start a new session as today, with recent exchanges, and store its id;
  - **if the resume fails** (session not found, protocol error before the turn starts): clear it, then start fresh as above, inside the same task. The user sees one answer.
- **Per-task settings are reapplied on every resume:**
  - folder, read-only or edits, the permission profile, model, and effort;
  - Codex through `thread/resume` and `turn/start` overrides;
  - Claude Code through its usual flags, which apply to each invocation.

  Nothing a session allowed before carries over to a later task that doesn't allow it.
- **Not resumed:**
  - **screen tasks**, which stay one-shot and carry images;
  - **routine runs**: each run starts fresh in the routine's conversation, so a run never depends on an earlier one. A routine is meant to report the state now.
- **Claude Code persistence:**
  - Poko drops `--no-session-persistence` only for resumable conversation tasks;
  - those sessions are then stored by Claude Code under `~/.claude/projects/…` and can appear in the user's own `claude --resume` list. This is noted in 설정 → 엔진.
- **Deleting:**
  - deleting a conversation, or 모든 데이터 삭제, also deletes its engine sessions where the engine allows it (Codex `thread/delete`). For Claude Code, Poko removes only the session files whose ids it created;
  - a failure here never blocks the delete.
- **Context size:** the engines compact on their own. Poko adds no summarizing of its own in this phase.

## Milestones (one PR each)

1. **Codex:**
   - the column and migration;
   - resume, with fallback to a fresh start;
   - storing and clearing the thread id;
   - deleting threads with their conversation.

   Real check: a long conversation where the 8th question needs a fact from the 1st.
2. **Claude Code:**
   - session ids, resume, fallback, and session-file cleanup;
   - the note in 설정.

   Same real check.

## Explicitly deferred

- Poko's own summaries of long conversations.
- Showing token use (the next step, which uses `thread/tokenUsage/updated` and Claude Code's result usage).
- Moving a conversation's session to another engine.
