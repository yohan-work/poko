# Phase 18 — Opening Poko at login

## Goal

Let routines run without the user remembering to open Poko.

Routines (Phase 15) run only while Poko runs. After a restart, or a day the user never opened Poko, nothing runs. The 루틴 page says so, but the fix is up to the user. A Mac app usually solves this with a login item.

## What the user experiences

- **The setting:** 설정 → 시작 → **로그인할 때 포코 열기**, off by default.
  - Its line: "Mac에 로그인하면 포코가 창 없이 메뉴 막대에서 시작해. 루틴도 앱을 열지 않아도 돌아."
  - The switch shows what macOS has, not a saved copy. If the user removes Poko in 시스템 설정 → 일반 → 로그인 항목, the switch shows off.
  - If macOS needs the user's approval, the line says: "시스템 설정 → 일반 → 로그인 항목에서 포코를 허용해 줘."
  - In a development build the switch is off and disabled: "설치한 앱에서만 쓸 수 있어." Otherwise a login item would point at the development Electron.
- **At login:**
  - Poko starts without its window. It shows in the menu bar (and the Dock), and the shortcut, the quick panel, and routines work as usual;
  - the Dock icon, 포코 열기 in the menu bar, or a notification opens the window;
  - routine times missed earlier that day run as Phase 15 already does.
- **The 루틴 page** mentions the setting: "포코가 켜져 있을 때만 돌아. 설정에서 ‘로그인할 때 포코 열기’를 켜 두면 Mac을 켤 때 함께 시작해."

## Design

- **No storage.** macOS keeps the login item. Main reads it with `app.getLoginItemSettings()` and changes it with `app.setLoginItemSettings({ openAtLogin })`. On macOS 13+ that uses `SMAppService` (`mainAppService`).
- **IPC:**
  - `app:login-item` returns `{ available, enabled, needsApproval }`:
    - `available`: `app.isPackaged` and macOS or Windows;
    - `needsApproval`: macOS reports `status: "requires-approval"`.
  - `app:set-login-item(enabled: boolean)` changes it and returns the same shape. Main refuses it when it isn't available.
- **Starting hidden:** at startup, main checks `wasOpenedAtLogin` (macOS) and creates the main window with `show: false`. Everything else starts as usual.
  - If macOS doesn't report the login launch, the window just shows. That fails safe: Poko still runs, with its window open.
- **Not changed:** routines, the scheduler, and the quit flow.

## Milestone (one PR)

1. The IPC, the setting, starting hidden, and the 루틴 page line.

   Tests cover the shape main returns (available, development builds, approval) and the hidden start decision.

   The real app check needs a packaged build:
   - turn the setting on and off and see it in 시스템 설정 → 로그인 항목;
   - log out and back in once to see the hidden start.

## Explicitly deferred

- Hiding the Dock icon while the window is closed.
- Linux autostart.
