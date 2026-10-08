import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveWorkspaceDirectory } from "../agent/workspace";
import {
  attachedTextSection,
  type CheckedAttachment,
  removeAttachments,
  writeImages,
} from "../attachments/attachments";
import { ConversationGoneError } from "../database/Database";
import { IPC_CHANNELS, type QueuedQuestion, type TaskStartedNotice } from "../shared";
import { attachmentDirs, CONVERSATION_GONE, ctx, folderGoneMessage, settleEdits } from "./context";
import { deliverTaskEvent } from "./events";

/**
 * Questions sent while Poko is busy (Phase 17). Each waits as a `queued` task and starts on its
 * own when Poko is free, oldest first. Poko still runs one task at a time.
 */
export const QUEUE_LIMIT = 3;
/** A start that became a waiting question. */
export type QueuedStart = { queued: QueuedQuestion };
export const QUEUE_FULL = "기다리는 질문이 너무 많아. 하나가 끝난 뒤에 보내 줘.";

interface Waiting extends QueuedQuestion {
  /** What the user typed, sent to the engine with the attached text. */
  message: string;
  /** The resolved folder, checked again when it starts. */
  folder: string;
  images: string[];
  /** Attached text, kept in the task's attachment folder rather than in memory. */
  textFile: string | null;
}

const waiting: Waiting[] = [];
/** Places held by questions still being checked before they join the queue. */
let reserved = 0;
let draining = false;
/** The task that ended last, whose approved changes settle before the next task starts. */
let lastEnded: string | null = null;

/** Whether any question waits or is about to; while so, Poko counts as busy. */
export function hasWaiting(): boolean {
  return waiting.length + reserved > 0;
}

export function waitingQuestions(): QueuedQuestion[] {
  return waiting.map(({ taskId, conversationId, text }) => ({ taskId, conversationId, text }));
}

/**
 * Holds a place in the queue. Synchronous, so two starts at once can't both pass the limit.
 * Every place held is given back with `releaseSlot`, whether or not the question joined.
 */
export function reserveSlot(): boolean {
  if (waiting.length + reserved >= QUEUE_LIMIT) return false;
  reserved += 1;
  return true;
}

export function releaseSlot(): void {
  reserved = Math.max(0, reserved - 1);
}

/** Records a checked question as waiting, with its attachments written to its own folder. */
export async function enqueueQuestion(input: {
  shown: string;
  message: string;
  conversationId: string | null;
  folder: string;
  attachments: CheckedAttachment[];
}): Promise<QueuedStart | { error: string }> {
  if (!ctx.database) throw new Error("Local storage is unavailable.");
  let taskId: string;
  try {
    taskId = ctx.database.queueTask(input.shown, input.folder, input.conversationId);
  } catch (error) {
    if (error instanceof ConversationGoneError) return { error: CONVERSATION_GONE };
    throw error;
  }
  const dir = ctx.attachmentsRoot ? join(ctx.attachmentsRoot, taskId) : null;
  let images: string[] = [];
  let textFile: string | null = null;
  try {
    const text = attachedTextSection(input.attachments);
    if (dir && ctx.attachmentsRoot) {
      const written = await writeImages(ctx.attachmentsRoot, taskId, input.attachments);
      images = written?.images ?? [];
      if (text) {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        textFile = join(dir, "attached.txt");
        await writeFile(textFile, text, { mode: 0o600 });
      }
      if (images.length || textFile) attachmentDirs.set(taskId, dir);
    } else if (text) throw new Error("Nowhere to keep the attached text.");
  } catch (error) {
    attachmentDirs.delete(taskId);
    if (dir) void removeAttachments(dir);
    ctx.database.recordTaskEvent(taskId, "cancelled", null);
    throw error;
  }
  const question: QueuedQuestion = {
    taskId,
    conversationId: input.conversationId,
    text: input.shown,
  };
  waiting.push({ ...question, message: input.message, folder: input.folder, images, textFile });
  sendQueue();
  return { queued: question };
}

/** 취소: takes a waiting question out. False when it isn't waiting (it may have just started). */
export function cancelQueued(taskId: string): boolean {
  const index = waiting.findIndex((item) => item.taskId === taskId);
  if (index < 0) return false;
  waiting.splice(index, 1);
  // Recorded directly, not as a task event: nothing ran, so nothing ends (no notification).
  ctx.database?.recordTaskEvent(taskId, "cancelled", "보내기 전에 취소했어.");
  dropAttachments(taskId);
  sendQueue();
  return true;
}

