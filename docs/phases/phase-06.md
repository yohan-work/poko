# Phase 06 — Screen companion

## Goal

Let Poko see a window the user picks and act in it one approved step at a time, with Poko itself visible on the screen while it works. This is the product's "wow" moment. The character steps out of the app window, flies to the button it means, points at it with its companion dot, says what it will do, and taps it once the user approves.

It runs on the user's existing Codex (ChatGPT) sign-in. No new API key is needed.

## What the user experiences

1. **Look.** "이 화면 보고 알려줘." The user picks a window. Poko captures it, explains what it sees, and the overlay character circles the elements it talks about.
2. **Act, one step at a time.** "이 메일 답장 창 열어 줘." Poko proposes one action. The overlay character flies to the target, the satellite dot points at it, and a bubble says "'답장' 버튼을 누를게". The user approves in the app or with a shortcut, the step runs, Poko looks again, and it proposes the next step. A stop shortcut ends everything at once.

## Feasibility (checked)

- **Model input:** the Codex App Server accepts `localImage` inputs (`{ type: "localImage", path }`), so a screenshot saved by the main process can go to Codex on the user's existing sign-in. Audio inputs exist too, which is a possible later step toward voice.
- **Grounding:** Codex isn't a dedicated computer-use model, so it isn't asked to name pixel coordinates. Each turn sends the screenshot plus a numbered list of the window's accessibility elements (role, label, value, frame). The model replies with an element number and an action. That's more precise than coordinates, and it lets the approval card say exactly what will be pressed.
- **Platform:** macOS first. It needs Screen Recording permission (capture) and Accessibility permission (element tree and actions). Windows and Linux are deferred.

## Architecture

All privileged work stays in the Electron main process. The renderer only shows DTOs and sends narrow commands.

- **Capture:** `desktopCapturer` lists windows (with thumbnails, for the picker) and captures the chosen one to a temp PNG under `userData`. The file is deleted when the step ends, and leftover temp files from a crash are removed at startup. Screenshots are never stored in SQLite.
- **Window identity and accessibility:** a small Swift helper, built from source in the repository, does two things.
  - It maps the picked capture source (CGWindowID) to its owner process and frame with `CGWindowListCopyWindowInfo`. It then finds the matching `AXUIElement` window in that process by frame and title. If zero or several windows match, it refuses instead of guessing.
  - It reads that window's element tree, capped by depth and count, and returns `{ id, role, label, value, frame, secure, settable }`.

  JXA through System Events can't match a capture to a window reliably, so it isn't used.
- **Screen agent** (`electron/agent/screen/`): runs the loop of snapshot, Codex turn, proposed action, approval, execute, and snapshot again.
  - It uses one App Server thread per screen task, so later steps keep context.
  - The thread runs in the read-only sandbox, with its working directory set to an empty per-task temp folder rather than a project. Every command and file-change request from Codex in a screen task is declined.
  - The prompt marks the screenshot and element list as untrusted data: text on screen is never treated as instructions from the user. A step reply is JSON validated against a schema: `{ say, action: { kind: "click" | "type" | "scroll" | "done", elementId?, text?, direction? } }`. Invalid replies end the task.
- **Actions:** semantic actions only, through Accessibility: `AXPress` for click, setting `AXValue` for type, and `AXScrollToVisible` for scroll, the same way the Orca computer-use tool works.
  - Synthetic keystrokes are never used. They go to whatever app is in front, so typing is offered only for elements whose value can be set.
  - **Right before acting**, the helper reads the target again and checks that its role, label, and frame still match what the card showed and that its window is still the picked one. If anything changed, it stops instead of acting.
  - After each action, the tree is read again to check the result.
- **Overlay character:** a transparent, always-on-top, click-through `BrowserWindow` per display. It renders the Poko orb: flying to an element's frame, the satellite pointing, a highlight ring, and a speech bubble. It follows reduced motion.
  - Window capture records only the picked window, so the overlay isn't in the image.
  - The overlay still hides while Poko captures or measures, so it never covers the target. `setContentProtection` is only an extra layer, because macOS doesn't always honor it.
- **Stop:** a global shortcut stops the task immediately. The overlay and the main window show that Poko is in control.

## Safety (from Phase 04 lessons)

- Every action needs its own approval in Phase 06. There's no auto-run and no session trust.
- **Scope:** Poko acts only in the app of the window the user picked for the task. If focus moves to another app, the task pauses.
- **Blocked apps:** terminals, password managers, Keychain Access, and System Settings privacy panes. Typing into a terminal would be general shell access.
- **Hard stops:** a secure text field (`AXSecureTextField`) ends the task, and Poko never types secrets.
- **Untrusted labels:** element labels and on-screen text come from the app or web page and can lie, for example a "Send" button labeled "Cancel". The approval card therefore shows a **crop of the target from the screenshot** as its main evidence, with the label as secondary text. Labels that look like payment, purchase, delete, or send get a stronger warning, but that is only a hint, never a guarantee.
- **Step limits:** a maximum number of steps per task, and a timeout per approval, as in Phase 04.
- **Transparency:** before the first screen task, Poko explains what happens and what it needs.
  - Screenshots and element labels of the chosen window are sent to Codex (OpenAI).
  - Codex may keep its own session records on disk under `~/.codex`. Poko doesn't control those files.
  - It needs macOS permissions, and explains which ones and why.

## Milestones

Each milestone is its own PR with review.

1. **Permissions and look.** Permission onboarding (check and explain Screen Recording and Accessibility), the window picker, capture, the Swift helper (window identity and snapshot), and a Codex turn with `localImage` and the element list. Poko describes the window, and no actions exist yet.
2. **Overlay character.** The transparent overlay window. Poko flies to and circles elements referenced in the look answer. It is excluded from capture and respects reduced motion.
3. **One approved step at a time.** The action schema and validation, the approval card with a target crop, approve and stop shortcuts, AX execution with re-check, the step loop, and the safety rules above.

## Explicitly deferred

- Multi-step plan approval and auto-run.
- Voice input (Codex audio input) and a Claude provider (the user has a Claude subscription; check its terms first).
- Windows and Linux.
- Approval-gated file writes in the workspace and sandboxed command approval (the former Phase 06), which move to a later phase with a workspace-write sandbox.
- Packaging the Swift helper for distribution (signing, notarization). Development builds compile it locally.

## Acceptance criteria

- With permissions granted, "이 화면 보고 알려줘" on a picked window gives an accurate description, and the overlay highlights the elements it mentions.
- A proposed action shows the overlay pointing at the right element and a card naming it. Declining does nothing. Approving performs exactly that one action.
- The stop shortcut halts within one step. Blocked apps, secure fields, and focus leaving the picked app all stop or pause the task.
- Screenshots never reach SQLite, and temp files are removed.
- `pnpm check` and `pnpm format:check` pass. Screen-agent logic (schema, validation, safety rules, loop) has unit tests with recorded snapshots.
