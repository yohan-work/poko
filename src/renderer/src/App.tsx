import { useEffect, useState } from "react";
import type { AppView } from "../../../electron/shared";
import { useAppStore } from "./state/appStore";
import { ChatPanel } from "./components/chat/ChatPanel";
import { ActivityPanel } from "./components/activity/ActivityPanel";
import { TasksPanel } from "./components/activity/TasksPanel";
import { MemoryPanel } from "./components/activity/MemoryPanel";
import { Character } from "./components/character/Character";
import { Icon, type IconName } from "./components/Icon";

const navigation: { id: AppView; label: string; icon: IconName }[] = [
  { id: "conversation", label: "대화", icon: "chat" },
  { id: "tasks", label: "작업", icon: "tasks" },
  { id: "memory", label: "기억", icon: "memory" },
  { id: "activity", label: "활동", icon: "activity" },
];

function WorkspaceButton() {
  const workspace = useAppStore((state) => state.workspace);
  const isSelectingWorkspace = useAppStore((state) => state.isSelectingWorkspace);
  const workspaceError = useAppStore((state) => state.workspaceError);
  const selectWorkspace = useAppStore((state) => state.selectWorkspace);

  return (
    <div className="sidebar__footer">
      <button
        className="workspace-button"
        type="button"
        onClick={() => void selectWorkspace()}
        disabled={isSelectingWorkspace}
        data-state={workspaceError ? "error" : workspace ? "selected" : "empty"}
        title={workspace?.path ?? "작업할 폴더 선택"}
      >
        <span className="workspace-button__icon" aria-hidden="true">
          <Icon name="folder" />
        </span>
        <span className="workspace-button__copy">
          <span className="workspace-button__value">
            {isSelectingWorkspace ? "폴더를 여는 중" : (workspace?.name ?? "작업 폴더 선택")}
          </span>
          <span className="workspace-button__label">
            {workspace ? "작업 폴더 · 읽기 전용" : "포코가 살펴볼 폴더"}
          </span>
        </span>
        <Icon name="chevron" className="workspace-button__chevron" />
      </button>
      {workspaceError && (
        <p className="workspace-error" role="alert">
          {workspaceError}
        </p>
      )}
    </div>
  );
}

function Sidebar({ onCollapse }: { onCollapse: () => void }) {
  const activeView = useAppStore((state) => state.activeView);
  const characterState = useAppStore((state) => state.characterState);
  const tasks = useAppStore((state) => state.tasks);
  const setActiveView = useAppStore((state) => state.setActiveView);

  return (
    <aside className="sidebar" aria-label="포코 메뉴">
      <div className="sidebar__header">
        <button
          className="icon-button"
          type="button"
          onClick={onCollapse}
          aria-label="사이드바 닫기"
          title="사이드바 닫기"
        >
          <Icon name="sidebar" />
        </button>
        <button
          className="brand"
          type="button"
          onClick={() => setActiveView("conversation")}
          aria-label="Poko 홈"
        >
          <Character state={characterState} size={22} />
          <span className="brand__name">poko</span>
        </button>
      </div>

      <nav className="sidebar__nav" aria-label="주요 화면">
        {navigation.map((item) => (
          <button
            className={`nav-item${activeView === item.id ? " is-active" : ""}`}
            type="button"
            key={item.id}
            onClick={() => setActiveView(item.id)}
            aria-current={activeView === item.id ? "page" : undefined}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <section className="sidebar__recent" aria-labelledby="recent-title">
        <h2 id="recent-title" className="sidebar__section-title">
          최근 작업
        </h2>
        {tasks.length === 0 ? (
          <p className="sidebar__empty">아직 작업이 없어.</p>
        ) : (
          <ul className="recent-list">
            {tasks.slice(0, 30).map((task) => (
              <li key={task.id}>
                <button
                  className="recent-list__item"
                  type="button"
                  onClick={() => setActiveView("tasks")}
                  title={task.title}
                >
                  <span
                    className={`recent-list__dot recent-list__dot--${task.status}`}
                    aria-hidden="true"
                  />
                  <span className="recent-list__title">{task.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <WorkspaceButton />
    </aside>
  );
}

export function App() {
  const activeView = useAppStore((state) => state.activeView);
  const initializeWorkspace = useAppStore((state) => state.initializeWorkspace);
  const [isSidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    void initializeWorkspace();
  }, [initializeWorkspace]);

  return (
    <div className="app-shell" data-sidebar={isSidebarOpen ? "open" : "closed"}>
      {isSidebarOpen && <Sidebar onCollapse={() => setSidebarOpen(false)} />}

      <main className="main-content">
        {!isSidebarOpen && (
          <button
            className="icon-button main-content__sidebar-toggle"
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="사이드바 열기"
            title="사이드바 열기"
          >
            <Icon name="sidebar" />
          </button>
        )}
        {activeView === "conversation" ? (
          <ChatPanel />
        ) : activeView === "memory" ? (
          <MemoryPanel />
        ) : activeView === "tasks" ? (
          <TasksPanel />
        ) : (
          <ActivityPanel />
        )}
      </main>
    </div>
  );
}
