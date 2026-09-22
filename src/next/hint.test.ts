/**
 * Tests for the ending hint (`./hint.ts`): the one reading, the
 * question a terminal is handed, the command a run with no terminal is
 * printed, the two-second timeout, and the silence every failure ends
 * in.
 *
 * Every case drives the `readState` seam, so no case reaches git, `gh`,
 * the board or a provider, and the state each one is read off is a
 * literal. The one case that leaves the seam out drives the real
 * composition against a context carrying no project, which is the
 * cheapest way to measure that a composition that refuses ends the
 * hint in silence rather than in an exit code.
 *
 * The output is a sink per level (`src/tests/output-sinks.ts`), so a
 * case reads the bytes the hint wrote and at which level it wrote
 * them. A case that measures silence pairs it with a control that
 * prints, since "no line" is what a hint that never ran looks like
 * too.
 *
 * ## What passes while wrong
 *
 * Five mutations of `hint.ts` were driven on 2026-09-22, one at a
 * time, over `env -u CLAUDECODE bun test src/next/hint.test.ts
 * --timeout 3000`, the module restored from a scratch copy and
 * verified with `shasum -c` each time, against 13 pass and 0 fail
 * either side:
 *
 *  - the terminal branch never taken, so every run is printed the
 *    command: 11 pass and 2 fail, the question case and the case that
 *    reads the hint a settled reading answers with.
 *  - the race dropped and the reading awaited on its own: 12 pass and
 *    1 fail, the timeout case, which FAILS BY TIMING OUT rather than
 *    by an assertion — a reading that never settles is what it drives,
 *    and without the race nothing ends it.
 *  - the `--no-hint` reading skipped: 12 pass and 1 fail, the flag
 *    case, which counts the readings as well as the lines.
 *  - the swallow turned into a rethrow: 12 pass and 1 fail, the
 *    defective-state case alone. The two cases that plant a reading
 *    which throws pass EITHER WAY, because `readWithin` answers null
 *    for a rejected read before the outer catch is reached; what is
 *    left for it is a throw from after the reading, which is the
 *    defect `actionInvocation` raises over a row naming no pull
 *    request. Without that case the catch would be untested and would
 *    read as dead code.
 *  - the null invocation forced through instead of answered on: 12
 *    pass and 1 fail, the case over the states that run no command.
 *    It reddens on the question rather than on a throw, since the
 *    throw that follows is swallowed into the same null the case
 *    expects.
 */
import type { NextHintSeams } from './hint.js';
import type { NextState } from './state.js';
import type { RafaContext } from '../cli/command.js';

import { describe, expect, it } from 'bun:test';

import { CommandExit } from '../cli/command.js';
import { createCommandRegistry } from '../cli/registry.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { actionInvocation } from './actions.js';
import { commandWords, HINT_FLAG, HINT_TIMEOUT_MS, hintLine, nextQuestion, nextStepHint, wantsHint } from './hint.js';

/** The base every state that names one is read against. */
const BASE = 'main';

/** The pull request the pull request rows name. */
const PR = 41;

/** The issue the roadmap rows name. */
const ISSUE = 64;

/** A state as a row answers one, with the fields a case fills. */
function stateOf(over: Partial<NextState>): NextState {
  return Object.freeze({
    id: 'pr-green',
    action: 'merge',
    reading: 'a reading',
    proposal: 'a proposal',
    pullRequest: null,
    issue: null,
    planStub: null,
    planPath: null,
    problems: [],
    ...over,
  });
}

/** The states the cases are read off, worded as the rows word them. */
const STATES = Object.freeze({
  green: stateOf({
    id: 'pr-green',
    action: 'merge',
    reading: `#${PR} is open on \`feat/rafa-63\`, green and merges into \`${BASE}\``,
    proposal: `merge #${PR} into \`${BASE}\``,
    pullRequest: PR,
  }),
  ready: stateOf({
    id: 'issue-ready',
    action: 'plan',
    reading: `#${ISSUE} is the next roadmap line, ready and unblocked`,
    proposal: `plan #${ISSUE}`,
    issue: ISSUE,
  }),
  notReady: stateOf({
    id: 'issue-not-ready',
    action: 'ready',
    reading: `#${ISSUE} is the next roadmap line and carries no spec:ready label`,
    proposal: `check the spec of #${ISSUE} and mark it ready`,
    issue: ISSUE,
  }),
  behind: stateOf({
    id: 'base-behind',
    action: 'sync',
    reading: `\`${BASE}\` is behind \`origin/${BASE}\``,
    proposal: `fast-forward \`${BASE}\` to \`origin/${BASE}\``,
  }),
  running: stateOf({
    id: 'loop-running',
    action: 'none',
    reading: 'a loop is running for this project',
    proposal: 'let it run',
  }),
  modified: stateOf({
    id: 'tree-modified',
    action: 'none',
    reading: 'the working tree has changes to 1 tracked file',
    proposal: 'commit or set aside your changes; rafa will not touch them',
  }),
});

