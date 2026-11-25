# AI PM shift checkpoints (5 AM / 1 PM / 5 PM)

Branch: `feature/ai-auto-queue`. Extends the existing auto-queue in `server/src/services/autoQueue/`.

## Intent

Replace the "fill everyone at 5 AM, then top up every 5 minutes" auto-queue with an AI project manager that
works the day at three fixed points, the way a PM would:

| Time (Manila) | What it does |
|---|---|
| 5:00 AM | Hand out Available tasks to the **morning** shift. |
| 1:00 PM | For each **morning** person, decide what they can still finish before their day ends. Hand what they can't to the **noon** shift. |
| 5:00 PM | For each **noon** person, decide what they can still finish. Hand what they can't to the **night** shift, then hand out Available tasks to the **night** shift. |

Tasks only ever go to people who hold the task's role (`assigneeRoleRestrictions` / team). The existing
rule stays: code decides who **can** take a task; the AI only decides who **should** and what is **doable**.

## What gets queued

| Item | Queued? |
|---|---|
| Normal task (no subtasks) | Yes |
| Subtask | Yes, each one on its own |
| Main / parent task (has subtasks) | **No, never** |

The Task Map pool lists parent tasks and their open subtasks as separate items (`isSubtask` on board items).
A parent task is excluded from every run: not handed out at 5 AM / 5 PM, not moved by the 1 PM / 5 PM
check, not offered by Distribute. Its subtasks are queued individually, each by its own role
(subtasks have their own `assigneeRoleRestrictions`).

- "Has subtasks" means any subtask, open **or completed**. The board query only loads open subtasks
  (`subtasks: { where: { completed: false } }`), so a parent whose subtasks are all done would look like a
  normal task. The builder adds a non-audit subtask count to the board item and the rule reads that.
- "Has subtasks" ignores `--audit` subtasks, which the board already hides (`isSubtaskExcludedFromBoard`).
  Otherwise a normal task with only an audit subtask would never be queued. *(My call.)*
- A parent task already in someone's column doesn't count toward their hours: its subtasks are the work,
  and counting both would double it. *(My call.)*
- The rule lives in `rules.ts` next to `isMaWorkItem`, so every run and the PM buttons share it.

## Goals

- The three runs above are the only automatic queueing.
- "Still doable" is judged by the AI (Ollama, already configured via `OLLAMA_URL` / `OLLAMA_MODEL`).
- Assignments and handovers happen directly, no PM approval step. PMs can still move anything by hand.
- Every move is logged with the AI's reason.

## Non-goals

- No new shift settings or per-person hours: shifts come from the existing Day/Noon/Night configs.
- No new UI beyond what exists (Distribute / Reset buttons stay as they are).
- No PM notification summary (not asked for).

## Anti-goals (failure even if it "works")

- Moving a task someone has already started.
- Giving a task to someone without its role.
- Moving tasks a PM placed by hand.
- An AI failure leaving work stuck: every AI step has a rules fallback.

## Shifts and who belongs where

Shifts come from `AuditShiftConfig` as configured today:

| Key | Name | Hours | Called here |
|---|---|---|---|
| `AM` | Morning Shift | 8:00 – 12:00 | morning |
| `PM_AFTERNOON` | Afternoon Shift | 12:00 – 18:30 | noon |
| `PM_NIGHT` | Night Shift | 17:00 – 02:00 | night |

A person can be a member of more than one shift. For these runs:

- Their **working window** is the union of the shifts they're in (existing `scheduledShiftHours` logic),
  so someone in AM + Afternoon works 8:00 – 18:30.
- Their **starting shift** is the earliest shift they're in. "Morning people" = starting shift AM,
  "noon people" = starting shift PM_AFTERNOON, "night people" = starting shift PM_NIGHT.
- Shifts are matched by their `order`, not hard-coded keys, so renaming a shift in settings doesn't break it.
  (Builder: map morning/noon/night to `order` 1/2/3 of the active configs.)

## The runs

### 5 AM: morning distribution

