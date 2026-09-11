/**
 * One declared task, from the tracker line to the argument list.
 *
 * This is the JOIN no colocated suite can make. `utils/declaration.ts`
 * knows what a block resolves to and nothing about a prompt;
 * `utils/claude.ts` knows what an argument list looks like and nothing
 * about where its flags came from; `start.ts` is where the two meet,
 * and its `dispatchTask` is the only place that reads a block off a
 * task, builds the prompt from what is left and hands the flags on. So
 * every case here drives that one function through the REAL
 * `runClaude` and the REAL `claudeArgs`, with the process spawn as the
 * only stub — it has to be, the spawner being `Bun.spawn` and the root
 * suite running vitest under node.
 *
 * Two claims, and they fail in opposite directions. A block left on
 * the text is read by the session as part of the task, so the routing
 * gets DESCRIBED to an agent instead of applied to it. Flags that stop
 * short of the spawn leave the task running at the loop defaults while
 * the operator log and the record both say otherwise — the failure
 * nothing downstream can notice.
 *
 * ## The prompt claim is about the injected HEAD, not the whole prompt
 *
 * A prompt is the two injected lines plus `PROMPT.md` plus the WHOLE
 * plan file, and a plan carrying declared tasks carries their blocks
 * by construction. So `the prompt contains no brace block` is false of
 * the prompt and true of the line the loop wrote, and asserting it
 * over the whole string would need a fixture plan with no blocks in it
 * — a fixture that cannot tell a strip from a plan that never had one.
 *
 * Both halves are asserted instead. The head must equal
 * `Your scoped task is: ` plus the sentence, byte for byte, which is
 * the strip stated as an equality rather than as an absence. And the
 * block must appear in the prompt exactly as many times as the PLAN
 * carries it, which is one: a strip that failed leaves two, and the
 * count says so without any assumption about where the second one
 * sits. The fixture plan is built from the same table the dispatches
 * are, so those counts cannot drift apart.
 *
 * The table carries a spec ending on a code span holding a JSON
 * object. Its braces are task TEXT, so its head must CONTAIN them —
 * without it, a strip that ate any trailing brace group would satisfy
 * every other case in this file.
 *
 * ## The undeclared control
 *
 * One spec carries no block at all, and it is the compatibility
 * promise as an assertion: its argument list must be the two arguments
 * the loop always spawned and nothing else, and its prompt must equal
 * the five-line join spelled out here from literals. The injected
 * second line is rebuilt from fragments rather than referenced, so an
 * edit to the preamble in `start.ts` reddens this file rather than
 * passing silently — a prompt built from the module under test agrees
 * with any prompt that module happens to build.
 *
 * ## The third consumer
 *
 * A parsed-off field is only gone from the consumer that parsed it,
 * and the commit is where a leak cannot be taken back out: the subject
 * is derived from the same sentence, so a block riding along reaches
 * the git history. `commitFinishedTask` is driven here for that one
 * claim, over a real tracker planted where the loop keeps one, with
 * the tick asserted to leave the block on the LINE — the tracker is
 * copied from the plan once at loop start, so a tick that dropped the
 * block would silently dispatch a resumed task at the defaults.
 *
 * ## The mutation grid
 *
 * Twenty-one mutations of `start.ts`, `utils/claude.ts` and
 * `utils/declaration.ts` were driven against this file and all
 * TWENTY-ONE reddened at least one case. Every leg ran TWICE and
 * named the IDENTICAL red set on both passes, asked for through
 * `--reporter=json` so a red SET is comparable member for member — a
 * red COUNT cannot separate two legs reddening the same number of
 * different cases. All three modules were restored bytes-identical
 * and all 14 cases were green either side.
 *
 * The wide legs are the ones reaching the argument list. Spawning
 * twice reddens 6; dropping the flags from `claudeArgs`, putting them
 * ahead of the base arguments, having `runClaude` ignore them,
 * dropping `-p` and calling `run(prompt)` with no flags redden 4
 * apiece. Sorting the flags and appending a newline to the prompt
 * redden 2 each, as does answering `flags: []` on the record while
 * still spawning with them — the two assertions the record and the
 * argument list make together.
 *
 * TEN legs isolate, and each names the claim its case is carrying.
 * Building the prompt from `taskInfo.task` reddens the injection case
 * ALONE; announcing that same string reddens the announcement case
 * alone; leaving the block on what `commitFinishedTask` hands its
 * runner reddens the commit case alone. Dropping the routing line,
 * announcing it unconditionally, dropping the issue warning,
 * announcing a resumed task with the unchecked wording and reporting
 * the exit code as 0 each redden one. Dropping the injected preamble
 * and swapping `PROMPT.md` for the plan each redden the five-line
 * join alone, which is what spelling that literal out is for.
 *
 * The union of the 21 red sets covers all 14 cases, so no fixture
 * here is riding along. Three cases are reached by ONE leg each and
 * all three are controls. A commit runner handed a truncated
 * sentence reaches
 * `hands a plain task its text unchanged`; a routing line announced
 * for every task reaches
 * `says nothing about routing for a plain task`; and
 * `leaves a brace that is task text alone` is reached by a COMPOUND
 * leg over `utils/declaration.ts` — dropping the end anchor AND the
 * recognised-key rule together. Neither half reddens anything alone
 * (measured, 0 of 14 each): each shadows the other, so only the pair
 * can say which two layers that case rests on.
 */
