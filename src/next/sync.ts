/**
 * The one action of `./state.ts` that runs no registered command: the
 * fast-forward of a base that is behind its remote, spawned through the
 * git seam of `src/pr/git.ts`.
 *
 * Row 2 of the table answers `sync`, and `./actions.ts` maps the other
 * eight ids onto a command and answers null for this one — there is no
 * `rafa git pull`, and inventing one to hold two git commands would put
 * a command in the roster that nothing but `rafa next` would ever run.
 * So the step lives here as a function over a {@link GitRunner}, which
 * is the same seam `pr merge`'s clean-up is spawned through and the
 * same one `./readings.ts` reads the standing over.
 *
 * ## It answers, it does not throw
 *
 * {@link fastForwardBase} answers a {@link SyncOutcome} for every
 * ending, a refusal included, because the caller — `rafa next`, which
 * runs a chain of steps — decides what a refusal costs, prints it and
 * picks the exit code. That is the shape of `GitResult` itself
 * (`src/pr/git.ts`) and of `readStepOutcome`
 * (`src/start/branch-decision.ts`), whose refusal wording this one
 * follows: `❌` on the first line, the following lines indented, git's
 * own words quoted as it said them.
 *
 * ## A base that has diverged is refused, and by whom
 *
 * Row 2 fires on `behind > 0` alone, so a base that is ahead AND behind
 * reaches this step, and fast-forwarding it is impossible. The standing
 * is therefore read again here, off `git rev-list --left-right --count`,
 * and a divergence is refused BEFORE `git merge` is spawned, naming
 * both counts and leaving the choice between pushing, rebasing and
 * resetting to the person — the refusal `src/start/branch-decision.ts`
 * makes for the same standing, in the same words, since neither module
 * may move a commit the operator has not pushed.
 *
 * Being ahead alone is not being diverged: `git merge --ff-only`
 * answers `Already up to date.` for it and exits 0 (measured there on
 * git 2.50.1 under macOS with `LC_ALL=C`), which this module answers as
 * a step that moved nothing rather than as a failure.
 *
 * ## What it does NOT do
 *
 * It does not fetch. The standing row 2 is read over is fetched ahead
 * of it (`NextWorld.standing` in `./readings.ts` runs
 * `git fetch <remote> <base>` first), so a fetch here would be a second
 * network round trip inside one `rafa next`, and the `rev-list` it does
 * run is local and free. A caller reaching this function outside that
 * order fetches first, or it fast-forwards to whatever the clone
 * already holds.
 *
 * It does not check which branch is checked out either. Row 2 is read
 * on the base branch (`onBase` in `./readings.ts`), and the merge
 * moves whatever HEAD names — so the precondition for calling this is
 * that HEAD IS the base, and the row is what holds it.
 */
import type { GitRunner } from '../pr/index.js';

import { plural } from '../commands/plan/plan-files.js';
import { gitSaid } from '../pr/index.js';
import { hasDiverged, parseBaseStanding } from '../start/branch-decision.js';

/** The indent a refusal's following lines carry, as `src/start/branch-decision.ts` indents its own. */
const INDENT = '   ';

/** Which base is fast-forwarded, and to which remote's copy of it. */
export interface SyncPlan {
  /** The base branch, which is what HEAD names; see the module note. */
  readonly base: string;
  /** The remote its copy is read at: `origin`. */
  readonly remote: string;
}

/** What the fast-forward ended as. Never a throw; see the module note. */
export type SyncOutcome =
  | {
    readonly kind: 'synced';
    /** What git said about the merge, its own words, empty when it said nothing. */
    readonly said: string;
  }
  | {
    readonly kind: 'refused';
    /** The whole refusal, its first line opening with `❌`; the caller prints it. */
    readonly message: string;
  };

/** A refusal, its lines joined. */
function refuse(lines: readonly string[]): SyncOutcome {
  return Object.freeze({ kind: 'refused', message: lines.join('\n') });
}

/** What git said, each line indented, and nothing at all when it said nothing. */
function quotedLines(said: string): readonly string[] {
  return said === ''
    ? []
    : said.split('\n').map((line) => `${INDENT}${line}`);
}

/** The line every refusal here ends with: nothing was moved. */
function stillAt(base: string): string {
  return `${INDENT}${base} has not moved.`;
}

/** The tracking branch as every sentence here names it. */
function trackingOf(plan: SyncPlan): string {
  return `${plan.remote}/${plan.base}`;
}

/**
 * Fast-forwards `plan.base` onto its remote copy, reading how the two
 * stand first and refusing a base that has diverged. See the module
 * note for the refusals, what it does not do, and the precondition that
 * HEAD is the base.
 */
export function fastForwardBase(git: GitRunner, plan: SyncPlan): SyncOutcome {
  const { base } = plan;
  const tracking = trackingOf(plan);
  const counted = git(['rev-list', '--left-right', '--count', `${base}...${tracking}`]);
  if (!counted.ok) {
    return refuse([
      `❌ Could not read how ${base} stands against ${tracking}.`,
      ...quotedLines(gitSaid(counted)),
      stillAt(base),
    ]);
  }

  const standing = parseBaseStanding(counted.stdout);
  if (standing === null) {
    return refuse([
      `❌ Could not read how ${base} stands against ${tracking}.`,
      `${INDENT}git answered ${JSON.stringify(counted.stdout)}, which is no pair of counts.`,
      stillAt(base),
    ]);
  }
  if (hasDiverged(standing)) {
    return refuse([
      `❌ Refusing to fast-forward ${base}: it has diverged from ${tracking}.`,
      `${INDENT}${base} is ${plural(standing.ahead, 'commit')} ahead of ${tracking} and ${plural(standing.behind, 'commit')} behind it.`,
      `${INDENT}Push, rebase or reset ${base}, then run again.`,
    ]);
  }

  const merged = git(['merge', '--ff-only', tracking]);
  if (!merged.ok) {
    return refuse([
      `❌ Could not fast-forward ${base} to ${tracking}.`,
      ...quotedLines(gitSaid(merged)),
      stillAt(base),
    ]);
  }
  return Object.freeze({ kind: 'synced', said: gitSaid(merged) });
}
