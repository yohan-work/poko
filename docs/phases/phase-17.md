# Phase 17 — Asking while Poko is busy

## Goal

Let the user ask the next question while Poko is still working, instead of being told to come back later.

Today Poko runs one task at a time, and every other start is refused with "포코가 이미 다른 작업을 하고 있어. 끝난 뒤에 다시 물어봐 줘.". The workarounds have grown around that rule: the routine banner's 멈추고 지금 묻기, the busy guards on the folder buttons, and a composer whose only button is 멈추기 while an answer streams. The user has to remember the question and come back.

Poko still runs **one task at a time**. A question sent while it is busy waits its turn and starts on its own. Running several tasks at once stays deferred.

## What the user experiences

- **Sending while busy (main window):**
  - the user can type and send while an answer streams, or while another task (the quick panel's, a routine's) runs;
  - the question appears under the conversation as **대기 중 · {text}**, with **취소**. It joins the conversation itself (the user's message) only when its turn comes, so messages keep their order: a follow-up sent while A1 streams shows as Q1, A1, Q2, A2;
  - the composer's button is **보내기** while there is text and **멈추기** when the box is empty, so stopping the running task stays one click (and ⌘.). Attaching and dictation stay available.
- **Where the user can send:**
  - in the conversation on screen, or from the new-conversation screen (it waits there and becomes a new conversation when it starts);
  - switching to another conversation stays locked while Poko is busy, as today. A waiting queue keeps Poko busy longer, which this phase accepts. Relaxing the lock is deferred.
- **Its turn:**
  - when Poko becomes free (the task finished, failed, or was stopped), the oldest waiting question starts on its own;
  - a follow-up gets the answer that was streaming when it was sent as context, because its context is read when it starts;
  - if it is the conversation on screen, or the new-conversation screen it was sent from, the answer streams there as usual. The existing notification rule applies.
- **Order and limits:**
  - waiting questions run oldest first. A question sent while others wait always goes behind them;
  - at most **3** wait at once. A fourth is refused: "기다리는 질문이 너무 많아. 하나가 끝난 뒤에 보내 줘.";
  - waiting questions run before a routine, whether it comes due or the user presses 지금 실행. The routine waits, as it does today for any busy Poko.
  - 멈추고 지금 묻기 still stops a routine run. If questions are already waiting, they go first.
- **Cancelling:** **취소** removes a waiting question. Nothing is added to the conversation, and the text goes back into the message box if it is empty.
- **What doesn't wait:**
  - 화면 보기 and 대신 해 줘 need the screen as it is now, so they are still refused while Poko is busy or anything waits;
  - a question refused for another reason (wrong folder, missing folder, data being deleted) is refused right away, as today;
  - deleting a conversation with a waiting question is refused, as for a running one ("작업 중이라 지금은 지울 수 없어"). The user cancels it first.
  - choosing a folder and 모든 데이터 삭제 are refused while anything waits. The folder message says so: "포코가 작업 중이거나 기다리는 질문이 있어서 끝난 뒤에 바꿀 수 있어."
- **Starting fails:** if a waiting question can't start when its turn comes (its folder is gone, or the engine fails to start), the conversation shows the question and the reason as an error, and the next one starts.
- **Quitting:** waiting questions are not run after a restart. On the next start, each one is added to its conversation as the question plus "포코가 꺼져서 묻지 못했어.", so its text isn't lost.
- **The quick panel** keeps refusing while Poko is busy until milestone 2.

## Design

- **Recording a waiting question:**
  - `createTask` gains a queued form. It records only a `tasks` row with status `queued`, the shown text as `prompt`, the resolved folder, and the conversation (null for a new one). There is no `messages` row and no new conversation yet;
  - `startQueuedTask(taskId)` later creates the conversation if needed, inserts the user message, and sets the task `running`, all in one transaction. A new conversation is titled from the message as today;
  - `recordTaskStart` doesn't change the window's saved active conversation for a queued task.
- **What waits in memory** (`electron/app/queue.ts`): `{ taskId, conversationId, text, images, textFile, folder }`.
  - Images are written to the task's attachment folder when it is queued, as a running task's are. Attached text is written there as one file (`attachedTextSection`) and read back when the task starts, so no attachment content is held in memory.
  - The engine prompt is rebuilt from `text` and that file. `tasks.prompt` holds only the shown text.
- **Queueing:**
  - Only the main window's `task:start` may queue (an `allowQueue` option). The quick panel and screen starts keep refusing.
  - The busy check gains "anything waiting". A start while Poko is busy **or** anything waits is queued, so order stays oldest first even in the gap before the next one starts.
  - The slot is counted synchronously, before any `await`. That way two starts at once can't both pass the limit, or both queue with nothing running. After queueing, `startNext()` runs if Poko is idle.
  - The same folder checks as a direct start run before queueing. `anyTaskBusy` counts waiting questions, so the folder can't be changed while they wait.
- **Starting the next one:** `startNext()` runs when Poko becomes **idle**, not on the terminal event.
  - The terminal event is delivered while `AgentCore` still counts the task active, and while `ctx.screenRun` is still set, so a start there would be refused.
  - `AgentCore` gains an idle hook, called after a task leaves `activeTasks`. The screen run's `done.finally` calls `startNext` too.
  - `startNext` re-checks that nothing runs or starts, that data isn't being deleted, and that the queue isn't frozen.
  - It then awaits `settleEdits` for the task that just ended, so the next task's checkpoints come after the previous task's final state.
  - It re-resolves the folder, then starts the task the same way a direct start does: context and edit setting read now, `startQueuedTask`, `agentCore.startTask`, and the `taskStarted` notice.
  - If any step fails, it records an error in the conversation, sends the renderer an error event, removes the attachment folder, and moves on to the next one.
- **Quitting:** `before-quit` and the main window's `closed` freeze the queue (`ctx.queueFrozen`) before they cancel tasks, so a cancel never starts the next question during quit.
- **Routines:** `startRoutineTask`'s busy check counts waiting questions. That covers both the timer and 지금 실행.
- **Cancelling:** `task:cancel-queued(taskId)` takes the task out of the queue and records it `cancelled` directly, without `deliverTaskEvent`. That way it doesn't trigger the end-of-task path (routine end, notification, `startNext`). It also removes the attachment folder.
  - If the task already started, main answers "not waiting", and the renderer leaves it to the `taskStarted` adoption.
- **Telling the renderer:**
  - the start reply gains `queued: { taskId }`. The renderer keeps its running task, `isSending`, and the character state as they are;
  - `task:queued` returns the waiting list (`{ taskId, conversationId, text }[]`), and `taskQueueChanged` sends it whenever it changes. The renderer draws the 대기 중 rows from this list, so they survive a reload or a reopened window;
  - when a waiting task starts, the existing `taskStarted` notice adopts it if its conversation is on screen, or if the new-conversation screen sent it.
- **Startup:** `recoverInterruptedTasks` turns each `queued` task into a failed one in its conversation (creating the conversation for a new one): the user's message, then the assistant line "포코가 꺼져서 묻지 못했어.". Startup already empties the attachments folder.
- **Not changed:** the provider and Agent Core contracts (apart from the idle hook), approvals, edits, and the read-only routine boundary.

## Milestones (one PR each)

1. **The queue in main and the main window.**

   Tests cover:
   - queueing while busy, and while others wait;
   - the limit, including two starts at once;
   - starting in order after completed, failed, and cancelled ends, and after a screen run, only once `AgentCore` is idle;
   - message order in a conversation after a queued follow-up;
   - a queued new conversation;
   - cancelling, including a cancel racing a start;
   - a dequeued task whose folder is gone or whose start throws;
   - quitting with waiting questions, and the startup rule;
   - a routine (timer and 지금 실행) and 화면 보기 while something waits;
   - deleting a conversation with a waiting question;
   - the quick panel still refusing;
   - no notification for a cancelled waiting question;
   - the renderer's waiting rows after a reload, and adopting the started task.
2. **The quick panel.** A question asked there while Poko is busy waits too. The panel shows 대기 중, and `taskStarted` is sent when the task actually starts. Then the panel streams the answer, or the user can open it in the main window.

## Explicitly deferred

- Running several tasks at once.
- Switching conversations while Poko is busy.
- Reordering or editing a waiting question.
- Running waiting questions after a restart.
- Queueing screen tasks.

## Status

- **Milestone 1 (the queue in main and the main window) is done.**
  - A waiting question is a `queued` task with no message. `startQueuedTask` adds the message when its turn comes, so the conversation keeps its order.
  - `electron/app/queue.ts` holds the queue. `AgentCore.onIdle` and the end of a screen run start the next question, and `before-quit` and `closed` freeze the queue.
  - The quick panel, screen tasks, routines, folder changes, and 모든 데이터 삭제 wait or refuse while anything waits.
  - **Real app**, with a test profile and Codex:
    - a follow-up sent while the first answer was being written showed as 대기 중 with 취소;
    - it started on its own after the first answer, and it used that answer as context ("한 문장으로 줄여 줘" shortened it);
    - 취소 removed a waiting question and put its text back into the empty box.
