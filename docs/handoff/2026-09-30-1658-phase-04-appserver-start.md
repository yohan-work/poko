# Handoff: Phase 04 App Server approval gate 구현 시작

- ID: 2026-09-30-1658-phase-04-appserver-start
- 상태: 부분 완료
- 기록 시각: 2026-09-30 16:58 Asia/Seoul
- 관련 Socratic: [2026-09-30-1658-phase-04-appserver-start](../socratic/2026-09-30-1658-phase-04-appserver-start.md)

## 목표와 결과

- 목표: Codex 작업의 구체적인 action approval을 Poko main process가 소유하고 audit하는 기반을 만든다.
- 결과: 사용자가 App Server transport 전환을 승인했다. 현재 branch에 approval protocol/provider, main IPC 및 persistence 초기 변경이 미커밋 상태로 존재한다. 구현은 진행 중이며 renderer 처리와 테스트가 남았다.

## 변경 사항

- `electron/shared.ts`: approval IPC channel, approval event/DTO 타입 추가.
- `electron/agent/AgentProvider.ts`, `electron/agent/AgentCore.ts`: approval callback 및 응답 경로 초기 추가.
- `electron/providers/codex/appServerProtocol.ts`, `electron/providers/codex/CodexAppServerProvider.ts`: stdio JSON-RPC 프로토콜 파서와 App Server provider 초기 구현.
- `electron/database/schema.ts`, `electron/database/Database.ts`, `drizzle/20260930075429_spotty_maddog/`, `drizzle/20260930075456_blue_ares/`: approval audit schema, request/resolve/restart recovery 초기 추가.
- `electron/main.ts`: approval 응답 IPC와 DB 기록 연결.
- 의도: `codex exec --json`은 상호작용 approval 응답 통로가 없어 Codex App Server로 전환한다. App Server가 experimental이므로 OS enforcement 검증 전 write는 켜지 않는다.

## 검증 증거

- `git status --short --branch` → `feat/phase-04-approval...origin/main`; 위 변경 파일들이 미커밋 상태이며 기존 파일 삭제는 없다.
- `git log -1 --oneline` → `26694ac docs: record Phase 04 architecture decision gate (#9)`.
- `pnpm typecheck` → 실패: `src/renderer/src/state/appStore.ts:69`와 `:88`의 exhaustive switch가 새 `approvalRequired` event를 처리하지 않아 TS2366.
- 직전 조사에서 `codex --version`은 `codex-cli 0.159.1`, `codex app-server --help`는 stdio server 명령과 experimental 상태를 표시했다.
- App Server 프로토콜 근거: [공식 App Server 문서](https://learn.chatgpt.com/docs/app-server), [OpenAI harness overview](https://openai.com/index/unlocking-the-codex-harness/).

## 미검증 및 차단 요인

- Phase 04 `pnpm check`, lint, tests, format, build는 아직 실행하지 않았다.
- preload channel allowlist, renderer approval UI/store, `waiting_approval` task lifecycle 및 provider/protocol/database 테스트가 남았다.
- `CodexAppServerProvider.ts`의 module-global `sessionItems`를 per-task session state로 옮긴다. 초기 구현이라 request timeout, cancellation, shutdown 및 stale response 처리를 검토한다.
- App Server는 experimental이며 sandbox/write pause 보장은 OS별로 미검증이다. 미지원/모호한 요청은 거부하고 write execution을 enable하지 않는다.
- 실제 Codex model 요청 및 GUI 검증은 데이터 전송/비용과 실행 환경 확인이 필요하므로 아직 하지 않았다.

## 다음 세션 재개 순서

1. `git status --short --branch`를 실행해 `feat/phase-04-approval`에 보존된 변경을 확인한다. 브랜치를 바꾸거나 reset하지 않는다.
2. `src/renderer/src/state/appStore.ts`의 두 switch에 approval event 처리를 추가하고 `pnpm typecheck`를 실행한다.
3. `electron/providers/codex/CodexAppServerProvider.ts`에서 session item 상태를 task-local로 만들고 protocol/request lifecycle을 검토한다.
4. preload, renderer store/UI, task state transition, approval activity/history와 DB recovery를 완성한다.
5. protocol, stale/mismatched ID, fail-closed, persistence/restart recovery 테스트를 추가하고 `pnpm check`, `pnpm format:check`, continuity validator를 실행한다.
6. `git diff --check` 및 전체 diff review 후 PR을 생성해 기존 PR → review → squash merge 흐름을 따른다. OS별 enforcement가 검증될 때까지 write mode를 비활성 상태로 둔다.
