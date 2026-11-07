/**
 * `rafa instinct pairs [--unpaired]`: the bug-fix join, read and not
 * pushed. Prints how many of the effort store's bug findings paired with
 * the loop that fixed them, how many of those the library's push log
 * already holds under `bug-fix-pair`, and each pair; with `--unpaired`,
 * each bug that found no fixing loop and why. It writes nothing.
 *
 * ## What is read
 *
 * The join is the one the bug-fix pass runs (`src/learning/bug-fix-pass.ts`),
 * up to its push:
 *
 *   1. `readBugFixRows` (`@open-tomato/rafa-effort`) reads the bug
 *      findings, their sessions' out-of-scope bugs, the resolved findings
 *      and the `done` task reports of the store under the project root,
 *      `RAFA_EFFORT_DIR` when that is set;
 *   2. {@link readPlanStageLinks} reads the stages of every plan file in
 *      the `plan.dir` the project's config names;
 *   3. `pairBugFixes` (`@open-tomato/rafa-inventory`) joins them into
 *      pairs and unpaired bugs, each with its reason; and
 *   4. `readLoggedPairs` reads the pair keys the push log of the `local`
 *      library (`.rafa/instincts/` of the root) holds. A pair is logged
 *      when its key, `bugFixPairKey`'s issue reference and filing
 *      session, is among them.
 *
 * Nothing is pushed and no file is written: pushing is the pass's, which
 * `rafa effort collect` and the loop run. A store with no `effort.sqlite`
 * holds no bug: its note is written as an info line and every count is 0.
 * A plan file the reader passes over, and a config warning, are warnings.
 *
 * ## The counts
 *
 * `total` is the number of bug findings; `paired` the number of them that
 * found at least one fixing loop, so `total - paired` are unpaired; and
 * `logged` the number of the paired whose key the push log holds. A bug
 * two loops fixed is one paired bug and two pairs, both under its key.
 *
 * ## What a clean run answers
 *
 * A line with the three counts and the project, then each pair as its
 * issue, its filing and its fixing plan, and its lesson's trigger and
 * action on a line each, whitespace runs collapsed. `--unpaired` adds each
 * unpaired bug as its issue, its filing plan and its reason. With
 * `--output=json`, {@link InstinctPairsResult} is the data of the terminal
 * result event, `pairs` and `unpaired` both given whether or not
 * `--unpaired` is: the flag widens what text mode prints.
 *
 * ## Refusals
 *
 * A positional word, or a value typed with `--unpaired`, is exit code 1,
 * naming the usage, and so is a config `loadConfig` refuses. Bugs left
 * unpaired are exit code 0: the command reports and does not gate.
 */
import type { RafaCommand, RafaContext } from '@open-tomato/rafa/core/command';
import type { BugFixPair, UnpairedBug, UnpairedReason } from '@open-tomato/rafa-inventory';

import { readBugFixRows } from '@open-tomato/rafa-effort';
import { bugFixPairKey, localInstinctsDir, pairBugFixes, readLoggedPairs } from '@open-tomato/rafa-inventory';

import { expectNoArgument, resolveProjectConfig } from '@open-tomato/rafa/commands/plan/plan-files';
import { CommandExit } from '@open-tomato/rafa/core/command';
import { plansDirAt } from '@open-tomato/rafa/core/plan';

import { readPlanStageLinks } from '../../learning/plan-stage-links.js';

import { instinctProject } from './instinct-records.js';

/** The command's name, as a refusal opens with it. */
const NAME = 'rafa instinct pairs';

/** The usage line a refusal names. */
const USAGE = 'rafa instinct pairs [--unpaired]';

/** What a bug filed outside any plan is shown as. */
const NO_PLAN = '(no plan)';