/** Remembers the task that just ended, so its approved changes settle before the next starts. */
export function noteTaskEnded(taskId: string): void {
  lastEnded = taskId;
}

/** Tries the next question soon: call when Poko may have become free. */
export function kickQueue(): void {
  setImmediate(() => void startNext());
}

/** Whether a waiting question may start now. */
function free(): boolean {
  return Boolean(
    ctx.agentCore &&
      ctx.database &&
      !ctx.agentCore.hasActiveTasks &&
      !ctx.screenRun &&
      ctx.startingTasks === 0 &&
      !ctx.deletingData &&
      !ctx.queueFrozen,
  );
}

/** Starts the oldest waiting question, or the next one after any that can't start. */
export async function startNext(): Promise<void> {
  if (draining || waiting.length === 0 || !free()) return;
  draining = true;
  // Counted as a start, so every other start sees Poko busy (and queues behind it).
  ctx.startingTasks += 1;
  try {
    const previous = lastEnded;
    lastEnded = null;
    if (previous)
      await settleEdits(previous).catch((error) =>
        console.error("Could not settle edits before the next question.", error),
      );
    while (waiting.length > 0 && !ctx.queueFrozen) {
      const next = waiting.shift() as Waiting;
      // The window hears the list change after `taskStarted`, so it still knows where the
      // question waited when it takes it over.
      const started = await startWaiting(next);
      sendQueue();
      if (started) break;
    }
  } finally {
    ctx.startingTasks -= 1;
    draining = false;
  }
}

/** Starts one waiting question. False when it couldn't start, so the next one may. */
async function startWaiting(next: Waiting): Promise<boolean> {
  const cwd = await resolveWorkspaceDirectory(next.folder).catch(() => null);
  let text = "";
  try {
    if (next.textFile) text = await readFile(next.textFile, "utf8");
  } catch (error) {
    console.error("Could not read a waiting question's attached text.", error);
    text = "";
  }
  // Quitting: it stays queued, and the next start shows it as not asked.
  if (ctx.queueFrozen || !ctx.database || !ctx.agentCore) return true;
  const conversationId = ctx.database.startQueuedTask(next.taskId);
  const conversation = conversationId ? ctx.database.getConversation(conversationId) : null;
  if (!conversation) {
    dropAttachments(next.taskId);
    return false;
  }
  const notice: TaskStartedNotice = {
    taskId: next.taskId,
    title: next.text.slice(0, 120),
    conversation,
  };
  if (ctx.mainWindow && !ctx.mainWindow.isDestroyed() && !ctx.mainWindow.webContents.isDestroyed())
    ctx.mainWindow.webContents.send(IPC_CHANNELS.taskStarted, notice);
  if (!cwd) {
    fail(next.taskId, folderGoneMessage(next.folder));
    return false;
  }
  if (next.textFile && !text) {
    fail(next.taskId, "첨부한 글을 읽지 못했어. 다시 보내 줘.");
    return false;
  }
  try {
    ctx.agentCore.startTask({
      prompt: [next.message || "첨부한 파일을 살펴봐 줘.", text].filter(Boolean).join("\n\n"),
      cwd,
      taskId: next.taskId,
      context: ctx.database.getTaskContext(next.taskId),
      editsEnabled: ctx.database.isEditsEnabled(cwd),
      ...(next.images.length ? { images: next.images } : {}),
    });
    return true;
  } catch (error) {
    console.error("Could not start a waiting question.", error);
    fail(next.taskId, "작업을 시작하지 못했어.");
    return false;
  }
}

/** A waiting question that couldn't start: its conversation shows why, like a failed answer. */
function fail(taskId: string, error: string): void {
  deliverTaskEvent({ taskId, event: { type: "error", error } });
}

function dropAttachments(taskId: string): void {
  const dir = attachmentDirs.get(taskId);
  attachmentDirs.delete(taskId);
  if (dir) void removeAttachments(dir);
}

function sendQueue(): void {
  if (ctx.mainWindow && !ctx.mainWindow.isDestroyed() && !ctx.mainWindow.webContents.isDestroyed())
    ctx.mainWindow.webContents.send(IPC_CHANNELS.taskQueueChanged, waitingQuestions());
}

/** For tests: forgets every waiting question. */
export function resetQueueForTests(): void {
  waiting.length = 0;
  reserved = 0;
  draining = false;
  lastEnded = null;
}
