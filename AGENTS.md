# Poko development guide

Poko is an early-stage, local personal AI desktop agent. Keep the character and conversation experience simple, and keep tool execution behind the Electron main process and Agent Core.

## Project rules

- Inspect existing code and documentation before changing them. Preserve unrelated work.
- Keep `Conversation` (user-facing messages) separate from `Task` (work performed by an agent).
- The renderer must not execute shell commands, spawn processes, or access arbitrary filesystem paths. Put privileged work in the Electron main process and expose only narrow, typed APIs through preload.
- Do not run an external action, destructive command, deployment, push, or other high-impact operation without an explicit approval path.
- Keep provider output behind normalized `AgentEvent` values. Do not show raw CLI output in the character conversation.
- Prefer the smallest change that fits the current phase. Do not add infrastructure for a future phase until it is needed.
- Keep user-facing copy warm and plain. Keep detailed technical information in Activity.

## Before changing architecture

Read `docs/architecture.md` and the active phase document under `docs/phases/`. Update those documents when implementation decisions materially change.

## Verification

For code changes, run the relevant package scripts for type checking, linting, tests, and production build. Report checks that could not run and why. For UI changes, also launch the desktop app and inspect the main flow when the environment supports it.

## Pull requests

Complete one reviewable milestone per pull request. Include the user-visible behavior, files changed, and verification results. Address review feedback before merging or starting a dependent milestone.
