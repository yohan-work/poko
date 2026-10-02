import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join, relative } from "node:path";
import type { EditRecord, PokoDatabase } from "../database/Database";
import type { EditNote } from "../shared";
import {
  changedSinceCheckpoint,
  createCheckpoint,
  type EditFile,
  UndoRefused,
  undoEdit,
  withAfterStates,
} from "./checkpoint";

/** Checkpoints are kept this long; older edits can no longer be undone. */
export const KEEP_DAYS = 30;

const undoMessages: Record<UndoRefused["reason"], (file: string) => string> = {
  changed: (file) =>
    `‘${file}’이(가) 그 뒤에 바뀌어서 되돌리지 않았어. 새 작업을 덮어쓰지 않으려고.`,
  unknown: (file) => `‘${file}’의 변경 결과를 확인하지 못해서 되돌릴 수 없어.`,
  outside: (file) => `‘${file}’은(는) 작업 폴더 밖이라 되돌릴 수 없어.`,
  not_a_file: (file) => `‘${file}’은(는) 일반 파일이 아니라 되돌릴 수 없어.`,
};

/**
 * Approved file changes: a checkpoint right before each is accepted, its outcome once Codex has
 * moved on, and undo. Main process only.
 */
export class EditManager {
  constructor(
    private readonly database: PokoDatabase,
    private readonly root: string,
  ) {}

  private dir(id: string): string {
    return join(this.root, id);
  }

  /** Saves the files' current bytes before an approved change is accepted. Throws on failure. */
  async checkpoint(
    taskId: string,
    requestId: string,
    workspace: string,
    paths: string[],
  ): Promise<void> {
    const id = randomUUID();
    try {
      const files = await createCheckpoint(this.dir(id), workspace, paths);
      this.database.createEdit({
        id,
        taskId,
        requestId,
        workspace,
        files: JSON.stringify(files),
      });
    } catch (error) {
      await rm(this.dir(id), { recursive: true, force: true });
      throw error;
    }
  }

  /**
   * Settles a task's pending edits once Codex has moved on (its next request or its end): an
   * edit whose files changed is `applied` with the state it left; one that changed nothing is
   * `failed` and its checkpoint is removed. Returns whether anything was settled.
   */
  async settle(taskId: string): Promise<boolean> {
    const pending = this.database.pendingEdits(taskId);
    for (const edit of pending) {
      const files = JSON.parse(edit.files) as EditFile[];
      try {
        if (await changedSinceCheckpoint(this.dir(edit.id), files)) {
          const after = await withAfterStates(files);
          this.database.updateEdit(edit.id, "applied", JSON.stringify(after));
          this.database.recordTaskEvent(
            taskId,
            "edit",
            `파일을 바꿨어: ${names(edit.workspace, files).join(", ")}`,
          );
        } else {
          this.database.updateEdit(edit.id, "failed");
          await rm(this.dir(edit.id), { recursive: true, force: true });
        }
      } catch (error) {
        console.error("Could not settle an edit.", error);
        this.database.updateEdit(edit.id, "failed");
      }
    }
    return pending.length > 0;
  }

  /** Restores an applied edit. Resolves to an error message, or null when undone. */
  async undo(id: string): Promise<string | null> {
    const edit = this.database.getEdit(id);
    if (edit?.status !== "applied") return "이 변경은 되돌릴 수 없어.";
    const files = JSON.parse(edit.files) as EditFile[];
    try {
      await undoEdit(this.dir(id), edit.workspace, files);
    } catch (error) {
      if (error instanceof UndoRefused)
        return undoMessages[error.reason](relative(edit.workspace, error.file));
      console.error("Could not undo an edit.", error);
      return "되돌리지 못했어. 파일은 그대로야.";
    }
    this.database.updateEdit(id, "undone");
    this.database.recordTaskEvent(
      edit.taskId,
      "edit",
      `변경을 되돌렸어: ${names(edit.workspace, files).join(", ")}`,
    );
    await rm(this.dir(id), { recursive: true, force: true });
    return null;
  }

  notes(conversationId: string): EditNote[] {
    return this.database.conversationEdits(conversationId).map((edit) => toNote(edit));
  }

  /** Removes a conversation's checkpoints before the conversation (and its edits) is deleted. */
  async forgetConversation(conversationId: string): Promise<void> {
    for (const id of this.database.conversationEditIds(conversationId))
      await rm(this.dir(id), { recursive: true, force: true });
  }

  /** Expires edits older than KEEP_DAYS and removes their checkpoints. */
  async expireOld(now = new Date()): Promise<void> {
    const before = new Date(now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString();
    for (const id of this.database.expireEdits(before))
      await rm(this.dir(id), { recursive: true, force: true });
  }
}

function names(workspace: string, files: EditFile[]): string[] {
  return files.map((file) => relative(workspace, file.path));
}

function toNote(edit: EditRecord): EditNote {
  return {
    id: edit.id,
    createdAt: edit.createdAt,
    status: edit.status === "undone" ? "undone" : edit.status === "expired" ? "expired" : "applied",
    files: names(edit.workspace, JSON.parse(edit.files) as EditFile[]),
  };
}
