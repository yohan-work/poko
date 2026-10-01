# Phase 06 — Screen companion

## Goal

Let Poko see a window the user picks and act in it one approved step at a time, with Poko itself visible on the screen while it works. This is the product's "wow" moment. The character steps out of the app window, flies to the button it means, points at it with its companion dot, says what it will do, and taps it once the user approves.

It runs on the user's existing Codex (ChatGPT) sign-in. No new API key is needed.

## What the user experiences

1. **Look.** "이 화면 보고 알려줘." The user picks a window. Poko captures it, explains what it sees, and the overlay character circles the elements it talks about.
2. **Act, one step at a time.** "이 메일 답장 창 열어 줘." Poko proposes one action. The overlay character flies to the target, the satellite dot points at it, and a bubble says "'답장' 버튼을 누를게". The user checks the crop of the target on the approval card in the app and approves there, the step runs, Poko looks again, and it proposes the next step. A stop shortcut ends everything at once.

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
  - The thread is meant to have no access to the user's files. Its working directory is an empty per-task temp folder, and it gets a permission profile that denies `:root` and grants read access only to that folder, plus whatever platform paths Codex strictly needs. Unlike Phase 02's profile, it does not grant all of `:minimal`, unless milestone 1 shows Codex can't run without it. The shell tool is disabled for screen tasks if the App Server supports it. Every command and file-change approval request is declined.
  - Codex can run read-only commands *without* asking, so containment must come from that profile, not from approvals. Milestone 1 must prove it with a real run of the **exact profile that ships**: a screen task told to read `~/.ssh` or `~/.codex/auth.json` must fail. Until that check passes, screen tasks don't ship.
  - The prompt marks the screenshot and element list as untrusted data: text on screen is never treated as instructions from the user. A step reply is JSON validated against a schema: `{ say, action: { kind: "click" | "type" | "reveal" | "done", elementId?, text? } }`. Invalid replies end the task.
- **Actions:** semantic actions only, through Accessibility: `AXPress` for click, setting `AXValue` for type, and `AXScrollToVisible` for reveal (bring an element into view). This is the same approach as the Orca computer-use tool, and none of these need the target app to be in front. Directional scrolling is left out of the first version, because a page's scroll bar belongs to browser chrome, which is look-only.
  - Synthetic keystrokes are never used. They go to whatever app is in front, so typing is offered only for elements whose value can be set.
  - **Right before acting**, the helper finds the target again in a fresh tree. It must match **exactly one** element by role, label, frame, and its index path from the window. If zero or several match, Poko stops. It then checks that the window is still the picked one.
  - **Visible and on top:** `click` and `type` are offered only when the element's frame lies fully inside the window's visible area and the element at its center (`AXUIElementCopyElementAtPosition`) is the target or one of its descendants. Elements that are scrolled away or covered by a modal or sticky header are refused, so the crop always shows what will be pressed.
  - **Pixels:** a fresh crop is compared with the approved crop. Approving moves focus to Poko, which can change focus rings, carets, and selection colors, and pages animate. So a mismatch never acts silently: it shows the new crop and asks again. The comparison method and tolerance are set by tests against a real browser in milestone 3.
  - After each action, the tree is read again to check the result.
- **Overlay character:** a transparent, always-on-top, click-through `BrowserWindow` per display. It renders the Poko orb: flying to an element's frame, the satellite pointing, a highlight ring, and a speech bubble. It follows reduced motion.
  - Window capture records only the picked window, so the overlay isn't in the image.
  - The overlay still hides while Poko captures or measures, so it never covers the target. `setContentProtection` is only an extra layer, because macOS doesn't always honor it.
- **Stop:** a global shortcut, the only global shortcut, stops the task. After stop, no accessibility action runs: the executor checks the stop flag right before each helper call, and a stop that arrives later cancels the step before it is sent. The overlay and the main window show that Poko is in control.
- **Approval only on the card:** an action can be approved only from the card in Poko's window, which shows the target crop. The overlay bubble is narration built from untrusted labels, so it is never an approval surface, and there is no approve shortcut.

## Safety (from Phase 04 lessons)

