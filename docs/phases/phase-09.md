# Phase 09 — Installable Poko for Codex users

## Goal

Make Poko an app someone can install and open from Finder, not only run with `pnpm dev`. The target is people who already use (or are willing to set up) the Codex CLI with a ChatGPT sign-in. Poko checks that setup on first run and guides the user through anything missing.

Other engines (Claude Code, API keys) are a later phase. This phase keeps the Codex dependency, but makes it explicit and friendly.

## What we checked first

- `resolveCodexExecutable` already searches the usual install places (PATH, Homebrew, npm global, nvm, Volta, asdf, bun).
- **A blocker for a packaged app:** an npm/nvm install of Codex is a `#!/usr/bin/env node` script (`codex-cli 0.160.0` here). An app opened from Finder gets a minimal `PATH` without `node`, so Poko would find `codex` but fail to start it.
- `codex login status` reports the sign-in ("Logged in using ChatGPT"), so Poko can check it without reading Codex's files.
- The Swift helper is loaded from `app.getAppPath()/native/build/poko-ax`. Inside a packaged app that path is in the `asar` archive, and an executable can't run from there.

## What the user experiences

- **First run, and whenever Codex isn't ready:** a short setup screen with three checks, each with a plain fix.
  1. **Codex 설치:** found at a path with its version, or install instructions (`npm install -g @openai/codex` or Homebrew), with a copy button.
  2. **로그인:** signed in, or a **로그인하기** button that starts `codex login`, which opens the browser.
  3. **사용 가능 여부:** the version is new enough for Poko's options, or an update hint.

  **다시 확인** re-runs the checks. Once everything passes, the screen gets out of the way.
- **Installing:** a `.dmg` with Poko.app. It opens from Applications like any app. Screen Recording and Accessibility permissions belong to **Poko** itself, not to a terminal.
- Everything else works as in development.

## Design

- **Starting Codex from a GUI app**
  - When Poko spawns Codex, the child's `PATH` gets the folder that holds the `codex` file put first (nvm and npm keep `node` there), followed by Homebrew's folders and the normal `PATH`.
  - Poko never runs a login shell to read the user's profile; it only starts known executables.
- **Setup check** (`setup:status`, main process, trusted renderer only)
  - It finds the executable, then runs `codex --version` and `codex login status` with that `PATH` and a timeout. It parses only the version number and whether the sign-in line says "Logged in".
  - `setup:login` runs `codex login` once, because the user clicked; the browser handles the sign-in.
  - Results are cached until 다시 확인.
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

## Milestones

1. **Codex setup check:** the GUI-safe `PATH` when spawning Codex, `setup:status` and `setup:login`, the setup screen in the app, and tests for the version and login parsing and for building `PATH`.
2. **Packaging:** the electron-builder config, the helper in resources and its packaged path, `pnpm dist`, ad-hoc signing by default with optional Developer ID signing and notarization, and README install docs.

## Acceptance criteria

- With Codex missing, not signed in, or too old, the setup screen names the problem and the fix. 다시 확인 updates it. Unit tests run with fake executables.
- A packaged Poko.app, opened from Finder (no terminal `PATH`), finds and starts an nvm-installed Codex and answers a question. This is a real run on this machine.
- The packaged app runs 화면 보기: the helper is found in resources, and the permissions are attributed to Poko.
- CI still passes. `pnpm dist` produces a `.dmg` and `.zip`. README explains install and first run.

## Explicitly deferred

- Other engines (Claude Code CLI, API keys, local models). This needs an engine choice in setup and per-engine sandbox and approval parity.
- Auto-update, Windows, and Linux packages.
