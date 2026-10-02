# 현재 목표

- 상태: 진행 중
- 마지막 갱신: 2026-10-02 Asia/Seoul
- 현재 작업 단위: Phase 08 승인된 수정과 되돌리기 완료([phase-08](../phases/phase-08.md), #38–#40). CI가 모든 PR에서 검사를 돌린다(#37). Phase 09 설치형 앱 완료([phase-09](../phases/phase-09.md), #41–#43). 다음 후보: Claude Code 등 다른 엔진, 설정·데이터 관리, 코드 구조 정리.

## 목표와 성공 기준

- 목표: Poko v0.1을 단계별 PR → 리뷰 → 머지 흐름으로 구현해 로컬 AI desktop agent를 제공한다.
- 성공 기준: Phase 00–07이 머지됐다(캐릭터 UI, 읽기 전용 Codex 분석, 저장, 승인 게이트, 대화 품질, 화면 동반자, 여러 대화). 이후 샌드박스 기반 쓰기 모드를 PR 단위로 검증해 완성한다.

## 범위와 확정된 결정

- 포함: Phase 00–04 기반, Claude 스타일 UI 개편, Phase 05 대화 품질.
- 제외: 자동 memory extraction, browser 자동화, scheduler, 자동 실행. 승인 기반 파일 쓰기는 workspace-write 샌드박스와 함께 Phase 07 이후에 진행한다.
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
- 완료: Phase 04 PR #10은 리뷰(4건 수정: process group 종료, `willRetry`, symlink 경계, 복수 승인 대기열) 후 squash merge commit `1526608`로 원격 `main`에 반영됐다.
- 검증: `pnpm check`(typecheck, lint, 37 tests, build), `pnpm format:check`, `git diff --check` 통과.
- 미검증: GUI 상호작용, OS별 sandbox enforcement. write mode는 비활성이다. (실제 Codex 요청은 아래 PR #22 항목에서 확인됨)
- 완료: UI 개편 PR #12(사이드바·대화 화면), #13(검정 구 + 코랄 위성 캐릭터), #14(작업·기억·활동 탭)가 리뷰 후 squash merge됐다. 최신 `main`은 `76948f6`이다.
- 결정: 작업 완료 후 PR → 리뷰 → 지적 반영 → squash merge까지 사용자 확인 없이 진행한다(사용자 지시, 2026-10-01).
- 결정: 다음 순서는 Phase 06 화면 동반자(사용자의 'wow point' 요청) → Phase 07 여러 대화 → 이후 workspace-write 샌드박스 기반 쓰기 모드. 계획은 [phase-06](../phases/phase-06.md).
- 완료: Phase 05 대화 품질. PR #15(계획), #17(기억·대화 맥락, `tasks.conversation_id`/`result` migration), #19(Markdown), #20(스트리밍)이 리뷰 후 squash merge됐다. 최신 `main`은 `4c24790`이다.
- 검증: `pnpm check`(typecheck, lint, 60 tests, build), `pnpm format:check`, `git diff --check` 통과. 화면은 stub preload로 렌더링해 확인했다.
- 완료: PR #22로 실제 Codex 검증에서 찾은 승인 버그(실행 정책 제안 때문에 모든 승인 자동 거절)를 고쳤다. 승인된 셸 명령은 샌드박스 밖에서 실행되므로 v0.1에서는 명령 승인을 거절하고 파일 변경 승인만 유지한다(사용자 결정). v0.1은 실질적으로 읽기 전용이다. `main`은 `78bc860`.
- 확인됨: 실제 Codex(0.159.3)로 기억 반영, 후속 질문, 스트리밍, 명령 승인 거절을 확인했다.
- 확인됨: Codex App Server는 `localImage` 입력을 지원해 기존 구독으로 화면 이해가 가능하다.
- 운영 메모: 같은 작업 폴더를 다른 세션도 사용한다. 브랜치 전환이 섞이지 않도록 별도 git worktree에서 작업한다.

## 마지막 체크포인트

- Handoff: [2026-10-01-1258-phase-05-complete](../handoff/2026-10-01-1258-phase-05-complete.md)
- Socratic: [2026-10-01-1258-phase-05-complete](../socratic/2026-10-01-1258-phase-05-complete.md)

## 재개 지점

1. 원격 `main`에서 시작한다. 공유 작업 폴더의 브랜치는 바꾸지 말고 git worktree를 사용한다.
2. Phase 07 완료: [phase-07](../phases/phase-07.md). 사이드바 대화 목록·새 대화·전환(#34), 이름 바꾸기·삭제(#35).
3. Phase 06 완료(#24–#31): 권한·보기, 오버레이 캐릭터, 행동 하나씩 승인, 실제 사이트 검증(검사 후 마우스 클릭, 승인 카드 전달 수정). 데모 GIF는 README에 있다.
4. macOS 화면 기록·손쉬운 사용 권한과 실제 Codex 요청은 사용자 환경에서 확인한다.
