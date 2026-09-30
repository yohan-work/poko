import { useEffect } from "react";
import type { AppView } from "../../../electron/shared";
import { useAppStore } from "./state/appStore";
import { ChatPanel } from "./components/chat/ChatPanel";
import { ActivityPanel } from "./components/activity/ActivityPanel";
import { TasksPanel } from "./components/activity/TasksPanel";

const navigation: { id: AppView; label: string; shortLabel: string }[] = [
  { id: "conversation", label: "대화", shortLabel: "대화" },
  { id: "memory", label: "기억", shortLabel: "기억" },
  { id: "tasks", label: "작업", shortLabel: "작업" },
  { id: "activity", label: "활동", shortLabel: "활동" },
];

const futureViewCopy: Record<Exclude<AppView, "conversation">, { title: string; copy: string }> = {
  memory: {
    title: "우리의 기억은 차근차근 쌓일 거야.",
    copy: "프로젝트와 취향을 기억하는 기능은 다음 단계에서 준비할게.",
  },
  tasks: {
    title: "함께한 작업을 여기서 볼 수 있어.",
    copy: "이번에 포코에게 부탁한 일이 여기에 모여.",
  },
  activity: {
    title: "포코의 작업 기록이 여기에 남아.",
    copy: "포코가 프로젝트를 살펴본 과정이 여기에 남아.",
  },
};

function WorkspaceButton() {
  const workspace = useAppStore((state) => state.workspace);
  const isSelectingWorkspace = useAppStore((state) => state.isSelectingWorkspace);
  const workspaceError = useAppStore((state) => state.workspaceError);
  const selectWorkspace = useAppStore((state) => state.selectWorkspace);

  return (
    <div className="workspace-control">
      <button
        className="workspace-button"
        type="button"
        onClick={() => void selectWorkspace()}
        disabled={isSelectingWorkspace}
        data-state={
          isSelectingWorkspace
            ? "loading"
            : workspaceError
              ? "error"
              : workspace
                ? "success"
                : "default"
        }
        title={workspace?.path ?? "작업할 폴더 선택"}
      >
        <span className="workspace-button__icon" aria-hidden="true">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M2.75 5.75c0-.83.67-1.5 1.5-1.5h4l1.6 1.7h5.9c.83 0 1.5.67 1.5 1.5v7.3c0 .83-.67 1.5-1.5 1.5h-11c-.83 0-1.5-.67-1.5-1.5v-9Z" />
          </svg>
        </span>
        <span className="workspace-button__copy">
          <span className="workspace-button__label">작업 폴더</span>
          <span className="workspace-button__value">
            {isSelectingWorkspace ? "폴더를 여는 중" : (workspace?.name ?? "선택해 줘")}
          </span>
        </span>
        <span className="workspace-button__chevron" aria-hidden="true">
          ⌄
        </span>
      </button>
      {workspaceError && (
        <span className="workspace-error" role="alert">
          {workspaceError}
        </span>
      )}
    </div>
  );
}

function EmptyView({ view }: { view: Exclude<AppView, "conversation"> }) {
  const message = futureViewCopy[view];
  return (
    <section className="future-view" aria-labelledby="future-view-title">
      <span className="future-view__mark" aria-hidden="true">
        p
      </span>
      <p className="future-view__eyebrow">곧 만나요</p>
      <h1 id="future-view-title">{message.title}</h1>
      <p>{message.copy}</p>
    </section>
  );
}

export function App() {
  const activeView = useAppStore((state) => state.activeView);
  const characterState = useAppStore((state) => state.characterState);
  const initializeWorkspace = useAppStore((state) => state.initializeWorkspace);
  const setActiveView = useAppStore((state) => state.setActiveView);

  useEffect(() => {
    void initializeWorkspace();
  }, [initializeWorkspace]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="brand"
          type="button"
          onClick={() => setActiveView("conversation")}
          aria-label="Poko 홈"
        >
          <span className="brand__mark" aria-hidden="true">
            <i />
            <i />
          </span>
          <span className="brand__name">poko</span>
        </button>
        <WorkspaceButton />
      </header>

      <main className="main-content">
        {activeView === "conversation" ? (
          <ChatPanel />
        ) : activeView === "activity" ? (
          <ActivityPanel />
        ) : activeView === "tasks" ? (
          <TasksPanel />
        ) : (
          <EmptyView view={activeView} />
        )}
      </main>

      <nav className="bottom-nav" aria-label="주요 화면">
        {navigation.map((item) => (
          <button
            className={`bottom-nav__item${activeView === item.id ? " is-active" : ""}`}
            type="button"
            key={item.id}
            onClick={() => setActiveView(item.id)}
            aria-current={activeView === item.id ? "page" : undefined}
          >
            <span
              className={`bottom-nav__glyph bottom-nav__glyph--${item.id}`}
              aria-hidden="true"
            />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <footer className="status-line" data-state={characterState}>
        <span className="status-line__dot" aria-hidden="true" />
        <span>{characterState === "error" ? "연결을 확인해 줘" : "내 컴퓨터에서 실행 중"}</span>
        <span className="status-line__separator" aria-hidden="true">
          ·
        </span>
        <span>미리보기</span>
      </footer>
    </div>
  );
}
