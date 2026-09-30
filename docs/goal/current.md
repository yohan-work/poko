# 현재 목표

- 상태: 진행 중
- 마지막 갱신: 2026-09-30 16:27 Asia/Seoul
- 현재 작업 단위: Phase 03 SQLite persistence 구현 및 PR 준비

## 목표와 성공 기준

- 목표: Poko v0.1을 단계별 PR → 리뷰 → 머지 흐름으로 구현해 로컬 AI desktop agent를 제공한다.
- 성공 기준: Phase 00–02가 머지됐고, 캐릭터·workspace·읽기 전용 Codex 분석 시나리오가 구현됐다. 후속 Phase의 persistence, approval, providers, tools를 PR 단위로 검증해 완성한다.

## 범위와 확정된 결정

- 포함: Phase 00–02 기반과 Phase 03의 SQLite task/conversation/activity/settings/memory persistence 구현.
- 제외: 자동 memory extraction, browser, scheduler, write/command approval enforcement (Phase 04+).
- 결정: pnpm 단일 애플리케이션에서 시작하고 필요할 때만 패키지를 분리한다. Electron main/preload/renderer는 Electron Vite를 사용하며 renderer에는 좁은 IPC bridge만 노출한다. README는 현재 동작과 계획 기능을 구분한다.

## 현재 상태

- 완료: Phase 00 PR #1 및 Phase 01 PR #2가 각각 리뷰 후 squash merge됐다. Phase 01 merge commit은 `ed8b8fab`이다.
- 완료: MIT 라이선스, Phase 01 구현, 공개 README와 GitHub description/topics가 반영됐다.
- 완료: typecheck, lint, test (2개), build, format check 통과.
- 확인됨: Electron main process는 BrowserWindow의 `visible=true`와 renderer load completion을 기록했다.
- 미검증: Orca가 Electron 창을 열거하지 못해 실제 화면 상호작용/폴더 선택을 확인하지 못했다.
- 완료: 창 표시 옵션을 명시한 PR #3이 `29f8b97`로 squash merge됐다.
- 완료: Phase 02 CodexProvider, JSONL normalization, Agent Core, workspace validation, task IPC와 in-memory UI 구현.
- 검증: Phase 02 `pnpm check` (typecheck, lint, 13 tests, production build), `pnpm format:check`, continuity validator 통과.
- 완료: PR #5 Phase 02가 `b8591aa`로 squash merge됐다. Codex 기본 read-only의 넓은 읽기 범위는 제한형 named permission profile로 보완했다.
- 미검증: 개발 컨테이너가 OS sandbox를 차단해 Codex 제한 profile의 실제 enforcement와 GUI interaction은 확인하지 못했다. real Codex model request는 데이터 전송/비용 때문에 실행하지 않았다.
- 완료: Phase 03은 Drizzle `1.0.0-rc.4` + Node built-in SQLite로 schema/migration, task/message/activity persistence, workspace import, explicit memory CRUD, bootstrap UI를 구현했다.
- 검증: `pnpm check` (typecheck, lint, 16 tests, build) 및 `pnpm format:check` 통과. SQLite tests는 temp file DB를 열고 닫아 persistence/recovery를 확인한다.
- 진행 중: Phase 03 변경은 `feat/phase-03-persistence`에 있으며 PR/review/merge가 남았다. Electron GUI 재시작 검증은 이 환경에서 미수행이다.

## 마지막 체크포인트

- Handoff: [2026-09-30-1627-phase-03-persistence](../handoff/2026-09-30-1627-phase-03-persistence.md)
- Socratic: [2026-09-30-1627-phase-03-persistence](../socratic/2026-09-30-1627-phase-03-persistence.md)

## 재개 지점

1. `feat/phase-03-persistence`의 전체 diff를 검토하고 `pnpm check`, `pnpm format:check` 결과를 재확인한다.
2. Phase 03 PR을 열고 PR diff를 리뷰한 뒤 squash merge한다.
3. 다음은 Phase 04 approval gate 계획/구현으로 진행한다. Electron GUI 검증 환경이 생기면 persistence restart 흐름을 추가 확인한다.
