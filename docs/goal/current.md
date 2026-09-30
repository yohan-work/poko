# 현재 목표

- 상태: 진행 중
- 마지막 갱신: 2026-09-30 15:08 Asia/Seoul
- 현재 작업 단위: Startup window visibility follow-up

## 목표와 성공 기준

- 목표: Poko v0.1 기반 문서를 만들고, 각 단계마다 PR → 리뷰 → 머지한 뒤 Phase 01 데스크톱 앱을 제공한다.
- 성공 기준: Phase 00 아키텍처 문서가 머지되고, Phase 01의 캐릭터·대화·workspace 흐름이 typecheck/lint/test/build를 통과하며 실제 화면의 핵심 조작을 검증한다.

## 범위와 확정된 결정

- 포함: Phase 00 문서와 MIT 라이선스, 공개 저장소 README; Phase 01 구현, GitHub 저장소 설명·topics, PR 리뷰 흐름.
- 제외: 이번 작업 단위에서 Codex worker, SQLite, 자동 메모리 추출, browser, scheduler, approval enforcement 구현.
- 결정: pnpm 단일 애플리케이션에서 시작하고 필요할 때만 패키지를 분리한다. Electron main/preload/renderer는 Electron Vite를 사용하며 renderer에는 좁은 IPC bridge만 노출한다. README는 현재 동작과 계획 기능을 구분한다.

## 현재 상태

- 완료: Phase 00 PR #1 및 Phase 01 PR #2가 각각 리뷰 후 squash merge됐다. Phase 01 merge commit은 `ed8b8fab`이다.
- 완료: MIT 라이선스, Phase 01 구현, 공개 README와 GitHub description/topics가 반영됐다.
- 완료: typecheck, lint, test (2개), build, format check 통과.
- 확인됨: Electron main process는 BrowserWindow의 `visible=true`와 renderer load completion을 기록했다.
- 미검증: Orca가 Electron 창을 열거하지 못해 실제 화면 상호작용/폴더 선택을 확인하지 못했다.
- 진행 중: 명시적으로 보이는 창을 생성하는 소규모 후속 수정 PR #3을 `fix/window-visible`에서 준비한다.

## 마지막 체크포인트

- Handoff: [2026-09-30-1508-window-visible-fix](../handoff/2026-09-30-1508-window-visible-fix.md)
- Socratic: [2026-09-30-1508-window-visible-fix](../socratic/2026-09-30-1508-window-visible-fix.md)

## 재개 지점

1. PR #3 continuity와 전체 diff를 검토하고 자동 검증을 실행한다.
2. PR #3을 리뷰 후 squash merge한다.
3. Orca Electron window enumeration 또는 native UI interaction을 확인 가능한 환경에서 재검증한다.
4. Phase 02 Codex worker 구현으로 진행한다.
