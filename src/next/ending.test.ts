/**
 * Tests for the ending the six commands finish with (`./ending.ts`):
 * the line a run with no terminal is left, the question a terminal is
 * put, the step a yes runs, and the wrapper the two phase 0 commands
 * of the six are ended by.
 *
 * Every case drives the `readState` seam, so none reaches git, `gh`,
 * the board or a provider, and the state each is read off is a
 * literal. The step a yes runs is a RECORDING command in a registry of
 * this file's own — `runAction` looks the action up there — so a case
 * reads the spelling and the words `run` was called with rather than
 * what a real `pr merge` would do. The prompter is a double whose
 * answer the case scripts, and it records being opened and closed, so
 * "nothing was asked" is a reading and not an assumption.
 *
 * The output is a sink per level (`src/tests/output-sinks.ts`).
 *
 * ## The controls
 *
 * Four readings here would pass against an ending that had stopped
 * doing anything at all, and each is paired:
 *
 *  - the `--no-hint` case counts the readings and the lines of the run
 *    that turned it off AGAINST the same run with the flag left alone;
 *  - the declined case holds "nothing ran" against the same world
 *    answered yes, which runs one step;
 *  - the no-terminal case holds "no prompter was opened" against the
 *    terminal case, which opens one;
 *  - the `endingWith` refusal case holds "no state was read" against
 *    the same wrapper over an inner run that returns, which reads one.
 *
 * ## The two wrapped commands, and what is held where
 *
 * `plan create` and `loop start` are phase 0 commands behind a wrapper,
 * and their inner run writes a plan or runs a whole loop, so neither is
 * driven here. What IS held: the wrapper's own behaviour, over a stub
 * inner command, in the block above; and, in the last block, that all
 * six declare {@link HINT_FLAG_SPEC} by IDENTITY, with no other core
 * command declaring the flag as the control. That the two modules reach
 * `endingWith` and that spec at all is held a third way, by the import
 * case of `src/index.test.ts`, which spells the imports each command
 * module takes.
 */
import type { NextEndingSeams } from './ending.js';
import type { NextState } from './state.js';
import type { RafaCommand, RafaContext } from '../cli/command.js';
import type { Output } from '../ports/index.js';
import type { Prompter } from '../project/root-choice.js';

import { describe, expect, it } from 'bun:test';

import { CommandExit } from '../cli/command.js';
import { createCommandRegistry } from '../cli/registry.js';
import issueReady from '../commands/issue/ready.js';
import loopStart from '../commands/loop/start.js';
import planCreate from '../commands/plan/create.js';
import prMerge from '../commands/pr/merge.js';
import prTriage from '../commands/pr/triage.js';
import prWait from '../commands/pr/wait.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { DEFAULT_ENDING_SEAMS, endingWith, endWithNextStep, HINT_FLAG_SPEC } from './ending.js';
import { HINT_FLAG } from './hint.js';

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
  running: stateOf({
    id: 'loop-running',
    action: 'none',
    reading: 'a loop is running for this project',
    proposal: 'let it run',
  }),
});

/** The subjects the recording registry holds. */
const SUBJECTS = [
  { name: 'pr', summary: 'pull requests' },
  { name: 'plan', summary: 'plans' },
];

/** One call a recording command took: the spelling, and the words and output it was handed. */
interface Seen {
  readonly spelling: string;
  readonly argv: readonly string[];
  readonly output: Output;
}

/** A command recording what it was called with, or refusing with `refusal` when one is given. */
function recording(seen: Seen[], subject: string, action: string, refusal?: CommandExit): RafaCommand {
  return {
    name: `${subject} ${action}`,
    description: `Records one call of ${subject} ${action}.`,
    subject,
    action,
    summary: `${subject} ${action}`,
    args: [{ name: 'n', description: 'A number.', type: 'string' }],
    flags: [{ name: 'yes', description: 'Without asking.', type: 'boolean' }],
    examples: [{ cmd: `rafa ${subject} ${action}`, note: 'runs it' }],
    outputs: ['text', 'json'],
    run: async (context: RafaContext) => {
      seen.push({ spelling: `${subject} ${action}`, argv: context.argv, output: context.output });
      if (refusal !== undefined) throw refusal;
    },
  };
}

/** What one case drives the ending with; each left out is the harness's own. */
interface Drive {
  /** The state the reading answers. */
  readonly state?: NextState;
  /** Whether there is a terminal to be asked on; false when left out. */
  readonly terminal?: boolean;
  /** What the question is answered with; `n` when left out. */
  readonly answer?: string;
  /** The flags the command was run with. */
  readonly flags?: Readonly<Record<string, string | boolean>>;
  /** What the step the yes runs refuses with, or nothing for one that returns. */
  readonly refusal?: CommandExit;
}

/** What a case reads back: what the ending wrote, asked, opened and ran. */
interface Driven {
  readonly ending: Awaited<ReturnType<typeof endWithNextStep>>;
  readonly info: readonly string[];
  readonly asked: readonly string[];
  readonly opened: number;
  readonly closed: number;
  readonly reads: number;
  readonly seen: readonly Seen[];
  readonly results: readonly unknown[];
}

