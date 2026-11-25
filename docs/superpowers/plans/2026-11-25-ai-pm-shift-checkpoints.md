# AI PM Shift Checkpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Task Map auto-queue into an AI PM that queues work at 5 AM (morning), checks doability and hands over at 1 PM (morning → noon) and 5 PM (noon → night, then fills night), never queueing parent tasks.

**Architecture:** Pure rules and planners in `server/src/services/autoQueue/` decide everything from a board snapshot; `autoQueueService.ts` loads the board, applies decisions through the Task Map's own handlers (`assignTaskMapTask`, `updateTaskStatuses`) as the "Nexus AI" bot, and logs. Ollama answers two questions only: who should get a task (existing `ollamaPicker.ts`) and which of a person's unstarted tasks they can't finish (new `ollamaDoable.ts`); code restricts both answers to labels it built and falls back to rules on any failure.

**Tech Stack:** TypeScript, Express, Prisma 5, BullMQ (Redis), Node `node:test` via `tsx --test`, self-hosted Ollama `/api/chat` with JSON-schema `format`.

**Spec:** `docs/superpowers/specs/2026-11-25-ai-pm-shift-checkpoints-design.md`

## Global Constraints

- Branch `feature/ai-auto-queue`. All paths below are relative to `server/` unless they start with `docs/`.
- Run tests with `npx tsx --test test/<file>.test.ts` from `server/`; full suite `npm test`.
- `server/.gitignore` ignores `*.test.ts`: existing auto-queue tests are local-only. Do **not** force-add tests; commit only `src/` (and `docs/`) files.
- Manila time everywhere: cron jobs use `tz: 'Asia/Manila'`; minute-of-day comes from `getManilaHourAndMinute()` (`services/auditAutoAssign`).
- Schedules: 5 AM `0 5 * * *`, 1 PM `0 13 * * *`, 5 PM `0 17 * * *`. The 5-minute top-up job is no longer scheduled.
- Every run stays behind `AUTO_QUEUE_MODE` (`off` / `dry_run` / `on`); `dry_run` changes nothing and logs each decision.
- Queued: normal tasks with no subtasks, and subtasks. Never queued, moved or counted: parent tasks (any non-`--audit` subtask, open or completed).
- Only tasks that are unstarted **and** placed by the auto-queue bot are ever moved. Started tasks and PM-placed tasks stay put.
- A task only goes to someone `canUserTakeTask` allows (role / team).
- Shift groups by `order` rank of the active `AuditShiftConfig` rows: rank 0 = `morning`, 1 = `noon`, 2 = `night`. A user's group = the lowest-ranked shift they're a member of.
- Audit log `run` values: `'5am' | '1pm' | '5pm'`; `action` values: `'assign' | 'handover' | 'returned'`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **MA starts a task between plan and apply** (e.g. clicks Start at 13:00:20) → the card must not move. Fresh status re-check before every handover/return (Task 6 test of `isStillMovable`).
2. **Person whose shift already ended** (AM-only, 8–12, checked at 1 PM) → remaining hours 0, every movable task is "can't finish" without calling the AI (Task 3 test).
3. **Next shift has no one with the role or room** → task goes back to Available tasks as Hand-over, not overloaded onto someone (Task 4 test with `requireRoom`).
4. **Parent task sitting in a column** (PM-placed or legacy) → not counted in hours, not moved, not offered (Task 1 tests).
5. **AI lists a started or unknown task as "can't finish"** → ignored; only unstarted labels are allowed by the schema and the parser (Task 3 test).

---

### Task 1: Parent tasks are never queue work

**Files:**
- Modify: `src/services/autoQueue/rules.ts` (`BoardItem`, `isMaWorkItem`, new `isParentTask`)
- Modify: `src/controllers/taskMap.controller.ts:443` (`prisma.task.findMany` `include` in `getTaskMapData`)
- Test: `test/autoQueue.rules.test.ts`

**Interfaces:**
- Produces: `isParentTask(item: BoardItem): boolean`; `BoardItem` gains `subtaskCount?: number | null` and `subtasks?: Array<{ title?: string | null }> | null`. `isMaWorkItem` returns `false` for parents, so `orderPoolForQueue`, `computeMaLoads`, Distribute and every run exclude them.

