import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { Routine, RoutineInput, RoutineSchedule } from "../../../../../electron/shared";
import { folderName } from "../../lib/folder";
import { relativeTime } from "../../lib/time";
import { useNow } from "../../lib/useNow";
import { useAppStore } from "../../state/appStore";
import { Icon } from "../Icon";
import { EmptyState, Page, PageHeader } from "../page/Page";

const DAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** "매일 09:00", "월·수 18:30", "3시간마다". */
export function scheduleLabel(schedule: RoutineSchedule): string {
  if (schedule.kind === "daily") return `매일 ${schedule.time}`;
  if (schedule.kind === "weekly")
    return `${schedule.days.map((day) => DAYS[day]).join("·")} ${schedule.time}`;
  return `${schedule.hours}시간마다`;
}

function resultLabel(routine: Routine, now: Date): string | null {
  const result = routine.lastResult;
  if (!result) return null;
  const when = relativeTime(result.at, now);
  switch (result.status) {
    case "running":
      return `실행 중 · ${when}`;
    case "completed":
      return `마지막 실행: 마쳤어 · ${when}`;
    case "failed":
      return `마지막 실행: 마치지 못했어 · ${when}${result.message ? ` · ${result.message}` : ""}`;
    case "skipped":
      return `건너뛰었어 · ${when}${result.message ? ` · ${result.message}` : ""}`;
  }
}

function RoutineForm({
  initial,
  onDone,
}: {
  initial: Routine | null;
  onDone: (saved: boolean) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [kind, setKind] = useState<RoutineSchedule["kind"]>(initial?.schedule.kind ?? "daily");
  const [time, setTime] = useState(
    initial && initial.schedule.kind !== "interval" ? initial.schedule.time : "09:00",
  );
  const [days, setDays] = useState<number[]>(
    initial?.schedule.kind === "weekly" ? initial.schedule.days : [1, 2, 3, 4, 5],
  );
  const [hours, setHours] = useState(
    initial?.schedule.kind === "interval" ? initial.schedule.hours : 3,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const schedule: RoutineSchedule =
    kind === "daily" ? { kind, time } : kind === "weekly" ? { kind, days, time } : { kind, hours };
  const ready =
    title.trim() &&
    prompt.trim() &&
    (kind !== "weekly" || days.length > 0) &&
    (kind === "interval" || time);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    const input: RoutineInput = {
      ...(initial ? { id: initial.id } : {}),
      title,
      prompt,
      schedule,
      enabled: initial?.enabled ?? true,
    };
    const response = await window.poko.routines
      .save(input)
      .catch(() => ({ error: "루틴을 저장하지 못했어. 다시 시도해 줘." }));
    setSaving(false);
    if ("error" in response) setError(response.error);
    else onDone(true);
  }

  return (
    <form className="routine-form" onSubmit={(event) => void submit(event)}>
      <label className="routine-form__field">
        <span>이름</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={60}
          placeholder="예: 아침 변경 사항 정리"
          required
        />
      </label>
      <label className="routine-form__field">
        <span>할 일</span>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          maxLength={4000}
          rows={3}
          placeholder="메시지 창에 쓰듯 적어 줘. 예: 어제 이후 바뀐 파일을 정리하고 확인할 점을 알려 줘."
          required
        />
      </label>
      <div className="routine-form__field">
        <span>언제</span>
        <div className="routine-form__when">
          <fieldset className="segmented">
            <legend className="sr-only">반복</legend>
            {(
              [
                ["daily", "매일"],
                ["weekly", "요일마다"],
                ["interval", "몇 시간마다"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={kind === value}
                className={`segmented__item${kind === value ? " is-active" : ""}`}
                onClick={() => setKind(value)}
              >
                {label}
              </button>
            ))}
          </fieldset>
          {kind === "weekly" && (
            <fieldset className="routine-form__days">
              <legend className="sr-only">요일</legend>
              {DAYS.map((label, day) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={days.includes(day)}
                  className={`routine-form__day${days.includes(day) ? " is-active" : ""}`}
                  onClick={() =>
                    setDays((current) =>
                      current.includes(day)
                        ? current.filter((item) => item !== day)
                        : [...current, day].sort(),
                    )
                  }
                >
                  {label}
                </button>
              ))}
            </fieldset>
          )}
          {kind === "interval" ? (
            <select
              aria-label="몇 시간마다"
              value={hours}
              onChange={(event) => setHours(Number(event.target.value))}
            >
              {Array.from({ length: 24 }, (_, index) => index + 1).map((value) => (
                <option key={value} value={value}>
                  {value}시간마다
                </option>
              ))}
            </select>
          ) : (
            <input
              type="time"
              aria-label="시각"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              required
            />
          )}
        </div>
      </div>
      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      <div className="memory-form__actions">
        <button className="secondary-button" type="button" onClick={() => onDone(false)}>
          취소
        </button>
        <button className="primary-button" type="submit" disabled={!ready || saving}>
          {initial ? "저장" : "루틴 만들기"}
        </button>
      </div>
    </form>
  );
}

function RoutineCard({
  routine,
  onChanged,
  onEdit,
}: {
  routine: Routine;
  onChanged: () => Promise<void>;
  onEdit: () => void;
}) {
  const now = useNow();
  const openConversation = useAppStore((state) => state.openConversation);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // While a switch change saves, the switch is off-limits: the routine shown is stale until the
  // list reloads, so a second tap would send the same value again.
  const [toggling, setToggling] = useState(false);
  const result = resultLabel(routine, now);

  // An armed delete disarms itself, so a stray click later can't delete.
  useEffect(() => {
    if (!confirmDelete) return;
    const timer = window.setTimeout(() => setConfirmDelete(false), 5000);
    return () => window.clearTimeout(timer);
  }, [confirmDelete]);

  async function toggle() {
    if (toggling) return;
    setToggling(true);
    const { id, title, prompt, schedule } = routine;
    const response = await window.poko.routines
      .save({ id, title, prompt, schedule, enabled: !routine.enabled })
      .catch(() => ({ error: "바꾸지 못했어. 다시 시도해 줘." }));
    setMessage("error" in response ? response.error : null);
    await onChanged();
    setToggling(false);
  }

  async function runNow() {
    const response = await window.poko.routines
      .run(routine.id)
      .catch(() => ({ error: "실행하지 못했어. 다시 시도해 줘." }));
    setMessage("error" in response ? response.error : "실행했어. 결과는 루틴 대화에 쌓여.");
    onChanged();
  }

  async function remove() {
    setConfirmDelete(false);
    const deleted = await window.poko.routines.delete(routine.id).catch(() => false);
    if (!deleted) setMessage("루틴을 지우지 못했어. 다시 시도해 줘.");
    await onChanged();
  }

  return (
    <li className="routine-card" data-enabled={routine.enabled}>
      <div className="routine-card__head">
        <h2 className="routine-card__title">🔁 {routine.title}</h2>
        <input
          className="switch"
          type="checkbox"
          role="switch"
          aria-label={`${routine.title} 루틴`}
          aria-checked={routine.enabled}
          checked={routine.enabled}
          disabled={toggling}
          onChange={() => void toggle()}
        />
      </div>
      <p className="routine-card__prompt">{routine.prompt}</p>
      <p className="routine-card__meta">
        {scheduleLabel(routine.schedule)} · {folderName(routine.workspacePath)} 폴더
        {routine.enabled && routine.nextRunAt
          ? ` · 다음 실행 ${new Date(routine.nextRunAt).toLocaleString("ko-KR", {
              month: "numeric",
              day: "numeric",
              weekday: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}`
          : routine.enabled
            ? ""
            : " · 꺼져 있어"}
      </p>
      {result && (
        <p className="routine-card__result" data-status={routine.lastResult?.status}>
          {result}
        </p>
      )}
      {message && (
        <p className="routine-card__message" role="status">
          {message}
        </p>
      )}
      <div className="routine-card__actions">
        <button className="secondary-button" type="button" onClick={() => void runNow()}>
          지금 실행
        </button>
        {routine.conversationId && (
          <button
            className="secondary-button"
            type="button"
            onClick={() => routine.conversationId && void openConversation(routine.conversationId)}
          >
            대화 열기
          </button>
        )}
        <button className="icon-button" type="button" onClick={onEdit} aria-label="편집">
          <Icon name="pencil" />
        </button>
        {confirmDelete ? (
          <>
            <button
              className="secondary-button routine-card__delete"
              type="button"
              onClick={() => void remove()}
            >
              정말 지울게
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setConfirmDelete(false)}
            >
              취소
            </button>
          </>
        ) : (
          <button
            className="icon-button"
            type="button"
            onClick={() => setConfirmDelete(true)}
            aria-label="삭제"
          >
            <Icon name="trash" />
          </button>
        )}
      </div>
    </li>
  );
}

