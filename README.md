# Poko

**A friendly local AI desktop agent for getting real work done in your projects.**

Poko is an early-stage open-source project. It gives local coding-agent tools a friendly character-led desktop interface and keeps conversation history, tasks, and explicit memories on your computer. It can also look at a browser window you pick and do a task in it, one step at a time, asking you before each step.

![Poko searching Google in Safari, opening Wikipedia, and summarizing the article, one approved step at a time](docs/images/demo/screen-companion.gif)

*Poko in "대신 해 줘" mode. Request: "구글에서 포켓몬스터 위키백과를 검색하고, 위키백과 문서에 들어가서 세 줄로 요약해 줘" (search Google for the Pokémon article on Wikipedia, open it, and summarize it in three lines). Poko points at each target on screen, waits for approval on the card, and returns a summary. The recording is sped up 1.5× and uses a private Safari window. Thumbnails of other windows in the picker are blurred.*

![Poko conversation with answers about the project](docs/images/screenshots/conversation.png)

## Screenshots

| Tasks | Memory |
| --- | --- |
| ![Tasks view listing completed requests](docs/images/screenshots/tasks.png) | ![Memory view with saved preference, project, decision, and routine cards](docs/images/screenshots/memory.png) |

**Screen step approval**

![Approval card showing a crop of the Google search field and the full text Poko will type, while the on-screen Poko points at the same field](docs/images/screenshots/screen-step.png)

**Activity**

![Activity timeline showing each step Poko took](docs/images/screenshots/activity.png)

Screenshots use sample data.

## Project status

- [x] Foundation and architecture documented
- [x] Character and chat desktop app (Phase 01)
- [x] Read-only Codex project analysis (Phase 02)
- [x] Local task, conversation, activity, workspace, and memory persistence (Phase 03)
- [x] In-app approval gate for Codex command and file-change requests (Phase 04)
- [x] Saved memories and recent conversation as context, Markdown answers, and streaming replies (Phase 05)
- [x] Screen companion: Poko looks at a window you pick and acts in it one approved step at a time, on screen (Phase 06, macOS)
- [x] Multiple conversations: new, switch, rename, and delete, each with its own context (Phase 07)
- [x] Approved edits with undo: edits are off by default per folder; each change is shown as a diff, approved once, and can be undone (Phase 08)
- [x] Installable macOS app with a Codex setup check on first run (Phase 09)
- [x] Settings page: memory switch, undo retention, export, delete all (Phase 10)
- [x] Claude Code as an alternative engine, with the same approvals and undo, and for screen tasks (Phase 11)
- [x] Model and reasoning-effort pickers under the message box, per engine
- [x] Approved project commands (tests, builds) on Claude Code, in a sandbox (Phase 12)
- [x] Ask Poko from anywhere with ⌥Space or the menu bar icon (Phase 13), optionally about the window in front
- [x] Drop or paste files and images into the message box (Phase 14)
- [x] Notifications when a task ends or needs approval while Poko isn't in front
- [x] Search conversations by title and message

## What Poko is aiming for

Talk to a small desktop character in plain language, in as many separate conversations as you like. Poko sends read-only project-analysis requests to the locally installed Codex CLI, shows understandable progress, and reports the result. Conversation, tasks, Activity, workspace selection, and user-managed memories persist locally in SQLite.

## Screen companion (macOS)

Open **화면 보기** under the composer, write what you want in the request field, and pick a window.

- **보고 설명해 줘 (look):** Poko captures the window, answers your question about it, and then flies out onto your screen to point at the controls it mentioned.
- **대신 해 줘 (do it for me):** in a browser window, Poko works toward your goal one step at a time:
  1. It looks at the page and proposes one step, a click or typed text.
  2. Its on-screen character points at the target, and the card in Poko's window shows a crop of that target and, for typing, the full text.
  3. The step runs only after you press **이 단계만 허용**.
  4. Poko looks again and proposes the next step. When the goal asks for information, such as "open the email and summarize it", Poko returns the answer at the end.

Examples: "검색창에 오늘 날씨를 검색해 줘", "구글에서 OO 공식 사이트를 찾아 들어가서 채용 메뉴 내용을 요약해 줘", "받은편지함에서 9월 30일 OO에게 온 메일을 열어서 요약해 줘".

It needs macOS **Screen Recording** and **Accessibility** permissions. Poko explains both and opens the right settings pane. Before the first use, it also explains what is sent: one window's screenshot and element names go to Codex (OpenAI), and Poko deletes the screenshot when the task ends.

