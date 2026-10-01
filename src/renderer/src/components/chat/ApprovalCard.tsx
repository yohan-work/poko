import { useAppStore } from "../../state/appStore";

export function ApprovalCard() {
  const approval = useAppStore((state) => state.pendingApproval);
  const isResponding = useAppStore((state) => state.isRespondingToApproval);
  const respondToApproval = useAppStore((state) => state.respondToApproval);
  if (!approval) return null;

  const isCommand = approval.kind === "command";

  return (
    <li className="approval-card" aria-label="포코의 확인 요청">
      <span className="message__sender">포코</span>
      <p className="approval-card__title">
        {isCommand ? "이 명령을 실행해도 될까?" : "이 파일 변경을 적용해도 될까?"}
      </p>
      {isCommand ? (
        <pre className="approval-card__code">{approval.summary}</pre>
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
          <>
            <dt>이유</dt>
            <dd>{approval.reason}</dd>
          </>
        )}
      </dl>
      {approval.diff?.map((entry) => (
        <details className="approval-card__diff" key={entry.path}>
          <summary>{entry.path}</summary>
          <pre className="approval-card__code">{entry.change}</pre>
        </details>
      ))}
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
          이번 한 번만 허용
        </button>
      </div>
    </li>
  );
}
