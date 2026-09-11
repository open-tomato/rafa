/**
 * End-to-end test for the effort pipeline: collect, then report.
 *
 * The effort stack's seven modules each have a colocated suite
 * driving their own seam, and between them every function here is
 * already covered.
 * What none of them drives is the JOIN — a row the COLLECTOR wrote,
 * serialised to the store, read back by the REPORT. Both sides are
 * tested against hand-built fixtures of their own, and a hand-built
 * fixture cannot report a disagreement between the two: the report's
 * suite plants rows with `node:fs` and the collector's suite never
 * opens a report. So the claims this file owns are the ones that are
 * only true of the two halves together.
 *
 *   - The store the collector WRITES is the store the report READS.
 *     A path that drifted apart leaves both colocated suites green
 *     and every report empty.
 *   - A log's `gitBranch` reaches a report GROUP KEY. That chain runs
 *     through four modules — the record fold, the dominant-branch
 *     histogram, the plan-stub resolution and the accumulator's key —
 *     and each is pinned in isolation against a fixture that assumes
 *     the previous step's output shape.
 *   - The commit rows do not reach the session report. Two stores,
 *     two key projections, one directory; the report reads sessions
 *     alone, and one folding the commit rows in would still look
 *     entirely plausible.
 *   - The counters a log carries survive to the report's columns. The
 *     planted per-turn usage gives every column a DISTINCT DECIMAL
 *     MAGNITUDE (input 100, output 10, cache-write 1,000, cache-read
 *     10,000), so any column folded into another changes a number
 *     rather than landing on a coincidence.
 *
 * ## The fixture is a table, and the expectations are derived from it
 *
 * {@link SESSIONS} declares nine loose logs with the kind, the group
 * and the turns each should produce. Every count asserted below is
 * computed from that table rather than typed as a literal, so the two
 * paths stay independent: the expectation is a fold over the fixture
 * declaration and the actual is a fold over the written logs through
 * the whole stack. Editing the table moves both, which is what keeps
 * a later case from being quietly re-pointed at whatever the code now
 * does.
 *
 * The prompt literals come from {@link PROMPT_SHAPES} rather than
 * being transcribed. Nothing here is testing the classifier — that
 * file carries its own drift guard against the source injecting each
 * prompt — and a transcribed prefix would silently re-bucket every
 * planted session as `other` the day one of those literals moved.
 *
 * ## What the second run's zero rests on
 *
 * A second collect appending zero rows is a ZERO-HIT reading, and a
 * collector that had stopped collecting entirely answers it just as
 * well. The liveness control is the third case in that block: a log
 * arriving BETWEEN the runs must be picked up and must move the
 * report's totals by exactly its own turns. Without it the zero says
 * nothing in either direction.
 *
 * ## What this file deliberately does not drive
 *
 * The two command entries (`collect(args)` and `report(args)`) resolve
 * their repo root through git and their log directory from the home
 * directory, so driving them would read this machine's real session
 * logs and write into the real `.ralph/`. Their argv is covered
 * purely in the colocated suites; everything here goes through
 * {@link collectEffort} and {@link buildReport} with the root, the log
 * directory and the commit reader all injected.
 *
 * The `ci-repair` prompt shape has no live session anywhere in the
 * tree — it is newer than every log there — so its only evidence
 * against the source remains the drift guard in `classify.test.ts`.
 * It is planted here because a fixture is free to hold what the tree
 * does not, and because the kind accounting below is a fold over the
 * kinds the classifier declares rather than over the ones observed.
 *
 * Twenty-one module mutations were driven against this file, across
 * six of the stack's seven modules, and EIGHTEEN reddened at least
 * one case, with the restored modules green either side and
 * byte-identical: making either store key projection a constant,
 * recursing the log walk into the subagent directory, attributing a
 * row without its enqueue content, never reading the plan roster,
 * never skipping an already-stored log, pointing the report at the
 * commit store, giving both halves one store file, grouping on the
 * branch before the plan, ignoring the kind filter, ignoring the
 * entrypoint filter, merging the effort histogram into the model one,
 * never reading the `effort` field, summing input tokens from output
 * tokens, taking the first timestamp as the latest, refusing a queue
 * id a plan, taking the dominant branch as the last one seen, and
 * classifying every prompt as `other`.
 *
 * THREE stayed green and are named rather than dropped, because each
 * is a property of this fixture rather than a hole in the suite.
 * Breaking `dominantEntrypoint`'s tie rule changes nothing here: every
 * planted session carries ONE entrypoint, so there is no tie to break.
 * Counting a spanless session as zero minutes changes nothing either:
 * every planted record carries a parseable timestamp, so a
 * single-turn session has a span of zero rather than none, and only a
 * planted ROW can be spanless — which is what the report's own suite
 * drives. And making the STORE's append stop skipping a key it
 * already holds is invisible from here, because the collector's own
 * selection has already emptied the batch by then: the two layers are
 * belt and braces and only the outer one fires. That is exactly what
 * `skippedOnAppend` is asserted at zero for — it is the reading that
 * says the set the collector skips by and the set the store dedupes
 * by agree, and the leg that DOES bite it is the selection one above.
 */
