import { useEffect } from "react";
import { useAppStore } from "../../state/appStore";
import { Character } from "../character/Character";
import { Icon } from "../Icon";

function Permission({
  granted,
  title,
  why,
  kind,
}: {
  granted: boolean;
  title: string;
  why: string;
  kind: "screen" | "accessibility";
}) {
  const openScreenSettings = useAppStore((state) => state.openScreenSettings);
  return (
    <li className="screen-permission" data-granted={granted}>
      <span className="screen-permission__state">{granted ? "허용됨" : "필요해"}</span>
      <div>
        <p className="screen-permission__title">{title}</p>
        <p className="screen-permission__why">{why}</p>
      </div>
      {!granted && (
        <button className="secondary-button" type="button" onClick={() => openScreenSettings(kind)}>
          설정 열기
        </button>
      )}
    </li>
  );
}

/** Picks a window for Poko to look at; explains permissions and data use first. */
export function ScreenPicker({ question, onPicked }: { question: string; onPicked: () => void }) {
  const screen = useAppStore((state) => state.screen);
  const closeScreen = useAppStore((state) => state.closeScreen);
  const refreshScreen = useAppStore((state) => state.refreshScreen);
  const acceptScreenNotice = useAppStore((state) => state.acceptScreenNotice);
  const lookAtWindow = useAppStore((state) => state.lookAtWindow);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeScreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeScreen]);

  if (!screen.open) return null;
  const status = screen.status;
  const permissionsReady = status?.permissions.accessibility && status.permissions.screen;

  return (
    <div className="screen-picker" role="dialog" aria-modal="true" aria-labelledby="screen-title">
      <div className="screen-picker__panel">
        <header className="screen-picker__header">
          <Character state="listening" size={30} />
          <h2 id="screen-title">어떤 화면을 볼까?</h2>
          <button className="icon-button" type="button" onClick={closeScreen} aria-label="닫기">
            ✕
          </button>
        </header>

        {screen.loading && !status ? (
          <p className="screen-picker__note">화면 정보를 확인하고 있어…</p>
        ) : screen.error ? (
          <p className="screen-picker__error" role="alert">
            {screen.error}
          </p>
        ) : !status?.supported ? (
          <p className="screen-picker__note">화면 보기는 지금 macOS에서만 쓸 수 있어.</p>
        ) : !status.noticeAccepted ? (
          <div className="screen-notice">
            <p>화면 보기를 쓰면 이렇게 동작해:</p>
            <ul>
              <li>고른 창 하나의 스크린샷과 화면 요소 이름이 Codex(OpenAI)로 전송돼.</li>
              <li>
                포코는 스크린샷을 저장하지 않고 작업이 끝나면 바로 지워. Codex는 자체 기록을
                ~/.codex 에 남길 수 있어.
              </li>
              <li>지금은 화면을 보고 설명만 해. 클릭이나 입력은 하지 않아.</li>
            </ul>
            <button
              className="primary-button"
              type="button"
              onClick={() => void acceptScreenNotice()}
            >
              알겠어, 계속할게
            </button>
          </div>
        ) : !permissionsReady ? (
          <div className="screen-permissions">
            <ul>
              <Permission
                kind="screen"
                granted={status.permissions.screen}
                title="화면 기록"
                why="고른 창의 스크린샷을 찍으려면 필요해."
              />
              <Permission
                kind="accessibility"
                granted={status.permissions.accessibility}
                title="손쉬운 사용"
                why="창 안의 버튼과 입력창 이름을 읽으려면 필요해."
              />
            </ul>
            <p className="screen-picker__note">
              설정에서 허용한 뒤 포코를 다시 시작해야 할 수도 있어.
            </p>
            <button className="secondary-button" type="button" onClick={() => void refreshScreen()}>
              다시 확인
            </button>
          </div>
        ) : screen.windows.length === 0 ? (
          <p className="screen-picker__note">볼 수 있는 창이 없어. 창을 열고 다시 확인해 줘.</p>
        ) : (
          <>
            <p className="screen-picker__note">
              {question.trim()
                ? `“${question.trim()}” 에 답하려고 볼 창을 골라 줘.`
                : "창을 고르면 포코가 무엇이 보이는지 설명할게."}
            </p>
            <ul className="screen-windows">
              {screen.windows.map((window) => (
                <li key={window.id}>
                  <button
                    className="screen-window"
                    type="button"
                    onClick={() => {
                      onPicked();
                      void lookAtWindow(window.id, question);
                    }}
                  >
                    {window.thumbnail ? (
                      <img src={window.thumbnail} alt="" />
                    ) : (
                      <span className="screen-window__blank">
                        <Icon name="screen" />
                      </span>
                    )}
                    <span className="screen-window__app">{window.app}</span>
                    {window.title && <span className="screen-window__title">{window.title}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