- [ ] **Step 1: Write the failing tests**

```ts
test('parent task (has subtasks) is not MA work; normal task and subtask are', () => {
  assert.equal(isMaWorkItem(item({ subtaskCount: 2 })), false);
  assert.equal(isMaWorkItem(item({ subtaskCount: 0 })), true);
  assert.equal(isMaWorkItem(item({ id: 'subtask:s1', isSubtask: true, subtaskId: 's1' })), true);
});

test('parent with only completed subtasks is still a parent (count includes completed)', () => {
  assert.equal(isParentTask(item({ subtaskCount: 1, subtasks: [] })), true);
});

test('without a count, open non-audit subtasks decide; --audit subtasks are ignored', () => {
  assert.equal(isParentTask(item({ subtasks: [{ title: 'Build page' }] })), true);
  assert.equal(isParentTask(item({ subtasks: [{ title: 'Page --audit' }] })), false);
  assert.equal(isParentTask(item({})), false);
});

test('pool order drops parent tasks', () => {
  const ids = orderPoolForQueue([item({ id: 'parent', subtaskCount: 3 }), item({ id: 'plain' })]).map((t) => t.id);
  assert.deepEqual(ids, ['plain']);
});

test('a parent in a column adds no load', () => {
  const loads = computeMaLoads([item({ assigneeId: 'u1', subtaskCount: 2 })], ['u1']);
  assert.deepEqual(loads.get('u1'), { active: 0, queued: 0, hours: 0 });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx tsx --test test/autoQueue.rules.test.ts` → `isParentTask` is not exported.

- [ ] **Step 3: Implement**
  - `isParentTask`: `false` when `item.isSubtask`; else `subtaskCount > 0` when `subtaskCount` is a number; else any entry of `subtasks` whose title doesn't contain `--audit` (case-insensitive).
  - `isMaWorkItem`: return `false` first when `isParentTask(item)`.
  - Controller: add to the task `include`
    `_count: { select: { subtasks: { where: { NOT: { title: { contains: '--audit', mode: 'insensitive' } } } } } }`,
    and on the parent item pushed at `enrichedTasks.push({ ...task, ...` (around line 756) set `subtaskCount: task._count?.subtasks ?? 0`. Subtask items (line ~811) get no `subtaskCount`.

- [ ] **Step 4: Run, expect PASS** — `npx tsx --test test/autoQueue.rules.test.ts` and `npm test` (planner tests must still pass).

- [ ] **Step 5: Typecheck and commit** — `npx tsc --noEmit` → no errors.

```bash
git add src/services/autoQueue/rules.ts src/controllers/taskMap.controller.ts
git commit -m "Auto-queue: never queue parent tasks, only normal tasks and subtasks"
```

---

### Task 2: Shift groups and remaining hours

**Files:**
- Modify: `src/services/autoQueue/rules.ts`
- Test: `test/autoQueue.rules.test.ts`

**Interfaces:**
- Produces:
  - `type ShiftGroup = 'morning' | 'noon' | 'night'`
  - `ShiftWindow` gains `order?: number | null`
  - `shiftGroupOf(user: QueueUser, shifts: ShiftWindow[]): ShiftGroup | null` — rank of active shifts sorted by `order` (ties by start time): 0 morning, 1 noon, 2 night; user's group = lowest rank they're a member of; `null` if none.
  - `usersInGroup(users: QueueUser[], shifts: ShiftWindow[], group: ShiftGroup): QueueUser[]` — eligible (`isAutoQueueEligibleUser`) users in that group.
  - `remainingShiftHours(user: QueueUser, shifts: ShiftWindow[], minuteOfDay: number): number` — minutes of the user's shift union (same 48h line as `scheduledShiftHours`) at or after `minuteOfDay`, in hours.
  - `autoQueuedTo(item: BoardItem, botId: string): string | null` — moved here unchanged from `autoQueueService.ts` (service imports it from rules).

- [ ] **Step 1: Write the failing tests**

