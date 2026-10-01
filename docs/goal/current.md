# 현재 목표

- 상태: 진행 중
- 마지막 갱신: 2026-10-01 09:22 Asia/Seoul
- 현재 작업 단위: Phase 04 App Server approval gate 구현

## 목표와 성공 기준

- 목표: Poko v0.1을 단계별 PR → 리뷰 → 머지 흐름으로 구현해 로컬 AI desktop agent를 제공한다.
- 성공 기준: Phase 00–02가 머지됐고, 캐릭터·workspace·읽기 전용 Codex 분석 시나리오가 구현됐다. 후속 Phase의 persistence, approval, providers, tools를 PR 단위로 검증해 완성한다.

## 범위와 확정된 결정

- 포함: Phase 00–03 기반과 Phase 04의 in-app approval gate 설계 및 구현.
- 제외: 자동 memory extraction, browser, scheduler, write/command approval enforcement (Phase 04+).
- 결정: pnpm 단일 애플리케이션에서 시작하고 필요할 때만 패키지를 분리한다. Electron main/preload/renderer는 Electron Vite를 사용하며 renderer에는 좁은 IPC bridge만 노출한다. README는 현재 동작과 계획 기능을 구분한다.
- 결정: 사용자 승인으로 Phase 04 Codex transport를 `codex exec --json`에서 stdio JSON-RPC `codex app-server`로 전환한다. App Server는 experimental이므로 capability를 좁게 유지하고 검증 전 write 실행은 fail-closed로 둔다.

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
- 완료: Phase 03 PR #7은 squash merge commit `ddd0cf3`로 원격 `main`에 반영됐다. 로컬 `main`은 사전 존재하던 divergence로 이전 커밋에 남아 있다.
- 검증: Phase 03 `pnpm check` (typecheck, lint, 16 tests, build), `pnpm format:check`, `git diff --check`, continuity validator 통과.
- 미검증: GUI restart와 packaged-app migration asset 검증은 packaging/GUI 환경이 없어 진행하지 않았다.
- 완료: Phase 04 plan PR #8은 squash merge commit `140979e`로 원격 `main`에 반영됐다.
- 완료(미커밋): Phase 04 App Server provider, 승인 IPC/preload, renderer 승인 카드와 `waiting_approval` 상태, SQLite approval audit 및 단일 migration(`20261001001847_approvals`)이 `feat/phase-04-approval`에 있다.
- 검증: `pnpm check`(typecheck, lint, 34 tests, build), `pnpm format:check` 통과.
- 미검증: GUI 상호작용, 실제 Codex model 요청, OS별 sandbox enforcement. write mode는 여전히 비활성이다.

## 마지막 체크포인트

- Handoff: [2026-10-01-0922-phase-04-approval-complete](../handoff/2026-10-01-0922-phase-04-approval-complete.md)
- Socratic: [2026-10-01-0922-phase-04-approval-complete](../socratic/2026-10-01-0922-phase-04-approval-complete.md)

## 재개 지점

1. `git status --short --branch`로 `feat/phase-04-approval`의 미커밋 변경을 확인한다.
2. 사용자 확인 후 커밋하고 PR을 올려 review → squash merge 흐름을 따른다.
3. GUI가 가능한 환경에서 `pnpm dev`로 승인 카드 흐름을 확인한다. 실제 Codex 요청은 비용/데이터 전송에 대한 사용자 승인 후 진행한다.
4. OS별 enforcement 검증 전까지 write mode는 켜지 않는다.
