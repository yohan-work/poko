# Handoff: Phase 03 SQLite persistence

- ID: 2026-09-30-1627-phase-03-persistence
- 상태: 부분 완료
- 기록 시각: 2026-09-30 16:27 Asia/Seoul
- 관련 Socratic: [2026-09-30-1627-phase-03-persistence](../socratic/2026-09-30-1627-phase-03-persistence.md)

## 목표와 결과

- 목표: 대화, task, Activity, workspace setting, explicit memory를 앱 재실행 뒤에도 복원한다.
- 결과: Drizzle/Node SQLite schema와 migration, main-process DB repository/IPC, renderer bootstrap/history/memory UI, 재시작을 모사하는 file-backed tests를 구현했다. PR/review/merge 전이라 작업 단위 상태는 부분 완료다.

## 변경 사항

- `electron/database/schema.ts`, `drizzle/`: 6개 테이블, FK/index, 생성된 SQLite migration.
- `electron/database/Database.ts`: WAL, foreign keys, startup migration/recovery, legacy workspace import, transactional user message/task creation, lifecycle/activity/result 저장, explicit memory CRUD/search.
- `electron/main.ts`, `electron/preload.ts`, `electron/shared.ts`: narrow bootstrap/memory IPC; DB는 main process 안에 유지.
- `src/renderer/src/state/appStore.ts`, `src/renderer/src/components/activity/MemoryPanel.tsx`: persisted bootstrap, Tasks/Activity history, add/search/delete memory UI.
- `docs/architecture.md`, `docs/phases/phase-03.md`, `README.md`: 실제 구현 범위 및 Drizzle RC dependency tradeoff 반영.
- `drizzle-orm`과 `drizzle-kit`은 `1.0.0-rc.4`로 고정했다. stable Drizzle `0.45.3`에는 Node SQLite driver가 없어 native addon을 피하기 위해 선택했으며, 안정 버전 출시 시 재검토한다.

## 검증 증거

- `pnpm db:generate` → migration 생성, 두 번째 실행에서 schema 변경 없음.
- `pnpm check` → typecheck, lint, 16 tests, Electron production build 통과.
- `pnpm format:check` → 통과.
- `electron/database/Database.test.ts` → migration/reopen, history persistence, workspace JSON import, stale-running recovery, wildcard escaping/memory CRUD를 file-backed temp DB로 확인.

## 미검증 및 차단 요인

- Electron GUI를 띄워 실제 userData directory에서 재시작 persistence를 시각 확인하지 못했다.
- 개발 Node는 `node:sqlite` experimental warning을 출력한다. Electron 44.4.5에는 Node 24.21.0이 포함되며 adapter가 동작하지만, Node API/Drizzle RC의 prerelease 위험을 문서화했다.
- Production packaging은 아직 없으므로 packaged app 안에서 migration asset 경로가 포함되는지는 추후 packaging 단계에서 검증한다.

## 다음 세션 재개 순서

1. `git status --short`와 `git diff`를 검토한다.
2. `pnpm check && pnpm format:check`를 실행한다.
3. `feat/phase-03-persistence`에서 PR을 생성하고 diff를 리뷰한 뒤 merge한다.
4. Phase 04 approval gate 계획을 `docs/phases/phase-04.md`에 먼저 작성한다.
