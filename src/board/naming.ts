/**
 * The one place a board item's names are spelled: the slug read from an
 * issue title, the spec path, the plan stub, the branch and the
 * pull-request title built from it, and the local notes file that sits
 * beside the spec.
 *
 * Every piece of work on this repository has one issue, and that issue's
 * number is its id everywhere else (`.rafa/specs/rafa-20-pr-commands.md`):
 *
 * ```text
 * id                  rafa-20
 * spec                <specs.dir>/rafa-20-pr-commands.md
 * local notes         <specs.dir>/rafa-20-notes.md
 * plan stub           rafa-20-pr-commands
 * branch              feat/rafa-20-pr-commands
 * pull-request title  rafa-20: Pull request commands
 * ```
 *
 * The local notes file is the one name with NO slug in it, on purpose: a
 * person writes that file BEFORE any snapshot exists, on a machine that
 * has not asked `gh` for the title, so a name carrying the slug would be
 * a name they could not spell — and an issue retitled later would orphan
 * the notes they had written under the old one. The id alone is enough,
 * since it is unique already.
 *
 * The spellings are ONE convention with several surfaces, and they are
 * written here together because a caller that spells one of them by hand
 * is a caller that can disagree with the others. The disagreement is not
 * cosmetic: `src/effort/attribution.ts` matches a branch back to its
 * plan by name, and `plan create --next` calls a roadmap line TAKEN when
 * a branch `feat/rafa-<n>-*` exists, so a branch spelled a second way is
 * work that looks unclaimed and effort that attributes to nothing.
 *
 * Nothing here touches the filesystem, the board or the configuration.
 * These are pure string functions over a number and a title, so the
 * cases in `./naming.test.ts` need no seams at all.
 *
 * ## The slug
 *
 * The spec asks for slugs that "say what the user gets, two to four
 * words". A person writing one by hand can do that; this function is
 * handed whatever the issue title says, so the rule it applies is:
 *
 *  1. Drop a leading id the title already carries, so a title written
 *     `rafa-20: pull request commands` does not answer the stub
 *     `rafa-20-rafa-20-pull-request-commands`. An issue template cannot
 *     stop a person from repeating the id in the title, and this is
 *     cheaper than noticing the doubled id later in a branch name.
 *  2. Cut at the first clause break — a comma, a colon, a semicolon, a
 *     dash or an opening bracket — because a title's first clause is
 *     what it is about and the rest qualifies it. The cut is KEPT only
 *     when the clause still leaves {@link MIN_SLUG_WORDS} words, so a
 *     list-shaped title such as `Plan, review and merge` answers
 *     `plan-review-merge` rather than the one-word `plan`.
 *  3. Drop the stop words in {@link STOP_WORDS}, which carry no meaning
 *     in a path; `the GitHub CLI as a declared dependency` answers
 *     `github-cli-declared-dependency`. They are dropped only while some
 *     word survives: a title that is nothing but stop words keeps them,
 *     because a slug reading `untitled` says less than one reading `as`.
 *  4. Keep the first {@link MAX_SLUG_WORDS} words, lower-cased, joined
 *     by single hyphens.
 *
 * A title with no word characters at all — an emoji, punctuation, a
 * script this transliterates nothing of — answers {@link FALLBACK_SLUG}.
 * That is a name, not a refusal: the id in front of it still makes the
 * spec path, the stub and the branch unique, so the run proceeds with a
 * dull name rather than halting on a title nobody has to retype.
 *
 * ## The number
 *
 * Every spelling takes the issue number and refuses one that is not a
 * positive integer, with a `RangeError` naming what it was handed. A
 * number arriving here comes from `gh`, or from a flag already parsed,
 * so a bad one is a defect in the caller and not a person's typo: it
 * should stop the run where it is, rather than spell `rafa-NaN-...`
 * into a branch that then exists.
 */
import path from 'path';

/** The prefix every board id carries: `rafa-20`. */
export const ID_PREFIX = 'rafa';

/** The prefix every branch carries, over the id: `feat/rafa-20-...`. */
export const BRANCH_PREFIX = 'feat';

/** The extension a spec snapshot is written under. */
export const SPEC_EXTENSION = '.md';

/** What the local notes file's name carries after the id, before the extension. */
export const NOTES_SUFFIX = '-notes';

/** How many words a slug keeps; the top of the spec's two-to-four. */
export const MAX_SLUG_WORDS = 4;