- Every action needs its own approval in Phase 06. There's no auto-run and no session trust.
- **Scope:** Poko acts only in the window the user picked. Accessibility actions don't need focus, so Poko's own windows may take focus while the user approves. **Right before an action**, the helper checks that the target still belongs to the picked window and app. If another app has taken over that window's space, or the window is gone, the task pauses.
- **Act only in web page content (fail closed):** an approved action should not be able to run code or weaken security. Allowed apps can still do that through their own UI: Mail opens attachments, Calendar alerts can open files, browser settings pages change security options, and URL-scheme links hand off to other apps. So the first version allows actions **only inside the web content (`AXWebArea`) of an `http`/`https` page** in Safari, Chrome, Arc, Firefox, or Edge. Specifically:
  - Pages with any other scheme (`chrome://`, `about:`, `devtools://`, `file://`, extension pages) are look-only, which also covers docked developer tools.
  - Browser chrome (toolbar, menus, settings windows) is look-only.
  - A link is offered only if its `AXURL` is `http`/`https`. Links to other schemes, or to files with executable or installer extensions (`.app`, `.command`, `.sh`, `.pkg`, `.dmg`, `.zip`, and similar), are refused. This only covers what Poko can see: a page can still start a download or a scheme hand-off from script. So the promise is that Poko never knowingly offers such an action, and the browser's own download prompts and macOS Gatekeeper still apply. The approval card says when a click may download something.
  - Every other app, including Finder, launchers, Mail, Notes, Calendar, editors, terminals, settings, and Poko itself, can be **looked at** but never acted in. Poko's own windows are left out of the window picker.

  More apps or areas are added only by explicit review.
- **Untrusted labels:** element labels and on-screen text come from the app or web page and can lie, for example a "Send" button labeled "Cancel". The approval card therefore shows a **crop of the target from the screenshot** as its main evidence, with the label as secondary text. For `type`, the card shows the **full text** that will be entered, so nothing can be pasted out of view. Labels that look like payment, purchase, delete, or send get a stronger warning, but that is only a hint, never a guarantee.
- **Frame-to-pixel mapping:** accessibility frames are global screen points, while the capture is window-relative pixels at the display's scale. The crop is computed as `(elementFrame − windowFrame) × (imageWidth / windowFrame.width)`. The helper reports the window frame and scale with every snapshot. If the image's aspect ratio doesn't match the window frame (for example, a downscaled thumbnail), Poko recaptures at full size or refuses. This mapping has unit tests, because a wrong crop would show the user a different control than the one pressed.
- **Step limits:** a maximum number of steps per task, and a timeout per approval, as in Phase 04.
- **Transparency:** before the first screen task, Poko explains what happens and what it needs.
  - Screenshots and element labels of the chosen window are sent to Codex (OpenAI).
  - Codex may keep its own session records on disk under `~/.codex`. Poko doesn't control those files.
  - It needs macOS permissions, and explains which ones and why.

## Milestones

Each milestone is its own PR with review.

1. **Permissions and look.** Permission onboarding (check and explain Screen Recording and Accessibility), the window picker, capture, the Swift helper (window identity and snapshot), and a Codex turn with `localImage` and the element list. Poko describes the window, and no actions exist yet.
2. **Overlay character.** The transparent overlay window. Poko flies to and circles elements referenced in the look answer. It hides while Poko captures or measures (content protection is only an extra layer) and respects reduced motion.
3. **One approved step at a time.** The action schema and validation, the approval card with a target crop, the stop shortcut, AX execution with re-check, the step loop, and the safety rules above.

### Milestone 1 notes (implemented)