/** One pair as the command gives it. */
export interface InstinctPair {
  /** The GitHub issue number the bug was filed as. */
  readonly issue: string;
  /** The stub of the plan whose loop filed the bug, null when it ran outside one. */
  readonly filing_plan: string | null;
  /** The stub of the plan whose loop fixed it. */
  readonly fixing_plan: string;
  /** The lesson's trigger: the bug's words. */
  readonly trigger: string;
  /** The lesson's action: the fix. */
  readonly action: string;
  /** True when the push log holds the pair's key under `bug-fix-pair`. */
  readonly logged: boolean;
}

/** One unpaired bug as the command gives it. */
export interface InstinctUnpaired {
  /** The reference's `externalId`: the issue number, or a `local` tracker's id. */
  readonly issue: string;
  /** The stub of the plan whose loop filed the bug, null when it ran outside one. */
  readonly plan: string | null;
  /** Why no fixing loop was found. */
  readonly reason: UnpairedReason;
}

/** What json mode gives as the terminal result's `data`. */
export interface InstinctPairsResult {
  /** How many bug findings the store holds. */
  readonly total: number;
  /** How many of them found at least one fixing loop. */
  readonly paired: number;
  /** How many of the paired the push log already holds. */
  readonly logged: number;
  /** Each pair, in the join's order. */
  readonly pairs: readonly InstinctPair[];
  /** Each unpaired bug, in bug order. */
  readonly unpaired: readonly InstinctUnpaired[];
}

/** What the command can be handed. */
export interface InstinctPairsSeams {
  /** The clock the join stamps its lessons with; the system clock when left out. */
  readonly now?: () => Date;
}

/** One string per push-log key, equal for equal keys. */
function keyText(key: { readonly ref: string; readonly filed_by: string }): string {
  return JSON.stringify([key.ref, key.filed_by]);
}

/** Text on one line: every whitespace run one space. */
function oneLine(text: string): string {
  return text.trim().replace(/\s+/gu, ' ');
}

/** True when the line asks for `--unpaired`; a value typed with it is refused. */
export function readUnpairedFlag(flags: Readonly<Record<string, string | boolean>>): boolean {
  const value = flags['unpaired'];
  if (value === undefined || value === false || value === 'false') return false;
  if (value === true || value === 'true') return true;
  throw new CommandExit(1, `❌ --unpaired takes no value, and read "${value}" as one\nUsage: ${USAGE}`);
}

/**
 * The result the join's `pairs` and `unpaired` give, over `total` bug
 * findings and the push log's keys `logged`; see the module note.
 */
export function pairsResult(
  total: number,
  pairs: readonly BugFixPair[],
  unpaired: readonly UnpairedBug[],
  logged: readonly { readonly ref: string; readonly filed_by: string }[],
): InstinctPairsResult {
  const loggedKeys = new Set(logged.map((key) => keyText(key)));
  const isLogged = (pair: BugFixPair): boolean => loggedKeys.has(keyText(bugFixPairKey(pair)));
  const pairedBugs = new Set(pairs.map((pair) => pair.bug.id));
  const loggedBugs = new Set(pairs.filter((pair) => isLogged(pair)).map((pair) => pair.bug.id));
  return {
    total,
    paired: pairedBugs.size,
    logged: loggedBugs.size,
    pairs: pairs.map((pair) => ({
      issue: pair.issue,
      filing_plan: pair.bug.planStub,
      fixing_plan: pair.plan,
      trigger: oneLine(pair.lesson.trigger),
      action: oneLine(pair.lesson.action),
      logged: isLogged(pair),
    })),
    unpaired: unpaired.map((bug) => ({ issue: bug.issue, plan: bug.bug.planStub, reason: bug.reason })),
  };
}

