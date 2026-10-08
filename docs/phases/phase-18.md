# Phase 18 — Opening Poko at login

## Goal

Let routines run without the user remembering to open Poko.

Routines (Phase 15) run only while Poko runs. After a restart, or a day the user never opened Poko, nothing runs. The 루틴 page says so, but the fix is up to the user. A Mac app usually solves this with a login item.

## What the user experiences

- **The setting:** 설정 → 시작 → **로그인할 때 포코 열기**, off by default.
  - Its line: "Mac에 로그인하면 포코가 창 없이 메뉴 막대에서 시작해. 루틴도 앱을 열지 않아도 돌아."
  - The switch shows what macOS has, not a saved copy. If the user removes Poko in 시스템 설정 → 일반 → 로그인 항목, the switch shows off.
  - If macOS needs the user's approval, the switch stays on and the line says: "시스템 설정 → 일반 → 로그인 항목에서 포코를 허용해 줘."
  - If macOS refuses to register it (which can happen to an ad-hoc signed or moved copy), the switch goes back to off: "macOS가 포코를 로그인 항목에 넣지 못했어. 포코를 응용 프로그램 폴더에서 연 뒤 다시 켜 줘."
  - The page reads it again whenever the window gets focus, so a change made in 시스템 설정 shows up.
  - **Disabled:**
    - in a development build: "설치한 앱에서만 쓸 수 있어." Otherwise a login item would point at the development Electron;
    - in an app outside the Applications folder: "포코를 응용 프로그램 폴더로 옮긴 뒤에 쓸 수 있어."
  - macOS only. electron-builder builds only the macOS app.
- **At login:**
  - Poko starts without its window. It shows in the menu bar (and the Dock), and the shortcut, the quick panel, and routines work as usual;
  - the Dock icon, 포코 열기 in the menu bar, or a notification opens the window;
  - routine times missed earlier that day run as Phase 15 already does.
- **The 루틴 page** mentions the setting: "포코가 켜져 있을 때만 돌아. 설정에서 ‘로그인할 때 포코 열기’를 켜 두면 Mac을 켤 때 함께 시작해."

## Design

- **No storage.** macOS keeps the login item. Main reads it with `app.getLoginItemSettings()` and changes it with `app.setLoginItemSettings({ openAtLogin })`. On macOS 13+ that uses `SMAppService` (`mainAppService`).
- **The state** (`LoginItemState`, part of `settings:get`):
  - `available`: `app.isPackaged`, macOS, and `app.isInApplicationsFolder()`. `unavailable` says which one is missing;
  - `enabled`: `status` is `enabled` or `requires-approval`;
  - `needsApproval`: `status` is `requires-approval`.
- **Changing it:** `settings:set-login-item(enabled: boolean)` refuses anything but a boolean, and does nothing when the item isn't available. After writing, it reads the status again. macOS can refuse silently (Electron only logs it), so a switch turned on that didn't take comes back with `failed`.
- **Ad-hoc signing:** `pnpm dist` without a Developer ID signs ad hoc. Each rebuild changes the code identity, so macOS may ask for approval again or keep a stale entry. Check the real app with the build installed in /Applications.
- **Starting hidden:** `wasOpenedAtLogin` is read once at startup. If it is true, the main window is created with `show: false`.
  - If macOS doesn't report the login launch, the window just shows. That fails safe: Poko still runs, with its window open.
  - The deprecated `openAsHidden`/`wasOpenedAsHidden` don't work on macOS 13+ and aren't used.
- **Dock clicks during a quiet start:** `activate` is registered first in `whenReady`. A click before the window exists asks for it to show once it does.
- **The first show** uses a window background in the app's color, so it doesn't flash white.
- **Not changed:** routines, the scheduler, and the quit flow.

## Milestone (one PR)

1. The IPC, the setting, starting hidden, and the 루틴 page line.

   Tests cover:
   - the state in each case: installed, a development build, outside /Applications, and approval pending;
   - a refused registration;
   - the hidden start decision, including a read that throws.

   The real app check needs a packaged build in /Applications:
   - turn the setting on and off and see it in 시스템 설정 → 로그인 항목;
   - log out and back in once to see the hidden start;
   - then try the Dock, 포코 열기 in the menu bar, and a notification click.

## Explicitly deferred

- Hiding the Dock icon while the window is closed.
- Windows and Linux.