import type { TaskDispatch, TaskSessionRunner } from '../start.js';
import type { ClaudeSpawner } from '../utils/claude.js';
import type { CommitAttempt, CommitOptions } from '../utils/commit.js';
import type { TaskInfo } from '../utils/tracker.js';

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { commitFinishedTask, dispatchTask } from '../start.js';
import { runClaude } from '../utils/claude.js';

/** The two spaces a tracker line puts between text and block. */
const GAP = '  ';

/** A code span delimiter, kept out of the template literals. */
const TICK = '`';

/** Zero-indexed line the first task sits on in the fixture plan. */
const FIRST_TASK_LINE = 5;

/**
 * The second line the loop injects, rebuilt from fragments.
 *
 * Spelled here rather than imported so an edit to the preamble in
 * `start.ts` reddens the undeclared control. The fragments join on
 * single spaces, which is what the one long line in that file is.
 */
const INJECTED_PREAMBLE = [
  'Consider tasks listed above this one in the plan checklist as',
  'completed. Do not re-evaluate or re-do them. Focus only on the',
  'scoped task.',
].join(' ');

/** A stand-in for `PROMPT.md`, read once before the loop. */
const PROMPT_CONTENT = [
  'Always read `@progress.txt` in full before starting the task.',
  '',
  'The loop stages and commits on your behalf.',
].join('\n');

/** One task line the loop is handed, and what it must run as. */
interface DispatchSpec {
  /** The sentence the session must be given, block removed. */
  text: string;
  /** The block the plan wrote after it, or null for none. */
  block: string | null;
  /** What the record must carry, and what must reach the argv. */
  flags: readonly string[];
  /** The whole argument list, spelled out rather than composed. */
  argv: readonly string[];
  /** Granular keys an agent outranked, named on the routing line. */
  suppressed: readonly string[];
}

/** A task sentence long enough to look like the plan it came from. */
const ROUTING_TASK = [
  'Add the task-shape to agent routing table to `context/workflow.md`,',
  'mapping prose to `doc-updater` and tests to `tdd-guide`',
].join(' ');

/**
 * The five task lines every case here is driven over.
 *
 * Three carry a block and two do not, and each of the two defends
 * something a table of declared lines alone cannot. One is an ordinary
 * undeclared task, which is what the loop meets most often and which
 * carries the compatibility promise. The other ends on a code span
 * holding a JSON object, so a strip that ate any trailing brace group
 * reddens rather than passing.
 *
 * The last declared spec names an effort the CLI does not answer to.
 * Its model still resolves, so it is the one spec whose flags are a
 * PROPER SUBSET of what its block asked for — a resolver that passed
 * the unusable value on would spawn `--effort medum` and stall the
 * task on a CLI refusal.
 */
const DISPATCHES: readonly DispatchSpec[] = [
  {
    text: 'Capture the three gates into per-run capture files',
    block: null,
    flags: [],
    argv: ['-p', '--dangerously-skip-permissions'],
    suppressed: [],
  },
  {
    text: 'Update the skill cap sentence',
    block: '{agent=doc-updater model=haiku effort=low}',
    flags: ['--agent', 'doc-updater'],
    argv: [
      '-p',
      '--dangerously-skip-permissions',
      '--agent',
      'doc-updater',
    ],
    suppressed: ['model', 'effort'],
  },
  {
    text: ROUTING_TASK,
    block: '{tools=Read,Write,Edit model=haiku effort=low}',
    flags: [
      '--model',
      'haiku',
      '--effort',
      'low',
      '--tools',
      'Read,Write,Edit',
    ],
    argv: [
      '-p',
      '--dangerously-skip-permissions',
      '--model',
      'haiku',
      '--effort',
      'low',
      '--tools',
      'Read,Write,Edit',
    ],
    suppressed: [],
  },
  {
    text: `Refuse a settings payload of ${TICK}{"mode": "fast"}${TICK}`,
    block: null,
    flags: [],
    argv: ['-p', '--dangerously-skip-permissions'],
    suppressed: [],
  },
  {
    text: 'Run the collector over every session log',
    block: '{effort=medum model=haiku}',
    flags: ['--model', 'haiku'],
    argv: ['-p', '--dangerously-skip-permissions', '--model', 'haiku'],
    suppressed: [],
  },
];

