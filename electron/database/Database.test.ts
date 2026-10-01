import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    database.recordTaskEvent(taskId, "cancelled", "요청을 멈췄어.", "요청을 멈췄어.");
    expect(database.resolveApproval(taskId, "1", "approve")).toBe(false);
    expect(database.getBootstrapData().tasks[0]).toMatchObject({ status: "cancelled" });
    database.close();
  });
});
