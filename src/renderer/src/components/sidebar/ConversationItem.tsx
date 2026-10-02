import { useEffect, useRef, useState } from "react";
import type { PersistedConversation } from "../../../../../electron/shared";
import { relativeTime } from "../../lib/time";
import { useAppStore } from "../../state/appStore";
import { Icon } from "../Icon";

const BUSY_HINT = "포코가 작업 중이라 끝난 뒤에 옮길 수 있어.";

/** One conversation in the sidebar: open it, rename it inline, or delete it after confirming. */
export function ConversationItem({
  conversation,
  now,
}: {
  conversation: PersistedConversation;
  now: Date;
}) {
  const activeConversationId = useAppStore((state) => state.activeConversationId);
  const isSending = useAppStore((state) => state.isSending);
  const openConversation = useAppStore((state) => state.openConversation);
  const renameConversation = useAppStore((state) => state.renameConversation);
  const deleteConversation = useAppStore((state) => state.deleteConversation);
  // Fixed position under the button, so the list's scroll area can't clip the menu.
  const [menuAt, setMenuAt] = useState<{ top: number; right: number } | null>(null);
  const menuOpen = menuAt !== null;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(conversation.title);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const active = conversation.id === activeConversationId;
  const locked = isSending && !active;

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuAt(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const saveTitle = async () => {
    if (busy) return;
    const next = title.replace(/\s+/g, " ").trim();
    if (next === conversation.title) {
      setEditing(false);
      return;
    }
    setBusy(true);
    const failure = await renameConversation(conversation.id, next);
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    setError(null);
    setEditing(false);
  };

  const remove = async () => {
    setBusy(true);
    const failure = await deleteConversation(conversation.id);
    setBusy(false);
    if (failure) {
      setError(failure);
      setConfirming(false);
    }
  };

  if (editing)
    return (
      <li className="conversation-item is-editing">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void saveTitle();
          }}
        >
          <input
            className="conversation-item__input"
            aria-label="대화 이름"
            value={title}
            maxLength={80}
            // biome-ignore lint/a11y/noAutofocus: the field appears because the user chose to rename.
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setTitle(conversation.title);
                setError(null);
                setEditing(false);
              }
            }}
            onBlur={() => void saveTitle()}
          />
        </form>
        {error && (
          <p className="conversation-item__error" role="alert">
            {error}
          </p>
        )}
      </li>
    );

  return (
    <li className="conversation-item">
      <div className="conversation-item__row">
        <button
          className={`recent-list__item${active ? " is-active" : ""}`}
          type="button"
          onClick={() => void openConversation(conversation.id)}
          disabled={locked}
          aria-current={active ? "true" : undefined}
          title={locked ? BUSY_HINT : conversation.title}
        >
          {active && isSending && (
            <>
              <span className="recent-list__dot recent-list__dot--running" aria-hidden="true" />
              <span className="visually-hidden">작업 중</span>
            </>
          )}
          <span className="recent-list__title">{conversation.title}</span>
          <span className="recent-list__time">{relativeTime(conversation.updatedAt, now)}</span>
        </button>
        <div className="conversation-item__menu" ref={menuRef}>
          <button
            className="conversation-item__more"
            type="button"
            aria-label={`${conversation.title} 대화 메뉴`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(event) => {
              if (menuOpen) {
                setMenuAt(null);
                return;
              }
              const box = event.currentTarget.getBoundingClientRect();
              setMenuAt({ top: box.bottom + 4, right: window.innerWidth - box.right });
            }}
          >
            <Icon name="more" />
          </button>
          {menuOpen && (
            <div className="conversation-menu" role="menu" style={menuAt ?? undefined}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuAt(null);
                  setTitle(conversation.title);
                  setError(null);
                  setEditing(true);
                }}
              >
                <Icon name="pencil" />
                이름 바꾸기
              </button>
              <button
                type="button"
                role="menuitem"
                className="conversation-menu__danger"
                // The conversation Poko is working in can't be deleted until it finishes.
                disabled={active && isSending}
                title={
                  active && isSending
                    ? "포코가 이 대화에서 작업 중이라 끝난 뒤에 지울 수 있어."
                    : undefined
                }
                onClick={() => {
                  setMenuAt(null);
                  setError(null);
                  setConfirming(true);
                }}
              >
                <Icon name="trash" />
                삭제
              </button>
            </div>
          )}
        </div>
      </div>
      {error && (
        <p className="conversation-item__error" role="alert">
          {error}
        </p>
      )}
      {confirming && (
        <div
          className="confirm-dialog"
          role="alertdialog"
          aria-labelledby={`delete-${conversation.id}`}
        >
          <div className="confirm-dialog__panel">
            <h2 id={`delete-${conversation.id}`}>이 대화를 삭제할까?</h2>
            <p>‘{conversation.title}’의 메시지가 지워져. 작업과 활동 기록은 그대로 남아.</p>
            <div className="confirm-dialog__actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
              >
                취소
              </button>
              <button
                className="primary-button confirm-dialog__danger"
                type="button"
                onClick={() => void remove()}
                disabled={busy}
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}