import type { SessionKind } from '../effort/classify.js';
import type { CollectOptions } from '../effort/collect.js';
import type { CommitLogParseResult, CommitStats } from '../effort/commits.js';
import type { EffortGroup, EffortReport } from '../effort/report.js';

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PROMPT_SHAPES } from '../effort/classify.js';
import { collectEffort } from '../effort/collect.js';
import {
  SESSION_KINDS,
  buildReport,
  formatReport,
} from '../effort/report.js';
import { readStoreRows } from '../effort/store.js';

/** Per-turn usage. One distinct decimal magnitude per column. */
const TURN_INPUT = 100;
const TURN_OUTPUT = 10;
const TURN_CACHE_WRITE = 1_000;
const TURN_CACHE_READ = 10_000;

/** What one planted turn adds to a group's `totalTokens`. */
const TURN_TOTAL = TURN_INPUT
  + TURN_OUTPUT
  + TURN_CACHE_WRITE
  + TURN_CACHE_READ;

/** Sits on every prompt's SECOND line. No store row may carry it. */
const PROMPT_BODY = 'this-body-must-not-reach-the-store';

/** The prompt for the one session the loop did not dispatch. */
const DESKTOP_PROMPT = 'A question typed into the desktop app.';

/** Entrypoints: the loop's own, and everything else sharing the tree. */
const SDK = 'sdk-cli';
const DESKTOP = 'claude-desktop';

/** Models, so a filtered histogram and an unfiltered one differ. */
const OPUS = 'claude-opus-5';
const FABLE = 'claude-fable-5';

/** Branches the planted records carry. */
const Q19_BRANCH = 'feat/q19-loop-economics';
const Q03_BRANCH = 'feat/q03-port-phase-3';
const NO_PLAN_BRANCH = 'chore/no-plan-here';
const MAIN_BRANCH = 'main';

/** Plan stubs. The q03 pair matches on its queue id alone. */
const Q19_PLAN = 'q19-loop-economics';
const Q03_PLAN = 'q03-port-phase-three';

/**
 * The plan directory's listing.
 *
 * Four files, two stubs: the tracker and the prerequisites siblings
 * share the directory in a real `.plans/` and must not be read as
 * plans, so `planStubCount` below is a reading rather than a count of
 * the files planted.
 */
const PLAN_FILES: readonly string[] = [
  `PLAN-${Q19_PLAN}.md`,
  `PLAN-${Q03_PLAN}.md`,
  `PLAN_TRACKER-${Q19_PLAN}.md`,
  `PREREQUISITES-${Q19_PLAN}.md`,
];

/** One planted assistant turn. */
interface TurnSpec {
  branch: string;
  stamp: string;
  /** Omitted where nothing declared one, as a desktop turn does. */
  effort?: string;
}