```ts
const amS = { shiftKey: 'AM', order: 1, startHour: 8, endHour: 12, memberIds: ['m', 'mn'], isActive: true };
const noonS = { shiftKey: 'PM_AFTERNOON', order: 2, startHour: 12, endHour: 18, endMinute: 30, memberIds: ['mn', 'n'], isActive: true };
const nightS = { shiftKey: 'PM_NIGHT', order: 3, startHour: 17, endHour: 2, memberIds: ['n2'], isActive: true };
const S = [nightS, amS, noonS]; // unsorted on purpose

test('group = earliest shift by order the user belongs to', () => {
  assert.equal(shiftGroupOf(user({ id: 'm' }), S), 'morning');
  assert.equal(shiftGroupOf(user({ id: 'mn' }), S), 'morning'); // AM + afternoon
  assert.equal(shiftGroupOf(user({ id: 'n' }), S), 'noon');
  assert.equal(shiftGroupOf(user({ id: 'n2', name: 'Night Person' }), S), 'night');
  assert.equal(shiftGroupOf(user({ id: 'x', name: 'Nobody' }), S), null);
});

test('remaining hours run to the end of the shift union', () => {
  assert.equal(remainingShiftHours(user({ id: 'mn' }), S, 13 * 60), 5.5);
  assert.equal(remainingShiftHours(user({ id: 'm' }), S, 13 * 60), 0);
  assert.equal(remainingShiftHours(user({ id: 'n' }), S, 17 * 60), 1.5);
  assert.equal(remainingShiftHours(user({ id: 'n2', name: 'Night Person' }), S, 17 * 60), 9);
});

test('usersInGroup drops ineligible users', () => {
  const users = [user({ id: 'm' }), user({ id: 'mn', roles: ['Project Manager'] })];
  assert.deepEqual(usersInGroup(users, S, 'morning').map((u) => u.id), ['m']);
});
```

- [ ] **Step 2: Run, expect FAIL** (`shiftGroupOf` not exported).
- [ ] **Step 3: Implement** the four functions above in `rules.ts`; move `autoQueuedTo` and update the import in `autoQueueService.ts`.
- [ ] **Step 4: Run, expect PASS** — `npm test`.
- [ ] **Step 5: Commit**

```bash
git add src/services/autoQueue/rules.ts src/services/autoQueue/autoQueueService.ts
git commit -m "Auto-queue: morning/noon/night shift groups and remaining shift hours"
```

---

### Task 3: Doable verdict (Ollama + rules fallback)

**Files:**
- Create: `src/services/autoQueue/ollamaDoable.ts`
- Create: `src/services/autoQueue/doable.ts`
- Test: `test/autoQueue.doable.test.ts`

**Interfaces:**
- Consumes: `BoardItem`, `itemHours`, `isBoardItemStarted`, `orderPoolForQueue` ordering rules from `rules.ts`; `OllamaConfig` from `ollamaPicker.ts`.
- Produces:
  - `ollamaDoable.ts`: `buildDoableRequest(remainingHours: number, items: BoardItem[], model: string)`, `parseDoableResponse(raw: string, items: BoardItem[]): DoableAnswer | null`, `judgeWithOllama(remainingHours, items, config): Promise<DoableAnswer | null>` where `DoableAnswer = { cannotFinishIds: string[]; reason: string }`.
  - `doable.ts`: `type JudgeFn = (remainingHours: number, items: BoardItem[]) => Promise<DoableAnswer | null>`;
    `rulesCannotFinish(items: BoardItem[], remainingHours: number, defaultHours: number): string[]`;
    `decideDoable(items: BoardItem[], remainingHours: number, opts: { judge?: JudgeFn; defaultHours: number }): Promise<{ cannotFinishIds: string[]; method: 'ai' | 'rules'; reason: string }>`.

Request shape: same conventions as `buildPickRequest` (system + user message, `stream: false`, `options.temperature: 0`, HTML stripped, description ≤ 600 chars). Items labelled `t1..tN`; started items are listed with `IN PROGRESS` and are **not** in the schema enum. Schema: `{ cannotFinish: { type: 'array', items: { type: 'string', enum: <unstarted labels> } }, reason: { type: 'string' } }`, both required. System prompt: the person has `<remainingHours>` hours left in their shift; in-progress work comes first; list the not-started tasks they realistically cannot finish today, judged from estimates, priority, due date and the description; reply JSON only.

