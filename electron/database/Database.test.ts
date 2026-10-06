import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationGoneError, PokoDatabase } from "./Database";

let directory = "";
const migrationsPath = join(process.cwd(), "drizzle");

async function openDatabase(legacyPath?: string): Promise<PokoDatabase> {
  if (!directory) directory = await mkdtemp(join(tmpdir(), "poko-database-"));
  return PokoDatabase.open(join(directory, "poko.sqlite"), migrationsPath, legacyPath);
}

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = "";
});

describe("PokoDatabase", () => {
  it("runs migrations once and restores messages, tasks, and activity after reopening", async () => {
    const database = await openDatabase();
    database.setWorkspace("/tmp/example-project");
    const taskId = database.createTask("분석해 줘", "/tmp/example-project");
    database.recordTaskEvent(taskId, "started", "요청을 확인했어.");
    database.recordTaskEvent(taskId, "completed", "분석을 마쳤어.", "확인 결과야.");
    database.close();

    const reopened = await openDatabase();
    const bootstrap = reopened.getBootstrapData();
    expect(bootstrap.workspacePath).toBe("/tmp/example-project");
    expect(bootstrap.messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "분석해 줘"],
      ["assistant", "확인 결과야."],
    ]);
    expect(bootstrap.tasks[0]).toMatchObject({ id: taskId, status: "completed" });
    expect(bootstrap.activities).toHaveLength(2);
    reopened.close();
  });

  it("imports legacy workspace settings only when the database has no setting", async () => {
    const dbPath = await openDatabase();
    dbPath.close();
    const legacyPath = join(directory, "settings.json");
    await writeFile(legacyPath, JSON.stringify({ workspacePath: "/tmp/legacy" }));

    const imported = await openDatabase(legacyPath);
    expect(imported.getWorkspace()).toBe("/tmp/legacy");
    imported.setWorkspace("/tmp/new");
    imported.close();
    await readFile(legacyPath, "utf8");
    const reopened = await openDatabase(legacyPath);
    expect(reopened.getWorkspace()).toBe("/tmp/new");
    reopened.close();
  });

  it("marks interrupted tasks failed and performs explicit memory CRUD with literal search", async () => {
    const database = await openDatabase();
    const taskId = database.createTask("작업 중 종료", "/tmp/example-project");
    database.close();

    const recovered = await openDatabase();
    expect(recovered.getBootstrapData().tasks[0]).toMatchObject({ id: taskId, status: "failed" });
    const underscore = recovered.saveMemory({
      type: "preference",
      content: "foo_bar 100% \\local",
      importance: 4,
    });
    recovered.saveMemory({ type: "fact", content: "foobar 100x", importance: 2 });
    expect(recovered.searchMemories("_").map((item) => item.id)).toEqual([underscore.id]);
    expect(recovered.searchMemories("100%").map((item) => item.id)).toEqual([underscore.id]);
    expect(recovered.searchMemories("\\local").map((item) => item.id)).toEqual([underscore.id]);
    expect(recovered.deleteMemory(underscore.id)).toBe(true);
    expect(recovered.listMemories()).toHaveLength(1);
    recovered.close();
  });

  it("audits one-shot approvals and never restores a pending approval", async () => {
    const database = await openDatabase();
    const taskId = database.createTask("테스트 실행해 줘", "/tmp/example-project");
    const request = {
      taskId,
      requestId: "7",
      kind: "command" as const,
      summary: "pnpm test",
      cwd: "/tmp/example-project",
      reason: null,
      canApprove: true,
    };
    expect(database.recordApprovalRequest(request)).toBe(true);
    expect(database.getBootstrapData().tasks[0]).toMatchObject({ status: "waiting_approval" });
    expect(database.resolveApproval("other-task", "7", "approve")).toBe(false);
    expect(database.resolveApproval(taskId, "7", "approve")).toBe(true);
    expect(database.resolveApproval(taskId, "7", "approve")).toBe(false);
    expect(database.getBootstrapData().tasks[0]).toMatchObject({ status: "running" });
    expect(() => database.recordApprovalRequest(request)).toThrow();

    expect(database.recordApprovalRequest({ ...request, requestId: "8", canApprove: false })).toBe(
      false,
    );
    expect(database.resolveApproval(taskId, "8", "approve")).toBe(false);

    database.recordApprovalRequest({ ...request, requestId: "9" });
    database.close();

    const recovered = await openDatabase();
    expect(recovered.getBootstrapData().tasks[0]).toMatchObject({ id: taskId, status: "failed" });
    expect(recovered.resolveApproval(taskId, "9", "approve")).toBe(false);
    recovered.close();
  });

  it("closes unanswered approvals when the task ends", async () => {
    const database = await openDatabase();
    const taskId = database.createTask("작업", "/tmp/example-project");
    database.recordApprovalRequest({
      taskId,
      requestId: "1",
      kind: "file_change",
      summary: "1개 파일 변경을 적용하려고 해.",
      cwd: "/tmp/example-project",
      reason: null,
      canApprove: true,
    });
    database.recordApprovalRequest({
      taskId,
      requestId: "2",
      kind: "command",
      summary: "pnpm lint",
      cwd: "/tmp/example-project",
      reason: null,
      canApprove: true,
    });
    expect(database.resolveApproval(taskId, "2", "decline")).toBe(true);
    expect(database.getBootstrapData().tasks[0]).toMatchObject({ status: "waiting_approval" });
    database.recordTaskEvent(taskId, "cancelled", "요청을 멈췄어.", "요청을 멈췄어.");
    expect(database.resolveApproval(taskId, "1", "approve")).toBe(false);
    expect(database.getBootstrapData().tasks[0]).toMatchObject({ status: "cancelled" });
    database.close();
  });

  it("exports everything it keeps, then deletes all history but keeps settings", async () => {
    const database = await openDatabase();
    const taskId = database.createTask("README 고쳐 줘", "/tmp/project");
    database.recordTaskEvent(taskId, "completed", "마쳤어.", "고쳤어.");
    const conversation = database.getTaskConversation(taskId)?.id ?? null;
    database.recordApprovalRequest({
      taskId,
      requestId: "1",
      kind: "file_change",
      summary: "README.md",
      cwd: "/tmp/project",
      reason: null,
      canApprove: true,
    });
    database.createEdit({
      id: "edit-1",
      taskId,
      requestId: "1",
      workspace: "/tmp/project",
      files: "[]",
    });
    database.saveMemory({ type: "fact", content: "기억", importance: 3 });
    database.setActiveConversation(conversation);
    database.setWorkspace("/tmp/project");
    database.acceptScreenNotice();
    database.setSettings({ checkpointDays: 7 });

    const exported = database.exportAll();
    expect(
      Object.fromEntries(Object.entries(exported).map(([key, rows]) => [key, rows.length])),
    ).toEqual({
      conversations: 1,
      messages: 2,
      tasks: 1,
      activities: 2,
      approvals: 1,
      memories: 1,
      edits: 1,
    });

    database.deleteAllHistory();
    expect(Object.values(database.exportAll()).every((rows) => rows.length === 0)).toBe(true);
    expect(database.getBootstrapData()).toMatchObject({
      conversationId: null,
      conversations: [],
      tasks: [],
      workspacePath: "/tmp/project",
    });
    expect(database.isScreenNoticeAccepted()).toBe(true);
    expect(database.getSettings().checkpointDays).toBe(7);
    database.close();
  });

  it("keeps valid settings and ignores invalid ones", async () => {
    const database = await openDatabase();
    expect(database.getSettings()).toEqual({
      engine: "codex",
      quickShortcut: "Alt+Space",
      codexModel: null,
      claudeModel: null,
      codexEffort: null,
      claudeEffort: null,
      memoriesInContext: true,
      taskNotifications: true,
      checkpointDays: 30,
    });
    expect(database.setSettings({ taskNotifications: false }).taskNotifications).toBe(false);
    database.setSettings({ taskNotifications: true });
    expect(database.setSettings({ quickShortcut: "off" }).quickShortcut).toBe("off");
    expect(database.setSettings({ codexEffort: "high", claudeEffort: "max" })).toMatchObject({
      codexEffort: "high",
      claudeEffort: "max",
    });
    expect(
      database.setSettings({ codexEffort: "ultra" as unknown as "max", claudeEffort: null }),
    ).toMatchObject({ codexEffort: "high", claudeEffort: null });
    database.setSettings({ codexEffort: null });
    expect(database.setSettings({ quickShortcut: "Cmd+Q" as unknown as "off" }).quickShortcut).toBe(
      "off",
    );
    database.setSettings({ quickShortcut: "Alt+Space" });
    expect(
      database.setSettings({ engine: "claude", memoriesInContext: false, checkpointDays: 7 }),
    ).toMatchObject({
      engine: "claude",
      memoriesInContext: false,
      checkpointDays: 7,
    });
    expect(
      database.setSettings({
        memoriesInContext: "no" as unknown as boolean,
        checkpointDays: 365 as unknown as 30,
        engine: "gpt" as unknown as "codex",
      }),
    ).toMatchObject({ engine: "claude", memoriesInContext: false, checkpointDays: 7 });

    expect(database.setSettings({ codexModel: "gpt-6-astra", claudeModel: "opus" })).toMatchObject({
      codexModel: "gpt-6-astra",
      claudeModel: "opus",
    });
    expect(
      database.setSettings({ codexModel: "bad model; rm -rf", claudeModel: null }),
    ).toMatchObject({ codexModel: "gpt-6-astra", claudeModel: null });
    expect(database.setSettings({ codexModel: "openai/gpt-oss-120b" }).codexModel).toBe(
      "openai/gpt-oss-120b",
    );
    expect(database.setSettings({ codexModel: "--dangerous" }).codexModel).toBe(
      "openai/gpt-oss-120b",
    );

    // The notice says where screenshots go, so each engine is accepted on its own.
    database.acceptScreenNotice("codex");
    expect(database.isScreenNoticeAccepted("codex")).toBe(true);
    expect(database.isScreenNoticeAccepted("claude")).toBe(false);
    database.acceptScreenNotice("claude");
    database.resetScreenNotice();
    expect(database.isScreenNoticeAccepted("codex")).toBe(false);
    expect(database.isScreenNoticeAccepted("claude")).toBe(false);
    database.close();
  });

  it("builds context from saved memories and completed exchanges in the same conversation", async () => {
    const database = await openDatabase();
    database.saveMemory({ type: "fact", content: "덜 중요한 기억", importance: 2 });
    database.saveMemory({ type: "preference", content: "답변은 간결하게", importance: 5 });

    const done = database.createTask("구조 설명해 줘", "/tmp/project");
    database.recordTaskEvent(done, "completed", "마쳤어.", "Electron 앱이야.");
    const conversation = database.getTaskConversation(done)?.id ?? null;
    const failed = database.createTask("실패한 요청", "/tmp/project", conversation);
    database.recordTaskEvent(failed, "error", "실패했어.", "작업을 마치지 못했어.");
    const cancelled = database.createTask("취소한 요청", "/tmp/project", conversation);
    database.recordTaskEvent(cancelled, "cancelled", "멈췄어.", "요청을 멈췄어.");
    const current = database.createTask("그거 다시 설명해 줘", "/tmp/project", conversation);

    const context = database.getTaskContext(current);
    expect(context.memories.map((memory) => memory.content)).toEqual([
      "답변은 간결하게",
      "덜 중요한 기억",
    ]);
    expect(context.history).toEqual([{ request: "구조 설명해 줘", answer: "Electron 앱이야." }]);

    // With memories turned off, none go with requests; they stay saved, and history is kept.
    database.setSettings({ memoriesInContext: false });
    expect(database.getTaskContext(current).memories).toEqual([]);
    expect(database.getTaskContext(current).history).toHaveLength(1);
    expect(database.listMemories()).toHaveLength(2);
    database.setSettings({ memoriesInContext: true });
    database.close();

    // A task in another conversation must not see this conversation's history.
    const client = new DatabaseSync(join(directory, "poko.sqlite"));
    const now = new Date().toISOString();
    client
      .prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run("other", "다른 대화", now, now);
    client
      .prepare(
        "INSERT INTO tasks (id, title, prompt, provider, status, conversation_id, created_at) VALUES (?, ?, ?, 'codex', 'running', 'other', ?)",
      )
      .run("other-task", "새 질문", "새 질문", now);
    client.close();
    const reopened = await openDatabase();
    expect(reopened.getTaskContext("other-task").history).toEqual([]);
    reopened.close();
  });

  it("backfills conversation and result for tasks saved before the context migration", async () => {
    directory = await mkdtemp(join(tmpdir(), "poko-database-"));
    const migrations = (await readdir(migrationsPath)).sort();
    const olderMigrations = join(directory, "older-migrations");
    for (const name of migrations.slice(0, migrations.indexOf("20261001020914_task_context"))) {
      await cp(join(migrationsPath, name), join(olderMigrations, name), { recursive: true });
    }
    const dbPath = join(directory, "poko.sqlite");
    (await PokoDatabase.open(dbPath, olderMigrations)).close();

    const client = new DatabaseSync(dbPath);
    const at = "2026-09-30T10:00:00.000Z";
    client.exec(`
      INSERT INTO conversations VALUES ('c1', '대화', '${at}', '${at}');
      INSERT INTO tasks (id, title, prompt, provider, status, created_at, completed_at)
        VALUES ('old', '구조 설명해 줘', '구조 설명해 줘', 'codex', 'completed', '${at}', '${at}');
      INSERT INTO messages VALUES ('m1', 'c1', 'user', '구조 설명해 줘', '${at}');
      INSERT INTO messages VALUES ('m2', 'c1', 'assistant', 'Electron 앱이야.', '${at}');
    `);
    client.close();

    const upgraded = await PokoDatabase.open(dbPath, migrationsPath);
    // Phase 07 titles the old conversation from its first message.
    expect(upgraded.listConversations()).toMatchObject([{ id: "c1", title: "구조 설명해 줘" }]);
    const next = upgraded.createTask("그거 다시 설명해 줘", "/tmp/project", "c1");
    expect(upgraded.getTaskContext(next).history).toEqual([
      { request: "구조 설명해 줘", answer: "Electron 앱이야." },
    ]);
    upgraded.close();
  });

  it("keeps conversations apart: titles, replies, and context", async () => {
    const database = await openDatabase();
    expect(database.getBootstrapData()).toMatchObject({ conversationId: null, conversations: [] });

    const first = database.createTask("  프로젝트\n구조를 설명해 줘  ", "/tmp/project");
    const firstConversation = database.getTaskConversation(first)?.id as string;
    const second = database.createTask("메일 요약해 줘", "/tmp/project");
    const secondConversation = database.getTaskConversation(second)?.id as string;
    expect(firstConversation).not.toBe(secondConversation);

    // Each reply lands in its own task's conversation, even when they finish out of order.
    database.recordTaskEvent(second, "completed", "마쳤어.", "메일 요약이야.");
    database.recordTaskEvent(first, "completed", "마쳤어.", "Electron 앱이야.");
    expect(database.getConversationMessages(firstConversation).map((m) => m.content)).toEqual([
      "  프로젝트\n구조를 설명해 줘  ",
      "Electron 앱이야.",
    ]);
    expect(database.getConversationMessages(secondConversation).map((m) => m.content)).toEqual([
      "메일 요약해 줘",
      "메일 요약이야.",
    ]);
    // Titles are the first message, flattened (the order here is by same-millisecond updates).
    expect(
      database
        .listConversations()
        .map((c) => c.title)
        .sort(),
    ).toEqual(["메일 요약해 줘", "프로젝트 구조를 설명해 줘"]);

    const followUp = database.createTask("더 자세히", "/tmp/project", secondConversation);
    expect(database.getTaskContext(followUp).history).toEqual([
      { request: "메일 요약해 줘", answer: "메일 요약이야." },
    ]);
    database.close();
  });

  it("titles a conversation with at most 40 characters and refuses unknown ids", async () => {
    const database = await openDatabase();
    const long = database.createTask("가".repeat(60), "/tmp/project");
    expect(database.getTaskConversation(long)?.title).toBe("가".repeat(40));
    expect(() => database.createTask("질문", "/tmp/project", "gone")).toThrow(
      ConversationGoneError,
    );
    database.close();
  });

  it("reopens the saved conversation, or falls back to the newest", async () => {
    const database = await openDatabase();
    const a = database.getTaskConversation(database.createTask("A", "/tmp/p"))?.id as string;
    const b = database.getTaskConversation(database.createTask("B", "/tmp/p"))?.id as string;
    database.setActiveConversation(a);
    expect(database.getBootstrapData()).toMatchObject({
      conversationId: a,
      messages: [{ content: "A" }],
    });
    database.setActiveConversation("deleted-or-unknown");
    expect(database.getActiveConversationId()).toBe(b);
    database.setActiveConversation(null);
    expect(database.getActiveConversationId()).toBe(b);
    database.close();
  });

  it("drops empty conversations when migrating", async () => {
    directory = await mkdtemp(join(tmpdir(), "poko-database-"));
    const migrations = (await readdir(migrationsPath)).sort();
    const olderMigrations = join(directory, "older-migrations");
    for (const name of migrations.slice(
      0,
      migrations.indexOf("20261001235717_conversation_titles"),
    )) {
      await cp(join(migrationsPath, name), join(olderMigrations, name), { recursive: true });
    }
    const dbPath = join(directory, "poko.sqlite");
    (await PokoDatabase.open(dbPath, olderMigrations)).close();
    const client = new DatabaseSync(dbPath);
    const at = "2026-09-30T10:00:00.000Z";
    client.exec(`INSERT INTO conversations VALUES ('empty', '대화', '${at}', '${at}');`);
    client.close();
    const upgraded = await PokoDatabase.open(dbPath, migrationsPath);
    expect(upgraded.listConversations()).toEqual([]);
    upgraded.close();
  });

  it("renames and deletes conversations, keeping tasks and Activity", async () => {
    const database = await openDatabase();
    const task = database.createTask("메일 요약해 줘", "/tmp/p");
    const id = database.getTaskConversation(task)?.id as string;
    expect(database.hasRunningTask(id)).toBe(true);
    database.recordTaskEvent(task, "completed", "마쳤어.", "요약이야.");
    expect(database.hasRunningTask(id)).toBe(false);

    expect(database.renameConversation(id, "  받은편지함\n정리  ")).toBe(true);
    expect(database.getConversation(id)?.title).toBe("받은편지함 정리");
    expect(() => database.renameConversation(id, "   ")).toThrow(TypeError);
    expect(() => database.renameConversation(id, "가".repeat(81))).toThrow(TypeError);
    expect(database.renameConversation("gone", "제목")).toBe(false);

    database.setActiveConversation(id);
    expect(database.deleteConversation(id)).toBe(true);
    expect(database.listConversations()).toEqual([]);
    expect(database.getConversationMessages(id)).toEqual([]);
    expect(database.getActiveConversationId()).toBeNull();
    // The task and its Activity stay as the audit trail, detached from the conversation.
    const data = database.getBootstrapData();
    expect(data.tasks.map((item) => item.id)).toEqual([task]);
    expect(data.activities.some((activity) => activity.taskId === task)).toBe(true);
    expect(database.getTaskConversation(task)).toBeNull();
    expect(database.deleteConversation(id)).toBe(false);
    database.close();
  });

  it("keeps the edit switch per workspace and finds pending file changes", async () => {
    const database = await openDatabase();
    expect(database.isEditsEnabled("/real/project")).toBe(false);
    database.setEditsEnabled("/real/project", true);
    expect(database.isEditsEnabled("/real/project")).toBe(true);
    expect(database.isEditsEnabled("/real/other")).toBe(false);

    const task = database.createTask("README 고쳐 줘", "/real/project");
    expect(database.getTaskWorkspace(task)).toBe("/real/project");
    database.recordApprovalRequest({
      taskId: task,
      requestId: "7",
      kind: "file_change",
      summary: "1개 파일 변경",
      cwd: "/real/project",
      reason: null,
      canApprove: true,
    });
    expect(database.getApprovalKind(task, "7")).toBe("file_change");
    expect(database.pendingFileChanges("/real/project")).toEqual([
      { taskId: task, requestId: "7" },
    ]);
    expect(database.pendingFileChanges("/real/other")).toEqual([]);

    database.setEditsEnabled("/real/project", false);
    expect(database.isEditsEnabled("/real/project")).toBe(false);
    database.close();
  });
});