/** One planted session log, and what the pipeline should make of it. */
interface SessionSpec {
  id: string;
  /** The kind its prompt should classify as. */
  kind: SessionKind;
  /** The report group its turns should land in. */
  group: string;
  /** The dispatched sentence, for a task session alone. */
  taskText: string | null;
  entrypoint: string;
  model: string;
  turns: readonly TurnSpec[];
}

/** One of the fixture day's instants. */
function at(time: string): string {
  return `2026-09-08T${time}:00.000Z`;
}

/**
 * The nine loose logs, with every expectation this file derives.
 *
 * `s-task-e` is the session that outlived a checkout: its records
 * name two branches and the dominant one decides its group. It is
 * also the desktop-driven TASK session, which is what keeps the kind
 * filter and the entrypoint filter independent — a fixture where the
 * two removed the same rows would pass with either one dropped.
 *
 * Its MINORITY branch is planted LAST on purpose. Object key order is
 * insertion order, so with the majority branch last a dominance rule
 * that simply took the final key seen would still answer correctly,
 * and the leg driving that rule would be a silent no-op — measured,
 * exactly that way round.
 */
const SESSIONS: readonly SessionSpec[] = [
  {
    id: 's-task-a',
    kind: 'task',
    group: Q19_PLAN,
    taskText: 'Add the streaming session reader',
    entrypoint: SDK,
    model: OPUS,
    turns: [
      { branch: Q19_BRANCH, stamp: at('10:00'), effort: 'xhigh' },
      { branch: Q19_BRANCH, stamp: at('10:30'), effort: 'xhigh' },
    ],
  },
  {
    id: 's-task-b',
    kind: 'task',
    group: Q19_PLAN,
    taskText: 'Add the append-only store',
    entrypoint: SDK,
    model: OPUS,
    turns: [
      { branch: Q19_BRANCH, stamp: at('10:20'), effort: 'xhigh' },
      { branch: Q19_BRANCH, stamp: at('10:50'), effort: 'low' },
    ],
  },
  {
    id: 's-task-c',
    kind: 'task',
    group: Q03_PLAN,
    taskText: 'Port the third phase',
    entrypoint: SDK,
    model: OPUS,
    turns: [{ branch: Q03_BRANCH, stamp: at('11:00'), effort: 'xhigh' }],
  },
  {
    id: 's-task-d',
    kind: 'task',
    group: NO_PLAN_BRANCH,
    taskText: 'Track the implementer agent',
    entrypoint: SDK,
    model: OPUS,
    turns: [{ branch: NO_PLAN_BRANCH, stamp: at('12:00'), effort: 'xhigh' }],
  },
  {
    id: 's-task-e',
    kind: 'task',
    group: Q19_PLAN,
    taskText: 'Re-run one task by hand',
    entrypoint: DESKTOP,
    model: FABLE,
    turns: [
      { branch: Q19_BRANCH, stamp: at('13:00') },
      { branch: Q19_BRANCH, stamp: at('13:05') },
      { branch: MAIN_BRANCH, stamp: at('13:10') },
    ],
  },
  {
    id: 's-plan',
    kind: 'plan-generation',
    group: Q19_PLAN,
    taskText: null,
    entrypoint: SDK,
    model: OPUS,
    turns: [{ branch: Q19_BRANCH, stamp: at('09:00'), effort: 'xhigh' }],
  },
  {
    id: 's-wrap',
    kind: 'wrap-up',
    group: Q19_PLAN,
    taskText: null,
    entrypoint: SDK,
    model: OPUS,
    turns: [{ branch: Q19_BRANCH, stamp: at('14:00'), effort: 'xhigh' }],
  },
  {
    id: 's-ci',
    kind: 'ci-repair',
    group: Q19_PLAN,
    taskText: null,
    entrypoint: SDK,
    model: OPUS,
    turns: [{ branch: Q19_BRANCH, stamp: at('15:00'), effort: 'xhigh' }],
  },
  {
    id: 's-other',
    kind: 'other',
    group: MAIN_BRANCH,
    taskText: null,
    entrypoint: DESKTOP,
    model: FABLE,
    turns: [{ branch: MAIN_BRANCH, stamp: at('16:00') }],
  },
];