/** Runs the ending over one world and answers it beside everything it spent. */
async function drive(over: Drive = {}): Promise<Driven> {
  const info: string[] = [];
  const asked: string[] = [];
  const results: unknown[] = [];
  const seen: Seen[] = [];
  let opened = 0;
  let closed = 0;
  let reads = 0;

  const commands = [recording(seen, 'pr', 'merge', over.refusal), recording(seen, 'plan', 'create')];
  const context: RafaContext = Object.freeze({
    args: [],
    flags: over.flags ?? {},
    outputMode: 'text',
    verbosity: 2,
    output: sinkOutput({
      info: (line: string) => info.push(line),
      result: (payload: unknown) => results.push(payload),
    }),
    signal: new AbortController().signal,
    env: {},
    argv: [],
    registry: createCommandRegistry({ subjects: SUBJECTS, commands }),
    project: null,
  });
  const seams: NextEndingSeams = {
    isTerminal: () => over.terminal === true,
    readState: async (): Promise<NextState> => {
      reads += 1;
      return over.state ?? STATES.green;
    },
    expire: () => new Promise<void>(() => undefined),
    openPrompter: (): Prompter => {
      opened += 1;
      return {
        say: () => undefined,
        ask: (question: string) => {
          asked.push(question);
          return Promise.resolve(over.answer ?? 'n');
        },
        close: () => {
          closed += 1;
        },
      };
    },
  };

  const ending = await endWithNextStep(context, seams);
  return { ending, info, asked, opened, closed, reads, seen, results };
}

describe('the line a run with no terminal is left', () => {
  it('prints the rafa command that does the next step, asks nothing and runs nothing', async () => {
    const driven = await drive({ state: STATES.green });

    expect(driven.info).toEqual([`👉 Next: merge #${PR} into \`${BASE}\` — rafa pr merge ${PR} --yes`]);
    expect([driven.ending?.hint.kind, driven.ending?.asked, driven.ending?.ran]).toEqual(['command', false, false]);
    expect([driven.asked, driven.opened, driven.seen]).toEqual([[], 0, []]);
  });

  it('says nothing at all for a state whose action runs no command', async () => {
    const quiet = await drive({ state: STATES.running });
    const loud = await drive({ state: STATES.green });

    expect([quiet.ending, quiet.info, quiet.seen]).toEqual([null, [], []]);
    expect(loud.info).toHaveLength(1);
  });
});

describe('the question a terminal is put', () => {
  it('puts the question rafa next would, prints no line, and runs the step on a yes', async () => {
    const driven = await drive({ state: STATES.green, terminal: true, answer: 'y' });

    expect(driven.asked).toEqual([`Merge #${PR} into \`${BASE}\`? [y/N] `]);
    expect(driven.info).toEqual([]);
    expect(driven.seen.map((call) => [call.spelling, call.argv])).toEqual([['pr merge', [`${PR}`, '--yes']]]);
    expect([driven.ending?.hint.kind, driven.ending?.asked, driven.ending?.ran]).toEqual(['question', true, true]);
  });

  it('runs nothing on a no, and closes the prompter either way', async () => {
    const declined = await drive({ state: STATES.green, terminal: true, answer: 'n' });
    const taken = await drive({ state: STATES.green, terminal: true, answer: 'yes' });

    expect([declined.seen, declined.ending?.ran]).toEqual([[], false]);
    expect([declined.opened, declined.closed]).toEqual([1, 1]);
    expect([taken.seen.length, taken.ending?.ran]).toEqual([1, true]);
    expect([taken.opened, taken.closed]).toEqual([1, 1]);
  });

  it('runs the step the state names, which is not always the pull request one', async () => {
    const driven = await drive({ state: STATES.ready, terminal: true, answer: 'y' });

    expect(driven.asked).toEqual([`Plan #${ISSUE}? [y/N] `]);
    expect(driven.seen.map((call) => [call.spelling, call.argv])).toEqual([['plan create', ['--next']]]);
  });

  it('takes the step through an output whose result is dropped, the ending command owning that event', async () => {
    const driven = await drive({ state: STATES.green, terminal: true, answer: 'y' });

    driven.seen[0]?.output.result({ merged: true });
    driven.seen[0]?.output.info('a line the step wrote');

    expect(driven.results).toEqual([]);
    expect(driven.info).toEqual(['a line the step wrote']);
  });

  it('throws what the step threw, with its own exit code and message', async () => {
    const refusal = new CommandExit(2, '❌ the pull request is not green');
    const thrown = await drive({ state: STATES.green, terminal: true, answer: 'y', refusal })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(CommandExit);
    expect([(thrown as CommandExit).exitCode, (thrown as CommandExit).message])
      .toEqual([2, '❌ the pull request is not green']);
  });
});

