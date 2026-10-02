import { useState } from "react";
import type { CodexSetup } from "../../../../../electron/shared";
import { useAppStore } from "../../state/appStore";
import { Character } from "../character/Character";

const INSTALL_COMMAND = "npm install -g @openai/codex";

type Step = { title: string; ok: boolean; detail: string; action?: "install" | "login" | "update" };

/** What is missing, in order, with a plain fix for each. */
export function setupSteps(setup: CodexSetup): Step[] {
  return [
    {
      title: "Codex 설치",
      ok: setup.installed && !setup.missingNode,
      detail: !setup.installed
        ? "Codex CLI가 설치되어 있지 않아. 터미널에서 아래 명령으로 설치해 줘."
        : setup.missingNode
          ? "Codex는 찾았지만 실행에 필요한 node를 찾지 못했어. Node.js를 설치하거나 nvm으로 다시 설치해 줘."
          : `${setup.path}${setup.version ? ` · v${setup.version}` : ""}`,
      action: setup.installed && !setup.missingNode ? undefined : "install",
    },
    {
      title: "ChatGPT 로그인",
      ok: setup.login === "chatgpt",
      detail:
        setup.login === "chatgpt"
          ? "ChatGPT 계정으로 로그인되어 있어."
          : setup.login === "api_key"
            ? "API 키로 로그인되어 있어. 포코는 ChatGPT 계정 로그인을 사용해."
            : !setup.installed || setup.missingNode
              ? "Codex를 설치하면 로그인할 수 있어."
              : "로그인하기를 누르면 브라우저에서 ChatGPT로 로그인할 수 있어.",
      action: setup.login === "chatgpt" ? undefined : "login",
    },
    {
      title: "사용 가능 버전",
      ok: setup.featuresOk,
      detail: setup.featuresOk
        ? "포코가 쓰는 기능이 모두 있어."
        : !setup.installed || setup.missingNode
          ? "Codex를 설치하면 확인할게."
          : "Codex를 0.159.0 이상으로 업데이트해 줘. 아래 명령으로 업데이트할 수 있어.",
      action: setup.featuresOk || !setup.installed || setup.missingNode ? undefined : "update",
    },
  ];
}

/** Shown on start while Codex isn't ready: what is missing and how to fix it. */
export function SetupScreen() {
  const setup = useAppStore((state) => state.setup);
  const dismissed = useAppStore((state) => state.setupDismissed);
  const checking = useAppStore((state) => state.setupChecking);
  const checkSetup = useAppStore((state) => state.checkSetup);
  const startLogin = useAppStore((state) => state.startLogin);
  const cancelLogin = useAppStore((state) => state.cancelLogin);
  const dismiss = useAppStore((state) => state.dismissSetup);
  const [copied, setCopied] = useState(false);
  if (!setup || setup.ready || dismissed) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="setup-screen" role="dialog" aria-modal="true" aria-labelledby="setup-title">
      <div className="setup-screen__panel">
        <header className="setup-screen__header">
          <Character state="listening" size={36} />
          <div>
            <h2 id="setup-title" className="setup-screen__title">
              포코를 쓰려면 Codex 준비가 필요해
            </h2>
            <p className="setup-screen__lead">
              포코는 이 컴퓨터의 Codex CLI와 ChatGPT 계정으로 동작해.
            </p>
          </div>
        </header>
        <ol className="setup-steps">
          {setupSteps(setup).map((step) => (
            <li key={step.title} className="setup-step" data-ok={step.ok}>
              <span className="setup-step__mark" aria-hidden="true">
                {step.ok ? "✓" : "!"}
              </span>
              <div className="setup-step__body">
                <p className="setup-step__title">
                  {step.title}
                  <span className="visually-hidden">{step.ok ? " 완료" : " 필요"}</span>
                </p>
                <p className="setup-step__detail">{step.detail}</p>
                {(step.action === "install" || step.action === "update") && !step.ok && (
                  <div className="setup-step__command">
                    <code className="setup-step__code">{INSTALL_COMMAND}</code>
                    <button className="secondary-button" type="button" onClick={() => void copy()}>
                      {copied ? "복사했어" : "복사"}
                    </button>
                  </div>
                )}
                {step.action === "login" && !step.ok && setup.installed && !setup.missingNode && (
                  <div className="setup-step__command">
                    {setup.loggingIn ? (
                      <>
                        <span>브라우저에서 로그인을 마쳐 줘…</span>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => void cancelLogin()}
                        >
                          취소
                        </button>
                      </>
                    ) : (
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() => void startLogin()}
                      >
                        로그인하기
                      </button>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
        <div className="confirm-dialog__actions">
          <button className="secondary-button" type="button" onClick={dismiss}>
            나중에
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => void checkSetup()}
            disabled={checking}
          >
            {checking ? "확인하는 중…" : "다시 확인"}
          </button>
        </div>
      </div>
    </div>
  );
}