- [ ] **Step 1: Write the failing tests**

```ts
const t = (id: string, over: Partial<BoardItem> = {}): BoardItem => ({ id, title: `Task ${id}`, status: 'PENDING', priority: 'MEDIUM', createdAt: '2026-11-01T00:00:00Z', ...over });
const started = t('s', { status: 'IN PROGRESS', estimatedHours: 2 });

test('request labels tasks, marks in-progress, and only allows unstarted labels', () => {
  const req = buildDoableRequest(3, [started, t('a'), t('b')], 'qwen2.5:3b');
  assert.deepEqual(req.format.properties.cannotFinish.items.enum, ['t2', 't3']);
  const user = req.messages.find((m) => m.role === 'user')!.content;
  assert.match(user, /t1: Task s.*IN PROGRESS/);
  assert.match(user, /3(\.0)?h left/);
  assert.doesNotMatch(user, /"id"|subtask:/);
});

test('parse maps labels back to ids and drops started/unknown labels', () => {
  const items = [started, t('a'), t('b')];
  assert.deepEqual(parseDoableResponse('{"cannotFinish":["t3","t1","t9"],"reason":"Too much"}', items), { cannotFinishIds: ['b'], reason: 'Too much' });
  assert.equal(parseDoableResponse('nope', items), null);
});

test('rules: in-progress first, then pool order, keep what fits, the rest cannot finish', () => {
  const items = [started, t('low', { estimatedHours: 1 }), t('urgent', { priority: 'URGENT', estimatedHours: 2 }), t('big', { estimatedHours: 4 })];
  assert.deepEqual(rulesCannotFinish(items, 4.5, 3), ['low', 'big']); // 2 (started) + 2 (urgent) = 4; low (1) would make 5
});

test('no time left: everything unstarted, AI not asked', async () => {
  let asked = false;
  const r = await decideDoable([started, t('a')], 0, { defaultHours: 3, judge: async () => { asked = true; return null; } });
  assert.deepEqual(r.cannotFinishIds, ['a']);
  assert.equal(r.method, 'rules');
  assert.equal(asked, false);
});

test('uses the AI answer; falls back to rules when it returns null or throws', async () => {
  const items = [t('a', { estimatedHours: 1 }), t('b', { estimatedHours: 1 })];
  assert.deepEqual((await decideDoable(items, 1, { defaultHours: 3, judge: async () => ({ cannotFinishIds: ['a'], reason: 'b is due today' }) })).cannotFinishIds, ['a']);
  const fb = await decideDoable(items, 1, { defaultHours: 3, judge: async () => { throw new Error('down'); } });
  assert.deepEqual([fb.method, fb.cannotFinishIds], ['rules', ['b']]);
});

test('no unstarted tasks: nothing to decide, AI not asked', async () => {
  const r = await decideDoable([started], 1, { defaultHours: 3, judge: async () => { throw new Error('should not be called'); } });
  assert.deepEqual(r.cannotFinishIds, []);
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx tsx --test test/autoQueue.doable.test.ts` → modules not found.
- [ ] **Step 3: Implement** both files. `rulesCannotFinish` keeps started items first (they consume hours but are never returned), then unstarted in `orderPoolForQueue` order, keeping each while the running total ≤ `remainingHours`; returns the ids of the rest. `judgeWithOllama` mirrors `pickWithOllama` (Basic auth, timeout, warn-and-return-null on any failure). `decideDoable` skips the judge when `remainingHours <= 0` or there are no unstarted items.
- [ ] **Step 4: Run, expect PASS** — `npx tsx --test test/autoQueue.doable.test.ts`.
- [ ] **Step 5: Commit**

```bash
git add src/services/autoQueue/ollamaDoable.ts src/services/autoQueue/doable.ts
git commit -m "Auto-queue: AI doable check with rules fallback"
```

---

### Task 4: Checkpoint planner (verdicts → handovers / returns / at-risk)

**Files:**
- Modify: `src/services/autoQueue/planner.ts`
- Test: `test/autoQueue.planner.test.ts`

