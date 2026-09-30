# Phase 00 — Foundation

## Goal

Set the project boundaries and public contribution entry points before application code grows.

## Decisions

- One pnpm application with Electron, React, TypeScript, and Vite; add internal module boundaries without creating a package workspace yet.
- Electron main owns privileged work, preload exposes typed and narrow IPC, and the renderer stays free of Node access.
- Conversation and Task are separate domain concepts. Providers emit normalized `AgentEvent` values through the Agent Core.
- SQLite/Drizzle, Codex execution, approval enforcement, browser tools, and scheduler implementation belong to later phases.
- MIT is the project license.

## Deliverables

- `AGENTS.md` with project safety, phase, and verification guidance.
- `docs/architecture.md` with process responsibilities, IPC, core contracts, data model, and phase boundaries.
- `docs/phases/phase-00.md` and `docs/phases/phase-01.md`.
- Root README and MIT license for an understandable, reusable public repository.

## Verification

- Review the documented IPC and domain contracts against the agreed v0.1 scope.
- Check that deferred features are documented without adding empty infrastructure.
- Check Markdown links and confirm the README does not claim unfinished features as available.

## Completion gate

Open a pull request containing the foundation documents, review and resolve feedback, then merge before starting Phase 01 implementation.
