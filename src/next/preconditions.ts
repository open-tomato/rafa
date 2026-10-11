/**
 * The two pre-conditions of the state table (`./state.ts`): the
 * conditions that stop the table and are reported in its place, each
 * with what the PERSON does about it rather than an action rafa runs.
 * Both answer `none`, so a caller prints the two lines and has nothing
 * to offer.
 *
 *  - {@link readTreeModified}, `tree-modified`: the working tree has
 *    changes to tracked files. Every action the table can propose
 *    switches branches, pulls, merges or hands the checkout to a model
 *    session, and each of those loses or conflicts those changes. The
 *    reading NAMES the checkout it read and the files, and the proposal
 *    is prose only — "commit or set aside your changes; rafa will not
 *    touch them" — with no command in it, because the choice between
 *    committing them, stashing them and moving them elsewhere is the
 *    person's and rafa does not make it. An untracked file is not one of
 *    these: nothing rafa runs loses one (`trackedChanges` in
 *    `src/start/branch-decision.ts`).
 *  - {@link readPullsUnusable}, `pulls-unusable`: the pull request
 *    provider could not be ASKED — no network, no authentication, a
 *    `gh` that did not run. The port answers null for a pull request
 *    that is not there and throws when it could not look
 *    (`src/pr/types.ts`), so a throw is this condition and never an
 *    empty repository. The proposal names `rafa doctor`, which is the
 *    command that reports what the provider needs.
 *
 * ## Where each is read
 *
 * The tree is read AFTER row 1, `loop-running`, and ahead of every other
 * row. A loop that is running or paused edits a checkout as its task
 * goes, and those edits are the loop's, not the person's: committing
 * them puts a half-finished task on the loop's branch, and setting them
 * aside takes them out from under the running session (#444). So while a
 * run is live, row 1 answers and the tree is never read; once no run is
 * live, no edit in any checkout is a live run's, and the tree reading
 * can offer every one of them back to the person. Row 1 reads
 * `.rafa/runs/` alone, so putting it first spends nothing the tree
 * reading would not have.
 *
 * The tree reading names the checkout it read because that is not
 * always the checkout the command runs in: git is reached at the
 * project root, which is the main checkout even when `rafa next` runs in
 * a linked worktree beside it. The name is `git rev-parse
 * --show-toplevel` at the project root, asked only once the tree has
 * shown a change; a name git could not give is carried as a problem and
 * the line reads "the working tree" alone.
 *
 * The provider is read where the table would read it, ahead of rows 5,
 * 6, 7 and 8 and not before: asking it earlier would spend a `gh` call
 * on a state rows 1 to 4 settle without one, and a provider nobody asked
 * is a provider nobody can report on. So a running loop is still row 1
 * with the provider unusable beside it, and it says so without ever
 * finding out.
 */
import type { NextWorld } from './readings.js';
import type { RowAnswer } from './state.js';

import { messageOf } from '../config-sections.js';
import { plural } from '../plan/plan-files.js';

/** How many changed files the tree pre-condition names before eliding. */
const MAX_NAMED_FILES = 5;

/** The changed files a pre-condition names, capped and quoted. */
function nameFiles(paths: readonly string[]): string {
  const shown = paths.slice(0, MAX_NAMED_FILES).map((path) => `\`${path}\``);
  const hidden = paths.length - shown.length;
  return hidden > 0
    ? `${shown.join(', ')} and ${hidden} more`
    : shown.join(', ');
}

/**
 * A sentence on one line: every run of whitespace a space. What a
 * provider threw can be several lines, and a reading is one.
 */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The working tree as the tree line names it: with the checkout it was read in, when git named one. */
function treeLabel(checkout: string | null): string {
  return checkout === null
    ? 'the working tree'
    : `the working tree at \`${checkout}\``;
}

/**
 * Pre-condition 1: the working tree has changes to tracked files. Prose
 * only, and no tool named; read once row 1 has found no live run, see
 * the module note.
 */
export function readTreeModified(world: NextWorld): RowAnswer | null {
  const paths = world.tracked();
  if (paths.length === 0) return null;

  const tree = treeLabel(world.checkout());
  return {
    id: 'tree-modified',
    action: 'none',
    reading: `${tree} has changes to ${plural(paths.length, 'tracked file')}: ${nameFiles(paths)}`,
    proposal: 'commit or set aside your changes; rafa will not touch them',
  };
}

/**
 * Pre-condition 2: the provider could not be asked. Answered by ASKING
 * it — the one reading that tells a provider that is unusable from a
 * repository that simply has no pull request — so it is read where the
 * table would read the provider and not before; see the module note.
 */
export async function readPullsUnusable(world: NextWorld): Promise<RowAnswer | null> {
  try {
    await world.openPull();
    return null;
  } catch (error) {
    return {
      id: 'pulls-unusable',
      action: 'none',
      reading: `the \`${world.sources.pulls.kind}\` pull request provider could not be asked: ${oneLine(messageOf(error))}`,
      proposal: 'run `rafa doctor` to see what the provider needs, then read the state again',
    };
  }
}
