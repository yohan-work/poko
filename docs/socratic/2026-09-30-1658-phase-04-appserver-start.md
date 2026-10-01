# Socratic: Phase 04 App Server approval gate 구현 시작

- ID: 2026-09-30-1658-phase-04-appserver-start
- 상태: 부분 완료
- 관련 Handoff: [2026-09-30-1658-phase-04-appserver-start](../handoff/2026-09-30-1658-phase-04-appserver-start.md)

## 질문과 확인된 사실

| 질문 | 답 | 상태 | 근거 |
| --- | --- | --- | --- |
| 작업 브랜치와 시작 commit은 무엇인가? | `feat/phase-04-approval`, `26694ac`에서 시작했다. | 확인됨 | `git status --short --branch`, `git log -1 --oneline` |
| 왜 transport를 바꾸는가? | Phase 04는 사용자가 현재 실행의 구체적인 action을 승인/거부해야 하는데 `codex exec --json`은 필요한 bidirectional approval channel을 제공하지 않아 App Server stdio JSON-RPC로 전환한다. | 확인됨 | `docs/phases/phase-04.md`; 공식 [App Server protocol](https://learn.chatgpt.com/docs/app-server) |
| 현재 코드 검증은 통과하는가? | Typecheck가 renderer의 두 exhaustive switch 누락으로 실패한다. | 확인됨 | `pnpm typecheck`: `appStore.ts:69`, `appStore.ts:88`, TS2366 |
| 실제 write approval이 안전하게 작동하는가? | 아직 확인되지 않았다. | 미확인 | GUI 및 supported OS enforcement 검증은 미실행 |

## 판단

- 확인됨: 승인 흐름은 main process에서 request identity와 child stdin을 소유해야 하고, DB에는 pending 요청을 재시작 후 복원하지 않도록 만료 처리가 필요하다. 이 요구는 `docs/phases/phase-04.md`에 기록되어 있다.
- 확인됨: 현재 미커밋 구현은 shared types, Agent Core/provider boundary, Codex app-server transport, DB audit schema/recovery 및 main IPC를 일부 연결한다.
- 추론: 다음으로 renderer switch를 고치면 남은 컴파일 오류가 드러날 수 있으므로 그 지점부터 작은 단위로 검증하는 것이 가장 빠르다.
- 미확인: 초기 provider의 stream lifecycle, cancellation, timeout, malformed/mismatched approval 처리와 여러 task 동시 실행 안정성.
- 미확인: OS별 Codex sandbox가 action 전에 실제로 pause하는지와 UI에서 approval/decline가 기대대로 보이는지.

## 다음 계획

1. `src/renderer/src/state/appStore.ts` 두 switch에서 approval event를 exhaustively 처리한다 — 근거/의존성: 새 shared `AgentEvent` union — 확인 방법: `pnpm typecheck`.
2. `electron/providers/codex/CodexAppServerProvider.ts`의 module-global item tracking을 session-local로 옮기고 request lifecycle을 단순화한다 — 근거/의존성: task별 isolated stream 필요 — 확인 방법: provider protocol 단위 테스트.
3. preload IPC validation, renderer pending approval UI, task `waiting_approval` lifecycle을 잇는다 — 근거/의존성: main process API 및 DTO — 확인 방법: renderer/typecheck 및 IPC/state tests.
4. deny-by-default, stale request, malformed protocol, timeout, persistence/restart recovery 테스트를 추가한다 — 근거/의존성: Phase 04 acceptance criteria — 확인 방법: `pnpm check`, `pnpm format:check`, migration tests.
5. 전체 변경을 리뷰하고 PR 흐름을 진행한다 — 근거/의존성: 사용자 지정 PR → 리뷰 → 머지 — 확인 방법: PR review 후 squash merge.

## 중단 또는 방향 전환 조건

- App Server protocol negotiation/capability가 지원되지 않거나 안전한 pause를 보장하지 않으면 write request를 거부하고 read-only analysis만 유지한다.
- OS별 sandbox enforcement 검증 전 write mode를 켜지 않는다.
- DB persistence 실패, malformed action 또는 request identity mismatch가 발생하면 해당 action은 거부한다.