/** 루틴: requests Poko runs on a schedule, always read-only, each with its own conversation. */
export function RoutinesPanel() {
  const workspace = useAppStore((state) => state.workspace);
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Routine | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      setRoutines(await window.poko.routines.list());
      setLoadError(null);
    } catch {
      setLoadError("루틴을 불러오지 못했어. 잠시 뒤 다시 시도해 줘.");
    }
  }, []);

  // Runs end while the page is open; their results show without a reload.
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <Page labelledBy="routines-title">
      <PageHeader
        id="routines-title"
        title="루틴"
        description="정해 둔 시간에 포코가 알아서 하는 일이야. 항상 읽기 전용으로 실행되고, 결과는 루틴마다 있는 대화에 쌓여. 포코가 켜져 있을 때만 돌아(창을 닫아도 메뉴 막대에서는 돌아). 설정에서 ‘로그인할 때 포코 열기’를 켜 두면 Mac을 켤 때 함께 시작해."
        action={
          editing === null && (
            <button
              className="primary-button"
              type="button"
              onClick={() => setEditing("new")}
              disabled={!workspace}
              title={workspace ? undefined : "먼저 작업할 폴더를 선택해 줘."}
            >
              <Icon name="plus" />
              <span>새 루틴</span>
            </button>
          )
        }
      />
      {editing === "new" && (
        <>
          <p className="routine-form__folder">
            {workspace ? `${workspace.name} 폴더에서 실행돼.` : "먼저 작업할 폴더를 선택해 줘."}
          </p>
          <RoutineForm
            initial={null}
            onDone={(saved) => {
              setEditing(null);
              if (saved) void load();
            }}
          />
        </>
      )}
      {loadError && (
        <p className="page-error" role="alert">
          {loadError}
        </p>
      )}
      {routines && routines.length === 0 && editing === null ? (
        <EmptyState>
          아직 루틴이 없어. 예를 들어 "매일 아침 9시에 어제 바뀐 파일 정리해 줘"를 만들어 볼까?
        </EmptyState>
      ) : (
        <ul className="routine-list" aria-label="루틴">
          {(routines ?? []).map((routine) =>
            editing !== null && editing !== "new" && editing.id === routine.id ? (
              <li key={routine.id}>
                <RoutineForm
                  initial={routine}
                  onDone={(saved) => {
                    setEditing(null);
                    if (saved) void load();
                  }}
                />
              </li>
            ) : (
              <RoutineCard
                key={routine.id}
                routine={routine}
                onChanged={load}
                onEdit={() => setEditing(routine)}
              />
            ),
          )}
        </ul>
      )}
    </Page>
  );
}
