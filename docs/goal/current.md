# 현재 목표

- 상태: 진행 중
- 마지막 갱신: 2026-10-12 Asia/Seoul
- 현재 작업 단위: Phase 00–18 완료. 문서 정리(#94), Phase 20 긴 대화 맥락(#96–#98), Phase 21 사용량 보기(#99 계획, #100 기록, 표시) 완료. 개인 설치판(Phase 19)은 보류(2026-10-12 사용자 결정: 인증서는 아직 만들지 않는다).

## 목표와 성공 기준

- 목표: Poko를 단계별 PR → 리뷰 → 머지 흐름으로 만들어, 사용자의 Mac에서 매일 쓰는 개인용 로컬 AI desktop agent로 완성한다.
- 성공 기준: 각 단계가 계획 문서 → 마일스톤별 PR → 실제 앱 확인 순서로 머지된다. 개발 빌드로 확인할 수 없는 것은 사용자 Mac의 설치판에서 확인한다.

## 확정된 결정

- **배포는 보류**(2026-10-06): 개인용으로 계속 개발한다. 다시 꺼낼 때는 서명·공증 여부와 업데이트 채널을 먼저 정하고, GitHub Releases 기반 자동 업데이트(electron-updater 등)를 계획한다.
- **작업 흐름**(2026-10-01, 이후 반복 확인): 작업이 끝나면 push → PR → 리뷰 → 지적 반영 → CI 통과 후 squash merge까지 사용자 확인 없이 진행한다. main에 직접 push, 배포, 파괴적 작업은 따로 승인을 받는다.
- **구조**: pnpm 단일 애플리케이션, Electron main/preload/renderer(Electron Vite). renderer에는 좁은 IPC만 노출하고, 권한이 필요한 일은 main과 Agent Core가 한다.
- **README**: 현재 동작과 계획 기능을 구분해서 적는다.
- **엔진**: Codex는 stdio JSON-RPC `codex app-server`(experimental이라 capability를 좁게 유지), Claude Code는 stream-json. 엔진 출력은 정규화된 `AgentEvent`로만 다룬다.
- **명령 실행**: 승인된 명령은 Claude Code(macOS 샌드박스)에서만 실행한다. Codex의 명령 승인은 거절한다(Codex가 샌드박스 안 실행을 지원할 때까지).
- **제외**: 승인 없는 기억 저장, Playwright 같은 브라우저 자동화, 동시에 두 작업 실행(질문은 대기열로 순서대로 처리), 포코가 꺼져 있을 때의 실행(루틴은 포코가 실행 중일 때만 돈다. Phase 18은 로그인할 때 포코를 여는 것뿐이다).

## 완료된 단계

| 단계 | 내용 | 계획 |
|---|---|---|
| 00–04 | 기반, Codex 연결, 저장, 승인 카드 | [phase-00](../phases/phase-00.md)–[04](../phases/phase-04.md) |
| 05 | 대화 품질: 기억·맥락, Markdown, 스트리밍, 기억 제안(#69) | [phase-05](../phases/phase-05.md) |
| 06 | 화면 동반자: 화면 보기, 단계별 승인 브라우저 작업 | [phase-06](../phases/phase-06.md) |
| 07–08 | 여러 대화, 승인된 수정과 되돌리기 | [phase-07](../phases/phase-07.md), [08](../phases/phase-08.md) |
| 09–10 | 설치형 앱, 설정과 데이터 | [phase-09](../phases/phase-09.md), [10](../phases/phase-10.md) |
| 11–12 | Claude Code 엔진, 모델·추론 강도, 샌드박스 명령 | [phase-11](../phases/phase-11.md), [12](../phases/phase-12.md) |
| 13 | 어디서든 부르기: ⌥Space 빠른 입력창, 메뉴바, 알림, 받아쓰기, 선택한 글, 읽어 주기, 이어 묻기 | [phase-13](../phases/phase-13.md) |
| 14 | 파일·이미지 첨부 | [phase-14](../phases/phase-14.md) |
| 15 | 루틴(항상 읽기 전용, 당일 놓친 실행 1회, 루틴별 대화, 멈추고 지금 묻기) | [phase-15](../phases/phase-15.md) |
| 16 | 대화·프로젝트 기억의 폴더 귀속 | [phase-16](../phases/phase-16.md) |
| 17 | 질문 대기열(메인 창 #90, 빠른 입력창 #91) | [phase-17](../phases/phase-17.md) |
| 18 | 로그인할 때 포코 열기(설치한 앱에서만) | [phase-18](../phases/phase-18.md) |

그 밖에: 대화 검색, 다시 시도·답변 복사·단축키(#82), 기억 편집(#85), 상태 저장소 분리(#71), 데이터베이스 영역별 분리(#88).

## 확인된 것

- 실제 Codex로 기억 반영, 후속 질문, 스트리밍, 명령 승인 거절을 확인했다. Codex App Server는 `localImage` 입력을 지원한다.
- 각 PR의 실제 앱 확인은 해당 PR 설명에 있다(테스트용 프로필, 직접 띄운 데모 창만 사용).

## 미검증 (사용자 Mac의 설치판에서 확인 필요)

- 설치판에서 화면 보기 권한(화면 기록·손쉬운 사용)과, 업데이트 후에도 권한이 유지되는지(Phase 19);
- 로그인할 때 포코 열기(Phase 18): 실제 로그인 항목 등록과 로그아웃 후 동작;
- 마이크 버튼으로 받아쓰기가 실제로 뜨는지;
- 메인 창을 닫은 뒤 Dock 클릭으로 다시 여는 동작;
- 빠른 입력창 작업의 승인 카드를 메인 창으로 넘기는 흐름 전체(실제 수정 카드);
- 라이트 메뉴바에서 메뉴바 아이콘 색;
- 루틴 대화에서 다른 폴더가 선택됐을 때 이어서 묻기 거절;
- 루틴이 Mac 잠자기에서 깨어난 뒤 당일 놓친 실행을 한 번 실행하는지;
- 빠른 입력창 질문 대기열(Phase 17)의 실제 사용 흐름;
- 설치판에서 데이터베이스 migration이 실행되는지(앱 재시작 포함);
- Codex 제한 권한 profile과 샌드박스가 OS에서 실제로 적용되는지.

## 다음 계획 (2026-10-12 합의)

1. ~~Phase 20 긴 대화 맥락~~ 완료([phase-20](../phases/phase-20.md)). 지금 방식([phase-05](../phases/phase-05.md)): 최근 완료된 주고받기 5개, 전체 약 8,000자·한쪽 2,000자 제한, 실패·취소된 작업은 제외.
2. ~~사용량 보기~~ 완료([phase-21](../phases/phase-21.md)). 한도 경고·루틴 일시 중지는 실제 수치를 본 뒤 판단.
3. 소소한 개선(실사용 후 판단): 대화 하나 Markdown 내보내기, 루틴 결과가 변화 없으면 알림 생략.

## 보류 메모: 개인 설치판 (Phase 19)

다시 꺼낼 때 볼 것(계획 PR #95는 닫혔다):
- **서명:** ad-hoc 서명은 빌드마다 designated requirement가 cdhash로 바뀌어 macOS 권한(화면 기록·손쉬운 사용)이 초기화된다(2026-10-12 확인). Xcode 무료 Apple Development 인증서로 서명하면 유지된다.
- **설치 절차:** `pnpm build`부터 다시 하고, `-c.mac.identity`·`notarize=false`를 명시한다. 교체 전에 새 빌드의 서명과 requirement를 확인하고, 기존 앱이 완전히 종료될 때까지 기다린 뒤 `ditto`로 교체한다. 경로로 실행·종료한다(release/ 사본과 혼동하지 않게).
- **보조 프로그램:** `poko-ax`도 고정 identifier로 서명하고, 이전 ad-hoc 빌드의 권한 기록은 `tccutil reset`으로 한 번 지운다. 서명할 때 키체인 허용 창(항상 허용)이 뜬다.
- **Phase 18 버그:** `wasOpenedAtLogin`은 macOS 13+(SMAppService)에서 지원되지 않아 로그인으로 열려도 창이 뜰 수 있다. 실행 인자나 다른 판별 방법으로 고친다.

## 재개 지점

1. 원격 `main`에서 시작한다. 같은 작업 폴더를 다른 세션도 쓰므로 그 폴더의 브랜치는 바꾸지 말고 git worktree(scratchpad)에서 작업한다. worktree의 `node_modules` 링크는 `$(git rev-parse --git-common-dir)/info/exclude`에 `/node_modules`로 제외한다.
2. 모든 PR은 리뷰 → 지적 반영 → CI 통과 확인 후 squash merge한다.
   - 검사는 파이프 없이 종료 코드로 확인한다.
   - PR 전에 `git diff --stat origin/main`에 의도한 파일만 있는지 본다.
   - 커밋 전에 새 파일이 git에 포함됐는지 확인한다(`.gitignore`가 `data/`를 무시해서 `git diff --stat`에도 안 보인다).
   - 리뷰 에이전트에게 worktree를 만들거나 지우지 말라고 명시한다.
3. 실제 앱 확인은 별도 `--user-data-dir` 테스트 프로필과 직접 띄운 창으로만 한다. 사용자의 창이나 클립보드는 건드리지 않는다.
