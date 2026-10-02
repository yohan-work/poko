import { useAppStore } from "../../state/appStore";

/** Asked once before edits are allowed in a folder. */
export function EditsConfirm() {
  const open = useAppStore((state) => state.editsConfirmOpen);
  const workspace = useAppStore((state) => state.workspace);
  const setEdits = useAppStore((state) => state.setEdits);
  const close = useAppStore((state) => state.closeEditsConfirm);
  if (!open) return null;
  return (
    <div className="confirm-dialog" role="alertdialog" aria-labelledby="edits-confirm-title">
      <div className="confirm-dialog__panel">
        <h2 id="edits-confirm-title">‘{workspace?.name ?? "이 폴더"}’에서 수정을 허용할까?</h2>
        <ul className="edits-confirm__list">
          <li>포코가 파일 변경을 제안하면 바뀌는 내용을 먼저 보여줘.</li>
          <li>변경마다 허용해야 적용되고, 거절하면 아무것도 바뀌지 않아.</li>
          <li>
            엔진이 Claude Code(macOS)면 테스트 같은 명령도 제안할 수 있어. 명령마다 확인을 받고,
            작업 폴더 안 샌드박스에서 인터넷 없이 실행돼. Codex에서는 명령을 실행하지 않아.
          </li>
          <li>파일 옮기기와 폴더 밖 변경은 하지 않아.</li>
        </ul>
        <div className="confirm-dialog__actions">
          <button className="secondary-button" type="button" onClick={close}>
            취소
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => void setEdits(true, true)}
          >
            수정 허용
          </button>
        </div>
      </div>
    </div>
  );
}