/** Reads the store, the plans and the push log, and joins them; see the module note. */
export async function readInstinctPairs(context: RafaContext, seams: InstinctPairsSeams = {}): Promise<InstinctPairsResult> {
  expectNoArgument(context.args, USAGE);
  readUnpairedFlag(context.flags);
  const project = instinctProject(context, NAME);
  const warn = (message: string): void => {
    context.output.warn(message);
  };
  const config = await resolveProjectConfig(project, NAME, warn);
  const { rows, note } = readBugFixRows(project.root);
  if (note !== null) context.output.info(note);
  const links = await readPlanStageLinks(plansDirAt(project.root, config.planDir).path, { warn });
  const now = (seams.now ?? ((): Date => new Date()))();
  const { pairs, unpaired } = pairBugFixes(rows, links, now);
  const logged = await readLoggedPairs(localInstinctsDir(project.root));
  return pairsResult(rows.bugs.length, pairs, unpaired, logged);
}

/** Every line text mode writes: the counts, each pair, and each unpaired bug when `withUnpaired`. */
export function renderPairs(result: InstinctPairsResult, projectRoot: string, withUnpaired: boolean): readonly string[] {
  const lines = [
    `${String(result.paired)} of ${String(result.total)} bug finding(s) paired with the loop that fixed them,`
      + ` ${String(result.logged)} of those logged as \`bug-fix-pair\` (project: ${projectRoot})`,
    ...result.pairs.flatMap((pair) => [
      `  #${pair.issue}  filed by ${pair.filing_plan ?? NO_PLAN}, fixed by ${pair.fixing_plan}`
        + (pair.logged
          ? ''
          : '  (not logged)'),
      `      trigger: ${pair.trigger}`,
      `      action:  ${pair.action}`,
    ]),
  ];
  if (!withUnpaired) return lines;
  return [
    ...lines,
    `${String(result.unpaired.length)} unpaired bug finding(s):`,
    ...result.unpaired.map((bug) => `  #${bug.issue}  ${bug.plan ?? NO_PLAN}  ${bug.reason}`),
  ];
}

/** The command; see the module note. */
export function createInstinctPairsCommand(seams: InstinctPairsSeams = {}): RafaCommand {
  const command: RafaCommand = {
    name: 'instinct pairs',
    subject: 'instinct',
    action: 'pairs',
    summary: 'list each filed bug paired with the loop that fixed it, writing nothing',
    description: 'Joins the bug findings of the effort store with the loops that fixed them, as the bug-fix'
      + ' pass does, and pushes nothing: by issue id, through a plan whose stub is `rafa-<n>` or a stage'
      + ' whose context names `#<n>` in the plan files of `plan.dir`. Prints how many of the bug findings'
      + ' paired out of the total and how many of those the library\'s push log already holds as'
      + ' `bug-fix-pair`, then each pair as its issue, its filing and fixing plan, and its lesson\'s trigger'
      + ' and action. `--unpaired` adds each bug that found no fixing loop, with its issue, its plan and the'
      + ' reason. Nothing is written. With `--output=json` the counts, the pairs and the unpaired bugs are'
      + ' the data of the terminal result event.',
    args: [],
    flags: [
      {
        name: 'unpaired',
        description: 'Also list each bug finding that found no fixing loop, with its issue, the plan that'
          + ' filed it and the reason. Takes no value.',
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa instinct pairs',
        note: 'Prints the paired count out of the total, then each pair with its plans, trigger and action.',
      },
      {
        cmd: 'rafa instinct pairs --unpaired',
        note: 'Also lists each unpaired bug with its issue, plan and reason.',
      },
      {
        cmd: 'rafa instinct pairs --output=json',
        note: 'Gives the counts, the pairs and the unpaired bugs as the data of the terminal result event.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const result = await readInstinctPairs(context, seams);
      if (context.outputMode === 'json') {
        context.output.result(result);
        return;
      }
      const root = instinctProject(context, NAME).root;
      for (const line of renderPairs(result, root, readUnpairedFlag(context.flags))) context.output.info(line);
    },
  };
  return Object.freeze(command);
}

const command: RafaCommand = createInstinctPairsCommand();
export default command;