Safety:
- Poko acts only inside `http(s)` web pages in Safari, Chrome, Arc, Firefox, or Edge. Other apps, browser toolbars, and settings pages are look-only.
- Before each step, Poko finds the target again and checks several things. It must still be the same element. It must not be covered by another window or a pop-up. Nothing inside it may take the click instead, such as a star, a checkbox, or a button that appears on hover. Links that aren't web pages, or that point to installers or archives, are refused. Password fields are never typed into.
- Clicks are real mouse clicks at a checked point. The cursor returns to where it was. Typing sets the field's value; Poko never sends keystrokes.
- **⌘⇧Esc** stops a task at once, and nothing acts after a stop. **거절** ends the task.
- Text on the page is treated as untrusted data, never as instructions. Codex runs with no shell and no file access for screen tasks.

Details and test results are in [Phase 06](docs/phases/phase-06.md).

## Install (macOS, Apple silicon)

Poko runs on your Mac with the **Codex CLI** and your **ChatGPT** sign-in, or with **Claude Code** and your Claude sign-in. It has no account or server of its own.

1. Install Codex (`npm install -g @openai/codex`, or `brew install codex`) and sign in once (`codex login`).
2. Build the app with `pnpm install && pnpm dist`, then open `release/Poko-<version>-arm64.dmg` and drag Poko to Applications.
3. Open Poko. If Codex is missing, signed out, or too old, the setup screen names the problem and the fix: copy the install command, use **로그인하기** to sign in, or update. Codex 0.159.0 or newer is required.

**Using Claude Code instead.** Install Claude Code (`npm install -g @anthropic-ai/claude-code`) and sign in once in a terminal (`claude`, then `/login`). Then choose **Claude Code** under 설정 → 엔진. Poko starts your own `claude` with your hooks, plugins, MCP servers, and settings files turned off, offers it only reading tools (plus Edit and Write when you allow edits), and shows every edit as the same approval card with undo. 화면 보기 and 대신 해 줘 use the chosen engine too; on Claude Code a screen task gets no tools at all.

With edits allowed on Claude Code (macOS), Poko can also propose project commands such as `npm test`. Each command needs approval and runs in Claude Code's sandbox:
- it can write only in the workspace, never `.git`;
- it reads only the workspace and developer toolchains, not your documents, keys, or settings;
- it has no network;
- its file changes can't be undone.

Codex command requests are still declined, because Codex runs an approved command outside its sandbox.
4. For 화면 보기, macOS asks for **Screen Recording** and **Accessibility** for Poko itself.

Signing: without a certificate, `pnpm dist` signs the app ad hoc. It runs on the Mac that built it, and macOS asks for the screen permissions again after each new build. With a Developer ID certificate (`CSC_LINK` and `CSC_KEY_PASSWORD`, or `CSC_NAME`) the app is signed with it. With Apple credentials (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) it is also notarized, so it opens on other Macs without warnings. Pushing a `v*` tag builds the app in GitHub Actions.

## Development

Requirements: Node.js 24+ and pnpm 10+. Codex CLI must be installed and authenticated for project analysis. The screen companion needs macOS with Xcode command line tools (`swiftc`); `pnpm dev` and `pnpm build` compile the small `poko-ax` accessibility helper first.

```sh
pnpm install
pnpm dev
```

`pnpm dist` packages the app into `release/` (see Install).

Useful checks (the same ones run on every pull request in GitHub Actions, on macOS):

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Poko analyzes a selected workspace through the locally installed Codex CLI with a restricted read-only permission profile. It stores app data in its Electron user-data directory and does not upload memories or history to a Poko service. Agent requests are sent to the provider you configure through Codex CLI. Read [the architecture](docs/architecture.md), [the Phase 02 implementation](docs/phases/phase-02.md), [the Phase 03 design](docs/phases/phase-03.md), and [the Phase 04 approval gate](docs/phases/phase-04.md) for the current boundaries and tradeoffs.

## Security direction

Poko keeps tool execution and SQLite out of the UI renderer. Codex runs through its App Server in a read-only sandbox. When Codex asks to run a command or change files, Poko shows the concrete action and lets you approve it once or decline. Requests whose working directory or file paths leave the workspace, that ask for network access, or that would widen permissions are declined automatically. Poko never approves shell commands, because an approved command would run outside the sandbox; these requests are declined automatically. Editing is **off by default** for every folder. When you turn it on (the 읽기 전용 / 수정 허용 button under the message box), Codex proposes changes as diffs and each one needs your approval. Changes must stay inside the selected folder and outside `.git`, and moves, renames, and binary files are declined. Right before applying a change, Poko saves the files' current contents. **되돌리기** restores them exactly, and refuses if a file changed afterwards, so newer work is never overwritten. Saved copies are kept for 30 days. SQLite content is local and unencrypted in v0.1; credentials are not stored in the database. With each request, Poko also sends your saved memories and the last few completed exchanges of the conversation to Codex, so it can follow up and respect your preferences. Nothing else from the database is sent.

## Contributing

Contributions and feedback are welcome. Please open an issue to discuss larger changes before starting implementation. Each milestone is developed through a pull request with review and verification.

## License

Poko is licensed under the MIT License. See [LICENSE](LICENSE).
