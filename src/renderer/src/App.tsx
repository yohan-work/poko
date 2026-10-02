import { useEffect, useState } from "react";
import type { AppView } from "../../../electron/shared";
import { useAppStore } from "./state/appStore";
import { ChatPanel } from "./components/chat/ChatPanel";
import { ActivityPanel } from "./components/activity/ActivityPanel";
import { TasksPanel } from "./components/activity/TasksPanel";
import { MemoryPanel } from "./components/activity/MemoryPanel";
import { Character, stateLabels } from "./components/character/Character";
import { Icon, type IconName } from "./components/Icon";
import { relativeTime } from "./lib/time";
import { useNow } from "./lib/useNow";

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
  const setActiveView = useAppStore((state) => state.setActiveView);
  const conversations = useAppStore((state) => state.conversations);
  const activeConversationId = useAppStore((state) => state.activeConversationId);
  const isSending = useAppStore((state) => state.isSending);
  const conversationError = useAppStore((state) => state.conversationError);
  const newConversation = useAppStore((state) => state.newConversation);
  const openConversation = useAppStore((state) => state.openConversation);
  const now = useNow();
  const busyHint = "포코가 작업 중이라 끝난 뒤에 옮길 수 있어.";

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

      <section className="sidebar__recent" aria-labelledby="conversations-title">
        <div className="sidebar__section-head">
          <h2 id="conversations-title" className="sidebar__section-title">
            대화
          </h2>
          <button
            className="sidebar__new"
            type="button"
            onClick={() => void newConversation()}
            disabled={isSending}
            title={isSending ? busyHint : "새 대화 시작"}
          >
            <Icon name="plus" />
            <span>새 대화</span>
          </button>
        </div>
        {conversationError && (
          <p className="sidebar__error" role="alert">
            {conversationError}
          </p>
        )}
        {conversations.length === 0 ? (
          <p className="sidebar__empty">첫 메시지를 보내면 대화가 생겨.</p>
        ) : (
          <ul className="recent-list">
            {conversations.map((conversation) => {
              const active = conversation.id === activeConversationId;
              return (
                <li key={conversation.id}>
                  <button
                    className={`recent-list__item${active ? " is-active" : ""}`}
                    type="button"
                    onClick={() => void openConversation(conversation.id)}
                    disabled={isSending && !active}
                    aria-current={active ? "true" : undefined}
                    title={isSending && !active ? busyHint : conversation.title}
                  >
                    {active && isSending && (
                      <>
                        <span
                          className="recent-list__dot recent-list__dot--running"
                          aria-hidden="true"
                        />
                        <span className="visually-hidden">작업 중</span>
                      </>
                    )}
                    <span className="recent-list__title">{conversation.title}</span>
                    <span className="recent-list__time">
                      {relativeTime(conversation.updatedAt, now)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <WorkspaceButton />
    </aside>
  );
}

export function App() {
  const activeView = useAppStore((state) => state.activeView);
  const characterState = useAppStore((state) => state.characterState);
  const initializeWorkspace = useAppStore((state) => state.initializeWorkspace);
  const [isSidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    void initializeWorkspace();
  }, [initializeWorkspace]);

  return (
    <div className="app-shell" data-sidebar={isSidebarOpen ? "open" : "closed"}>
      {/* One live region announces Poko's state; the drawn characters stay silent. */}
      <p className="sr-only" aria-live="polite">
        포코: {stateLabels[characterState]}
      </p>
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
