/**
 * The label faults on one board listing, read: every issue carrying two
 * `epic:` labels, every `epic:` label no epic owns, every epic without
 * exactly one `horizon:` label, every checklist spec missing its epic's
 * label and every labelled spec missing from its epic's checklist.
 *
 * An epic is an issue labelled `type:epic` and `epic:<slug>` plus one
 * `horizon:now|next|later` label
 * (`.rafa/specs/rafa-244-epics-group-issues-features.md`). Membership is
 * the label and order is the checklist, so each fault here is one the
 * epic reader (`./epics.ts`) would otherwise pass over in silence: a
 * member dropped by a mistyped slug makes an epic read done early, and a
 * spec on the checklist without the label is never counted. Nothing here
 * spawns `gh`, reads git or opens a file: {@link readEpicProblems} is a
 * pure function over the listing, and every case in
 * `./epic-problems.test.ts` is a literal listing. A failed listing has
 * no labels to read; the caller reports its reason as `./epics.ts` does.
 *
 * ## Every problem names an issue and a slug
 *
 * Each {@link EpicProblem} carries the issue a report points at and the
 * slug it is about, so one line per problem can say both:
 *
 * ```text
 * several-epic-labels   the issue carrying them; its first slug, all in `slugs`
 * orphan-label          each issue carrying the label; the label's slug
 * horizon               the epic; its slug, null when it carries none
 * unlabelled-checklist  the spec on the checklist; the epic's slug
 * unlisted-member       the labelled spec; the epic's slug
 * ```
 *
 * Problems come in that order, then by issue number, then by slug.
 *
 * ## Which labels count
 *
 * Labels are read as `./epics.ts` reads them, with {@link epicSlugsOf}
 * and {@link groupByEpicLabel} taken whole: the `epic:` prefix matched as
 * written, a slug repeated on one issue counted once.
 *
 * - TWO `epic:` labels is a fault on any issue, a `type:epic` one
 *   included: an issue belongs to exactly one epic.
 * - An `epic:` label is OWNED when a `type:epic` issue's FIRST `epic:`
 *   label spells it, because that is the slug `./epics.ts` reads the
 *   epic's members by. A label found only as an epic's second `epic:`
 *   label therefore reads as owned by no epic, which is what the reader
 *   does with its members; the epic's two labels are reported as well.
 *   The orphan is reported once per non-epic issue carrying it.
 * - A `horizon:` label is any label with that prefix, its value not
 *   checked; an epic with none or with two or more is reported with all
 *   of them in `horizons`.
 *
 * ## The two sources of order
 *
 * The checklist is {@link parseRoadmapBody}'s answer for the epic's body,
 * never respelled: fenced lines skipped, a repeated issue reported once.
 * An epic carrying no `epic:` label has no label to compare with and is
 * skipped by both checks; its horizon is still read.
 *
 * - A checklist line is UNLABELLED when its issue is on the listing, is
 *   not itself a `type:epic` issue, and does not carry the epic's
 *   `epic:<slug>`. An issue missing from the listing is not reported: its
 *   labels were not read, and a board larger than the listing limit
 *   leaves some out (`./roadmap-board.ts`).
 * - A member is UNLISTED when it carries the label and its number is on
 *   no checklist line. A `type:bug` member is left out: bugs are members
 *   by label only, and a sweep spec lists the bugs it clears. A closed
 *   member is still reported; the checklist is the epic's order, and a
 *   closed spec missing from it is as absent as an open one.
 *
 * ## In native mode
 *
 * With `board.relationships` set to `native`, membership is the
 * sub-issue parent and order the sub-issue order
 * (`./relations/native.ts`), and an epic is named by its number and
 * title. Four of the five kinds are marks of the `epic:` labels and the
 * checklist, which only the `labels` mode reads, so they are not read
 * there: {@link readHorizonProblems} answers the one kind left, every
 * epic without exactly one `horizon:` label, each with a null slug,
 * since a horizon is a label in both modes. {@link readEpicProblems} is
 * the `labels` mode's reading and is never asked in `native` mode.
 */
import type { BoardIssue } from './roadmap-board.js';

import { EPIC_LABEL_PREFIX, epicSlugsOf, groupByEpicLabel } from './epics.js';
import { parseRoadmapBody } from './roadmap.js';

/** What a `horizon:` label opens with. */
export const HORIZON_LABEL_PREFIX = 'horizon:';