/** The log that arrives between two runs, as the zero's live control. */
const LATE_SESSION: SessionSpec = {
  id: 's-task-late',
  kind: 'task',
  group: Q19_PLAN,
  taskText: 'Add the pipeline test',
  entrypoint: SDK,
  model: OPUS,
  turns: [
    { branch: Q19_BRANCH, stamp: at('17:00'), effort: 'xhigh' },
    { branch: Q19_BRANCH, stamp: at('17:20'), effort: 'xhigh' },
  ],
};

/** Turns the subagent transcript holds; none may reach a report. */
const SUBAGENT_TURNS = 4;

/** Temporary directories to remove once each case is done. */
const scratch: string[] = [];

afterEach(() => {
  while (scratch.length > 0) {
    const dir = scratch.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/** The prompt content one spec's session is dispatched with. */
function promptOf(spec: SessionSpec): string {
  if (spec.kind === 'other') return `${DESKTOP_PROMPT}\n${PROMPT_BODY}`;

  const kind = spec.kind;
  const shape = PROMPT_SHAPES.find((candidate) => candidate.kind === kind);
  if (shape === undefined) {
    throw new Error(`no prompt shape declares the kind ${spec.kind}`);
  }
  const tail = spec.taskText ?? 'the plan';
  const first = `${shape.prefix}${tail}${shape.firstLineInfix ?? ''}`;
  return `${first}\n${PROMPT_BODY}`;
}

/** The enqueue record a session's prompt arrives on. */
function enqueue(content: string): string {
  return JSON.stringify({
    type: 'queue-operation',
    operation: 'enqueue',
    content,
  });
}

/** One billable turn, carrying the fixture's per-column magnitudes. */
function assistantTurn(spec: SessionSpec, turn: TurnSpec): string {
  const effort = turn.effort;
  return JSON.stringify({
    type: 'assistant',
    timestamp: turn.stamp,
    gitBranch: turn.branch,
    entrypoint: spec.entrypoint,
    isSidechain: false,
    ...(effort === undefined
      ? {}
      : { effort }),
    message: {
      model: spec.model,
      usage: {
        input_tokens: TURN_INPUT,
        output_tokens: TURN_OUTPUT,
        cache_creation_input_tokens: TURN_CACHE_WRITE,
        cache_read_input_tokens: TURN_CACHE_READ,
        cache_creation: {
          ephemeral_1h_input_tokens: TURN_CACHE_WRITE,
          ephemeral_5m_input_tokens: 0,
        },
      },
    },
  });
}

/** Writes one session log into the log directory. */
function writeSession(logDir: string, spec: SessionSpec): void {
  const turns = spec.turns.map((turn) => assistantTurn(spec, turn));
  const lines = [enqueue(promptOf(spec)), ...turns];
  const path = join(logDir, `${spec.id}.jsonl`);
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
}

/**
 * Plants a subagent transcript one level down.
 *
 * The population is depth-defined: a walk that recursed would fold
 * these turns into the loop's own totals, double-counting spend
 * already billed to the parent session. The turns are on a branch the
 * report groups, so folding them in would move a number rather than
 * add a bucket nobody reads.
 */
function writeSubagentTranscript(logDir: string): void {
  const dir = join(logDir, 's-task-a', 'subagents');
  mkdirSync(dir, { recursive: true });

  const parent = SESSIONS[0];
  if (parent === undefined) throw new Error('the fixture has no sessions');

  const lines: string[] = [];
  for (let index = 0; index < SUBAGENT_TURNS; index += 1) {
    lines.push(assistantTurn(parent, {
      branch: Q19_BRANCH,
      stamp: at(`18:0${index}`),
      effort: 'xhigh',
    }));
  }
  writeFileSync(join(dir, 'agent-1.jsonl'), `${lines.join('\n')}\n`, 'utf8');
}

/** A planted repo root with a log directory and a plan roster. */
interface Fixture {
  root: string;
  logDir: string;
  plansDir: string;
}

/** Plants the whole fixture tree under a fresh temporary root. */
function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'ralph-pipeline-'));
  scratch.push(root);

  const logDir = join(root, 'logs');
  const plansDir = join(root, '.plans');
  mkdirSync(logDir);
  mkdirSync(plansDir);

  for (const name of PLAN_FILES) {
    writeFileSync(join(plansDir, name), '# a plan\n', 'utf8');
  }
  for (const spec of SESSIONS) writeSession(logDir, spec);
  writeSubagentTranscript(logDir);
  return { root, logDir, plansDir };
}