**Interfaces:**
- Consumes: `shiftGroupOf`, `usersInGroup`, `remainingShiftHours`, `autoQueuedTo`, `getBoardItemOwnerId`, `isMaWorkItem`, `isBoardItemStarted` (Tasks 1–2); `decideDoable`, `JudgeFn` (Task 3).
- Produces:
  - `DailyPlanInput` gains `requireRoom?: boolean` — when true, a task that fits no one's free hours goes to `skipped` with reason `No one on the next shift has room` instead of to the least-full person.
  - `DailyPlanInput` gains `capacityHours?: (user: QueueUser) => number` — replaces `scheduledShiftHours` for each person's day length when set (users with capacity ≤ 0 are not candidates). The checkpoint passes `(u) => remainingShiftHours(u, shifts, minuteOfDay)`, so at 1 PM a 12:00–18:30 person has 5.5h of room, not 6.5h.
  - `Decision` gains `fromUserId?: string`.
  - `planCheckpoint(input: CheckpointPlanInput): Promise<CheckpointPlan>` with

```ts
export interface CheckpointPlanInput {
  boardItems: BoardItem[];
  users: QueueUser[];
  shifts: ShiftWindow[];
  minuteOfDay: number;
  from: ShiftGroup;   // group being checked
  to: ShiftGroup;     // group receiving handovers
  botId: string;
  defaultHours?: number;
  judge?: JudgeFn;
  pick?: PickFn;
}
export interface CheckpointPlan {
  verdicts: Array<{ userId: string; userName: string; remainingHours: number; method: 'ai' | 'rules'; reason: string; cannotFinishIds: string[] }>;
  handovers: Decision[];                                          // fromUserId set
  returned: Array<{ taskId: string; taskTitle: string; fromUserId: string; reason: string }>;
  atRisk: Array<{ taskId: string; taskTitle: string; userId: string; reason: string }>; // PM-placed, not moved
}
```

Flow: for each user in `usersInGroup(users, shifts, from)`, their items = `isMaWorkItem` items with `getBoardItemOwnerId === user.id`; `decideDoable(items, remainingShiftHours(...))`; each can't-finish id that is unstarted and `autoQueuedTo(item, botId) === user.id` is a handover candidate, otherwise `atRisk`. Then `planDailyDistribution({ pool: candidates, boardItems: boardItems without candidates, users: usersInGroup(users, shifts, to), shifts, defaultHours, pick, requireRoom: true, capacityHours })`; its decisions become `handovers` (with `fromUserId`), its `skipped` become `returned`.

- [ ] **Step 1: Write the failing tests** (reuse `ma`, `poolTask`, `queuedFor` helpers; add a bot-queued helper)

