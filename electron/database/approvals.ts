import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { ApprovalChoice, ApprovalRequest } from "../shared";
import { type Db, now } from "./common";
import { activities, approvals, tasks } from "./schema";

export function recordApprovalRequest(db: Db, request: ApprovalRequest): boolean {
  const timestamp = now();
  const canApprove = request.canApprove;
  db.transaction((tx) => {
    tx.insert(approvals)
      .values({
        id: randomUUID(),
        taskId: request.taskId,
        requestId: request.requestId,
        kind: request.kind,
        summary: request.summary,
        cwd: request.cwd,
        reason: request.reason,
        decision: canApprove ? "pending" : "denied",
        createdAt: timestamp,
        resolvedAt: canApprove ? null : timestamp,
      })
      .run();
    if (canApprove) {
      tx.update(tasks)
        .set({ status: "waiting_approval" })
        .where(eq(tasks.id, request.taskId))
        .run();
    }
    tx.insert(activities)
      .values({
        id: randomUUID(),
        taskId: request.taskId,
        type: "approval_requested",
        message: canApprove
          ? "포코가 작업 진행을 확인하고 있어."
          : "안전한 확인 정보가 없어 요청을 거절했어.",
        createdAt: timestamp,
      })
      .run();
  });
  return canApprove;
}

export function resolveApproval(
  db: Db,
  taskId: string,
  requestId: string,
  choice: ApprovalChoice,
): boolean {
  const timestamp = now();
  return db.transaction((tx) => {
    const pending = tx
      .select({ id: approvals.id })
      .from(approvals)
      .where(
        sql`${approvals.taskId} = ${taskId} AND ${approvals.requestId} = ${requestId} AND ${approvals.decision} = 'pending'`,
      )
      .get();
    if (!pending) return false;
    tx.update(approvals)
      .set({ decision: choice === "approve" ? "approved" : "denied", resolvedAt: timestamp })
      .where(eq(approvals.id, pending.id))
      .run();
    const stillWaiting = tx
      .select({ id: approvals.id })
      .from(approvals)
      .where(sql`${approvals.taskId} = ${taskId} AND ${approvals.decision} = 'pending'`)
      .get();
    if (!stillWaiting) {
      tx.update(tasks).set({ status: "running" }).where(eq(tasks.id, taskId)).run();
    }
    tx.insert(activities)
      .values({
        id: randomUUID(),
        taskId,
        type: choice === "approve" ? "approval_approved" : "approval_denied",
        message: choice === "approve" ? "확인했어. 이 요청을 한 번 진행할게." : "요청을 거절했어.",
        createdAt: timestamp,
      })
      .run();
    return true;
  });
}

/** Pending file-change approvals of tasks in a workspace, to decline when edits are turned off. */
export function pendingFileChanges(
  db: Db,
  realPath: string,
): Array<{ taskId: string; requestId: string }> {
  return db
    .select({ taskId: approvals.taskId, requestId: approvals.requestId })
    .from(approvals)
    .innerJoin(tasks, eq(tasks.id, approvals.taskId))
    .where(
      sql`${approvals.decision} = 'pending' AND ${approvals.kind} = 'file_change' AND ${tasks.workspace} = ${realPath}`,
    )
    .all();
}

/** The kind of a recorded approval request, or null when unknown. */
export function getApprovalKind(db: Db, taskId: string, requestId: string): string | null {
  return (
    db
      .select({ kind: approvals.kind })
      .from(approvals)
      .where(sql`${approvals.taskId} = ${taskId} AND ${approvals.requestId} = ${requestId}`)
      .get()?.kind ?? null
  );
}