/** How many of the five carry a block the grammar answers to. */
const DECLARED_LINES = 3;

/** The spec whose block names an agent. */
const AGENT_SPEC = 1;

/** The spec with no block, which is the compatibility control. */
const PLAIN_SPEC = 0;

/** The spec whose braces are task text rather than a declaration. */
const CODE_SPAN_SPEC = 3;

/** The spec whose block names an effort the CLI cannot use. */
const UNUSABLE_SPEC = 4;

/** The line a plan writes for one spec, block and all. */
function lineTextOf(spec: DispatchSpec): string {
  return spec.block === null
    ? spec.text
    : `${spec.text}${GAP}${spec.block}`;
}

/** The whole fixture plan, built from the same table. */
const PLAN_CONTENT = [
  '# Plan: a throwaway plan',
  '',
  '## Stage: One',
  '',
  '- [x] Add the store the collector writes its rows to',
  ...DISPATCHES.map((spec) => `- [ ] ${lineTextOf(spec)}`),
  '',
].join('\n');

/** The task as `findNextTask` would hand it over, block included. */
function taskInfoFor(
  spec: DispatchSpec,
  index: number,
  status: TaskInfo['status'] = 'unchecked',
): TaskInfo {
  return {
    task: lineTextOf(spec),
    lineNum: FIRST_TASK_LINE + index,
    status,
  };
}

/** One spawn the loop asked for, recorded rather than run. */
interface SpawnCall {
  args: readonly string[];
  prompt: string;
}

/** What one driven dispatch produced. */
interface DispatchRun {
  result: TaskDispatch;
  calls: readonly SpawnCall[];
}

/** How a driven dispatch differs from the ordinary one. */
interface DispatchOverrides {
  /** What the spawn answers. Defaults to a clean session. */
  exitCode?: number;
  /** The tracker status the loop read. Defaults to unchecked. */
  status?: TaskInfo['status'];
}

/**
 * Dispatches one spec through the real CLI door.
 *
 * The seam is the SPAWNER and not `runClaude`, which is what makes
 * this an integration rather than a second copy of the colocated
 * suites: the flags a declaration resolved to go through
 * `claudeArgs` on their way to the recorded argument list, so a case
 * asserting that list is asserting what would have been RUN.
 */
async function dispatchSpec(
  spec: DispatchSpec,
  index: number,
  overrides: DispatchOverrides = {},
): Promise<DispatchRun> {
  // One dispatch, one capture. A case sweeping the whole table would
  // otherwise read the FIRST spec's announcement for every later one,
  // which passes for four of five specs and hides the fifth.
  logs = [];
  warnings = [];

  const calls: SpawnCall[] = [];
  const spawn: ClaudeSpawner = (args, prompt) => {
    calls.push({ args: [...args], prompt });
    return Promise.resolve(overrides.exitCode ?? 0);
  };

  const run: TaskSessionRunner = function run(prompt, flags) {
    return runClaude(prompt, flags, spawn);
  };

  const result = await dispatchTask({
    taskInfo: taskInfoFor(spec, index, overrides.status ?? 'unchecked'),
    promptContent: PROMPT_CONTENT,
    planContent: PLAN_CONTENT,
    run,
  });

  return { result, calls };
}

/** The one spawn a case made, with the stub proved to have been hit. */
function onlyCall(calls: readonly SpawnCall[]): SpawnCall {
  expect(calls).toHaveLength(1);
  const call = calls[0];
  if (call === undefined) throw new Error('the spawner was never called');
  return call;
}

/** The first line of a prompt, which is the line the loop wrote. */
function headOf(prompt: string): string {
  return prompt.split('\n')[0] ?? '';
}

/** How many times `needle` occurs in `haystack`. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Lines the dispatch reported to the operator. */
let logs: string[] = [];

/** Lines it reported as a problem. */
let warnings: string[] = [];

