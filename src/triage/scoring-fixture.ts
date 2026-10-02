/**
 * The scoring fixture of the nearest-open-bug step (`./similarity.ts`):
 * what the board's own bug issues say about which reports were one bug,
 * so a threshold is measured on real wording and not assumed.
 *
 * `scripts/extract-scoring-fixture.ts` reads the board with `gh` and
 * writes `./testdata/scoring.json`; this module holds the reading that
 * script and its test share, with no `gh` call in it.
 *
 * ## What a filing is
 *
 * A filing is one report the loop wrote to the board: the body of an issue
 * triage filed ({@link ISSUE_OPENING}) or one of its `Reported again`
 * comments ({@link COMMENT_OPENING}), reduced to the `What` and `Artifact`
 * values the step compares, in the order they were written. An issue a
 * person wrote carries no such sections and gives no filing, and neither
 * do its comments.
 *
 * ## The cause label
 *
 * Every filing carries the number of the issue that owns its cause, which
 * is how the fixture says which filings were one bug. A filing's cause is
 * its issue's, and an issue's is read in this order:
 *
 *   - an issue `./testdata/scoring-causes.json` lists as excluded has none,
 *     and the issue and its comments are left out of the fixture: its
 *     reports name several causes, or one nobody could tell;
 *   - an issue the same file lists in a group has the group's cause: the
 *     board never linked many issues it closed for one bug, so the file
 *     holds a reading of their titles and artifacts, one group per bug;
 *   - an issue closed with `Duplicate of #N` (or `Inherited: duplicate of
 *     #N`) in a comment has cause N, itself read the same way, first link
 *     only, so that issue's own first report is a repeat of N's and not a
 *     new cause; one closed as a duplicate of no one issue (a sweep that
 *     folded a red-at-base report into the many causes behind it) has none;
 *   - every other issue is its own cause.
 *
 * A comment has its issue's cause unless the same file says otherwise by
 * its issue and comment number: the early triage put comments on issues by
 * a text search, and some landed on an unrelated issue. Such a comment has
 * the cause of what it says (a number), is a bug no other report names
 * (`"own"`, a number of its own from {@link OWN_CAUSE_BASE}), or, naming
 * several causes, is left out.
 *
 * The labels never come from this step's scores. Reports of one failure in
 * different test files are different causes, as the step's test-file guard
 * takes them. A cause nobody grouped or linked reads as several, which
 * makes the new-cause side of the measure stricter.
 *
 * ## Taken out
 *
 * Local paths ({@link localPathRedactor}) and named secrets
 * ({@link redactSecrets}) are taken out of every value as triage takes them
 * out of a filed text, then {@link leaksIn} refuses any value still holding
 * a home path or a token-shaped word, so a fixture is never written with
 * one.
 */
import { COMMENT_OPENING, ISSUE_OPENING } from './issue-text.js';
import { issueTextOf, sectionValueOf } from './similarity.js';

/** The board that was read, as `gh --repo` names it. */
export const FIXTURE_REPO = 'open-tomato/rafa';

/** One comment of a board issue, as `gh issue list --json comments` shows it. */
export interface BoardComment {
  readonly body: string;
  readonly createdAt: string;
}

/** One board issue, as `gh issue list --json number,body,createdAt,comments` shows it. */
export interface BoardIssue {
  readonly number: number;
  readonly body: string;
  readonly createdAt: string;
  readonly comments: readonly BoardComment[];
}

/** One report, labelled with its cause; see the module note. */
export interface Filing {
  /** The issue it was written on or into. */
  readonly issue: number;
  /** The 1-based place of its comment on that issue, or absent for the issue's own body. */
  readonly comment?: number;
  /** The number of the issue that owns the bug it reports. */
  readonly cause: number;
  readonly what: string;
  readonly artifact: string | null;
  /** The plan stub the report was made under, or null for none; the tracker file a key is built from. */
  readonly plan: string | null;
}

/** The file `scripts/extract-scoring-fixture.ts` writes. */
export interface ScoringFixture {
  readonly repo: string;
  readonly filings: readonly Filing[];
}

/**
 * The judgement `./testdata/scoring-causes.json` holds, over what the
 * board's closing comments say; see the module note.
 */
export interface CauseJudgement {
  /** Issues whose reports are one bug, by the number of the issue owning the cause. */
  readonly groups: Readonly<Record<string, readonly number[]>>;
  /** Issues whose reports name several causes or one nobody could tell. */
  readonly excluded: readonly number[];
  /**
   * Comments whose cause is not their issue's, by `<issue>.<comment>`: the
   * cause number they have, `"own"` for a bug no other report names, or
   * null for a comment naming several causes, which the fixture leaves out.
   */
  readonly filings: Readonly<Record<string, number | 'own' | null>>;
}

/** What the cause of a bug no other report names starts from; added to its issue and comment numbers. */
const OWN_CAUSE_BASE = 1_000_000;

/** The most comments one issue holds that an own cause number leaves room for. */
const OWN_CAUSE_ISSUE_STEP = 1000;

/** A comment naming the one issue its issue duplicates. */
const DUPLICATE_OF = /\b[Dd]uplicate of #(\d+)/;

/** A comment closing its issue as a duplicate of no single issue. */
const DUPLICATE_OF_MANY = /^Duplicate, closed in the stretch/;

/** The most links of `Duplicate of` followed before a chain is taken for a loop. */
const MAX_LINKS = 10;

/** The issue number `issue`'s comments name as the one it duplicates, or null. */
function linkOf(issue: BoardIssue): number | null {
  for (const { body } of issue.comments) {
    const match = DUPLICATE_OF.exec(body);
    if (match?.[1] !== undefined) return Number(match[1]);
  }
  return null;
}

