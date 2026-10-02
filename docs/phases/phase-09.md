# Phase 09 — Installable Poko for Codex users

## Goal

Make Poko an app someone can install and open from Finder, not only run with `pnpm dev`. The target is people who already use (or are willing to set up) the Codex CLI with a ChatGPT sign-in. Poko checks that setup on first run and guides the user through anything missing.

Other engines (Claude Code, API keys) are a later phase. This phase keeps the Codex dependency, but makes it explicit and friendly.

## What we checked first

- `resolveCodexExecutable` already searches the usual install places (PATH, Homebrew, npm global, nvm, Volta, asdf, bun).
- **A blocker for a packaged app:** an npm/nvm install of Codex is a `#!/usr/bin/env node` script (`codex-cli 0.160.0` here). An app opened from Finder gets a minimal `PATH` without `node`, so Poko would find `codex` but fail to start it.
- `codex login status` reports the sign-in ("Logged in using ChatGPT") **on stderr**, with exit code 0, so Poko can check it without reading Codex's files.
- The Swift helper is loaded from `app.getAppPath()/native/build/poko-ax`. Inside a packaged app that path is in the `asar` archive, and an executable can't run from there.

## What the user experiences

- **First run, and whenever Codex isn't ready:** a short setup screen with three checks, each with a plain fix.
  1. **Codex 설치:** found at a path with its version, or install instructions (`npm install -g @openai/codex` or Homebrew), with a copy button.
  2. **로그인:** signed in, or a **로그인하기** button that starts `codex login`, which opens the browser.
  3. **사용 가능 여부:** the version is at least **0.159.0**, the oldest version Poko was verified with (permission profiles, `localImage`, and the approval protocol). `codex features list` must also name `shell_tool` and `unified_exec`, which screen tasks need to turn off. Otherwise Poko shows an update hint.

  **다시 확인** re-runs the checks. Once everything passes, the screen gets out of the way.
- **Installing:** a `.dmg` with Poko.app. It opens from Applications like any app. Screen Recording and Accessibility permissions belong to **Poko** itself, not to a terminal.
- Everything else works as in development.

## Design

- **Starting Codex from a GUI app**
  - One helper, `codexEnvironment(executable)`, builds the child environment for **every** place Codex is started:
    - the App Server spawn;
    - the legacy CLI spawn;
    - `codex features list`;
    - `codex --version`, `codex login status`, and `codex login`.
  - Its `PATH` is, in order:
    1. the folder holding the resolved `codex` (nvm keeps `node` there);
    2. the folder holding `node` when it is found in a known place (nvm, Volta, asdf, fnm);
    3. `/opt/homebrew/bin` and `/usr/local/bin` (Homebrew and the nodejs.org installer);
    4. the inherited `PATH`.

    This covers npm installs with a custom prefix (`~/.npm-global/bin`) and `~/.local/bin`, where `node` lives elsewhere.
  - Poko never runs a login shell to read the user's profile; it only starts known executables.
  - If `codex` is a `#!/usr/bin/env node` script and no `node` is found in those places, the setup check says so ("Codex는 찾았지만 실행에 필요한 node를 찾지 못했어").
- **Setup check** (`setup:status`, main process, trusted renderer only)
  - It finds the executable, then runs `codex --version` and `codex login status` with that environment and a 10 s timeout each.
  - **Version:** parse `codex-cli X.Y.Z` from stdout and compare it with 0.159.0.
  - **Sign-in:** signed in means exit code 0 **and** a line on stdout or stderr that starts with `Logged in using ChatGPT`. "Not logged in", a non-zero exit, or `Logged in using an API key` all count as not ready. The last one gets its own message, because Poko targets ChatGPT sign-in.
  - **Features:** the same check, run from `codex features list`.