/** Commit shas the planted reader answers. */
const COMMIT_SHAS: readonly string[] = ['a'.repeat(40), 'b'.repeat(40)];

/** A commit row carrying what the store's key projection reads. */
function commitRow(sha: string, index: number): CommitStats {
  return {
    sha,
    timestamp: at(`0${index}:00`),
    subject: `subject ${index}`,
    author: 'A Dev',
    branch: null,
    filesChanged: 1,
    insertions: 2,
    deletions: 3,
    parentCount: 1,
    minutesSincePrevious: null,
  };
}

/** The commit reader seam, so no case shells out to git. */
function plantedCommits(): () => CommitLogParseResult {
  return () => ({
    rows: COMMIT_SHAS.map((sha, index) => commitRow(sha, index)),
    lineCount: COMMIT_SHAS.length,
    unparsedLineCount: 0,
  });
}

/** Everything a collect run needs, with nothing resolved from git. */
function optionsFor(fixture: Fixture): CollectOptions {
  return {
    repoRoot: fixture.root,
    logDir: fixture.logDir,
    plansDir: fixture.plansDir,
    readCommits: plantedCommits(),
    log: () => undefined,
  };
}

/** Sessions the fixture plants matching a predicate. */
function plantedSessions(
  match: (spec: SessionSpec) => boolean,
): SessionSpec[] {
  return SESSIONS.filter(match);
}

/** Turns the fixture plants across the sessions a predicate keeps. */
function plantedTurns(match: (spec: SessionSpec) => boolean): number {
  const kept = plantedSessions(match);
  return kept.reduce((total, spec) => total + spec.turns.length, 0);
}

/** The loop's own traffic: a dispatched task under the loop's CLI. */
function isLoopTask(spec: SessionSpec): boolean {
  return spec.kind === 'task' && spec.entrypoint === SDK;
}

/** One named group, or a throw naming what was missing. */
function groupFor(report: EffortReport, key: string): EffortGroup {
  const group = report.groups.find((candidate) => candidate.key === key);
  if (group === undefined) {
    throw new Error(`the report holds no group named ${key}`);
  }
  return group;
}

