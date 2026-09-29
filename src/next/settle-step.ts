/**
 * The `settle` step `rafa next` puts after its merge step: while the
 * fragments waiting on the base fold into a version, one more turn
 * proposes `rafa release settle`, asked like `merge` and run unasked
 * only under a `--yes` list naming `settle`.
 *
 * ## Why it is read after the merge, and not by the table
 *
 * No branch owns a version number: a merge carries its plan's fragment
 * onto the base, and settling what the merges left there is the step
 * that comes after them. `rafa pr merge` only PRINTS that step as its
 * last follow-up, since a command never runs another command's step;
 * `rafa next` is the workflow that runs it, as its own action. So the
 * step is read once a `merge` or `merge-unchecked` action has run
 * ({@link followsMerge}), the way the `home` step is read once a loop
 * action has run, and not as a row of `./state.ts`'s table: a row would
 * propose a settle on every run that finds fragments waiting, merged
 * through the button or by another device, which is the doctor
 * warning's to report and the person's to run by hand.
 *
 * ## One rule with the merge's follow-up
 *
 * What the step turns on is {@link SettleWaiting}, the settle dry run
 * over `origin/<base>` that `pr merge`'s own follow-up is decided by
 * (`settleWaitingOn`, `src/commands/pr/merge-cleanup.ts`), composed for
 * the project by `openNextSources` (`./sources.ts`). So `rafa next`
 * proposes settle exactly where the merge it just ran named
 * `rafa release settle` as its last line, and names nothing where the
 * release is off, only `level: none` fragments wait, none wait at all,
 * or the dry run could not fold them.
 *
 * ## The state it answers
 *
 * {@link settleState} is a {@link NextState} like any row's, with the id
 * {@link SETTLE_STATE_ID}, the action `settle` (which `./actions.ts`
 * maps onto `release settle` with no words), the reading naming how
 * many fragments wait on which base and the version they fold into, and
 * the proposal the question is put over. It names no pull request, no
 * issue and no plan: the fragments are the base's, not one plan's.
 *
 * A reading that throws is warned about and answers null, so the chain
 * goes on without the step rather than failing a merge that has already
 * landed; `rafa release settle --dry-run` is the command that says why.
 *
 * Nothing here runs git, asks a question or prints but through the
 * `warn` it is handed.
 */
import type { NextActionId, NextState, NextStateId } from './state.js';
import type { SettleWaiting } from '../commands/pr/merge-followups.js';
import type { GitRunner } from '../pr/index.js';
import type { MergeGuardSettings } from '../release/guard-merge.js';

import { plural } from '../commands/plan/plan-files.js';
import { settleWaitingOn } from '../commands/pr/merge-cleanup.js';
import { messageOf } from '../config-sections.js';
import { mergeGuardSettings } from '../release/guard-merge.js';

/** The id the settle step's state carries; no row of the table answers it. */
export const SETTLE_STATE_ID: NextStateId = 'fragments-waiting';

/** The action ids after which the settle step is read; see the module note. */
export const MERGE_ACTIONS: ReadonlySet<NextActionId> = new Set<NextActionId>(['merge', 'merge-unchecked']);

/** Reads what the settle dry run folded on the base, or null where it folded nothing. */
export type SettleReader = () => SettleWaiting | null;

/** Where {@link settleReaderFor} reads: the project, its base branch and its release settings. */
export interface SettlePlace {
  /** The project root, where `release.enabled` reads its files. */
  readonly root: string;
  /** The home, which the follow-up place carries beside the root. */
  readonly home: string;
  /** The base branch the fragments wait on, read as `origin/<base>`. */
  readonly base: string;
  /** The config, or the part of it holding the release settings. */
  readonly config: MergeGuardSettings;
}

/**
 * The reader `openNextSources` composes: the settle dry run over
 * `origin/<base>` as last fetched, through `settleWaitingOn`, the one
 * reading `pr merge`'s follow-up is decided by; see the module note.
 */
export function settleReaderFor(place: SettlePlace, git: GitRunner): SettleReader {
  const release = mergeGuardSettings(place.config);
  return () => settleWaitingOn({ root: place.root, home: place.home, base: place.base, release }, git);
}

/** Whether the settle step is read after an action that ran: `merge` and `merge-unchecked`. */
export function followsMerge(action: NextActionId): boolean {
  return MERGE_ACTIONS.has(action);
}

/** The state the settle step proposes over `waiting`; see the module note. */
export function settleState(waiting: SettleWaiting): NextState {
  const [wait, fold] = waiting.fragments === 1
    ? ['waits', 'folds']
    : ['wait', 'fold'];
  const base = `\`${waiting.base}\``;
  return Object.freeze({
    id: SETTLE_STATE_ID,
    action: 'settle',
    reading: `${plural(waiting.fragments, 'fragment')} ${wait} on ${base} and ${fold} into ${waiting.version}`,
    proposal: `settle the fragments on ${base} into ${waiting.version}`,
    pullRequest: null,
    issue: null,
    planStub: null,
    planPath: null,
    problems: Object.freeze([]),
  });
}

/**
 * The settle step to put after a merge step, or null where nothing
 * folds; a reading that throws is written through `warn` and answers
 * null. See the module note.
 */
export function readSettleAfterMerge(read: SettleReader, warn: (line: string) => void): NextState | null {
  try {
    const waiting = read();
    return waiting === null
      ? null
      : settleState(waiting);
  } catch (error) {
    warn(`the fragments waiting on the base could not be read after the merge, so rafa next proposes no settle: ${messageOf(error)}`);
    return null;
  }
}
