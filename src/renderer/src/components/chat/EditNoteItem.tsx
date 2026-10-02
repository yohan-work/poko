import { useState } from "react";
import type { EditNote } from "../../../../../electron/shared";
import { useAppStore } from "../../state/appStore";

/** An approved change in the conversation, with undo while it is still possible. */
export function EditNoteItem({ note }: { note: EditNote }) {
  const undoEdit = useAppStore((state) => state.undoEdit);
  const undoing = useAppStore((state) => state.undoingEdit === note.id);
  const isSending = useAppStore((state) => state.isSending);
  const [error, setError] = useState<string | null>(null);
  const shown = note.files.slice(0, 3).join(", ");
  const more = note.files.length > 3 ? ` 외 ${note.files.length - 3}개` : "";

  return (
    <li className="edit-note" data-status={note.status}>
      <div className="edit-note__body">
        <p className="edit-note__title">
          {note.status === "undone" ? "되돌린 변경" : `파일 ${note.files.length}개를 바꿨어`}
        </p>
        <p className="edit-note__files" title={note.files.join("\n")}>
          {shown}
          {more}
        </p>
        {error && (
          <p className="edit-note__error" role="alert">
            {error}
          </p>
        )}
      </div>
      {note.status === "applied" && (
        <button
          className="secondary-button edit-note__undo"
          type="button"
          disabled={undoing || isSending}
          title={
            isSending
              ? "포코가 작업 중이라 끝난 뒤에 되돌릴 수 있어."
              : "이 변경 전으로 파일을 되돌려"
          }
          onClick={async () => setError(await undoEdit(note.id))}
        >
          {undoing ? "되돌리는 중…" : "되돌리기"}
        </button>
      )}
      {note.status === "undone" && <span className="edit-note__badge">되돌렸어</span>}
      {note.status === "expired" && (
        <span className="edit-note__badge">되돌리기 기간이 지났어</span>
      )}
    </li>
  );
}