describe('collect then report over a planted log tree', () => {
  it('stores one row per loose log', async () => {
    const fixture = makeFixture();

    const result = await collectEffort(optionsFor(fixture));

    expect(result.sessions?.candidates).toBe(SESSIONS.length);
    expect(result.sessions?.read).toBe(SESSIONS.length);
    expect(result.sessions?.appended).toBe(SESSIONS.length);
    expect(result.sessions?.failed).toBe(0);
    expect(result.sessions?.planStubCount).toBe(2);
  });

  it('files no row for a subagent transcript', async () => {
    const fixture = makeFixture();

    const result = await collectEffort(optionsFor(fixture));
    const stored = readStoreRows(result.sessions?.storePath ?? '');
    const ids = stored.rows.map((row) => (row as { sessionId: string })
      .sessionId);

    expect(ids.sort()).toEqual(SESSIONS.map((spec) => spec.id).sort());
    expect(ids).not.toContain('agent-1');
  });

  it('reports every stored session and no commit row', async () => {
    const fixture = makeFixture();
    const result = await collectEffort(optionsFor(fixture));

    const report = buildReport({ repoRoot: fixture.root });
    const commits = readStoreRows(result.commits?.storePath ?? '');

    expect(commits.rows).toHaveLength(COMMIT_SHAS.length);
    expect(report.rowsRead).toBe(SESSIONS.length);
    expect(report.totals.sessions).toBe(SESSIONS.length);
  });

  it('groups each session under the plan its logs name', async () => {
    const fixture = makeFixture();
    await collectEffort(optionsFor(fixture));

    const report = buildReport({ repoRoot: fixture.root });
    const q19 = groupFor(report, Q19_PLAN);
    const branch = groupFor(report, NO_PLAN_BRANCH);

    expect(q19.kind).toBe('plan');
    expect(q19.planStub).toBe(Q19_PLAN);
    expect(q19.sessions)
      .toBe(plantedSessions((s) => s.group === Q19_PLAN).length);
    expect(branch.kind).toBe('branch');
    expect(branch.planStub).toBeNull();
  });

  it('reaches a plan through the queue id alone', async () => {
    const fixture = makeFixture();
    await collectEffort(optionsFor(fixture));

    const report = buildReport({ repoRoot: fixture.root });
    const q03 = groupFor(report, Q03_PLAN);

    expect(q03.kind).toBe('plan');
    expect(q03.planStub).toBe(Q03_PLAN);
    expect(q03.sessions).toBe(1);
  });

  it('groups a session on the branch most of it ran on', async () => {
    // s-task-e names two branches; the dominant one decides, so its
    // turns land under the plan rather than under `main`.
    const fixture = makeFixture();
    await collectEffort(optionsFor(fixture));

    const report = buildReport({ repoRoot: fixture.root });

    expect(groupFor(report, MAIN_BRANCH).sessions).toBe(1);
    expect(groupFor(report, Q19_PLAN).assistantTurns)
      .toBe(plantedTurns((s) => s.group === Q19_PLAN));
  });

  it('sums the planted counters column for column', async () => {
    const fixture = makeFixture();
    await collectEffort(optionsFor(fixture));

    const report = buildReport({ repoRoot: fixture.root });
    const turns = plantedTurns(() => true);

    expect(report.totals.assistantTurns).toBe(turns);
    expect(report.totals.inputTokens).toBe(turns * TURN_INPUT);
    expect(report.totals.outputTokens).toBe(turns * TURN_OUTPUT);
    expect(report.totals.cacheWriteTokens).toBe(turns * TURN_CACHE_WRITE);
    expect(report.totals.cacheReadTokens).toBe(turns * TURN_CACHE_READ);
    expect(report.totals.totalTokens).toBe(turns * TURN_TOTAL);
  });

  it('takes both minute columns from the log timestamps', async () => {
    // Two overlapping sessions of half an hour each: sixty minutes of
    // work across a fifty-minute span. One figure reported twice
    // cannot produce both.
    const fixture = makeFixture();
    await collectEffort(optionsFor(fixture));

    const report = buildReport({
      repoRoot: fixture.root,
      kinds: ['task'],
      entrypoints: [SDK],
    });
    const q19 = groupFor(report, Q19_PLAN);

    expect(q19.workMinutes).toBe(60);
    expect(q19.spanMinutes).toBe(50);
    expect(q19.sessionsWithoutSpan).toBe(0);
  });

  it('narrows to the loop with both filters', async () => {
    const fixture = makeFixture();
    await collectEffort(optionsFor(fixture));

    const byKind = buildReport({ repoRoot: fixture.root, kinds: ['task'] });
    const byBoth = buildReport({
      repoRoot: fixture.root,
      kinds: ['task'],
      entrypoints: [SDK],
    });

    const tasks = plantedSessions((spec) => spec.kind === 'task').length;
    const loopTasks = plantedSessions(isLoopTask).length;

    expect(byKind.totals.sessions).toBe(tasks);
    expect(byBoth.totals.sessions).toBe(loopTasks);
    expect(byBoth.rowsExcluded).toBe(SESSIONS.length - loopTasks);
    expect(Object.keys(groupFor(byKind, Q19_PLAN).models).sort())
      .toEqual([FABLE, OPUS]);
    expect(Object.keys(groupFor(byBoth, Q19_PLAN).models)).toEqual([OPUS]);
  });

  it('records what each session actually ran at', async () => {
    const fixture = makeFixture();
    await collectEffort(optionsFor(fixture));

    const report = buildReport({
      repoRoot: fixture.root,
      kinds: ['task'],
      entrypoints: [SDK],
    });

    expect(groupFor(report, Q19_PLAN).efforts).toEqual({ xhigh: 3, low: 1 });
    // Every row this collector writes carries the field, so a session
    // where nothing declared one is an EMPTY histogram and not an
    // absent one. Only a store predating the field counts here.
    expect(report.totals.sessionsWithoutEffort).toBe(0);
  });

  it('keeps the prompt body out of the store', async () => {
    const fixture = makeFixture();

    const result = await collectEffort(optionsFor(fixture));
    const text = readFileSync(result.sessions?.storePath ?? '', 'utf8');

    // The dispatched sentence IS stored, deliberately; it is what
    // makes the needle below a reading rather than a dead one.
    expect(text).toContain(SESSIONS[0]?.taskText ?? 'no such text');
    expect(text).not.toContain(PROMPT_BODY);
  });

  it('accounts for every kind the classifier declares', async () => {
    const fixture = makeFixture();
    await collectEffort(optionsFor(fixture));

    const perKind = SESSION_KINDS.map((kind) => buildReport({
      repoRoot: fixture.root,
      kinds: [kind],
    }).totals.sessions);
    const total = perKind.reduce((sum, count) => sum + count, 0);

    expect(total).toBe(SESSIONS.length);
  });
});