- `native/poko-ax/main.swift` builds with `pnpm native` (run by `dev` and `build`, macOS only) into the git-ignored `native/build/`. It is read-only: `permissions`, `windows`, and `snapshot <windowId>`. Packaging the helper into a release build is left for the packaging phase.
- Chromium-based apps expose page content only after `AXManualAccessibility` is set on the app. Page content sits deep in the tree, so the snapshot walks up to depth 40 and stops at 400 elements (about 0.7 s for a busy Chrome window). Pages report scrolled-away content with zero-height or off-window frames, so only elements visibly inside the window (at least 4 pt) take a slot, and subtrees wholly outside the window are skipped. A real GitHub page went from 400 mostly hidden elements (truncated) to 160 visible ones.
- The screen profile reads only the task's empty work folder (no `:minimal`). Codex starts with `--disable` for `shell_tool`, `unified_exec`, `view_image`, `memories`, `apps`, `plugins`, `multi_agent`, and `image_generation`. Every Poko task, project or screen, also disables Codex's own `computer_use`, browser, and local automation features so nothing acts outside Poko's approvals. `--disable` fails on a name Codex doesn't know, so Poko runs `codex features list` once and passes only known names. A screen task refuses to start if `shell_tool` and `unified_exec` can't both be disabled. Screen tasks also decline every file-change request.
- Real-run gate (Codex 0.159.3, 2026-10-01): a screen task with a screenshot attached described the image, and asked to read `~/.ssh/known_hosts` and `~/.codex/auth.json`, answered that both are outside its allowed folder. It made no tool calls. With the feature list applied, it reported having no file-reading tool at all. A project task still read `package.json`.
- The screenshot and work folder live in `userData/screen-tmp/<uuid>` and are removed when the task ends and on every start.

### Milestone 2 notes (implemented)

- After a look answer, the main process resolves the answer's `[id]` citations against that task's snapshot (at most three, in order, only elements with a frame inside the picked window). The chat shows the element's name in quotes instead of the number. Names are untrusted labels, so Markdown characters are stripped.
- One overlay window (`#overlay` route of the same renderer) is moved onto the display holding the picked window. It is transparent, click-through, never focusable, above other windows, and content-protected. It receives scenes from main and sends nothing back, and the IPC trust check only accepts the main window.
- Poko starts at the window's corner, flies to each point, rings it, and says `여기야: <name>`. The overlay hides on its own after about 3 seconds per point, right before every capture, and when the main window closes. Reduced motion turns the flight into a jump.
- Streaming text may show `[12]` briefly; the final answer replaces it.

### Milestone 3a notes (implemented): checking and acting

Real-browser results on a local test page (`127.0.0.1`, Safari 26 and Chrome) with a plain input, a React-controlled input, a `contenteditable` editor, links, a modal over a control, and a password field:

| | Safari | Chrome |
| --- | --- | --- |
| `AXPress` on a web button | Works | Not listed; calling it reports success and **does nothing** |
| Setting `AXValue` (plain, React, contenteditable) | Works after focusing the field (`AXFocused`) | Works; React state updates |
| Covered by an in-page modal or another app's window | Refused | Refused |
| `.dmg` link, `mailto:` link, password field, address bar, back button | Refused | Refused |

Decisions:
- `reveal` (scroll into view) skips the visible-and-on-top tests, because a partly hidden element is exactly what it is for. Every link on the path to the target is checked, since pressing text or an image inside a link follows it.
- `poko-ax act <windowId>` reads its request on stdin, so the text to type never appears in the process list. `check` runs every test without acting. `press`, `type`, and `reveal` run the same tests again and then act.
- An element is pressed only if it lists `AXPress`; Chrome's web buttons don't, so **clicking is Safari-only for now** (decided with the user). In Chrome, Poko can type but not click until a safe way to click is found. A click is never sent as a synthetic mouse event.
- Typing focuses the field first and reads the value back (polling up to 0.5 s); `valueMatches: false` means the page didn't take the text and is reported, not assumed.
- Window matching accepts an AX title that starts with the capture title plus `" - "`, because browsers append their name and profile. This fixed a picked Chrome window that shared its frame with another one.
- The pixel check: a mean difference measured an unchanged control at 0, the same field after typing at 0.034, and a different field of the same size at 0.043. It can't tell look-alike controls apart, and it dilutes small changes such as one letter. The accessibility re-check is what proves identity. The pixel check instead counts pixels that changed by more than 24 levels in any channel. Above 0.2% of the crop (about 9 pixels of a 120×36 button), Poko shows the new crop and asks again.
- Open question resolved: the hit test uses the target app's own `AXUIElementCopyElementAtPosition` (which sees in-page modals and sticky headers) plus the window stacking order with Poko's process ignored (which sees other apps).

