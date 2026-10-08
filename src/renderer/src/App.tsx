import { useEffect, useState } from "react";
import type { AppView, ConversationMatch } from "../../../electron/shared";
import { useAppStore } from "./state/appStore";
import { ChatPanel } from "./components/chat/ChatPanel";
import { ActivityPanel } from "./components/activity/ActivityPanel";
import { TasksPanel } from "./components/activity/TasksPanel";
import { RoutinesPanel } from "./components/activity/RoutinesPanel";
import { MemoryPanel } from "./components/activity/MemoryPanel";
import { Character, stateLabels } from "./components/character/Character";
import { Icon, type IconName } from "./components/Icon";
import { ConversationItem } from "./components/sidebar/ConversationItem";
import { EditsConfirm } from "./components/edits/EditsConfirm";
import { SetupScreen } from "./components/setup/SetupScreen";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { useNow } from "./lib/useNow";

const navigation: { id: AppView; label: string; icon: IconName }[] = [
  { id: "conversation", label: "대화", icon: "chat" },
  { id: "tasks", label: "작업", icon: "tasks" },
  { id: "routines", label: "루틴", icon: "repeat" },
  { id: "memory", label: "기억", icon: "memory" },
  { id: "activity", label: "활동", icon: "activity" },
  { id: "settings", label: "설정", icon: "settings" },
];

function WorkspaceButton() {
  const workspace = useAppStore((state) => state.workspace);
  const isSelectingWorkspace = useAppStore((state) => state.isSelectingWorkspace);
  const workspaceError = useAppStore((state) => state.workspaceError);
  const selectWorkspace = useAppStore((state) => state.selectWorkspace);
  const edits = useAppStore((state) => state.edits);
  // A task uses the folder it started in; the folder changes only between tasks.
  const busy = useAppStore((state) => state.isSending || state.busyElsewhere);

  return (
    <div className="sidebar__footer">
      <button
        className="workspace-button"
        type="button"
        onClick={() => void selectWorkspace()}
        disabled={isSelectingWorkspace || busy}
        data-state={workspaceError ? "error" : workspace ? "selected" : "empty"}
        title={
          busy
            ? "포코가 작업 중이라 끝난 뒤에 폴더를 바꿀 수 있어."
            : (workspace?.path ?? "작업할 폴더 선택")
        }
      >
        <span className="workspace-button__icon" aria-hidden="true">
          <Icon name="folder" />
        </span>
        <span className="workspace-button__copy">
          <span className="workspace-button__value">
            {isSelectingWorkspace ? "폴더를 여는 중" : (workspace?.name ?? "작업 폴더 선택")}
          </span>
          <span className="workspace-button__label">
            {workspace
              ? edits.enabled
                ? "작업 폴더 · 수정 허용"
                : "작업 폴더 · 읽기 전용"
              : "포코가 살펴볼 폴더"}
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
  const isSending = useAppStore((state) => state.isSending);
  const conversationError = useAppStore((state) => state.conversationError);
  const newConversation = useAppStore((state) => state.newConversation);
  const now = useNow();
  const busyHint = "포코가 작업 중이라 끝난 뒤에 옮길 수 있어.";
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ConversationMatch[] | null>(null);

  // Searches titles and messages in main, shortly after typing stops; empty shows everything.
  // biome-ignore lint/correctness/useExhaustiveDependencies: search again when the list changes
  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setMatches(null);
      return;
    }
    let current = true;
    const timer = window.setTimeout(() => {
      void window.poko.conversations
        .search(text)
        .then((found) => {
          if (current) setMatches(found);
        })
        .catch(() => {
          if (current) setMatches([]);
        });
    }, 200);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [query, conversations]);

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
            title={isSending ? busyHint : "새 대화 시작 (⌘N)"}
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
        {conversations.length > 0 && (
          <label className="sidebar__search">
            <Icon name="search" />
            <span className="sr-only">대화 검색</span>
            <input
              id="conversation-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                // Escape while composing (Korean IME) only cancels the syllable.
                if (event.key === "Escape" && !event.nativeEvent.isComposing) setQuery("");
              }}
              placeholder="대화 검색 (⌘K)"
              maxLength={200}
            />
          </label>
        )}
        {conversations.length === 0 ? (
          <p className="sidebar__empty">첫 메시지를 보내면 대화가 생겨.</p>
        ) : matches ? (
          matches.length === 0 ? (
            <p className="sidebar__empty">‘{query.trim()}’이 들어간 대화가 없어.</p>
          ) : (
            <ul className="recent-list">
              {matches.map((match) => (
                <ConversationItem
                  key={match.id}
                  conversation={match}
                  now={now}
                  snippet={match.snippet}
                />
              ))}
            </ul>
          )
        ) : (
          <ul className="recent-list">
            {conversations.map((conversation) => (
              <ConversationItem key={conversation.id} conversation={conversation} now={now} />
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
  const characterState = useAppStore((state) => state.characterState);
  const initializeWorkspace = useAppStore((state) => state.initializeWorkspace);
  const [isSidebarOpen, setSidebarOpen] = useState(true);

  // Codex must be installed and signed in; the setup screen explains what is missing.
  useEffect(() => {
    void useAppStore.getState().checkSetup();
    return window.poko.setup.onChanged((status) => useAppStore.getState().receiveSetup(status));
  }, []);

  // Approved changes settle (or are undone) in main; refresh the shown conversation's notes.
  useEffect(
    () =>
      window.poko.edits.onChanged((conversationId) => {
        const state = useAppStore.getState();
        if (state.activeConversationId === conversationId) void state.loadEditNotes();
      }),
    [],
  );

  useEffect(() => {
    void initializeWorkspace();
  }, [initializeWorkspace]);

  // ⌘N new conversation, ⌘K search conversations, ⌘. stop, ⌘, settings.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      // Not behind a dialog (picking a window, setup, confirming edits).
      if (document.querySelector('[aria-modal="true"], dialog[open]')) return;
      const state = useAppStore.getState();
      // By key position, so the shortcuts work with the Korean input source too.
      const key = event.code;
      if (key === "KeyN" && !event.shiftKey) {
        event.preventDefault();
        // Like the 새 대화 button: nothing while Poko works, and once per press.
        if (!state.isSending && !event.repeat) void state.newConversation();
      } else if (key === "KeyK") {
        event.preventDefault();
        setSidebarOpen(true);
        state.setActiveView("conversation");
        // After the sidebar (and its search field) is on screen.
        window.setTimeout(() => document.getElementById("conversation-search")?.focus(), 0);
      } else if (key === "Period") {
        event.preventDefault();
        if (state.isSending) void state.cancelTask();
      } else if (key === "Comma") {
        event.preventDefault();
        state.setActiveView("settings");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app-shell" data-sidebar={isSidebarOpen ? "open" : "closed"}>
      <EditsConfirm />
      <SetupScreen />
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
        ) : activeView === "routines" ? (
          <RoutinesPanel />
        ) : activeView === "settings" ? (
          <SettingsPanel />
        ) : (
          <ActivityPanel />
        )}
      </main>
    </div>
  );
}
