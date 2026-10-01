# Phase 04 — Approval and permission gate

## Goal

Add a visible, auditable approval flow for Codex actions while preserving read-only behavior as the default. Do not enable write tasks until the worker can pause before a concrete action and the app can reject it safely.

## Why the provider boundary needs to change

Phase 02 uses `codex exec --json`, a non-interactive command intended for one-off jobs and CI. It does not provide the bidirectional approval request/reply flow needed by an Electron UI. OpenAI documents the Codex App Server as a client integration for streamed events and approvals; its stdio transport is JSONL JSON-RPC, and the server pauses while the client answers approval requests. See the [App Server protocol](https://learn.chatgpt.com/docs/app-server) and OpenAI's [App Server architecture overview](https://openai.com/index/unlocking-the-codex-harness/).

The planned change replaces only the Codex provider transport with a per-task `codex app-server --listen stdio://` process. Agent Core, normalized Poko events, task storage, and the renderer's character-led UI remain. Treat App Server protocol revisions as a compatibility risk: negotiate protocol version, validate each server request, pin supported CLI behavior in tests, and fail closed to the existing read-only provider if approvals are unsupported.

## Permission behavior

- Read-only stays the default task mode.
- App Server approval requests become typed `waiting_approval` task state and a persisted approval activity.
- Render the concrete command, working directory, and reason. For file changes, show the proposed diff when the protocol provides it. Never label an ambiguous request as harmless.
- Approve only the current request, never persist `acceptForSession` or broaden a profile for future tasks in v0.1. Decline/cancel leaves the provider sandbox unchanged.
- Network access, deployment, publishing, payments, email, git push/reset, and other external or destructive actions remain denied. Do not let an approval dialog turn an unavailable capability into an available one.
- Never accept an approval response for an expired task, another renderer, or a mismatched request ID. Timeout, malformed request, renderer close, worker exit, or DB error denies the request and stops or safely resumes without the action.
- Persist request identity, display summary, decision, and timestamps in an `approvals` table linked to the task. Do not persist secrets or arbitrary raw protocol payloads.
- The main process owns pending approval requests and child-process stdin. Renderer receives display DTOs and sends only `{taskId, requestId, decision}` through a narrow IPC method.

## Scope

1. Add an approval domain model/state machine: `pending → approved | denied | expired | cancelled`, with one-shot request IDs.
2. Add App Server stdio JSON-RPC framing and a minimal capability handshake for the exact approval types used. Keep protocol parsing independent of Electron and cover it with fixtures.
3. Add provider callbacks/commands for receiving and answering approval requests. Validate request ownership and preserve cancellation/timeout behavior.
4. Add typed IPC and a small approval card/dialog that shows the concrete action and offers Approve once / Cancel. No session-wide trust button.
5. Persist approval records and restore only history; never restore a pending approval after app restart.
6. Add deterministic tests for request routing, stale IDs, deny-by-default behavior, malformed protocol, timeout, persistence, and shutdown.

## Explicitly deferred

- Do not enable file writes in this phase until the Codex App Server sandbox and file-change/command approval behavior has been verified on supported platforms.
- Do not implement destructive or external actions, general shell access, automatic approval, session trust, browser control, or deployment.
- If Codex cannot guarantee a pause before writes in the configured read-only baseline, keep write requests unsupported and ship only the approval request infrastructure.

## Implementation notes

- `CodexAppServerProvider` replaces `CodexProvider` in the main process. Protocol framing lives in `appServerProtocol.ts`, independent of Electron. The legacy `codex exec` provider remains in the tree, unused, until the App Server path is verified with a real Codex model.
- Field names were checked against `codex app-server generate-json-schema` from `codex-cli 0.159.3`. Command approvals without `kind` default to `"command"`. A file-change `update` with a `move_path` outside the workspace is declined.
- Command approvals that carry `networkApprovalContext` or `proposedNetworkPolicyAmendments` are declined automatically, since network access stays unavailable. A `proposedExecpolicyAmendment` alone does not block the request. Codex attaches one to most escalations, and it only takes effect through `acceptWithExecpolicyAmendment`, which Poko never sends. Poko replies only with `accept` or `decline`. An `availableDecisions` list without `accept` makes the request unapprovable. Refusals use `decline` even when the list names only `cancel`: codex-cli 0.159.3 accepts `decline` and continues the turn, while `cancel` would interrupt the whole task. This was found with a real Codex 0.159.3 run: the earlier rule auto-declined every escalation.
- An approved command runs outside the sandbox, so the approval card warns that it can reach files beyond the selected folder and the network.
- `electron/providers/codex/commandPolicy.ts` is an **allowlist that fails closed**. A denylist screen was tried first, and seven review rounds kept finding bypasses: quote splitting, option values, backticks, assignments, redirections, `git -c`, brace and glob expansion, and line continuations. So the approach was inverted:
  - The single `<shell> -c '<command>'` wrapper Codex uses is unwrapped once.
  - Shell syntax is limited to words, quotes, `&&`, `||`, `;`, `|`, and `>`/`>>` into the workspace. `$`, backticks, braces, globs, parentheses, backslashes outside quotes, `!`, `~`, `<`, `=`, and line breaks are declined.
  - Every segment must start with an allowed program, given as a bare name: file and text tools; project scripts through npm, pnpm, yarn, or bun `run/test/build/lint/…`; test runners; `node`/`python` with a script file; `go`/`cargo` build and test; and local git subcommands without inline config, external-program options, or discard flags.
  - Path arguments, option values (including attached short options such as `-o/tmp/x`), and redirect targets must stay relative, with no leading `/` or `~` and no `..`. `/dev/null` is the one exception. Nothing under `.git` is touched, because git config and hooks run programs.
  - The wrapper shell must be a system shell (a bare name, `/bin/…`, or `/usr/bin/…`). Package managers must name their subcommand first. git takes no `-C` or inline config.
  - git subcommands each have an exact flag allowlist, so bundled or abbreviated flags fail closed. `checkout` is offered only with `-b`, and branches are switched with `switch`.
  - A command that writes a file and runs project code in the same line is declined (`printf … > a.js && node a.js`). A runner saving its own output is fine.
  - The `.git` check is case-insensitive.
  - Known limit: allowed tools can still run project code (`pnpm test`, `make`, `node x.js`). That's why the card warns on every command, and Phase 06 should run approved commands inside a workspace-write sandbox.
- An unanswered approval is cancelled after 5 minutes, and the task stops. When a task ends, its pending approval rows become `expired` (or `cancelled` on user cancel). On startup, pending rows become `expired`.
- The main process writes the audit row before forwarding the decision to Codex. If the DB write fails, the request is declined.
- Workspace containment resolves symlinks through the nearest existing ancestor, and a dangling link counts as outside the workspace.
- Stopping a task signals the App Server's whole process group, so a command the user approved does not outlive the task.
- An App Server `error` notification with `willRetry: true` is not treated as the end of the task.
- Several approvals can be waiting at once. The UI answers them oldest first, and the task stays `waiting_approval` until none are left.

## Acceptance criteria

- Existing read-only analysis still passes through the provider with Codex sandbox/network restrictions intact.
- An approval request is persisted and shown with an accurate action preview; cancel/deny does not run it.
- A current one-shot approval responds only to the owning pending request and is audit logged.
- Restart converts pending approvals to expired/cancelled and never resumes the child process.
- Unknown request types, malformed JSON-RPC, missing command details, unsupported CLI/protocol, and persistence failures fail closed.
- `pnpm check`, `pnpm format:check`, database migration tests, and provider protocol tests pass.
- GUI testing on supported macOS, Windows, and Linux validates actual approval behavior before enabling write mode.

## Real-environment verification (2026-10-01, macOS, codex-cli 0.159.3)

Run against a scratch project through Agent Core, `CodexAppServerProvider`, and the SQLite layer, without the Electron UI:

- Codex paused before a write and asked to run `printf 'hi' > hello.txt` outside the sandbox.
- Approving ran exactly that command (`hello.txt` contained `hi`). The next write in the same task asked again, so the approval was one-shot.
- Refusing left the file uncreated, and Codex continued the turn and explained that the write was refused. The request listed only `accept`, `acceptWithExecpolicyAmendment`, and `cancel`, and Poko replied `decline`.
- Before this fix, every escalation was auto-declined because Codex attaches `proposedExecpolicyAmendment` to it.