/** Every kind of problem, in the order {@link readEpicProblems} answers them. */
export const EPIC_PROBLEM_KINDS = Object.freeze([
  'several-epic-labels',
  'orphan-label',
  'horizon',
  'unlabelled-checklist',
  'unlisted-member',
] as const);

/** One kind of label problem. */
export type EpicProblemKind = typeof EPIC_PROBLEM_KINDS[number];

/** An issue carrying two or more `epic:` labels. */
export interface SeveralEpicLabelsProblem {
  readonly kind: 'several-epic-labels';
  /** The issue carrying them. */
  readonly issue: number;
  /** Its first slug. */
  readonly slug: string;
  /** Every slug it carries, in label order. */
  readonly slugs: readonly string[];
}

/** An issue carrying an `epic:` label that no epic owns. */
export interface OrphanLabelProblem {
  readonly kind: 'orphan-label';
  /** The issue carrying the label. */
  readonly issue: number;
  /** The label's slug. */
  readonly slug: string;
}

/** An epic carrying no `horizon:` label, or two or more. */
export interface HorizonProblem {
  readonly kind: 'horizon';
  /** The epic. */
  readonly issue: number;
  /** The epic's slug, or null when it carries no `epic:` label. */
  readonly slug: string | null;
  /** Every `horizon:` label it carries, in label order; empty when none. */
  readonly horizons: readonly string[];
}

/** A spec on an epic's checklist that does not carry the epic's label. */
export interface UnlabelledChecklistProblem {
  readonly kind: 'unlabelled-checklist';
  /** The spec the checklist line points at. */
  readonly issue: number;
  /** The epic's slug, the label the spec is missing. */
  readonly slug: string;
  /** The epic whose checklist names it. */
  readonly epic: number;
  /** The 1-based line of the epic body naming it. */
  readonly lineNumber: number;
}

/** A spec carrying an epic's label that its checklist does not name. */
export interface UnlistedMemberProblem {
  readonly kind: 'unlisted-member';
  /** The labelled spec. */
  readonly issue: number;
  /** The epic's slug, the label the spec carries. */
  readonly slug: string;
  /** The epic whose checklist leaves it out. */
  readonly epic: number;
}

/** One label problem on the listing. */
export type EpicProblem =
  | SeveralEpicLabelsProblem
  | OrphanLabelProblem
  | HorizonProblem
  | UnlabelledChecklistProblem
  | UnlistedMemberProblem;

/** `issues` in ascending number, the listing left as it was. */
function byNumber<T extends { readonly number: number }>(issues: readonly T[]): readonly T[] {
  return [...issues].sort((left, right) => left.number - right.number);
}

/** Every issue carrying two or more `epic:` labels. */
function severalEpicLabels(issues: readonly BoardIssue[]): readonly EpicProblem[] {
  return issues.flatMap((issue) => {
    const slugs = epicSlugsOf(issue.labels);
    const [slug] = slugs;
    return slug === undefined || slugs.length < 2
      ? []
      : [{ kind: 'several-epic-labels', issue: issue.number, slug, slugs } as const];
  });
}

/** Every non-epic issue carrying an `epic:` label no epic's first label spells. */
function orphanLabels(
  groups: ReadonlyMap<string, readonly BoardIssue[]>,
  owned: ReadonlySet<string>,
): readonly EpicProblem[] {
  return [...groups.entries()]
    .filter(([slug]) => !owned.has(slug))
    .flatMap(([slug, carriers]) => carriers.map((carrier) => ({
      kind: 'orphan-label',
      issue: carrier.number,
      slug,
    } as const)));
}

/** Every epic carrying no `horizon:` label, or two or more, its slug read by `slugOf`. */
function horizons(epics: readonly BoardIssue[], slugOf: (epic: BoardIssue) => string | null): readonly EpicProblem[] {
  return epics.flatMap((epic) => {
    const found = epic.labels.filter((label) => label.startsWith(HORIZON_LABEL_PREFIX));
    return found.length === 1
      ? []
      : [{
        kind: 'horizon',
        issue: epic.number,
        slug: slugOf(epic),
        horizons: Object.freeze(found),
      } as const];
  });
}

/** An epic's slug as the `labels` mode reads it: its first `epic:` label's, or null. */
function firstSlugOf(epic: BoardIssue): string | null {
  return epicSlugsOf(epic.labels)[0] ?? null;
}

