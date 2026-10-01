import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PokoDatabase } from "./Database";

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

  it("builds context from saved memories and completed exchanges in the same conversation", async () => {
    const database = await openDatabase();
    database.saveMemory({ type: "fact", content: "덜 중요한 기억", importance: 2 });
    database.saveMemory({ type: "preference", content: "답변은 간결하게", importance: 5 });

    const done = database.createTask("구조 설명해 줘", "/tmp/project");
    database.recordTaskEvent(done, "completed", "마쳤어.", "Electron 앱이야.");
    const failed = database.createTask("실패한 요청", "/tmp/project");
    database.recordTaskEvent(failed, "error", "실패했어.", "작업을 마치지 못했어.");
    const cancelled = database.createTask("취소한 요청", "/tmp/project");
    database.recordTaskEvent(cancelled, "cancelled", "멈췄어.", "요청을 멈췄어.");
    const current = database.createTask("그거 다시 설명해 줘", "/tmp/project");

    const context = database.getTaskContext(current);
    expect(context.memories.map((memory) => memory.content)).toEqual([
      "답변은 간결하게",
      "덜 중요한 기억",
    ]);
    expect(context.history).toEqual([{ request: "구조 설명해 줘", answer: "Electron 앱이야." }]);
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
    const next = upgraded.createTask("그거 다시 설명해 줘", "/tmp/project");
    expect(upgraded.getTaskContext(next).history).toEqual([
      { request: "구조 설명해 줘", answer: "Electron 앱이야." },
    ]);
    upgraded.close();
  });
});