/** True when `issue` was closed as a duplicate of no one issue. */
function isFolded(issue: BoardIssue): boolean {
  return linkOf(issue) === null && issue.comments.some(({ body }) => DUPLICATE_OF_MANY.test(body));
}

/** The cause the board's closing comments give `issue`, or null when it has none. */
function boardCauseOf(issue: BoardIssue, byNumber: ReadonlyMap<number, BoardIssue>): number | null {
  if (isFolded(issue)) return null;
  let cause = issue.number;
  for (let links = 0; links < MAX_LINKS; links++) {
    const next = linkOf(byNumber.get(cause) ?? issue);
    if (next === null || next === cause) return cause;
    cause = next;
  }
  return issue.number;
}

/** The group number each grouped issue belongs to. */
function groupOf(judgement: CauseJudgement): ReadonlyMap<number, number> {
  const entries = Object.entries(judgement.groups)
    .flatMap(([cause, members]) => members.map((member): [number, number] => [member, Number(cause)]));
  return new Map(entries);
}

/** The cause of `issue`, or null when it has none; see the module note. */
export function causeOf(
  issue: BoardIssue,
  byNumber: ReadonlyMap<number, BoardIssue>,
  judgement: CauseJudgement,
): number | null {
  if (judgement.excluded.includes(issue.number)) return null;
  const groups = groupOf(judgement);
  const own = groups.get(issue.number);
  if (own !== undefined) return own;
  const board = boardCauseOf(issue, byNumber);
  return board === null
    ? null
    : groups.get(board) ?? board;
}

/** A filing from `body` on `issue`, or null when the body holds no `What`. */
function filingOf(
  body: string,
  place: Pick<Filing, 'issue' | 'comment' | 'cause'>,
  redact: (text: string) => string,
): Filing | null {
  const { what, artifact } = issueTextOf(body);
  if (what === null) return null;
  const plan = sectionValueOf(body, 'Plan');
  return {
    ...place,
    what: redact(what),
    artifact: artifact === null
      ? null
      : redact(artifact),
    plan: plan === null
      ? null
      : redact(plan).trim(),
  };
}

/** The cause of comment `comment` on `issue`, its issue's `cause` unless the judgement says otherwise; null leaves it out. */
function commentCause(issue: number, comment: number, cause: number, judgement: CauseJudgement): number | null {
  const reading = judgement.filings[`${String(issue)}.${String(comment)}`];
  if (reading === undefined) return cause;
  return reading === 'own'
    ? OWN_CAUSE_BASE + issue * OWN_CAUSE_ISSUE_STEP + comment
    : reading;
}

/** One issue's filings, oldest first, each with its cause; empty for an issue triage did not file. */
function filingsOn(
  issue: BoardIssue,
  byNumber: ReadonlyMap<number, BoardIssue>,
  redact: (text: string) => string,
  judgement: CauseJudgement,
): Filing[] {
  if (!issue.body.startsWith(ISSUE_OPENING)) return [];
  const cause = causeOf(issue, byNumber, judgement);
  if (cause === null) return [];
  const own = filingOf(issue.body, { issue: issue.number, cause }, redact);
  const repeats = issue.comments.map((comment, at) => {
    const place = commentCause(issue.number, at + 1, cause, judgement);
    return comment.body.startsWith(COMMENT_OPENING) && place !== null
      ? filingOf(comment.body, { issue: issue.number, comment: at + 1, cause: place }, redact)
      : null;
  });
  return [own, ...repeats].flatMap((filing) => filing ?? []);
}

/** The time a filing was written, for ordering. */
function writtenAt(filing: Filing, byNumber: ReadonlyMap<number, BoardIssue>): string {
  const issue = byNumber.get(filing.issue)!;
  return filing.comment === undefined
    ? issue.createdAt
    : issue.comments[filing.comment - 1]!.createdAt;
}

/** Every filing of `issues`, in the order they were written; see the module note. */
export function filingsOf(
  issues: readonly BoardIssue[],
  redact: (text: string) => string,
  judgement: CauseJudgement,
): Filing[] {
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const all = issues.flatMap((issue) => filingsOn(issue, byNumber, redact, judgement));
  // Stable, so two filings in one second keep the issue-then-comment order.
  return [...all].sort((a, b) => writtenAt(a, byNumber).localeCompare(writtenAt(b, byNumber)));
}

/** A word that names a home directory. */
const HOME_PATH = /\/(?:Users|home)\/[\w.-]+/;

/** A word shaped like a token: a GitHub, Anthropic or Linear key. */
const TOKEN_SHAPE = /\b(?:gh[pousr]_\w{10,}|github_pat_\w+|sk-ant-[\w-]+|lin_api_\w+)/;

/** The `value`'s leak, a short name, or null when it holds none; see the module note. */
export function leaksIn(value: string): string | null {
  if (HOME_PATH.test(value)) return 'a home path';
  if (TOKEN_SHAPE.test(value)) return 'a token';
  return null;
}

/** The first leak any value of `filings` holds, naming its filing, or null. */
export function firstLeakIn(filings: readonly Filing[]): string | null {
  for (const filing of filings) {
    const leak = leaksIn(filing.what) ?? leaksIn(filing.artifact ?? '');
    if (leak !== null) {
      const place = filing.comment === undefined
        ? ''
        : ` comment ${String(filing.comment)}`;
      return `issue ${String(filing.issue)}${place} holds ${leak}`;
    }
  }
  return null;
}
