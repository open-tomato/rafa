/**
 * `rafa pr retarget <n> --base=<branch>`: one pull request moved onto
 * the branch `base` through `PullRequests.editBase`, or, when it is
 * already on that base, nothing sent and exit 0. Starts no Claude
 * session and declares no `spends`.
 *
 * ## What it reads, in order
 *
 * The line first: exactly one pull request number, which the line must
 * name since a retarget acts on a pull request the caller already holds,
 * not on the branch checked out, then `--base`, required and not blank.
 * Then the config and the provider through `openPrContext`, so a line
 * refused for its words reads no config, makes no provider and spawns no
 * `gh`, the rule `pr-context.ts` keeps for every `pr` action.
 *
 * Then `get(n)`, for the base the pull request is on now: `editBase`
 * answers nothing (`packages/rafa/src/pr/types.ts`), so the comparison needs the read
 * first. A pull request the repository does not hold is refused naming
 * its number. One already on `base` (compared exactly, as
 * `retargetPullRequest` in `src/start/pr-retarget.ts` compares) sends no
 * edit, prints that it is already there and exits 0, so running the line
 * twice edits once.
 *
 * ## What it prints
 *
 * A retarget prints the line `retargetedLine` builds, the one the wrap-up
 * prints for the same edit, so a reader matching one matches both.
 *
 * ## Exit codes
 *
 * 0 for a pull request retargeted and for one already on the base. 2 for
 * a provider that is not `gh`, as every `pr` action refuses. 1 for every
 * other refusal: no number, a second word, a word that is no number,
 * `--base` left out, bare or blank, a config that cannot be used, a pull
 * request the repository does not hold, and a provider call that
 * rejected. Unlike the wrap-up, a refused edit is a failure here, not a
 * warning: the edit is all this line was run for. With `--output=json`
 * the {@link PrRetargetResult} is the data of the terminal result event.
 */
import type { LineFlags, PrSeams } from './pr-context.js';
import type { RafaCommand, RafaContext } from '@open-tomato/rafa/core/command';

import { readRequiredFlag } from '@open-tomato/rafa-board';

import { retargetedLine } from '../../start/pr-retarget.js';

import { PR_RETARGET_DECLARATION } from './declarations.js';
import { DEFAULT_PR_SEAMS, lineRefusal, onProvider, openPrContext, PR_USAGE, readPullArgument } from './pr-context.js';

/** The usage line this action's refusals name. */
const USAGE = PR_USAGE.retarget;

/** What json mode gives as the terminal result's `data`. */
export interface PrRetargetResult {
  /** The pull request the line named. */
  readonly number: number;
  /** True when this run edited the base, false when it was already on `to`. */
  readonly retargeted: boolean;
  /** The base the pull request was on before the run. */
  readonly from: string;
  /** The base the line asked for. */
  readonly to: string;
}

/** The words of a line: the pull request number and the base. */
export interface PrRetargetLine {
  readonly number: number;
  readonly base: string;
}

/** The line's number and `--base`, refusing a missing number, a stray word and a base left out or blank. */
export function readRetargetLine(args: readonly string[], flags: LineFlags): PrRetargetLine {
  const number = readPullArgument(args, USAGE);
  if (number === null) {
    throw lineRefusal('Expected the number of the pull request to retarget', USAGE);
  }
  const base = readRequiredFlag(flags, 'base', USAGE);
  return { number, base };
}

/** Retargets the pull request a line names, or answers that it is already on the base; see the module note. */
export async function retargetPull(context: RafaContext, seams: PrSeams): Promise<PrRetargetResult> {
  const { number, base } = readRetargetLine(context.args, context.flags);
  const pr = await openPrContext(context, seams);

  const pull = await onProvider(`read pull request #${String(number)}`, () => pr.pulls.get(number));
  if (pull === null) {
    throw lineRefusal(`No pull request #${String(number)} in the repository at ${pr.project.root}`, USAGE);
  }
  const from = pull.baseRefName;
  if (from === base) return { number, retargeted: false, from, to: base };

  await onProvider(
    `retarget pull request #${String(number)} from "${from}" to "${base}"`,
    () => pr.pulls.editBase(number, base),
  );
  return { number, retargeted: true, from, to: base };
}

/** The one line text mode prints for a result. */
export function renderRetarget(result: PrRetargetResult): string {
  return result.retargeted
    ? retargetedLine(result.number, result.from, result.to)
    : `✅ Pull request #${String(result.number)} is already on ${result.to}, so nothing was sent.`;
}

/** The command, reaching the provider through `seams`; see the module note. */
export function createPrRetargetCommand(seams: PrSeams = DEFAULT_PR_SEAMS): RafaCommand {
  const command: RafaCommand = {
    ...PR_RETARGET_DECLARATION,
    run: async (context) => {
      const result = await retargetPull(context, seams);
      if (context.outputMode === 'json') {
        context.output.result(result);
        return;
      }
      context.output.info(renderRetarget(result));
    },
  };
  return Object.freeze(command);
}

const command: RafaCommand = createPrRetargetCommand();
export default command;
