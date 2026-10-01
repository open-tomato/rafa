/**
 * A plan's `Owns:` folders: the folders a stage step's tests are chosen
 * under (`stageStepScope` in `./scope.ts`).
 *
 * A plan has no `Owns:` line of its own. It names the spec issue it was
 * written from in its `rafa:plan` block (`issue: "<n>"`, the header field
 * `PlanHeader.issue` reads), the spec issue names its epic by an
 * `epic:<slug>` label, and the epic issue's body carries the line. So
 * {@link readPlanOwns} walks that chain with at most two `gh` commands:
 *
 * ```
 * gh issue view <n> --json number,title,body,state,labels,author
 * gh issue list --state all --label type:epic --label epic:<slug> --limit 20 --json number,title,body,state,stateReason,labels
 * ```
 *
 * Nothing is parsed a second way: the first command is
 * `createGhSpecIssueReader`'s (`../board/issue.ts`), the second is
 * `epicContextArgs`'s with the rows checked by `parseBoardListing`, as
 * `readEpicContext` (`../board/epic-context.ts`) finds a spec's epic, and
 * the line is read by `ownedBoard` (`../board/board-owns.ts`), so the
 * folders come out repo-relative and normalised exactly as a board's do.
 * `readEpicContext` itself is not called: it warns in the planner's
 * words ("planned without its epic") and answers no body.
 *
 * ## None, never a throw
 *
 * The folders only narrow a stage step; without them the step runs the
 * whole suite, which is always correct. So every way the chain breaks
 * answers {@link PlanOwnsNone}, with a reason and a sentence for the run
 * record, and the reader never rejects:
 *
 * - `no-issue`: the plan names no issue, or one that is not a GitHub
 *   issue number (`OPT-123`); no command is sent;
 * - `no-epic`: the spec issue carries no `epic:` label, two or more of
 *   them, or a slug no `type:epic` issue carries, or several do;
 * - `no-owns-line`: the epic's body has no `Owns:` line, or one naming no
 *   folder the board reader accepts;
 * - `gh-failed`: either command failed or answered another shape.
 *
 * Nothing here spawns: `gh` arrives through the {@link GhRunner} seam,
 * and `./owns.test.ts` plants every answer.
 */
import type { GhRunner } from '../adapters/tracker/github.js';

import { ownedBoard } from '../board/board-owns.js';
import { epicContextArgs } from '../board/epic-context.js';
import { EPIC_LABEL_PREFIX, epicSlugsOf } from '../board/epics.js';
import { createGhSpecIssueReader } from '../board/issue.js';
import { parseBoardListing } from '../board/roadmap-board.js';
import { messageOf } from '../config-sections.js';

/** Why a plan has no `Owns:` folders; the module note lists each. */
export type PlanOwnsReason = 'no-issue' | 'no-epic' | 'no-owns-line' | 'gh-failed';

/** A plan whose epic names its folders. */
export interface PlanOwnsFound {
  /** The epic's `Owns:` folders, repo-relative, never empty. */
  readonly owns: readonly string[];
  /** The spec issue the plan names. */
  readonly issue: number;
  /** The epic issue the line was read from. */
  readonly epic: number;
}

/** A plan without `Owns:` folders: its stage steps run the whole suite. */
export interface PlanOwnsNone {
  readonly owns: null;
  /** Which link of the chain broke. */
  readonly reason: PlanOwnsReason;
  /** One sentence saying what was missing or what failed. */
  readonly detail: string;
}

/** What {@link readPlanOwns} answers. */
export type PlanOwns = PlanOwnsFound | PlanOwnsNone;

/** What {@link readPlanOwns} reads. */
export interface PlanOwnsOptions {
  /** The plan header's `issue` value, or null when it has none. */
  readonly issue: string | null;
  /** Runs the `gh` commands; see the module note. */
  readonly gh: GhRunner;
}

/** A GitHub issue number, whole: digits after an optional `#`. */
const ISSUE_NUMBER = /^#?(\d+)$/u;

/** The answer for a broken link. */
function none(reason: PlanOwnsReason, detail: string): PlanOwnsNone {
  return Object.freeze({ owns: null, reason, detail });
}

/** The positive issue number `issue` names, or null. */
function issueNumberOf(issue: string | null): number | null {
  const digits = ISSUE_NUMBER.exec(issue?.trim() ?? '')?.[1];
  if (digits === undefined) return null;
  const number = Number(digits);
  return Number.isSafeInteger(number) && number > 0
    ? number
    : null;
}

/** The `epic:` slug of issue `issue`, or the reason it has none. */
async function epicSlugOf(issue: number, gh: GhRunner): Promise<string | PlanOwnsNone> {
  let labels: readonly string[];
  try {
    labels = (await createGhSpecIssueReader({ gh })(issue)).labels;
  } catch (error) {
    return none('gh-failed', messageOf(error));
  }
  const slugs = epicSlugsOf(labels);
  const [slug, ...others] = slugs;
  if (slug === undefined) return none('no-epic', `issue #${String(issue)} carries no "${EPIC_LABEL_PREFIX}" label`);
  if (others.length > 0) {
    const named = slugs.map((each) => `"${EPIC_LABEL_PREFIX}${each}"`).join(', ');
    return none('no-epic', `issue #${String(issue)} carries ${String(slugs.length)} epic labels (${named})`);
  }
  return slug;
}

/** The folders the one epic carrying `slug` owns, or the reason there are none. */
async function epicOwns(issue: number, slug: string, gh: GhRunner): Promise<PlanOwns> {
  const args = epicContextArgs(slug);
  const command = `gh ${args.join(' ')}`;
  let result;
  try {
    result = await gh(args);
  } catch (error) {
    return none('gh-failed', `${command} failed (${messageOf(error)})`);
  }
  if (!result.ok) {
    const written = result.stderr.trim() || result.stdout.trim() || 'nothing';
    return none('gh-failed', `${command} failed (${written})`);
  }
  let epics;
  try {
    epics = parseBoardListing(result.stdout, command);
  } catch (error) {
    return none('gh-failed', messageOf(error));
  }
  const label = `${EPIC_LABEL_PREFIX}${slug}`;
  const [epic, ...others] = epics;
  if (epic === undefined) return none('no-epic', `no type:epic issue carries "${label}"`);
  if (others.length > 0) {
    const found = epics.map((each) => `#${String(each.number)}`).join(', ');
    return none('no-epic', `${String(epics.length)} epics carry "${label}" (${found})`);
  }
  const { owns } = ownedBoard(epic);
  if (owns.length === 0) return none('no-owns-line', `epic #${String(epic.number)} names no Owns: folder`);
  return Object.freeze({ owns, issue, epic: epic.number });
}

/**
 * The `Owns:` folders of the plan whose header names `options.issue`,
 * read through its spec issue's epic, or {@link PlanOwnsNone} saying
 * which link broke. Never rejects; sends at most two `gh` commands.
 */
export async function readPlanOwns(options: PlanOwnsOptions): Promise<PlanOwns> {
  const issue = issueNumberOf(options.issue);
  if (issue === null) {
    return options.issue === null
      ? none('no-issue', 'the plan names no issue')
      : none('no-issue', `the plan's issue "${options.issue}" is not a GitHub issue number`);
  }
  const slug = await epicSlugOf(issue, options.gh);
  if (typeof slug !== 'string') return slug;
  return epicOwns(issue, slug, options.gh);
}
