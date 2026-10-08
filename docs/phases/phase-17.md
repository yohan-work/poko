# Phase 17 — Asking while Poko is busy

## Goal

Let the user ask the next question while Poko is still working, instead of being told to come back later.

Today Poko runs one task at a time, and every other start is refused with "포코가 이미 다른 작업을 하고 있어. 끝난 뒤에 다시 물어봐 줘.". The workarounds have grown around that rule: the routine banner's 멈추고 지금 묻기, the busy guards on the folder buttons, and a composer whose only button is 멈추기 while an answer streams. The user has to remember the question and come back.

Poko still runs **one task at a time**. A question sent while it is busy waits its turn and starts on its own. Running several tasks at once stays deferred.

## What the user experiences

- **Sending while busy:**
  - in the main window, the user can type and send while an answer streams or another task (the quick panel's, a routine's) runs;
  - the message appears in the conversation right away, marked **대기 중**, with **취소**;
  - the composer's button is **보내기** while there is text and **멈추기** when the box is empty, so stopping the running task stays one click (and ⌘.).
- **Its turn:**
  - when the running task ends (finished, failed, or stopped), the oldest waiting question starts on its own;
  - a follow-up gets the answer that was streaming when it was sent as context, because its context is read when it starts;
  - if the user is looking at its conversation, the answer streams there as usual. Otherwise the conversation's place in the sidebar updates, and the existing notification rule applies.
- **Order and limits:**
  - waiting questions run oldest first, across conversations;
  - at most **3** wait at once. A fourth is refused: "기다리는 질문이 너무 많아. 하나가 끝난 뒤에 보내 줘.";
  - a waiting question runs before a routine that comes due. A routine waits, as it does today for any busy Poko.
- **Cancelling:** **취소** on a waiting question marks it cancelled, like stopping a running task. The message stays in the conversation with "보내지 않고 취소했어."
- **What doesn't wait:**
  - 화면 보기 and 대신 해 줘 need the screen as it is now, so they are still refused while busy;
  - a question refused for another reason (wrong folder, missing folder, data being deleted) is refused right away, as today.
- **Quitting:** waiting questions are not kept across a restart. On the next start they show as failed with "포코가 꺼져서 묻지 못했어.", and the question stays in the conversation so the user can send it again.

## Design

- **Recording:** a waiting question is a task with the existing `queued` status (the schema already allows it).
  - `createTask` gains a `status` option. A queued task records the user's message and the conversation (new or existing) like a running one, so the message shows at once and the conversation exists in the sidebar.
  - Attached images are written to the task's attachment folder when it is queued, and removed when it is cancelled, like a running task's.
  - Its folder (the resolved selected folder) is stored when it is queued, after the same folder checks a start makes. Folder changes stay refused while anything waits (`anyTaskBusy` counts waiting tasks), so the folder can't change underneath it.
- **The queue lives in main** (`electron/app/queue.ts`):
  - an in-memory FIFO of `{ taskId, prompt, attachments }`, at most 3;
  - `startConversationTask` queues instead of refusing when it is busy only because another task runs or starts, never while data is being deleted;
  - `startNext()` runs when a task ends (`deliverTaskEvent` on a terminal event) and when a screen run ends. It starts the oldest waiting task with the same steps as a direct start: context and edit setting read now, `queued` → `running`, `agentCore.startTask`;
  - `RoutineRunner` treats a non-empty queue as busy, so waiting questions go first;
  - `routines:yield` (멈추고 지금 묻기) stays: it stops a routine so the user's next question doesn't have to wait.
- **Telling the renderer:**
  - the start reply gains `queued: true`. The renderer shows the message with the 대기 중 chip and doesn't treat it as its active task yet;
  - when a waiting task starts, main sends the existing `taskStarted` notice. The renderer already adopts a started task whose conversation is on screen (the routine and quick-panel paths), so the answer streams there;
  - `task:cancel-queued(taskId)` removes a waiting task from the queue and records it cancelled. Main checks that it is still waiting.
- **Startup:** `recoverInterruptedTasks` also marks `queued` tasks failed, with the restart message as their result.
- **Not changed:** the provider and Agent Core contracts, approvals, edits, and the read-only routine boundary.

## Milestones (one PR each)

1. **The queue in main and the main window:**
   - `queued` recording, the queue, `startNext`, cancelling, the startup rule, and routines yielding to waiting questions;
   - the composer sending while busy, the 대기 중 chip with 취소, and adopting the started task.

   Tests cover queueing while busy, the limit, starting in order after completed, failed, and cancelled ends, cancelling, a routine waiting behind the queue, the startup rule, and the renderer's queued and adopted states.
2. **The quick panel:** a question asked there while Poko is busy waits too. The panel shows 대기 중 and then streams the answer when its turn comes, or the user can open it in the main window.

## Explicitly deferred

- Running several tasks at once.
- Reordering or editing a waiting question.
- Keeping waiting questions across a restart.
- Queueing screen tasks.