/** What a case reads back: what the hint wrote, and what it asked of its seams. */
interface Driven {
  readonly info: readonly string[];
  readonly warn: readonly string[];
  readonly error: readonly string[];
  readonly reads: number;
  readonly waited: readonly number[];
}

/** What one case drives the hint with; each left out is the harness's own. */
interface Drive {
  /** The state the reading answers, or null for a read that never settles. */
  readonly state?: NextState | null;
  /** What the reading throws instead of answering. */
  readonly throws?: unknown;
  /** Whether there is a terminal to be asked on; false when left out. */
  readonly terminal?: boolean;
  /** The flags the command was run with. */
  readonly flags?: Readonly<Record<string, string | boolean>>;
  /**
   * Whether the timeout ever expires. Left out it expires on the next
   * timer tick, which a reading that answers at all beats, since a
   * promise already settled is drained before any timer: that is what
   * makes the race of the timeout cases deterministic.
   */
  readonly expires?: boolean;
  /** Whether the state is read through the seam at all; true when left out. */
  readonly seam?: boolean;
}

/** A context carrying `flags`, the sinks of `driven` and no project. */
function contextWith(flags: Readonly<Record<string, string | boolean>>, driven: {
  info: string[];
  warn: string[];
  error: string[];
}): RafaContext {
  return Object.freeze({
    args: [],
    flags,
    outputMode: 'text',
    verbosity: 2,
    output: sinkOutput({
      info: (line: string) => driven.info.push(line),
      warn: (line: string) => driven.warn.push(line),
      error: (line: string) => driven.error.push(line),
    }),
    signal: new AbortController().signal,
    env: {},
    argv: [],
    registry: createCommandRegistry({ subjects: [], commands: [] }),
    project: null,
  });
}

/** Runs the hint over one world and answers it beside what it wrote and spent. */
async function drive(drive: Drive = {}): Promise<Driven & { hint: Awaited<ReturnType<typeof nextStepHint>> }> {
  const info: string[] = [];
  const warn: string[] = [];
  const error: string[] = [];
  const waited: number[] = [];
  let reads = 0;

  const context = contextWith(drive.flags ?? {}, { info, warn, error });
  const readState = async (): Promise<NextState> => {
    reads += 1;
    if (drive.throws !== undefined) throw drive.throws;
    const state = drive.state ?? null;
    if (state === null) return new Promise<NextState>(() => undefined);
    return state;
  };
  const seams: NextHintSeams = {
    isTerminal: () => drive.terminal === true,
    expire: (ms: number) => {
      waited.push(ms);
      return drive.expires === false
        ? new Promise<void>(() => undefined)
        : new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
    },
  };
  const hint = drive.seam === false
    ? await nextStepHint(context, seams)
    : await nextStepHint(context, { ...seams, readState });

  return { hint, info, warn, error, reads, waited };
}