describe('a second collect run', () => {
  it('appends no row at all', async () => {
    const fixture = makeFixture();
    const options = optionsFor(fixture);
    await collectEffort(options);

    const second = await collectEffort(options);

    expect(second.sessions?.candidates).toBe(SESSIONS.length);
    expect(second.sessions?.alreadyCollected).toBe(SESSIONS.length);
    expect(second.sessions?.read).toBe(0);
    expect(second.sessions?.appended).toBe(0);
    expect(second.sessions?.skippedOnAppend).toBe(0);
    expect(second.commits?.alreadyCollected).toBe(COMMIT_SHAS.length);
    expect(second.commits?.appended).toBe(0);
  });

  it('leaves the store bytes identical', async () => {
    const fixture = makeFixture();
    const options = optionsFor(fixture);
    const first = await collectEffort(options);
    const path = first.sessions?.storePath ?? '';
    const before = readFileSync(path, 'utf8');

    await collectEffort(options);

    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('renders a byte-identical report', async () => {
    const fixture = makeFixture();
    const options = optionsFor(fixture);
    await collectEffort(options);
    const before = formatReport(buildReport({ repoRoot: fixture.root }));

    await collectEffort(options);
    const after = formatReport(buildReport({ repoRoot: fixture.root }));

    // A byte-identical pair of EMPTY renders would be vacuous, so the
    // line count is held against the fixture: one header line, a
    // blank, the column row, one row per group and the total.
    const groups = new Set(SESSIONS.map((spec) => spec.group)).size;

    expect(after.join('\n')).toBe(before.join('\n'));
    expect(before).toHaveLength(groups + 4);
  });

  it('still collects a log that arrived between runs', async () => {
    // The liveness control for the three zeros above: a collector
    // that had stopped collecting answers them just as well.
    const fixture = makeFixture();
    const options = optionsFor(fixture);
    await collectEffort(options);
    const before = buildReport({ repoRoot: fixture.root });
    writeSession(fixture.logDir, LATE_SESSION);

    const third = await collectEffort(options);
    const after = buildReport({ repoRoot: fixture.root });
    const added = LATE_SESSION.turns.length;

    expect(third.sessions?.read).toBe(1);
    expect(third.sessions?.appended).toBe(1);
    expect(third.sessions?.alreadyCollected).toBe(SESSIONS.length);
    expect(after.rowsRead).toBe(before.rowsRead + 1);
    expect(after.totals.assistantTurns)
      .toBe(before.totals.assistantTurns + added);
    expect(after.totals.totalTokens)
      .toBe(before.totals.totalTokens + added * TURN_TOTAL);
    expect(groupFor(after, Q19_PLAN).sessions)
      .toBe(groupFor(before, Q19_PLAN).sessions + 1);
  });
});
