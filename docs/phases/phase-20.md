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
  - `conversations.engine_session` (nullable JSON) holds the conversation's current engine session: `{ engine, id, lastTaskId, memoryHashes, dirty }`, plus for Claude Code the resolved `cwd` and the transcript's size and modification time after Poko's last run;
  - it is written only after the engine confirms the session.
- **When a stored session is used:** all of these must hold, otherwise the task starts fresh (below):
  - the conversation's engine is the current engine;
  - every memory the session was sent is still sent now (`memoryHashes`, short hashes of type and text). A memory deleted, changed, or turned off ends only the sessions that saw it, so it never reaches the engine again through old turns;
  - every answer it missed fits the catch-up (the usual history limits); otherwise there would be a gap it can't see;
  - the session's last task (`lastTaskId`) is the conversation's last *completed* task. A failed or cancelled task, as today, never becomes context: the session that saw it isn't used again;
  - for Claude Code, the transcript's size and modification time are what Poko left. If the user continued it in a terminal (`claude --resume`) under other settings, Poko doesn't take in that outside history.
- **Resuming:**
  - **Codex:**
    - `thread/resume` with `excludeTurns: true`, so a long thread's history is never sent back (Poko reads lines up to 1 MB);
    - it passes every override `thread/start` passes today: cwd, `sandbox: "read-only"`, `approvalPolicy: "on-request"`, `approvalsReviewer: "user"`, the read-only permission profile, `mcp_servers: {}`, model, and effort;
    - the reply's effective `sandbox`, `approvalPolicy`, `approvalsReviewer`, and `cwd` are checked. Anything else means Poko doesn't use the thread (as Claude Code's `system/init` check does today);
  - **Claude Code:** `--resume <id>` with the same flags as a new task;
  - **what is sent:**
    - the new question;
    - a "Poko context" block that **replaces** anything earlier in the session: the current memories and the current edit or read-only rule. It says so explicitly ("earlier memory lists and edit rules no longer apply");
    - the exchanges completed in this conversation **after** the session's last task, such as a screen answer, a routine report, or a fallback answer, so the session never misses what Poko showed in between.
- **Starting fresh** (no usable session, or the resume failed):
  - as today, with recent exchanges, on a new engine process and connection;
  - the new session replaces the stored one, and the replaced session is deleted (below);
  - **only "not found"** (the engine says it doesn't have the session) also forgets it. Any other failure (no reply, a passing error, a previous task's process still closing it) gets a one-off ephemeral answer and keeps the stored session for the next one; the next resume catches up through the "after the session's last task" exchanges.
- **Never stored or resumed:**
  - **screen tasks and routine runs** start `ephemeral` on Codex and keep `--no-session-persistence` on Claude Code, so their screenshots, screen text, and reports aren't kept by the engine;
  - they appear to the next resume through the catch-up exchanges above.
- **Claude Code persistence:**
  - only resumable conversation tasks drop `--no-session-persistence`;
  - those sessions are stored by Claude Code under `~/.claude/projects/…` and appear in the user's own `claude --resume`. This is noted in 설정 → 엔진.
- **Deleting** (deleting a conversation, replacing a session, 모든 데이터 삭제):
  - **Codex:** `thread/delete`;
  - **Claude Code:** Poko removes the session's transcript (found from the stored resolved `cwd`, and `CLAUDE_CONFIG_DIR` when the runtime sets it) and its `file-history/<id>` backups, and only for ids Poko created;
  - a failure is logged and never blocks the delete.
- **Context size:** the engines compact on their own. Poko adds no summarizing of its own in this phase.

## Milestones (one PR each)

1. **Codex:**
   - the column, the migration, and the memory counter;
   - resume with `excludeTurns`, the effective-settings check, and the catch-up exchanges;
   - fresh starts, and forgetting a session only on "not found";
   - ephemeral screen and routine tasks;
   - deleting threads.

   Real check: a long conversation where the 8th question needs a fact from the 1st.
2. **Claude Code:**
   - session ids, resume, and the transcript check;
   - fallback;
   - transcript and file-history cleanup;
   - the note in 설정.

   Same real check.

## Explicitly deferred

- Poko's own summaries of long conversations.
- Showing token use (the next step, which uses `thread/tokenUsage/updated` and Claude Code's result usage).
- Moving a conversation's session to another engine.

## Status

- **Milestone 1 (Codex) is done.**
  - Real check with Codex 0.161.0 in a test profile:
    - question 1 told a code name, questions 2–7 were filler (pushing it out of the old five-exchange window), and question 8 asked for it back. The answer was "파란 고래";
    - all eight turns ran in one stored thread;
    - deleting the conversation removed the thread's rollout file from `~/.codex/sessions`, and the run left no other thread files.
  - **Where the code is:**
    - `electron/app/sessions.ts` decides and records;
    - `CodexAppServerProvider` resumes, checks the settings, falls back, and deletes threads;
    - Agent Core builds the resume prompt.
- **Known limits:**
  - **a thread started just as it is cancelled, or as Poko is force-quit,** may stay in `~/.codex/sessions`. Codex writes it before Poko learns its id, so Poko can't delete it;
  - **session bookkeeping never blocks an answer:** planning and recording failures are logged, and the question is answered fresh.

