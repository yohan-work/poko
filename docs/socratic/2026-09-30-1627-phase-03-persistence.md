# Socratic: Phase 03 SQLite persistence

- ID: 2026-09-30-1627-phase-03-persistence
- 상태: 부분 완료
- 관련 Handoff: [2026-09-30-1627-phase-03-persistence](../handoff/2026-09-30-1627-phase-03-persistence.md)

## 질문과 확인된 사실

| 질문 | 답 | 상태 | 근거 |
| --- | --- | --- | --- |
| DB는 어디에 있고 어느 process가 소유하는가? | Electron main이 userData의 `poko.sqlite`를 단독 소유하고 renderer에는 DTO만 IPC로 반환한다. | 확인됨 | `electron/main.ts`, `electron/database/Database.ts`, `electron/preload.ts` |
| user message/task와 결과를 재실행 뒤에 복구하는가? | 입력과 task를 transaction에 넣고 lifecycle/result/activity를 저장한다. temp file DB close/reopen test가 복구를 확인했다. | 확인됨 | `PokoDatabase.createTask`, `PokoDatabase.recordTaskEvent`, `electron/database/Database.test.ts`; `pnpm test` 통과 |
| stale running task를 재개하는가? | 재개하지 않고 앱 시작 때 `failed`로 종료 표시한다. | 확인됨 | `PokoDatabase.recoverInterruptedTasks`, persistence test |
| memory는 자동 추출 또는 vector search를 하는가? | 하지 않는다. user가 명시 저장/검색/삭제하는 plain text CRUD다. | 확인됨 | `MemoryPanel`, `PokoDatabase` |
| 안정 Drizzle에서 Node built-in SQLite driver를 바로 쓸 수 있는가? | 조사 시 stable `0.45.3`에는 adapter가 없어 `1.0.0-rc.4`로 고정했다. | 확인됨 | package/lockfile, `docs/phases/phase-03.md`; runtime file-backed tests |
| GUI에서 실제 재시작까지 확인했는가? | 이 실행 환경에서 GUI를 사용할 수 없어 확인하지 못했다. | 미확인 | GUI restart 시나리오 실행 기록 없음 |

## 판단

- 확인됨: migrations, file-backed DB close/reopen, workspace import, interrupted-task recovery, literal wildcard memory search 테스트가 통과했다. 전체 `pnpm check`와 `pnpm format:check`도 통과했다.
- 추론: 짧은 synchronous SQL 작업을 main process에 한정하고 event persistence errors를 UI event delivery와 분리하면 v0.1의 데이터량에서는 수용 가능하다. 큰 대화 기록/Activity가 필요해지면 pagination 또는 retention이 필요하다.
- 미확인: packaged app migration asset path, GUI renderer hydration 및 실제 닫기/재시작 UX.

## 다음 계획

1. PR 생성 전에 전체 변경과 migration을 다시 review한다 — 근거/의존성: user가 정한 PR → review → merge 흐름 — 확인 방법: `git diff`, `pnpm check`, `pnpm format:check`.
2. Phase 03 PR diff를 리뷰하고 merge한다 — 근거/의존성: 구현 branch가 현재 `origin/main`의 merged plan 위에 있다 — 확인 방법: PR checks 및 merge 상태.
3. Phase 04에서 command/write 승인 대상을 구체화한다 — 근거/의존성: 현재 provider는 read-only고 approval/write support deferred — 확인 방법: phase plan과 정책 테스트.

## 중단 또는 방향 전환 조건

- Drizzle stable에서 Node SQLite adapter가 제공되면 RC pin/lockfile/migration output을 검토하고 GA 버전으로 이동한다.
- 실제 app packaging에서 migration folder가 번들되지 않는 것이 확인되면 migration asset 배치 방식을 packaging 설계에 포함한다.
