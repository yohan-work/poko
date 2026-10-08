# 현재 목표

- 상태: 진행 중
- 마지막 갱신: 2026-10-08 Asia/Seoul
- 현재 작업 단위: Phase 00–16 완료(#1–#86). 진행 순서: 문서 정리 → `Database.ts` 영역별 분리 → 미검증 항목 확인 → Phase 17 질문 대기열.

## 목표와 성공 기준

- 목표: Poko v0.1을 단계별 PR → 리뷰 → 머지 흐름으로 구현해 로컬 AI desktop agent를 제공한다.
- 성공 기준: Phase 00–16이 머지됐다. 이후 단계도 계획 문서 → 마일스톤별 PR → 실제 앱 확인 순서로 완성한다.

## 범위와 확정된 결정

- 포함(완료): Phase 00–16. 승인 후 파일 수정과 되돌리기, 샌드박스 명령 실행(Claude Code), 화면 보기와 한 단계씩 승인하는 브라우저 작업, 승인 후 저장하는 기억 제안, 항상 읽기 전용인 루틴.
- 제외: 승인 없는 기억 저장, Playwright 같은 브라우저 자동화, Poko가 꺼져 있을 때의 실행, 배포(보류).
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

- 2026-10-08: Phase 16과 후속 다듬기 완료(#86까지 머지). 검토 후 정리 → 미검증 확인 → Phase 17 질문 대기열 순서로 진행하기로 했다.

## 재개 지점

1. 원격 `main`에서 시작한다. 공유 작업 폴더의 브랜치는 바꾸지 말고 git worktree(scratchpad)에서 작업한다.
2. 모든 PR은 리뷰 → 지적 반영 → CI 통과 확인 후 squash merge한다.
   - 검사는 파이프 없이 종료 코드로 확인한다.
   - 커밋 전에 새 파일이 git에 포함됐는지 확인한다(`.gitignore`가 `data/`를 무시한다).
   - 리뷰 에이전트에게 worktree를 만들거나 지우지 말라고 명시한다.
3. 완료:
   - Phase 06–13: 화면 동반자, 여러 대화, 승인된 수정과 되돌리기, 설치형 앱, 설정과 데이터, Claude Code 엔진, 모델 선택, 승인 후 샌드박스 명령 실행(Claude Code·macOS), 어디서든 포코 부르기(⌥Space 빠른 입력창, 메뉴바).
4. **배포는 보류** (2026-10-06 사용자 결정: 개인용으로 계속 개발). 아래는 나중에 다시 꺼낼 때를 위한 메모.
   - GitHub Releases 기반 자동 업데이트(electron-updater 등). 서명·공증 여부와 업데이트 채널을 먼저 계획한다.
   - 패키징된 앱에서 화면 보기 권한(화면 기록·손쉬운 사용)이 실제로 동작하는지 사용자 환경에서 확인한다.
5. 완료: 빠른 입력창 "화면과 함께 묻기"(#62), 파일·이미지 끌어다 놓기([phase-14](../phases/phase-14.md)), 추론 강도 선택, Claude Code로 화면 보기·대신 해 줘, 작업 완료 알림, 대화 검색, 기억 제안(승인 후 저장), 음성으로 묻기(macOS 받아쓰기), 상태 저장소 정리(#71), 선택한 글로 묻기, 답변 읽어 주기. 반복 작업(루틴, [phase-15](../phases/phase-15.md): 항상 읽기 전용·당일 놓친 실행 1회·루틴별 대화). 대화·프로젝트 기억의 폴더 귀속([phase-16](../phases/phase-16.md)). 다시 시도·답변 복사·단축키, 빠른 입력창 이어 묻기, 기억 편집, 루틴 실행 중 "멈추고 지금 묻기". 기능 검토 후보는 모두 끝났다. 다음은 Phase 17 질문 대기열([phase-17](../phases/phase-17.md), 2026-10-08 사용자와 결정, 동시 실행은 계속 보류). 그 밖의 후보:
   - Codex 명령 실행(Codex가 승인된 명령을 샌드박스 안에서 실행할 수 있게 되면).
6. 미검증:
   - 메인 창을 닫은 뒤 Dock 클릭으로 다시 여는 동작;
   - 빠른 입력창 작업의 승인 카드를 메인 창으로 넘기는 흐름 전체(실제 수정 카드);
   - 라이트 메뉴바에서 메뉴바 아이콘 색;
   - 마이크 버튼으로 받아쓰기가 실제로 뜨는지(사용자 Mac에서 확인 필요);
   - 루틴 대화에서 다른 폴더가 선택됐을 때 이어서 묻기 거절(폴더 선택 대화상자 때문에 자동 확인 불가);
   - 루틴이 Mac 잠자기에서 깨어난 뒤 당일 놓친 실행을 한 번 실행하는지.