/** How few words a first clause may leave before the cut is dropped. */
export const MIN_SLUG_WORDS = 2;

/** The slug a title with no usable word answers. */
export const FALLBACK_SLUG = 'untitled';

/**
 * Words dropped from a slug when some other word survives them. They are
 * the articles, conjunctions and prepositions an English title hangs
 * together with, and none of them narrows down what a spec is about.
 */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'and', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into',
  'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'this', 'to',
  'with',
]);

/** Where a title stops naming its subject and starts qualifying it. */
const CLAUSE_BREAK = /[,;:([–—]|\s-\s/u;

/** A leading id the title repeats: `rafa-20`, `rafa-20:`, `#rafa-20 -`. */
const LEADING_ID = /^\s*#?rafa[-\s]?\d+\s*[-:.–—]?\s*/iu;

/** Anything that is not a slug character, in runs. */
const NON_WORD = /[^a-z0-9]+/gu;

/**
 * Refuses an issue number that is not a positive integer, so no spelling
 * below can put `NaN` or `-1` into a path, a branch or a title.
 */
function requireIssueNumber(issue: number): number {
  if (!Number.isInteger(issue) || issue <= 0) {
    throw new RangeError(`An issue number must be a positive integer, not ${String(issue)}.`);
  }

  return issue;
}

/** `title` split into lower-case words, punctuation dropped. */
function wordsOf(title: string): string[] {
  return title.toLowerCase()
    .replace(NON_WORD, ' ')
    .split(' ')
    .filter((word) => word !== '');
}

/** `words` without the stop words, unless that would leave nothing. */
function withoutStopWords(words: readonly string[]): readonly string[] {
  const kept = words.filter((word) => !STOP_WORDS.has(word));
  return kept.length > 0
    ? kept
    : words;
}

/**
 * The slug for `title`: the module note holds the four steps and why the
 * clause cut is conditional.
 */
export function slugFromTitle(title: string): string {
  const withoutId = title.replace(LEADING_ID, '');
  const [firstClause = ''] = withoutId.split(CLAUSE_BREAK);

  const whole = withoutStopWords(wordsOf(withoutId));
  const clause = withoutStopWords(wordsOf(firstClause));
  const chosen = clause.length >= MIN_SLUG_WORDS
    ? clause
    : whole;

  if (chosen.length === 0) return FALLBACK_SLUG;
  return chosen.slice(0, MAX_SLUG_WORDS).join('-');
}

/** The id of issue `issue`: `rafa-20`. */
export function boardId(issue: number): string {
  return `${ID_PREFIX}-${requireIssueNumber(issue)}`;
}

/**
 * The plan stub for an issue: `rafa-20-pr-commands`. It is also the
 * spec's basename, which is why {@link specFileName} is spelled from it
 * rather than beside it.
 */
export function planStub(issue: number, title: string): string {
  return `${boardId(issue)}-${slugFromTitle(title)}`;
}

/** The spec's file name: the plan stub under `.md`. */
export function specFileName(issue: number, title: string): string {
  return `${planStub(issue, title)}${SPEC_EXTENSION}`;
}

/**
 * Where the spec snapshot for an issue is written: its file name under
 * `specsDir`, as `specs.dir` resolved it.
 */
export function specPath(specsDir: string, issue: number, title: string): string {
  return path.join(specsDir, specFileName(issue, title));
}

/**
 * The local notes file's name for an issue: `rafa-20-notes.md`. It
 * carries no slug; the module note holds why.
 */
export function notesFileName(issue: number): string {
  return `${boardId(issue)}${NOTES_SUFFIX}${SPEC_EXTENSION}`;
}

/**
 * Where an issue's local notes live: beside its spec snapshot, under
 * `specsDir` as `specs.dir` resolved it.
 */
export function notesPath(specsDir: string, issue: number): string {
  return path.join(specsDir, notesFileName(issue));
}

/** The branch an issue is worked on: `feat/rafa-20-pr-commands`. */
export function branchName(issue: number, title: string): string {
  return `${BRANCH_PREFIX}/${planStub(issue, title)}`;
}

/**
 * The pull request's title: the id, then the issue's own title. The
 * title is carried whole, with its clauses and its capitals, since a
 * person reads it; only the slug is narrowed.
 */
export function pullRequestTitle(issue: number, title: string): string {
  const id = boardId(issue);
  const spoken = title.replace(LEADING_ID, '').trim();
  return spoken === ''
    ? id
    : `${id}: ${spoken}`;
}