describe('the question and the command', () => {
  it('hands a terminal the question rafa next would put, and prints nothing', async () => {
    const driven = await drive({ state: STATES.green, terminal: true, expires: false });

    expect(driven.hint?.kind).toBe('question');
    expect(driven.hint?.line).toBe(`Merge #${PR} into \`${BASE}\`? [y/N] `);
    expect(driven.hint?.line).toBe(nextQuestion(STATES.green));
    expect(driven.info).toEqual([]);
  });

  it('prints a run with no terminal the rafa command that does it', async () => {
    const driven = await drive({ state: STATES.green, expires: false });

    expect(driven.info).toEqual([`👉 Next: merge #${PR} into \`${BASE}\` — rafa pr merge ${PR} --yes`]);
    expect(driven.hint?.kind).toBe('command');
    expect(driven.hint?.line).toBe(driven.info[0]);
    expect([driven.warn, driven.error]).toEqual([[], []]);
  });

  it('carries the state and the command the caller runs on a yes', async () => {
    const driven = await drive({ state: STATES.ready, terminal: true, expires: false });

    expect(driven.hint?.state).toBe(STATES.ready);
    expect(driven.hint?.invocation.action).toBe('plan');
    expect(commandWords(driven.hint?.invocation ?? { action: 'plan', command: '', argv: [] })).toBe('plan create --next');
  });

  it('words the printed line off the proposal and the command the action runs', () => {
    const lines = [STATES.green, STATES.ready, STATES.notReady].map((state) => {
      const invocation = actionInvocation(state);
      return invocation === null
        ? null
        : hintLine(state, invocation);
    });

    expect(lines).toEqual([
      `👉 Next: merge #${PR} into \`${BASE}\` — rafa pr merge ${PR} --yes`,
      `👉 Next: plan #${ISSUE} — rafa plan create --next`,
      `👉 Next: check the spec of #${ISSUE} and mark it ready — rafa issue ready ${ISSUE}`,
    ]);
  });

  it('says nothing for a state whose action runs no command', async () => {
    const quiet = [STATES.running, STATES.modified, STATES.behind];
    const driven = await Promise.all(quiet.flatMap((state) => [
      drive({ state, expires: false }),
      drive({ state, terminal: true, expires: false }),
    ]));

    expect(driven.map((one) => one.hint)).toEqual([null, null, null, null, null, null]);
    expect(driven.flatMap((one) => one.info)).toEqual([]);
  });
});

describe('the one reading', () => {
  it('reads the state once, with a terminal and without one', async () => {
    const asked = await drive({ state: STATES.green, terminal: true, expires: false });
    const printed = await drive({ state: STATES.green, expires: false });

    expect([asked.reads, printed.reads]).toEqual([1, 1]);
  });

  it('says nothing when the reading threw, and speaks when it answers', async () => {
    const threw = await drive({ throws: new CommandExit(2, 'the provider could not be asked'), expires: false });
    const answered = await drive({ state: STATES.green, expires: false });

    expect([threw.hint, threw.info]).toEqual([null, []]);
    expect(answered.info).toHaveLength(1);
  });

  it('says nothing for a state that names no pull request to act on', async () => {
    const defective = stateOf({ id: 'pr-green', action: 'merge', proposal: 'merge it', pullRequest: null });
    const driven = await drive({ state: defective, expires: false });
    const answered = await drive({ state: STATES.green, expires: false });

    expect([driven.hint, driven.info]).toEqual([null, []]);
    expect(answered.info).toHaveLength(1);
  });

  it('says nothing when the sources cannot be composed', async () => {
    const driven = await drive({ seam: false, expires: false });

    expect(driven.hint).toBe(null);
    expect([driven.info, driven.warn, driven.error]).toEqual([[], [], []]);
  });
});

describe('the two-second timeout', () => {
  it('gives up after two seconds and prints nothing', async () => {
    const timedOut = await drive({ state: null });
    const answered = await drive({ state: STATES.green });

    expect([timedOut.hint, timedOut.info]).toEqual([null, []]);
    expect(timedOut.waited).toEqual([HINT_TIMEOUT_MS]);
    expect(HINT_TIMEOUT_MS).toBe(2_000);
    expect(answered.info).toHaveLength(1);
  });

  it('answers as soon as the reading does, without waiting the timeout out', async () => {
    const driven = await drive({ state: STATES.green, terminal: true, expires: false });

    expect(driven.hint?.kind).toBe('question');
    expect(driven.waited).toEqual([HINT_TIMEOUT_MS]);
  });
});

describe('--no-hint', () => {
  it('says nothing and reads nothing when the flag turned it off', async () => {
    const off = await drive({ state: STATES.green, flags: { [HINT_FLAG]: false }, expires: false });
    const on = await drive({ state: STATES.green, flags: { [HINT_FLAG]: true }, expires: false });

    expect([off.hint, off.info, off.reads]).toEqual([null, [], 0]);
    expect([on.info.length, on.reads]).toEqual([1, 1]);
  });

  it('reads the flag as wanted unless it says otherwise', () => {
    const read = [{}, { [HINT_FLAG]: true }, { [HINT_FLAG]: false }, { [HINT_FLAG]: 'false' }, { [HINT_FLAG]: 'true' }]
      .map((flags) => wantsHint(flags));

    expect(read).toEqual([true, true, false, false, true]);
  });
});
