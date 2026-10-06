import { parseChange, relativePath } from "../../lib/diff";
import { useAppStore } from "../../state/appStore";
import { Character } from "../character/Character";

/** How the provider marks Claude's own description of a command. */
const CLAIM = "Claude 설명: ";

const changeLabels = { add: "새 파일", update: "수정", delete: "삭제", unknown: "변경" } as const;

export function ApprovalCard() {
  const approval = useAppStore((state) => state.pendingApprovals[0]);
  const waitingCount = useAppStore((state) => state.pendingApprovals.length);
  const isResponding = useAppStore((state) => state.isRespondingToApproval);
  const respondToApproval = useAppStore((state) => state.respondToApproval);
  if (!approval) return null;
  const laterCount = waitingCount - 1;

  const isCommand = approval.kind === "command";
  const claimed = isCommand && approval.reason?.startsWith(CLAIM) === true;
  const screen = approval.kind === "screen_action" ? approval.screen : undefined;
  const actionWords = { click: "누르기", type: "입력하기", reveal: "보이게 스크롤하기" } as const;

  return (
    <li className="approval-card" aria-label="포코의 확인 요청">
      <div className="approval-card__header">
        <Character state="approval" size={26} />
        <p className="approval-card__title">
          {screen
            ? "이 단계를 진행해도 될까?"
            : isCommand
              ? "이 명령을 실행해도 될까?"
              : "이 파일 변경을 적용해도 될까?"}
        </p>
      </div>
      {screen ? (
        <div className="approval-card__screen">
          <p className="approval-card__summary">{approval.summary}</p>
          {/* The crop is the evidence: labels come from the page and can lie. */}
          <figure className="approval-card__crop">
            <img src={screen.crop} alt={`대상: ${screen.target}`} />
            <figcaption>
              ‘{screen.target}’ {actionWords[screen.action]}
            </figcaption>
          </figure>
          {screen.text !== undefined && (
            <>
              <p className="approval-card__label">입력할 내용 (전체)</p>
              <pre className="approval-card__code">{screen.text}</pre>
            </>
          )}
          {screen.warning && (
            <p className="approval-card__warning" role="alert">
              {screen.warning}
            </p>
          )}
          <p className="approval-card__queue">⌘⇧Esc를 누르면 언제든 바로 멈춰.</p>
        </div>
      ) : isCommand ? (
        <>
          <pre className="approval-card__code">{approval.summary}</pre>
          <p className="approval-card__queue">
            작업 폴더에만 쓸 수 있고, 작업 폴더와 개발 도구 말고는 읽지 못하고, 인터넷은 쓸 수 없어.
            명령이 바꾼 파일은 되돌리기로 복구되지 않아.
          </p>
        </>
      ) : (
        <p className="approval-card__summary">{approval.summary}</p>
      )}
      <dl className="approval-card__details">
        {approval.cwd && (
          <>
            <dt>위치</dt>
            <dd>{approval.cwd}</dd>
          </>
        )}
        {approval.reason && (
          // Claude's own words about a command are its claim, not something Poko checked.
          <>
            <dt>{claimed ? "Claude 설명" : "이유"}</dt>
            <dd>{claimed ? approval.reason.slice(CLAIM.length) : approval.reason}</dd>
          </>
        )}
      </dl>
      {approval.diff?.map((entry) => {
        const change = parseChange(entry.change);
        return (
          // Small changes open right away, so the diff is what the user sees first.
          <details
            className="approval-card__diff"
            key={entry.path}
            open={(approval.diff?.length ?? 0) <= 3}
          >
            <summary>
              {changeLabels[change.kind]} {relativePath(entry.path, approval.cwd)}
              <span className="approval-card__counts">
                <span className="approval-card__counts-add">+{change.added}</span>
                <span className="approval-card__counts-remove">−{change.removed}</span>
              </span>
            </summary>
            <pre className="approval-card__code">
              {change.lines.map((line) => (
                <span className={`diff-line diff-line--${line.kind}`} key={line.n}>
                  {line.text || " "}
                </span>
              ))}
            </pre>
          </details>
        );
      })}
      {laterCount > 0 && (
        <p className="approval-card__queue">이 다음에 확인할 요청이 {laterCount}개 더 있어.</p>
      )}
      <div className="approval-card__actions">
        <button
          className="approval-card__button"
          type="button"
          onClick={() => void respondToApproval("decline")}
          disabled={isResponding}
        >
          거절
        </button>
        <button
          className="approval-card__button approval-card__button--primary"
          type="button"
          onClick={() => void respondToApproval("approve")}
          disabled={isResponding}
        >
          {screen ? "이 단계만 허용" : "이번 한 번만 허용"}
        </button>
      </div>
    </li>
  );
}
