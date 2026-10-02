import { useEffect, type ReactNode } from "react";
import { CHECKPOINT_DAY_CHOICES } from "../../../../../electron/shared";
import { useAppStore } from "../../state/appStore";
import { Page, PageHeader } from "../page/Page";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="settings-section" aria-labelledby={id}>
      <h2 id={id} className="settings-section__title">
        {title}
      </h2>
      <div className="settings-section__body">{children}</div>
    </section>
  );
}

function Row({
  label,
  detail,
  children,
}: {
  label: string;
  detail?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row__copy">
        <p className="settings-row__label">{label}</p>
        {detail && <p className="settings-row__detail">{detail}</p>}
      </div>
      {children && <div className="settings-row__control">{children}</div>}
    </div>
  );
}

const loginLabels = {
  chatgpt: "ChatGPT 계정으로 로그인되어 있어.",
  api_key: "API 키로 로그인되어 있어. 포코는 ChatGPT 계정 로그인을 사용해.",
  signed_out: "로그인이 필요해.",
  unknown: "로그인 상태를 확인하지 못했어.",
} as const;

function CodexSection() {
  const setup = useAppStore((state) => state.setup);
  const checking = useAppStore((state) => state.setupChecking);
  const recheckSetup = useAppStore((state) => state.recheckSetup);
  return (
    <Section id="settings-codex" title="Codex">
      <Row
        label={setup ? (setup.ready ? "준비됐어" : "준비가 필요해") : "확인하는 중"}
        detail={
          setup?.installed
            ? `${setup.path}${setup.version ? ` · v${setup.version}` : ""}`
            : setup
              ? "Codex CLI를 찾지 못했어."
              : undefined
        }
      >
        <button
          className="secondary-button"
          type="button"
          onClick={() => void recheckSetup()}
          disabled={checking}
        >
          {checking ? "확인하는 중" : "다시 확인"}
        </button>
      </Row>
      {setup?.installed && <Row label="로그인" detail={loginLabels[setup.login]} />}
    </Section>
  );
}

function MemorySection() {
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  return (
    <Section id="settings-memory" title="기억">
      <Row
        label="대화에 기억 사용"
        detail="끄면 저장한 기억은 기억 화면에 그대로 두고, 요청에는 함께 보내지 않아."
      >
        <input
          className="switch"
          type="checkbox"
          role="switch"
          aria-label="대화에 기억 사용"
          aria-checked={settings?.memoriesInContext ?? true}
          checked={settings?.memoriesInContext ?? true}
          disabled={!settings}
          onChange={(event) => void updateSettings({ memoriesInContext: event.target.checked })}
        />
      </Row>
    </Section>
  );
}

function ScreenSection() {
  const status = useAppStore((state) => state.screen.status);
  const openScreenSettings = useAppStore((state) => state.openScreenSettings);
  const resetScreenNotice = useAppStore((state) => state.resetScreenNotice);
  if (status && !status.supported)
    return (
      <Section id="settings-screen" title="화면 보기">
        <Row label="이 컴퓨터에서는 화면 보기를 쓸 수 없어." />
      </Section>
    );
  const permissions = [
    { kind: "screen" as const, label: "화면 기록", ok: status?.permissions.screen },
    { kind: "accessibility" as const, label: "손쉬운 사용", ok: status?.permissions.accessibility },
  ];
  return (
    <Section id="settings-screen" title="화면 보기">
      {permissions.map((permission) => (
        <Row
          key={permission.kind}
          label={permission.label}
          detail={
            permission.ok === undefined
              ? "확인하는 중"
              : permission.ok
                ? "허용됨"
                : "권한이 필요해."
          }
        >
          {permission.ok === false && (
            <button
              className="secondary-button"
              type="button"
              onClick={() => openScreenSettings(permission.kind)}
            >
              설정 열기
            </button>
          )}
        </Row>
      ))}
      <Row
        label="안내"
        detail={
          status?.noticeAccepted
            ? "화면 작업 때 무엇을 보내는지 안내를 확인했어."
            : "다음 화면 작업 전에 안내를 보여줄게."
        }
      >
        {status?.noticeAccepted && (
          <button
            className="secondary-button"
            type="button"
            onClick={() => void resetScreenNotice()}
          >
            안내 다시 보기
          </button>
        )}
      </Row>
    </Section>
  );
}

function EditsSection() {
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  return (
    <Section id="settings-edits" title="수정과 되돌리기">
      <Row
        label="되돌리기 보관 기간"
        detail="승인한 변경을 되돌릴 수 있는 기간이야. 줄이면 다음 실행 때 오래된 기록부터 지워."
      >
        <fieldset className="segmented">
          <legend className="sr-only">되돌리기 보관 기간</legend>
          {CHECKPOINT_DAY_CHOICES.map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={settings?.checkpointDays === days}
              className={`segmented__item${settings?.checkpointDays === days ? " is-active" : ""}`}
              disabled={!settings}
              onClick={() => void updateSettings({ checkpointDays: days })}
            >
              {days}일
            </button>
          ))}
        </fieldset>
      </Row>
    </Section>
  );
}

export function SettingsPanel() {
  const loadSettings = useAppStore((state) => state.loadSettings);
  const settingsError = useAppStore((state) => state.settingsError);
  const appVersion = useAppStore((state) => state.appVersion);

  // Permissions change in System Settings; check again when the user comes back.
  useEffect(() => {
    void loadSettings();
    const onFocus = () => void loadSettings();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadSettings]);

  return (
    <Page labelledBy="settings-title">
      <PageHeader
        id="settings-title"
        title="설정"
        description="포코가 무엇을 기억하고 보내는지 여기서 정할 수 있어."
      />
      {settingsError && (
        <p className="page-error" role="alert">
          {settingsError}
        </p>
      )}
      <CodexSection />
      <MemorySection />
      <ScreenSection />
      <EditsSection />
      <Section id="settings-about" title="정보">
        <Row
          label={`Poko${appVersion ? ` v${appVersion}` : ""}`}
          detail="github.com/yohan-work/poko"
        />
      </Section>
    </Page>
  );
}
