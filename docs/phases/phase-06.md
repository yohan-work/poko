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

- **Capture:** `desktopCapturer` lists windows (with thumbnails, for the picker) and captures the chosen one to a temp PNG under `userData`. The file is deleted when the step ends. Screenshots are never stored in SQLite.
- **Accessibility snapshot:** a JXA (`osascript -l JavaScript`) helper reads the chosen window's element tree through System Events, capped by depth and count. It returns `{ id, role, label, value, frame, secure }`. If JXA proves too slow, it can be replaced with a small Swift `AXUIElement` helper behind the same interface.
- **Screen agent** (`electron/agent/screen/`): runs the loop of snapshot, Codex turn, proposed action, approval, execute, and snapshot again. It uses one App Server thread per screen task, so later steps keep context. A step reply is JSON validated against a schema: `{ say, action: { kind: "click" | "type" | "scroll" | "done", elementId?, text?, direction? } }`. Invalid replies end the task.
- **Actions:** semantic actions through Accessibility (`AXPress` for click, setting `AXValue` or focus plus keystrokes for type, `AXScrollToVisible` or a scroll for scroll), the same way the Orca computer-use tool works. After each action, the tree is read again to check the result.
- **Overlay character:** a transparent, always-on-top, click-through `BrowserWindow` per display. It renders the Poko orb: flying to an element's frame, the satellite pointing, a highlight ring, and a speech bubble. It uses `setContentProtection(true)` so the overlay never appears in Poko's own screenshots. It follows reduced motion.
- **Stop:** a global shortcut stops the task immediately. The overlay and the main window show that Poko is in control.

## Safety (from Phase 04 lessons)

- Every action needs its own approval in Phase 06. There's no auto-run and no session trust.
- **Scope:** Poko acts only in the app of the window the user picked for the task. If focus moves to another app, the task pauses.
- **Blocked apps:** terminals, password managers, Keychain Access, and System Settings privacy panes. Typing into a terminal would be general shell access.
- **Hard stops:** a secure text field (`AXSecureTextField`) ends the task, and Poko never types secrets. Elements whose labels look like payment, purchase, delete, or send get a stronger warning on the card.
- **Step limits:** a maximum number of steps per task, and a timeout per approval, as in Phase 04.
- **Transparency:** before the first screen task, Poko explains that screenshots and element labels of the chosen window are sent to Codex (OpenAI). It also explains which macOS permissions it needs and why.

## Milestones

Each milestone is its own PR with review.

1. **Permissions and look.** Permission onboarding (check and explain Screen Recording and Accessibility), the window picker, capture, the JXA snapshot, and a Codex turn with `localImage` and the element list. Poko describes the window, and no actions exist yet.
2. **Overlay character.** The transparent overlay window. Poko flies to and circles elements referenced in the look answer. It is excluded from capture and respects reduced motion.
3. **One approved step at a time.** The action schema and validation, the approval card with a target crop, approve and stop shortcuts, AX execution with re-check, the step loop, and the safety rules above.

## Explicitly deferred

- Multi-step plan approval and auto-run.
- Voice input (Codex audio input) and a Claude provider (the user has a Claude subscription; check its terms first).
- Windows and Linux.
- Approval-gated file writes in the workspace (the former Phase 06), which moves to a later phase with a workspace-write sandbox.

## Acceptance criteria

- With permissions granted, "이 화면 보고 알려줘" on a picked window gives an accurate description, and the overlay highlights the elements it mentions.
- A proposed action shows the overlay pointing at the right element and a card naming it. Declining does nothing. Approving performs exactly that one action.
- The stop shortcut halts within one step. Blocked apps, secure fields, and focus leaving the picked app all stop or pause the task.
- Screenshots never reach SQLite, and temp files are removed.
- `pnpm check` and `pnpm format:check` pass. Screen-agent logic (schema, validation, safety rules, loop) has unit tests with recorded snapshots.