/** One epic's two order checks: its checklist against its label, both ways. */
function orderProblems(
  epic: BoardIssue,
  slug: string,
  listed: ReadonlyMap<number, BoardIssue>,
  members: readonly BoardIssue[],
): readonly EpicProblem[] {
  const lines = parseRoadmapBody(epic.body);
  const named = new Set(lines.map((line) => line.issue));
  const seen = new Set<number>();

  const unlabelled = lines.flatMap((line) => {
    const spec = listed.get(line.issue);
    if (seen.has(line.issue) || spec === undefined || spec.type === 'epic') return [];
    seen.add(line.issue);
    return epicSlugsOf(spec.labels).includes(slug)
      ? []
      : [{ kind: 'unlabelled-checklist', issue: line.issue, slug, epic: epic.number, lineNumber: line.lineNumber } as const];
  });
  const unlisted = members
    .filter((member) => member.type !== 'bug' && !named.has(member.number))
    .map((member) => ({ kind: 'unlisted-member', issue: member.number, slug, epic: epic.number } as const));

  return [...unlabelled, ...unlisted];
}

/** Problems in kind order, then by issue number, then by slug. */
function compareProblems(left: EpicProblem, right: EpicProblem): number {
  const kind = EPIC_PROBLEM_KINDS.indexOf(left.kind) - EPIC_PROBLEM_KINDS.indexOf(right.kind);
  if (kind !== 0) return kind;
  if (left.issue !== right.issue) return left.issue - right.issue;
  return (left.slug ?? '').localeCompare(right.slug ?? '');
}

/**
 * Every label problem on `issues`, a board listing, in the order the
 * module note gives. Never throws; an empty answer is a clean board.
 */
export function readEpicProblems(issues: readonly BoardIssue[]): readonly EpicProblem[] {
  const sorted = byNumber(issues);
  const epics = sorted.filter((issue) => issue.type === 'epic');
  const groups = groupByEpicLabel(sorted);
  const listed = new Map(sorted.map((issue) => [issue.number, issue]));
  const owned = new Set(epics.flatMap((epic) => epicSlugsOf(epic.labels).slice(0, 1)));

  const order = epics.flatMap((epic) => {
    const slug = epicSlugsOf(epic.labels)[0];
    return slug === undefined
      ? []
      : orderProblems(epic, slug, listed, groups.get(slug) ?? []);
  });

  const problems = [
    ...severalEpicLabels(sorted),
    ...orphanLabels(groups, owned),
    ...horizons(epics, firstSlugOf),
    ...order,
  ].sort(compareProblems);
  return Object.freeze(problems);
}

/**
 * The `horizon` problems on `issues` alone, in ascending epic number,
 * each with a null slug: the one kind the `native` mode reads, as the
 * module note's "In native mode" holds. Never throws.
 */
export function readHorizonProblems(issues: readonly BoardIssue[]): readonly EpicProblem[] {
  const epics = byNumber(issues).filter((issue) => issue.type === 'epic');
  return Object.freeze([...horizons(epics, () => null)]);
}

/** The sentence a report prints for `problem`: what is wrong and what fixes it. */
export function epicProblemMessage(problem: EpicProblem): string {
  const id = `#${String(problem.issue)}`;

  switch (problem.kind) {
    case 'several-epic-labels': {
      const labels = problem.slugs.map((slug) => `${EPIC_LABEL_PREFIX}${slug}`).join(', ');
      return `${id} carries ${String(problem.slugs.length)} epic labels (${labels}); an issue belongs to one epic, so remove all but one`;
    }
    case 'orphan-label':
      return `${id} carries ${EPIC_LABEL_PREFIX}${problem.slug}, which no type:epic issue carries; fix the slug or open the epic`;
    case 'horizon':
      return problem.horizons.length === 0
        ? `epic ${id} carries no ${HORIZON_LABEL_PREFIX} label; add one of horizon:now, horizon:next or horizon:later`
        : `epic ${id} carries ${String(problem.horizons.length)} horizon labels (${problem.horizons.join(', ')}); keep one`;
    case 'unlabelled-checklist':
      return `${id} is on epic #${String(problem.epic)}'s checklist on line ${String(problem.lineNumber)}`
        + ` but does not carry ${EPIC_LABEL_PREFIX}${problem.slug}; label it or take it off the checklist`;
    case 'unlisted-member':
      return `${id} carries ${EPIC_LABEL_PREFIX}${problem.slug} but is not on epic #${String(problem.epic)}'s checklist;`
        + ' it is walked last, by issue number, until it is added';
  }
}