- **Sign-in flow** (`setup:login`)
  - It runs `codex login` once, because the user clicked; the browser handles the sign-in.
  - Only one login runs at a time; a second click while one runs does nothing and shows "로그인 창이 열려 있어".
  - The process is stopped after 5 minutes or when the user presses 취소.
  - When it exits, for any reason, Poko re-runs `setup:status` and updates the screen, so a finished sign-in shows right away. Status is otherwise re-checked on 다시 확인 and whenever the setup screen opens.
- **Packaging**
  - Use electron-builder: a `.dmg` and a `.zip` for macOS on Apple silicon (arm64). Intel or universal builds come only if needed.
  - `pnpm dist` runs the checks, builds the Swift helper, then packages.
  - The helper ships in `extraResources`. Poko resolves it at `process.resourcesPath/poko-ax` when packaged, and at the build folder in development.
  - Migrations and `skills/` stay inside the app archive (Electron reads them from `asar`).
- **Signing**
  - With no credentials, the build gets an ad-hoc signature. That is enough to run locally, but macOS asks for permissions again after each new build.
  - With a Developer ID certificate and notarization credentials in the environment (the standard electron-builder variables), `pnpm dist` signs with hardened runtime and notarizes. The entitlements are the minimum needed for Electron.
  - No credentials go in the repository.
- **CI:** an optional workflow builds an unsigned `.dmg` on tags as an artifact. It is not part of the PR checks.

## Milestone 1 notes (implemented)

- `codexEnvironment` builds the `PATH` for every Codex start. The App Server spawn, `features list`, the setup probes, `codex login`, and the legacy CLI provider all use it. The providers read the current runtime at each start, so a Codex installed or fixed during setup is used without restarting, and the feature cache is per executable.
- `SetupService` resolves Codex, finds a `node` folder, flags a node script that has no `node`, and runs `--version`, `login status`, and `features list` with a 10 s timeout. `checkCodexSetup` decides readiness: version ≥ 0.159.0, `shell_tool` and `unified_exec` present, and ChatGPT sign-in read from stdout or stderr with exit code 0.
- `codex login` runs once at a time, stops after 5 minutes or on 취소, then re-checks and pushes the new status to the window.
- The setup screen opens on start when Codex isn't ready. It lists the three steps with fixes and offers 다시 확인 and 나중에.
- Real runs of the built app with a Finder-like environment (`env -i HOME=… PATH=/usr/bin:/bin`):
  - **ready:** nvm's Codex 0.160.0 was found, and a question got an answer ("안녕!");
  - **signed out** (`CODEX_HOME` set to an empty folder): only the sign-in step failed, with 로그인하기;
  - **not installed** (an empty `HOME`): the install step with the copy button; the other steps wait for the install.

## Milestones

1. **Codex setup check:** the GUI-safe `PATH` when spawning Codex, `setup:status` and `setup:login`, the setup screen in the app, and tests for the version and login parsing and for building `PATH`.
2. **Packaging:** the electron-builder config, the helper in resources and its packaged path, `pnpm dist`, ad-hoc signing by default with optional Developer ID signing and notarization, and README install docs.

## Acceptance criteria

- With Codex missing, not signed in (including "Not logged in" and API-key sign-in), older than 0.159.0, lacking the needed features, or missing `node`, the setup screen names the problem and the fix. 다시 확인 updates it. Unit tests run with fake executables: login output on stderr, the version parse, and the order of the built `PATH`.
- `codex login` runs once at a time, stops after 5 minutes or on 취소, and refreshes the status when it ends.
- A packaged Poko.app, opened from Finder (no terminal `PATH`), finds and starts an nvm-installed Codex and answers a question. This is a real run on this machine.
- The packaged app runs 화면 보기: the helper is found in resources, and the permissions are attributed to Poko.
- CI still passes. `pnpm dist` produces a `.dmg` and `.zip`. README explains install and first run.

## Explicitly deferred

- Other engines (Claude Code CLI, API keys, local models). This needs an engine choice in setup and per-engine sandbox and approval parity.
- Auto-update, Windows, and Linux packages.
