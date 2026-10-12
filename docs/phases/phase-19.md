# Phase 19 — A personal install that keeps its permissions

## Goal

Run Poko from `/Applications` every day, and update it with one command, without macOS asking for Screen Recording and Accessibility again after each update.

This is not distribution. Deployment stays on hold (2026-10-06); the build is for the Mac it is built on.

## Why

- `pnpm dist` signs ad-hoc when no Developer ID is set. An ad-hoc signature's designated requirement is the code hash (`cdhash H"…"`), which changes with every build. This was checked on 2026-10-12: two builds of the same small app gave two different requirements.
- macOS ties Screen Recording and Accessibility grants to that requirement, so each new build counts as a new app.
- Several checks can only happen in an installed app: Phase 18 (opening at login), screen permissions in a packaged app, and migrations at restart. They have been waiting on this (see `docs/goal/current.md`, 미검증).

## Decision (agreed with the user, 2026-10-12)

**Sign with a free Apple Development certificate from Xcode.**
- It chains to Apple, so `codesign` accepts it as is.
- The designated requirement then names the bundle id and the certificate, not the code hash, so it stays the same across builds.
- It lasts a year and is renewed the same way.

A self-signed certificate was tried in a throwaway keychain: `codesign` refused it as untrusted, and making it trusted needs a change to the user's trust settings. It is kept as a fallback only.

## What the user does once

1. Open Xcode → Settings (⌘,) → **Accounts** → **+** → Apple ID, and sign in.
2. Select the account → **Manage Certificates…** → **+** → **Apple Development**.
3. Check in a terminal: `security find-identity -v -p codesigning` lists one `Apple Development: …` identity.

## What Poko adds

- **`pnpm install-local`** (`scripts/install-local.mjs`):
  - it finds the Apple Development identity (`security find-identity -v -p codesigning`, read only). If there is none, it prints the three steps above and stops;
  - it builds an unpacked app signed with that identity (`electron-builder --dir`). There is no notarization, no dmg, and no publishing;
  - it quits a running `/Applications/Poko.app` (asks it to quit, as ⌘Q would) and replaces it with the new build;
  - it verifies the signature and prints the designated requirement, which must not be a `cdhash`;
  - then it opens Poko.
- **`pnpm dist`** is unchanged: Developer ID when configured, ad-hoc otherwise.
- **The build stamp:** 설정 shows the version with the short git commit it was built from, such as "0.1.0 (c925e66)", so it is clear which build is installed.

## Checks after installing (by the user, with Poko's help)

1. Grant Screen Recording and Accessibility once, then run `pnpm install-local` again: 화면 보기 should still work with no new prompt.
2. Phase 18: turn on 로그인할 때 포코 열기, log out and in, and Poko should be in the menu bar with no window.
3. Restart Poko and confirm the data is there (migrations in the packaged app).
4. Then the rest of the 미검증 list in `docs/goal/current.md`.

## Milestones

1. **This plan.**
2. **`install-local` and the build stamp.** Without the certificate, it can only be checked as far as the "no identity" message and a dry build. With it, the user runs the first install, and the checks above follow.

## Explicitly deferred

- Distribution: Developer ID, notarization, and auto-update.
- Installing for another user or Mac.
