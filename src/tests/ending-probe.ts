/**
 * The ending seams a command's own suite drives, in one place: a state
 * read from a literal, a terminal that is there or is not, and a
 * scripted answer to the question a terminal is put.
 *
 * Six commands end by naming the step that follows
 * (`src/next/ending.ts`), and each one's suite has the same two things
 * to hold: that the ending ran where it should, and that NOTHING was
 * read where it should not. Left to the system seams the ending would
 * compose the real sources — `git` and `gh` spawned in whatever scratch
 * project the case planted — so every dispatching case of those suites
 * hands the command a probe from here, and the cases that want no
 * ending at all type `--no-hint`.
 *
 * {@link EndingProbe.reads} is what makes "nothing was read" a reading
 * rather than a sentence: a `--no-hint` run and a run that ended in a
 * refusal each count zero against a run that counts one.
 *
 * The two lines are spelled out rather than built from
 * `src/next/hint.ts`, so a suite asserting on them measures the words a
 * person sees. `hint.test.ts` pins the same two independently, off the
 * same state, which is what keeps this file honest as the wording
 * changes.
 */
import type { Prompter } from '../cli/prompt/confirm.js';
import type { NextEndingSeams } from '../next/ending.js';
import type { NextState } from '../next/state.js';

/** The pull request the green state names. */
export const ENDING_PR = 41;

/** The base it merges into. */
export const ENDING_BASE = 'main';

/** The state a probe reads unless the case names another: a green pull request waiting to be merged. */
export const ENDING_GREEN: NextState = Object.freeze({
  id: 'pr-green',
  action: 'merge',
  reading: `#${ENDING_PR} is open on \`feat/rafa-63\`, green and merges into \`${ENDING_BASE}\``,
  proposal: `merge #${ENDING_PR} into \`${ENDING_BASE}\``,
  pullRequest: ENDING_PR,
  issue: null,
  planStub: null,
  planPath: null,
  problems: [],
});

/** The line a run with no terminal is printed for {@link ENDING_GREEN}. */
export const ENDING_LINE = `👉 Next: merge #${ENDING_PR} into \`${ENDING_BASE}\` — rafa pr merge ${ENDING_PR} --yes`;

/** The question a run with a terminal is put for {@link ENDING_GREEN}. */
export const ENDING_QUESTION = `Merge #${ENDING_PR} into \`${ENDING_BASE}\`? [y/N] `;

/** What one probe is built over; each left out is the probe's own. */
export interface EndingProbeOptions {
  /** The state the reading answers. {@link ENDING_GREEN} when left out. */
  readonly state?: NextState;
  /** Whether there is a terminal to be asked on; false when left out. */
  readonly terminal?: boolean;
  /** What the question is answered with; `n` when left out. */
  readonly answer?: string;
}

/** The seams one case ends with, and what the ending spent on them. */
export interface EndingProbe {
  /** Handed to the command as its `ending` seams. */
  readonly seams: NextEndingSeams;
  /** How many times the state was read: zero for an ending that never ran. */
  readonly reads: () => number;
  /** The questions the ending put, in order. */
  readonly asked: () => readonly string[];
}

/** An ending that reads one state, counts the readings, and answers the question as `options` scripts it. */
export function endingProbe(options: EndingProbeOptions = {}): EndingProbe {
  const asked: string[] = [];
  let reads = 0;

  const seams: NextEndingSeams = {
    isTerminal: () => options.terminal === true,
    readState: async (): Promise<NextState> => {
      reads += 1;
      return options.state ?? ENDING_GREEN;
    },
    // The reading has already answered, so the timeout never expires.
    expire: () => new Promise<void>(() => undefined),
    openPrompter: (): Prompter => ({
      say: () => undefined,
      ask: (question: string) => {
        asked.push(question);
        return Promise.resolve(options.answer ?? 'n');
      },
      close: () => undefined,
    }),
  };

  return { seams, reads: () => reads, asked: () => [...asked] };
}