Same as today's `runDailyAutoQueue` (whole pool, balanced by estimated hours against each person's
working-window length, AI picks among people the task fits), except candidates are **morning people only**.

### 1 PM and 5 PM: doable check, then handover

For each person in the checked group (1 PM: morning people; 5 PM: noon people):

1. **Remaining hours** = end of their working window − now.
2. **Their column**: in-progress tasks (count against remaining hours, never move) and queued, unstarted tasks.
3. **AI verdict**: one Ollama call per person. It sees remaining hours and each task (title, client, priority,
   due date, estimated hours, open subtasks, short description) under labels `t1..tN`, and returns
   `{"cannotFinish": ["t3", ...], "reason": "..."}` with a JSON schema that only allows those labels.
4. **Rules fallback** (AI off, slow, or unusable answer): keep in-progress first, then queued tasks in pool
   order (urgent, high, due date, oldest) while they fit in the remaining hours; the rest can't be finished.
5. **Only movable tasks move**: unstarted *and* placed by the auto-queue (existing `movableAutoQueued`).
   Tasks a PM placed that won't fit are logged as at-risk but stay put.
6. **Handover**: each task that can't be finished goes to the next group (1 PM → noon people,
   5 PM → night people) through the existing planner: role match, capacity by free hours, AI pick, rules fallback.
   If nobody in the next group has the role or the room, the task goes back to Available tasks marked
   `Hand-over` (same as `maInactivityService`), so the next run or a PM picks it up.

At 5 PM, after handovers, hand out the remaining Available tasks to **night people** (same as the 5 AM step).

### Logging

Each move writes an `AUTO_QUEUE` audit log (existing) with `run: '5am' | '1pm' | '5pm'`, plus
`action: 'assign' | 'handover' | 'returned'`, `fromUserId`, and the AI's reason.
Each handover also adds a task comment like the existing auto-handover comment, so the MA sees why it moved.

## Scheduling and switches

- BullMQ repeat jobs on `TaskMapAutoQueue`: `0 5 * * *`, `0 13 * * *`, `0 17 * * *`, `tz: 'Asia/Manila'`.
- **Remove the 5-minute top-up job**, including deleting its existing repeatable entry from Redis on startup
  (repeat jobs persist across deploys).
- All three runs stay behind `AUTO_QUEUE_MODE` (`off` / `dry_run` / `on`). `dry_run` logs every verdict and move
  without changing anything; run it for a day before switching to `on`.
- Runs share the existing one-at-a-time lock with Distribute / Reset.

## Approaches considered

1. **All inside Nexus with Ollama, on the existing auto-queue (chosen).** Reuses the branch's role matching,
   hour balancing, assign handler, logging and Ollama picker; only adds the checkpoint runs and the doable check.
2. **n8n schedules + Gemini node, Nexus validates.** Rejected by the user: Nexus already has Ollama, and
   splitting the logic across two systems adds a failure point.
3. **Pure rules (sum of estimates vs remaining hours), no AI.** Kept only as the fallback: the user wants the AI
   to judge doability, since many tasks have no estimate.

## Decided by the user

- AI judges "still doable".
- Assign directly, no approval step.
- Tasks that can't be finished go to the next shift.
- Base shifts on the existing Day / Noon / Night settings.
- Turn off the 5-minute top-up.

## My calls (correct me)

- Starting shift = earliest shift a person is in; working window = union of their shifts.
- Only unstarted, auto-queue-placed tasks are moved; PM-placed tasks are logged as at-risk, not moved.
- No fitting person in the next shift → back to Available tasks as `Hand-over`.
- 1 PM does **not** hand out Available tasks to noon people (your spec only has the check at 1 PM).
  If noon people should also get pool work at 1 PM, it's one line to add.

## Left to the builder

- Exact prompt wording for the doable check (keep it short; the default model is `qwen2.5:3b`).
- Ollama timeout per person and an overall run time budget.
- Tests in `server/test/` for: grouping by starting shift, remaining-hours maths across midnight (night shift),
  doable fallback, handover target selection, return-to-pool, and the "never move started / PM-placed" rules.