describe('--no-hint', () => {
  it('reads nothing, asks nothing, prints nothing and runs nothing', async () => {
    const off = await drive({ state: STATES.green, terminal: true, answer: 'y', flags: { [HINT_FLAG]: false } });
    const on = await drive({ state: STATES.green, terminal: true, answer: 'y' });

    expect([off.ending, off.reads, off.info, off.asked, off.seen]).toEqual([null, 0, [], [], []]);
    expect([on.reads, on.asked.length, on.seen.length]).toEqual([1, 1, 1]);
  });

  it('is declared as a boolean defaulting to true, which is what makes --no-hint read as false', () => {
    expect([HINT_FLAG_SPEC.name, HINT_FLAG_SPEC.type, HINT_FLAG_SPEC.default]).toEqual(['hint', 'boolean', true]);
    expect(Object.isFrozen(HINT_FLAG_SPEC)).toBe(true);
  });
});

describe('the wrapper the two phase 0 commands are ended by', () => {
  /** A command whose run records that it ran, and refuses with `refusal` when one is given. */
  function inner(ran: string[], refusal?: CommandExit): RafaCommand {
    return Object.freeze({
      name: 'plan create',
      description: 'Writes a plan.',
      subject: 'plan',
      action: 'create',
      summary: 'writes a plan',
      args: [],
      flags: [HINT_FLAG_SPEC],
      examples: [{ cmd: 'rafa plan create', note: 'writes one' }],
      outputs: ['text', 'json'] as const,
      aliases: ['plan'],
      run: async () => {
        ran.push('inner');
        if (refusal !== undefined) throw refusal;
      },
    });
  }

  /** A context of this block's own, collecting the lines the ending writes. */
  function contextFor(info: string[]): RafaContext {
    return Object.freeze({
      args: [],
      flags: {},
      outputMode: 'text',
      verbosity: 2,
      output: sinkOutput({ info: (line: string) => info.push(line) }),
      signal: new AbortController().signal,
      env: {},
      argv: [],
      registry: createCommandRegistry({ subjects: SUBJECTS, commands: [] }),
      project: null,
    });
  }

  /** The seams the wrapper cases run with: one reading, counted, and no terminal. */
  function countingSeams(reads: number[]): NextEndingSeams {
    return {
      isTerminal: () => false,
      readState: async (): Promise<NextState> => {
        reads.push(1);
        return STATES.green;
      },
      expire: () => new Promise<void>(() => undefined),
    };
  }

  it('runs the command first and then names the step that follows', async () => {
    const order: string[] = [];
    const info: string[] = [];
    const reads: number[] = [];
    const wrapped = endingWith(inner(order), {
      ...countingSeams(reads),
      readState: async (): Promise<NextState> => {
        order.push('read');
        reads.push(1);
        return STATES.green;
      },
    });

    await wrapped.run(contextFor(info));

    expect(order).toEqual(['inner', 'read']);
    expect(info).toEqual([`👉 Next: merge #${PR} into \`${BASE}\` — rafa pr merge ${PR} --yes`]);
  });

  it('reads no state at all when the command it wraps refused', async () => {
    const info: string[] = [];
    const reads: number[] = [];
    const refused = endingWith(inner([], new CommandExit(1, '❌ that plan already exists')), countingSeams(reads));
    const wrote = endingWith(inner([]), countingSeams(reads));

    const thrown = await refused.run(contextFor(info)).catch((error: unknown) => error);

    expect((thrown as CommandExit).exitCode).toBe(1);
    expect([reads.length, info]).toEqual([0, []]);

    await wrote.run(contextFor(info));

    expect([reads.length, info.length]).toEqual([1, 1]);
  });

  it('keeps everything the command declared, and is frozen', () => {
    const wrapped = endingWith(inner([]));

    expect([wrapped.name, wrapped.subject, wrapped.action, wrapped.aliases]).toEqual(['plan create', 'plan', 'create', ['plan']]);
    expect(wrapped.flags.map((flag) => flag.name)).toEqual(['hint']);
    expect(Object.isFrozen(wrapped)).toBe(true);
  });

  it('runs with the system seams when it is given none', () => {
    expect(DEFAULT_ENDING_SEAMS).toEqual({});
    expect(Object.isFrozen(DEFAULT_ENDING_SEAMS)).toBe(true);
  });
});

describe('the six commands that end with it', () => {
  /** The six, as the modules that declare them export them. */
  const SIX: readonly RafaCommand[] = [prMerge, prWait, prTriage, planCreate, issueReady, loopStart];

  it('declares this one flag spec on all six, by identity, so their help reads the same', () => {
    const declared = SIX.map((command) => command.flags.includes(HINT_FLAG_SPEC));

    expect(declared).toEqual(SIX.map(() => true));
    expect(SIX.map((command) => `${command.subject} ${command.action}`)).toEqual([
      'pr merge',
      'pr wait',
      'pr triage',
      'plan create',
      'issue ready',
      'loop start',
    ]);
  });

  it('is declared by no other core command, which is the control', async () => {
    const { CORE_COMMANDS } = await import('../commands/index.js') as { CORE_COMMANDS: readonly RafaCommand[] };
    const others = CORE_COMMANDS
      .filter((command) => !SIX.includes(command))
      .filter((command) => command.flags.some((flag) => flag.name === HINT_FLAG));

    expect(others.map((command) => command.name)).toEqual([]);
  });
});