```ts
const BOT = 'bot';
const botQueued = (userId: string, id: string, over: Partial<BoardItem> = {}): BoardItem => ({
  id, title: id, status: 'PENDING', createdAt: '2026-11-01T00:00:00Z', list: { name: 'Acme' },
  taskMap: { pmReviews: [{ type: 'PM_ASSIGNMENT', assignedTo: userId, assignedBy: BOT, mode: 'QUEUE' }] }, ...over,
});
const am1 = { shiftKey: 'AM', order: 1, startHour: 8, endHour: 12, memberIds: ['maria'], isActive: true };
const noon1 = { shiftKey: 'PM_AFTERNOON', order: 2, startHour: 12, endHour: 18, endMinute: 30, memberIds: ['jun', 'bea'], isActive: true };
const cp = (over: Partial<CheckpointPlanInput> = {}) => planCheckpoint({
  boardItems: [], users: [ma('maria', 'Maria'), ma('jun', 'Jun'), ma('bea', 'Bea')], shifts: [am1, noon1],
  minuteOfDay: 13 * 60, from: 'morning', to: 'noon', botId: BOT, ...over,
});

test('1 PM: morning MA past shift end hands bot-queued work to noon, least-full first', async () => {
  const plan = await cp({ boardItems: [botQueued('maria', 'a', { estimatedHours: 2 }), queuedFor('jun', 'j1')] });
  assert.deepEqual(plan.handovers.map((d) => [d.taskId, d.fromUserId, d.userId]), [['a', 'maria', 'bea']]);
});

test('started and PM-placed tasks never move; PM-placed ones are at risk', async () => {
  const plan = await cp({ boardItems: [
    botQueued('maria', 'started', { status: 'IN PROGRESS' }),
    queuedFor('maria', 'pm-placed'),
  ] });
  assert.equal(plan.handovers.length, 0);
  assert.deepEqual(plan.atRisk.map((r) => r.taskId), ['pm-placed']);
});

test('role task with nobody on the next shift holding the role goes back to the pool', async () => {
  const plan = await cp({ boardItems: [botQueued('maria', 'vid', { assigneeRoleRestrictions: ['Video Editor'] })] });
  assert.deepEqual(plan.returned.map((r) => r.taskId), ['vid']);
});

test('next shift has no room: returned, not overloaded', async () => {
  const full = [queuedFor('jun', 'j', 'X'), queuedFor('bea', 'b', 'X')].map((i) => ({ ...i, estimatedHours: 6.5 }));
  const plan = await cp({ boardItems: [...full, botQueued('maria', 'a', { estimatedHours: 2 })] });
  assert.deepEqual([plan.handovers.length, plan.returned.map((r) => r.taskId)], [0, ['a']]);
});

test('work that fits stays; AI verdict is used when given', async () => {
  const mn = { ...am1, memberIds: ['maria'] };
  const plan = await cp({
    shifts: [mn, { ...noon1, memberIds: ['jun', 'bea', 'maria'] }], // maria 8:00-18:30 -> 5.5h left
    boardItems: [botQueued('maria', 'a', { estimatedHours: 1 }), botQueued('maria', 'b', { estimatedHours: 1 })],
    judge: async () => ({ cannotFinishIds: ['b'], reason: 'b needs client input first' }),
  });
  assert.deepEqual(plan.handovers.map((d) => d.taskId), ['b']);
  assert.equal(plan.verdicts[0].method, 'ai');
});

test('next-shift room is counted from the hours they have left, not their whole day', async () => {
  // jun holds 4h; noon is 12:00-18:30, so at 13:00 he has 5.5h left -> 1.5h free; a 2h task doesn't fit
  const plan = await cp({
    users: [ma('maria', 'Maria'), ma('jun', 'Jun')],
    shifts: [am1, { ...noon1, memberIds: ['jun'] }],
    boardItems: [{ ...queuedFor('jun', 'j', 'X'), estimatedHours: 4 }, botQueued('maria', 'a', { estimatedHours: 2 })],
  });
  assert.deepEqual(plan.returned.map((r) => r.taskId), ['a']);
});

test('parent tasks in a column are ignored by the check', async () => {
  const plan = await cp({ boardItems: [botQueued('maria', 'parent', { subtaskCount: 2 })] });
  assert.deepEqual([plan.handovers.length, plan.returned.length, plan.atRisk.length], [0, 0, 0]);
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx tsx --test test/autoQueue.planner.test.ts` → `planCheckpoint` not exported.
- [ ] **Step 3: Implement** `requireRoom` in `planDailyDistribution` and `planCheckpoint` in `planner.ts`. Rules-fallback reason for handovers: `Can't finish by end of shift; lightest day on the next shift`.
- [ ] **Step 4: Run, expect PASS** — `npm test` (existing 5 AM tests unchanged).
- [ ] **Step 5: Commit**

```bash
git add src/services/autoQueue/planner.ts
git commit -m "Auto-queue: checkpoint planner for doable check and next-shift handover"
```

---

### Task 5: 5 AM fills the morning group only; 5 PM fill for the night group

**Files:**
- Modify: `src/services/autoQueue/autoQueueService.ts` (`runDailyAutoQueue`, `loadPeople`)
- Test: `test/autoQueue.planner.test.ts`

**Interfaces:**
- Consumes: `usersInGroup` (Task 2).
- Produces: `runGroupDistribution(group: ShiftGroup, label: '5am' | '5pm', opts?: { modeOverride?: AutoQueueMode }): Promise<DailyResult>` (internal, not wrapped in `exclusive`); `runDailyAutoQueue(opts)` = `exclusive('5 AM plan', () => runGroupDistribution('morning', '5am', opts))`.

- [ ] **Step 1: Write the failing test** — pins that capacity still uses the person's whole day while only the group is a candidate:

