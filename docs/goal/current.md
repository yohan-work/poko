# 현재 목표

- 상태: 진행 중
- 마지막 갱신: 2026-09-30 15:32 Asia/Seoul
- 현재 작업 단위: Phase 02 read-only Codex worker 구현 및 PR 준비

## 목표와 성공 기준

- 목표: Poko v0.1을 단계별 PR → 리뷰 → 머지 흐름으로 구현해 로컬 AI desktop agent를 제공한다.
- 성공 기준: Phase 00–02가 머지되고, 캐릭터·workspace·읽기 전용 Codex 분석 시나리오가 검증된다. 후속 Phase의 persistence, approval, providers, tools가 완료될 때마다 이 목표를 갱신한다.

## 범위와 확정된 결정

- 포함: Phase 00–01 기반과 Phase 02 read-only Codex worker, 공개 저장소 문서 및 PR 리뷰 흐름.
- 제외: Phase 02에서 파일 수정, SQLite, 자동 메모리 추출, browser, scheduler, in-app write approval.
- 결정: pnpm 단일 애플리케이션에서 시작하고 필요할 때만 패키지를 분리한다. Electron main/preload/renderer는 Electron Vite를 사용하며 renderer에는 좁은 IPC bridge만 노출한다. README는 현재 동작과 계획 기능을 구분한다.

## 현재 상태

- 완료: Phase 00 PR #1 및 Phase 01 PR #2가 각각 리뷰 후 squash merge됐다. Phase 01 merge commit은 `ed8b8fab`이다.
- 완료: MIT 라이선스, Phase 01 구현, 공개 README와 GitHub description/topics가 반영됐다.
- 완료: typecheck, lint, test (2개), build, format check 통과.
- 확인됨: Electron main process는 BrowserWindow의 `visible=true`와 renderer load completion을 기록했다.
- 미검증: Orca가 Electron 창을 열거하지 못해 실제 화면 상호작용/폴더 선택을 확인하지 못했다.
- 완료: 창 표시 옵션을 명시한 PR #3이 `29f8b97`로 squash merge됐다.
- 완료: Phase 02 CodexProvider, JSONL normalization, Agent Core, workspace validation, task IPC와 in-memory UI 구현.
- 검증: `pnpm check` 통과 (typecheck, lint, 13 tests, production build); 포맷은 자동 정리 후 재검증 대기.
- 진행 중: Phase 02 문서와 README 정합성을 맞추고 continuity 검증 및 PR 준비를 진행한다.

## 마지막 체크포인트

- Handoff: [2026-09-30-1532-phase-02-implementation](../handoff/2026-09-30-1532-phase-02-implementation.md)
- Socratic: [2026-09-30-1532-phase-02-implementation](../socratic/2026-09-30-1532-phase-02-implementation.md)

## 재개 지점

1. 포맷 검사와 continuity validator를 통과시킨다.
2. Phase 02 변경을 로컬 리뷰 후 PR → 리뷰 → 머지한다.
3. Codex CLI 인증 계정으로 선택 workspace read-only 분석을 수동 검증한다. 실제 모델 호출은 사용자 프로젝트 정보를 전송하고 비용을 낼 수 있어 자동 테스트에서는 실행하지 않는다.
