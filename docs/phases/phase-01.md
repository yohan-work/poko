# Phase 01 — Character and Chat

## Goal

Ship a runnable desktop app where a user can choose a workspace, talk to Poko, and see a friendly mock response while Codex integration is still deferred.

## Included

- Electron main, preload, and React renderer using Electron Vite, TypeScript, pnpm, and Zustand.
- Secure window defaults: context isolation enabled and renderer Node integration disabled.
- Character states: `idle`, `listening`, `thinking`, `working`, `success`, `error`, and `approval`.
- Conversation composer, user and assistant message display, and an in-memory conversation store.
- Native directory picker and persisted selected workspace.
- Typed IPC methods for workspace selection, workspace lookup, and mock conversation response.
- Persist the workspace preference in an atomic JSON settings file under Electron's `userData` directory.
- Friendly, minimal main screen; keep detailed technical Activity content for its later phase.

## Excluded

- Codex/Claude subprocesses, SQLite, task history across restarts, persistent conversation history, memory extraction, browser automation, scheduler, and approval enforcement.
- General filesystem or shell APIs exposed to the renderer.

## Implementation sequence

1. Add the app manifest, Electron Vite/TypeScript configuration, and scripts.
2. Implement the main process and narrow preload bridge.
3. Build the character-led conversation view and Zustand state.
4. Wire workspace selection and mock conversation IPC.
5. Refine empty, loading, and error states and keyboard/accessibility behavior.

## Verification

- Run typecheck, lint, tests, and production build.
- Launch the desktop app and verify workspace selection, restart persistence of that setting, message submission, and the mock reply.
- Inspect that the renderer has no direct Node or shell access.
- Submit one reviewable Phase 01 pull request after Phase 00 has merged; resolve review feedback before merge.