```ts
test('group distribution: only morning people receive, sized by their whole day', async () => {
  const S = [{ ...am, order: 1, memberIds: ['bea', 'maria'] }, { ...day, order: 2, memberIds: ['maria', 'jun'] }];
  const users = [ma('maria', 'Maria'), ma('jun', 'Jun'), ma('bea', 'Bea')];
  const { decisions, summary } = await planDailyDistribution({ pool: [poolTask('a'), poolTask('b')], boardItems: [], users: usersInGroup(users, S, 'morning'), shifts: S });
  assert.ok(decisions.every((d) => d.userId !== 'jun'));
  assert.equal(summary.find((s) => s.userName === 'Maria')!.shiftHours, 8);
});
```

- [ ] **Step 2: Run, expect PASS or FAIL** — it exercises Task 2's `usersInGroup` with the existing planner; it fails only if `order` isn't carried through. Fix in Step 3 if so.
- [ ] **Step 3: Implement** `loadPeople` selects `order` on shifts (already whole row); `runGroupDistribution` passes `usersInGroup(users, shifts, group)` to `planDailyDistribution` and labels logs/audit with `label`; `runDailyAutoQueue` delegates as above. Distribute keeps using all scheduled users (unchanged).
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit` → PASS, no errors.
- [ ] **Step 5: Commit**

```bash
git add src/services/autoQueue/autoQueueService.ts
git commit -m "Auto-queue: 5 AM run fills only the morning shift"
```

---

### Task 6: Apply checkpoints (1 PM / 5 PM run)

**Files:**
- Modify: `src/services/autoQueue/autoQueueService.ts`
- Test: `test/autoQueue.planner.test.ts` (pure helper only)

**Interfaces:**
- Consumes: `planCheckpoint` (Task 4), `runGroupDistribution` (Task 5), `judgeWithOllama` (Task 3), existing `applyDecisions`, `getCurrentOwnerId`, `invokeHandler`.
- Produces:
  - `isStillMovable(fresh: { ownerId: string | null | undefined; status?: string | null }, expectedOwnerId: string): boolean` (exported from `rules.ts`): owner unchanged and status not `IN PROGRESS` (normalised like `norm`).
  - `runCheckpoint(kind: '1pm' | '5pm', opts?: { modeOverride?: AutoQueueMode }): Promise<CheckpointResult>`, wrapped in `exclusive(\`${kind} checkpoint\`)`.

```ts
export interface CheckpointResult {
  mode: AutoQueueMode;
  skipped?: string;
  verdicts: CheckpointPlan['verdicts'];
  handovers: AppliedDecision[];
  returned: Array<CheckpointPlan['returned'][number] & { applied: boolean; error?: string }>;
  atRisk: CheckpointPlan['atRisk'];
  nightFill?: DailyResult;   // 5 PM only
}
```

Behaviour:
- `'1pm'`: `from: 'morning', to: 'noon'`; `'5pm'`: `from: 'noon', to: 'night'`, then reload the board and `runGroupDistribution('night', '5pm')` inside the same lock.
- Before each move, read fresh owner (`getCurrentOwnerId`) and status (`task.status` / `subtask.status`); skip with error `Changed or started meanwhile` unless `isStillMovable`.
- Handovers: `applyDecisions` with `expectedOwner: (item) => fromUserId`, label = kind; audit details add `action: 'handover'`, `fromUserId`.
- Returns: `invokeHandler(updateTaskStatuses, { params: { id }, body: { statuses: ['Hand-over'] }, user: bot })` (export `updateTaskStatuses` from `taskMapHandlers()`); audit `action: 'returned'`.
- Each handover/return adds a `taskComment` on the task (parent task id for subtasks), `userId: bot.id`, content: `**AI PM** (${kind}): moved to ${toName \|\| 'Available tasks'} — ${reason}`.
- `atRisk` and every verdict are logged (`logger.info`) and returned; nothing is written for them.
- `dry_run`: log every verdict, handover and return; write nothing.

- [ ] **Step 1: Write the failing test**

```ts
test('isStillMovable: same owner and not started', () => {
  assert.equal(isStillMovable({ ownerId: 'maria', status: 'PENDING' }, 'maria'), true);
  assert.equal(isStillMovable({ ownerId: 'maria', status: 'In Progress' }, 'maria'), false);
  assert.equal(isStillMovable({ ownerId: 'jun', status: 'PENDING' }, 'maria'), false);
  assert.equal(isStillMovable({ ownerId: undefined }, 'maria'), false);
});
```

- [ ] **Step 2: Run, expect FAIL** (`isStillMovable` not exported).
- [ ] **Step 3: Implement** `isStillMovable` in `rules.ts`, then `runCheckpoint` in the service.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` → PASS, no errors.
- [ ] **Step 5: Commit**

```bash
git add src/services/autoQueue/rules.ts src/services/autoQueue/autoQueueService.ts
git commit -m "Auto-queue: 1 PM and 5 PM checkpoint runs with handover and return to pool"
```

---

### Task 7: Schedule 5 AM / 1 PM / 5 PM, retire the 5-minute top-up, preview

**Files:**
- Modify: `src/workers/autoQueue.worker.ts`
- Modify: `src/server.ts` (auto-queue block added on this branch, ~line 123)
- Modify: `src/controllers/autoQueue.controller.ts` (`previewAutoQueueHandler`)

**Interfaces:**
- Consumes: `runCheckpoint` (Task 6), `runDailyAutoQueue`.
- Produces: job names `AUTO_QUEUE_1PM_JOB = 'taskMapAutoQueue1pm'`, `AUTO_QUEUE_5PM_JOB = 'taskMapAutoQueue5pm'`; preview `?kind=1pm|5pm` runs `runCheckpoint(kind, { modeOverride: 'dry_run' })`.

- [ ] **Step 1: Worker** — handle the two new job names by calling `runCheckpoint('1pm' | '5pm')` and returning counts `{ mode, skipped, handedOver, returned, atRisk, nightQueued }`. Keep `AUTO_QUEUE_JOB` exported (used for cleanup) but no longer handled beyond a no-op return.
- [ ] **Step 2: server.ts** — remove the `AUTO_QUEUE_JOB` `queue.add`; before adding jobs, remove any stale top-up repeatable:

```ts
for (const job of await autoQueueQueue.getRepeatableJobs()) {
  if (job.name === AUTO_QUEUE_JOB) await autoQueueQueue.removeRepeatableByKey(job.key);
}
```

  Add `AUTO_QUEUE_1PM_JOB` (`pattern: '0 13 * * *'`, `jobId: 'task-map-auto-queue-1pm'`) and `AUTO_QUEUE_5PM_JOB` (`pattern: '0 17 * * *'`, `jobId: 'task-map-auto-queue-5pm'`), both `tz: 'Asia/Manila'`, `attempts: 5`, `backoff: { type: 'fixed', delay: 2 * 60 * 1000 }` like the 5 AM job. Update the comment above the block.
- [ ] **Step 3: Preview** — add `1pm` / `5pm` kinds; drop `topup`. Update the JSDoc to `kind=daily|1pm|5pm|distribute`.
- [ ] **Step 4: Verify** — `npx tsc --noEmit` → no errors; `npm test` → PASS. Start the server (`npm run dev`) with `AUTO_QUEUE_MODE=dry_run`, then as a PM call `POST /api/task-map/auto-queue/preview?kind=1pm` and `?kind=5pm`; expect `success: true` with `verdicts`, `handovers`, `returned`, `atRisk` arrays and log lines `[AutoQueue][1pm][dry-run] ...`. Confirm in Redis (`getRepeatableJobs`) that only the 5am, 1pm and 5pm auto-queue jobs remain.
- [ ] **Step 5: Commit**

```bash
git add src/workers/autoQueue.worker.ts src/server.ts src/controllers/autoQueue.controller.ts
git commit -m "Auto-queue: schedule 5 AM / 1 PM / 5 PM runs, retire 5-minute top-up"
```

---

### Task 8: Commit the design and plan docs

- [ ] **Step 1: Commit**

```bash
git add docs/superpowers/specs/2026-11-25-ai-pm-shift-checkpoints-design.md docs/superpowers/plans/2026-11-25-ai-pm-shift-checkpoints.md
git commit -m "Docs: AI PM shift checkpoints design and plan"
```