/**
 * Captures what the dispatch printed.
 *
 * Through a spy on `console` and not a `process.stdout.write` patch:
 * vitest replaces the console object, so a stream capture reads zero
 * lines here and every absence assertion would pass against a loop
 * that announced the block in full.
 *
 * {@link dispatchSpec} empties both arrays again before each dispatch,
 * so a case driving the whole table reads one dispatch at a time.
 */
beforeEach(() => {
  logs = [];
  warnings = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The one announced line carrying `marker`, or the empty string. */
function announced(marker: string): string {
  return logs.find((line) => line.includes(marker)) ?? '';
}

describe('a declaration-bearing task, dispatched', () => {
  it('injects the sentence with no block on it', async () => {
    let declared = 0;

    for (const [index, spec] of DISPATCHES.entries()) {
      const { result } = await dispatchSpec(spec, index);
      const head = headOf(result.prompt);

      expect(head).toBe(`Your scoped task is: ${spec.text}`);
      expect(result.taskText).toBe(spec.text);

      if (spec.block === null) continue;
      declared += 1;

      // No brace anywhere on the line the loop wrote, and the block
      // still in the prompt exactly as often as the PLAN carries it.
      // A strip that failed leaves two rather than one.
      expect(head).not.toContain('{');
      expect(head).not.toContain('}');
      expect(occurrences(PLAN_CONTENT, spec.block)).toBe(1);
      expect(occurrences(result.prompt, spec.block)).toBe(1);
    }

    // Which specs actually carried a block, so the sweep above is not
    // five undeclared lines agreeing with themselves.
    expect(declared).toBe(DECLARED_LINES);
  });

  it('leaves a brace that is task text alone', async () => {
    const spec = DISPATCHES[CODE_SPAN_SPEC]!;
    const { result } = await dispatchSpec(spec, CODE_SPAN_SPEC);

    // The control along the one axis the case above cannot vary: a
    // strip that ate any trailing brace group would pass every
    // assertion there and fail here.
    expect(headOf(result.prompt)).toContain('{');
    expect(result.taskText).toBe(spec.text);
    expect(result.declaration).toBeNull();
  });

  it('spawns the flags its block resolved to', async () => {
    for (const [index, spec] of DISPATCHES.entries()) {
      const { result, calls } = await dispatchSpec(spec, index);
      const call = onlyCall(calls);

      // Both halves: what the record says the task ran as, and what
      // the argument list says it would actually have run as.
      expect(result.flags).toEqual(spec.flags);
      expect(call.args).toEqual(spec.argv);
      expect(call.prompt).toBe(result.prompt);
    }
  });

  it('ends on the variadic tools flag when one is named', async () => {
    const index = 2;
    const spec = DISPATCHES[index]!;
    const { calls } = await dispatchSpec(spec, index);

    // The reason the resolved flags are APPENDED: `--tools` consumes
    // tokens until one starting with a dash, so it has to be last
    // with nothing behind it to swallow.
    expect(onlyCall(calls).args.slice(-2))
      .toEqual(['--tools', 'Read,Write,Edit']);
  });

  it('keeps the block out of what it announces', async () => {
    for (const [index, spec] of DISPATCHES.entries()) {
      await dispatchSpec(spec, index);
      const line = announced('Executing task: ');

      expect(line.endsWith(`Executing task: ${spec.text}`)).toBe(true);
      if (spec.block !== null) expect(line).not.toContain(spec.block);
    }
  });

  it('names the routing it dispatched a task under', async () => {
    const spec = DISPATCHES[AGENT_SPEC]!;
    await dispatchSpec(spec, AGENT_SPEC);
    const line = announced('Routed as: ');

    expect(line).toContain('--agent doc-updater');
    for (const key of spec.suppressed) expect(line).toContain(key);

    // The granular keys are on the record and off the command line,
    // so the only place a plan can see they were outranked is here.
    expect(line).not.toContain('--model');
    expect(line).not.toContain('--effort');
  });

  it('says nothing about routing for a plain task', async () => {
    await dispatchSpec(DISPATCHES[PLAIN_SPEC]!, PLAIN_SPEC);

    expect(announced('Routed as: ')).toBe('');
    expect(warnings).toEqual([]);
  });

  it('drops a value it cannot use and says which', async () => {
    const spec = DISPATCHES[UNUSABLE_SPEC]!;
    const { result, calls } = await dispatchSpec(spec, UNUSABLE_SPEC);

    // The task runs at the loop default for that key rather than
    // stalling on a CLI that refuses the value.
    expect(onlyCall(calls).args).toEqual(spec.argv);
    expect(result.flags).toEqual(['--model', 'haiku']);
    expect(onlyCall(calls).args).not.toContain('--effort');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('effort=medum');
  });

  it('announces a resumed blocked task by its sentence', async () => {
    const spec = DISPATCHES[AGENT_SPEC]!;
    const overrides = { status: 'blocked' } as const;
    const { calls } = await dispatchSpec(spec, AGENT_SPEC, overrides);
    const line = announced('Resuming blocked task: ');

    expect(line.endsWith(`Resuming blocked task: ${spec.text}`)).toBe(true);
    expect(announced('Executing task: ')).toBe('');
    expect(onlyCall(calls).args).toEqual(spec.argv);
  });

  it('answers the exit code the spawn answered', async () => {
    const spec = DISPATCHES[AGENT_SPEC]!;
    const overrides = { exitCode: 7 };
    const { result } = await dispatchSpec(spec, AGENT_SPEC, overrides);

    expect(result.exitCode).toBe(7);
  });
});

describe('a task with no block at all', () => {
  it('spawns the two arguments the loop always did', async () => {
    const spec = DISPATCHES[PLAIN_SPEC]!;
    const { result, calls } = await dispatchSpec(spec, PLAIN_SPEC);

    expect(onlyCall(calls).args)
      .toEqual(['-p', '--dangerously-skip-permissions']);
    expect(result.flags).toEqual([]);
    expect(result.declaration).toBeNull();
    expect(result.taskText).toBe(spec.text);
  });

  it('builds the prompt it built before blocks existed', async () => {
    const spec = DISPATCHES[PLAIN_SPEC]!;
    const { result, calls } = await dispatchSpec(spec, PLAIN_SPEC);

    // The five-line join spelled out, so this compares against a
    // literal rather than against whatever the module assembled.
    const expected = [
      `Your scoped task is: ${spec.text}`,
      INJECTED_PREAMBLE,
      '',
      PROMPT_CONTENT,
      PLAN_CONTENT,
    ].join('\n');

    expect(result.prompt).toBe(expected);
    expect(onlyCall(calls).prompt).toBe(expected);
  });
});

const tempRoot = mkdtempSync(join(tmpdir(), 'ralph-dispatch-'));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

let planted = 0;

/** Writes a tracker where the loop keeps one, and answers its path. */
function plantTracker(content: string): string {
  planted += 1;
  const dir = join(tempRoot, `plan-${planted}`, '.plans');
  mkdirSync(dir, { recursive: true });
  const trackerPath = join(dir, 'PLAN_TRACKER-throwaway.md');
  writeFileSync(trackerPath, content, 'utf8');
  return trackerPath;
}

/** What a stubbed runner answers for a tree git saw nothing in. */
const CLEAN_ATTEMPT: CommitAttempt = {
  outcome: 'nothing-to-commit',
  subject: 'chore: a subject the runner derived for itself',
  sha: null,
  failedStep: null,
  exitCode: 0,
  message: '',
};

describe('what a finished declared task commits', () => {
  it('hands the commit runner the sentence alone', () => {
    const spec = DISPATCHES[AGENT_SPEC]!;
    const trackerPath = plantTracker(PLAN_CONTENT);
    const taskInfo = taskInfoFor(spec, AGENT_SPEC);
    const seen: CommitOptions[] = [];

    commitFinishedTask({
      trackerPath,
      taskInfo,
      repoRoot: tempRoot,
      commit: (options) => {
        seen.push(options);
        return CLEAN_ATTEMPT;
      },
    });

    // The subject is derived from this sentence, so a block left on
    // it reaches the one place nothing here can take it back out of.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.taskText).toBe(spec.text);
    expect(seen[0]?.taskText).not.toContain('{');

    // The tracker still carries the block, because the tracker is
    // copied from the plan ONCE and nothing would put it back.
    const ticked = readFileSync(trackerPath, 'utf8').split('\n');
    expect(ticked[taskInfo.lineNum]).toBe(`- [x] ${lineTextOf(spec)}`);
  });

  it('hands a plain task its text unchanged', () => {
    const spec = DISPATCHES[PLAIN_SPEC]!;
    const trackerPath = plantTracker(PLAN_CONTENT);
    const seen: CommitOptions[] = [];

    commitFinishedTask({
      trackerPath,
      taskInfo: taskInfoFor(spec, PLAIN_SPEC),
      repoRoot: tempRoot,
      commit: (options) => {
        seen.push(options);
        return CLEAN_ATTEMPT;
      },
    });

    expect(seen[0]?.taskText).toBe(spec.text);
    expect(seen[0]?.taskText).toBe(taskInfoFor(spec, PLAIN_SPEC).task);
  });
});