### Milestone 3b notes (implemented): one approved step at a time

- In the window picker, **대신 해 줘** turns the composer text into a goal for a browser window. Other apps are listed as look-only. `ScreenAgent` (main process) runs the loop:
  1. Hide the overlay, then snapshot and capture the window.
  2. Run one Codex turn on the screen profile that returns one JSON step.
  3. Check the step with the helper. A refusal goes back to Codex as that step's outcome, and three refusals in a row end the task.
  4. Crop the target and show the approval card. The overlay holds Poko at the target, saying the step.
  5. On approval: hide the overlay and capture again. If the crop changed by more than 0.2%, show the new crop and ask again, at most twice.
  6. The helper checks once more and acts.
  7. Record the outcome and loop. The task stops after 8 steps.
- **Changes from the plan:**
  - Each step is a new Codex turn whose prompt carries the goal and earlier steps, instead of one long thread. This kept the provider unchanged, and every turn sees only the current screen.
  - Declining a step ends the task: the user is in charge, and Poko doesn't look for a way around a "no".
  - A step waits 5 minutes for approval, then the task stops.
- **Stop:** `⌘⇧Esc` (`CommandOrControl+Shift+Escape`) is registered only while a screen task runs. Stop aborts the Codex turn and declines a waiting step. The loop checks the stop flag before every helper call, so nothing acts after a stop. The task's cancel button does the same.
- Approval goes only through the card. `approvals.kind` gains `screen_action` (a text column, so no migration). The crop isn't stored.
- Real run, using Codex 0.159.3 and Safari on the local test page, with approvals given by a test script: the goal "Add one 버튼을 두 번 누르고, Plain 입력칸에 poko를 입력해 줘" took 3 approved steps and finished in 24 s. The page then showed count 2 and the field held "poko" (its input event fired). Each step's card crop showed the right control.

## Open questions to settle in implementation

These come from plan review. Each milestone PR must answer them with real-browser evidence.

- **Hit test and Poko's own windows:** the "visible and on top" check must ignore Poko's main window and overlay but still detect other apps covering the target. Option: hit-test with Poko's windows hidden or ordered back for that moment, or check the window stacking order (`CGWindowListCopyWindowInfo`) for any non-Poko window over the target's frame, before the AX hit test on the target app.
- **Typing into real web forms:** setting `AXValue` may not fire `input`/`change` events in framework-controlled forms (React and similar), and rich editors (`contenteditable`, for example Gmail compose) may not expose a settable value. Milestone 3 must test common sites. If the page didn't take the text, `type` is reported as unsupported for that field rather than offered. A submit after a `type` is offered only when the field's value read back matches.

## Explicitly deferred

- Multi-step plan approval and auto-run.
- Voice input (Codex audio input) and a Claude provider (the user has a Claude subscription; check its terms first).
- Windows and Linux.
- Approval-gated file writes in the workspace and sandboxed command approval (the former Phase 06), which move to a later phase with a workspace-write sandbox.
- Packaging the Swift helper for distribution (signing, notarization). Development builds compile it locally.

## Acceptance criteria

- With permissions granted, "이 화면 보고 알려줘" on a picked window gives an accurate description, and the overlay highlights the elements it mentions.
- A proposed action shows the overlay pointing at the right element and a card naming it. Declining does nothing. Approving performs exactly that one action.
- A screen task can't read `~/.ssh` or `~/.codex` (real-run check).
- A target that changed after approval (fresh crop differs) is not acted on.
- After the stop shortcut, no accessibility action runs. Non-allowlisted apps, secure fields, and the target no longer belonging to the picked window all stop or pause the task.
- The approval crop matches the element that is pressed, which is covered by mapping tests.
- Screenshots never reach SQLite, and temp files are removed.
- `pnpm check` and `pnpm format:check` pass. Screen-agent logic (schema, validation, safety rules, loop) has unit tests with recorded snapshots.
