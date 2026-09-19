/**
 * The roadmap issue `plan create --next` reads its order off: which
 * issue it is, its body parsed into ordered `#<n>` lines, the readings
 * that call a line done or taken, and the first line that is neither.
 *
 * ORDER lives in one place (`.specs/rafa-20-pr-commands.md`): a pinned
 * issue titled `Roadmap` carrying an ordered task list of `#<n>` lines
 * with a one-line why. `--next` reads that list, walks it from the top,
 * and answers the first line nobody has finished and nobody has
 * started. Everything after the answer is `--issue=<n>`'s job
 * (`./issue.ts`), and turning a flag into a spec path is
 * `./spec-source.ts`'s, so this module stops at the PICK.
 *
 * Nothing here spawns. The board arrives through the {@link GhRunner}
 * seam declared in `src/adapters/tracker/github.ts` and git through the
 * {@link GitRunner} declared in `src/pr/git.ts`, as they do for the
 * tracker, the pull request provider, the trust reading and the issue
 * snapshot. Every case in `./roadmap.test.ts` drives a fake of its own
 * over a planted roadmap body: none reaches GitHub, spawns `gh` or
 * `git`, or reads the configuration either keeps under the home.
 *
 * ## Which issue is the roadmap
 *
 * `roadmap.issue` in config names it. With nothing named, the fallback
 * is the OPEN issue titled {@link ROADMAP_TITLE}, found with
 * `gh issue list --search`.
 *
 * The spec calls that issue "the pinned issue titled Roadmap", and what
 * is matched here is the TITLE alone: `gh issue list` has no pinned
 * filter, and pinnedness is a GraphQL read this module would have to
 * make a second shape for. The difference shows when two open issues
 * share the title, and that case is REFUSED naming `roadmap.issue`
 * rather than resolved by guessing which one somebody pinned — a wrong
 * guess there plans the next session from another project's list.
 *
 * ## The lines
 *
 * A roadmap line is a markdown task-list item whose first word is an
 * issue reference: `- [ ] #33 the board setup`. {@link parseRoadmapBody}
 * answers them in the order the body writes them, with the tick, the
 * one-line why and the line number each was read at.
 *
 * Three things it deliberately does NOT do:
 *
 *  - It reads no line inside a fenced code block. The Roadmap issue
 *    carries a table mapping the retired phase names and can carry a
 *    fenced example; a `- [ ] #3` shown as an example is not a
 *    commitment, and reading it would reorder the roadmap from a
 *    sample.
 *  - It drops a task-list item that does not OPEN with `#<n>`, silently.
 *    The issue's body is prose as well as a list, and a checklist item
 *    about something else is not a malformed roadmap line.
 *  - It de-duplicates nothing. A body naming one issue on two lines
 *    keeps both, in order, because the second is a real entry to walk:
 *    whatever made the first done or taken makes the second so too, and
 *    dropping it would hide a list that needs an edit.
 *
 * ## Done, and taken
 *
 * A line is DONE when it is ticked or its issue is closed, and TAKEN
 * when a branch `feat/rafa-<n>-*` exists locally or on the remote, or an
 * open pull request closes it. The four readings are asked cheapest
 * first — the tick costs nothing, the issue state one `gh issue view`,
 * the branch a scan already in hand, the pull request one `gh pr list` —
 * and each line stops at the first that answers yes, so a ticked line at
 * the top of a long roadmap spends no call at all.
 *
 * The scan of branches is taken ONCE for a whole walk
 * ({@link scanClaimBranches}) and so is the list of open pull requests,
 * because both answer every line and neither changes mid-walk.
 *
 * ## The remote half of the branch scan, and why it is data
 *
 * "Locally or on the remote" is two reads: `git for-each-ref` over
 * `refs/heads` and `refs/remotes`, which is what this clone holds, and
 * `git ls-remote --heads`, which is what the remote holds NOW. The
 * second is the one that catches a branch a colleague pushed since the
 * last fetch, and it is also the one that fails on a machine with no
 * network, no remote, or no credentials for it.
 *
 * A failed remote read is neither swallowed nor thrown: it is carried
 * out as {@link BranchScan.problems}, a list of sentences the caller
 * prints beside its skip lines. Swallowing it would answer "nothing is
 * taken" from a reading that never happened — the silent failure that
 * hands two people the same spec — and throwing it would stop `--next`
 * on a train. The policy over that list is the command's
 * (`./spec-source.ts`), not this module's; what this module owes is a
 * reading that says which half of it is missing.
 *
 * ## What "an open pull request closes it" matches
 *
 * GitHub's own closing keywords, in the pull request's body:
 * `close`, `closes`, `closed`, `fix`, `fixes`, `fixed`, `resolve`,
 * `resolves`, `resolved`, each followed by `#<n>`. The spec's PR body is
 * `Closes #<n>`, and the rest are matched because a person writing
 * `Fixes #20` has claimed the issue just as plainly.
 *
 * The pull request's HEAD BRANCH is not read here, although the spec's
 * branch is `feat/rafa-<n>-<slug>`: an open pull request's head branch
 * exists on the remote by definition, so {@link scanClaimBranches}
 * answers it one reading earlier and the two would only ever report the
 * same claim twice, with the branch sentence — the one that names where
 * the work is — losing to the pull request's.
 */
import type { SpecIssueReader } from './issue.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { GitRunner } from '../pr/git.js';

import { CommandExit } from '../cli/command.js';
import { describeValue, isMapping, messageOf } from '../config-sections.js';

import { boardId, BRANCH_PREFIX } from './naming.js';

/** What every refusal and every failure this module raises opens with. */
const PREFIX = 'board roadmap';

/** The title the roadmap issue carries when `roadmap.issue` names none. */
export const ROADMAP_TITLE = 'Roadmap';

/** The setting that names the roadmap issue outright. */
export const ROADMAP_SETTING = 'roadmap.issue';

/** The exit code a refused roadmap ends the command with; the board's own. */
export const ROADMAP_REFUSAL_EXIT = 2;

/** The remote the branch scan asks when the caller names none. */
export const DEFAULT_REMOTE = 'origin';

/** How many open pull requests one `gh pr list` reads; see the module note. */
export const OPEN_PULL_REQUEST_LIMIT = 100;

/** The fields the open pull request list asks for. */
export const PR_LIST_FIELDS = 'number,headRefName,body';

/** The fields the roadmap search asks for. */
export const ISSUE_LIST_FIELDS = 'number,title';

/** A markdown task-list item opening with an issue reference. */
const TASK_LINE = /^\s*[-*+]\s+\[([ xX])\]\s+#(\d+)\s*(.*)$/u;

/** A fence opening or closing a code block, with any info string. */
const FENCE = /^\s*(?:`{3,}|~{3,})/u;

/** What a why opens with when the line spells a separator before it. */
const WHY_SEPARATOR = /^[-:,.–—]\s*/u;

/** GitHub's closing keywords, each with the issue it closes. */
const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?\s*#(\d+)\b/giu;

/** One `- [ ] #<n>` line of the roadmap, as the body writes it. */
export interface RoadmapLine {
  /** The issue the line points at. */
  readonly issue: number;
  /** True when the box is ticked, which is one of the two done readings. */
  readonly ticked: boolean;
  /** The one-line why after the reference, trimmed. Empty when there is none. */
  readonly why: string;
  /** Where the line sits in the body, counting from 1, for a message. */
  readonly lineNumber: number;
}

/** The why a line spells after its reference, with any separator dropped. */
function whyOf(rest: string): string {
  return rest.trim()
    .replace(WHY_SEPARATOR, '')
    .trim();
}

/**
 * The `- [ ] #<n>` lines of `body`, in the order it writes them. The
 * module note holds what is skipped and why.
 */
export function parseRoadmapBody(body: string): readonly RoadmapLine[] {
  let lines: readonly RoadmapLine[] = [];
  let fenced = false;

  body.split(/\r\n?|\n/u).forEach((text, index) => {
    if (FENCE.test(text)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;

    const found = TASK_LINE.exec(text);
    if (found === null) return;

    const [, box = '', digits = '', rest = ''] = found;
    const issue = Number.parseInt(digits, 10);
    if (!Number.isSafeInteger(issue) || issue < 1) return;

    lines = [...lines, {
      issue,
      ticked: box.trim() !== '',
      why: whyOf(rest),
      lineNumber: index + 1,
    }];
  });

  return Object.freeze(lines);
}

/** What a failed command wrote, for a message. Never empty. */
function detailOf(result: GhResult, command: string): string {
  const written = result.stderr.trim() || result.stdout.trim();
  return written === ''
    ? `${command} failed and wrote nothing`
    : `${command} failed: ${written}`;
}

/** What `command` wrote, parsed as a list. Throws, naming it, when it is not one. */
function parseRows(stdout: string, command: string): readonly unknown[] {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new Error(`${PREFIX}: ${command} wrote output that is not JSON: ${messageOf(error)}`, { cause: error });
  }
  if (!Array.isArray(payload)) {
    throw new Error(`${PREFIX}: ${command} answered ${describeValue(payload)}, expected a list`);
  }
  return payload as readonly unknown[];
}

/** The number a row carries at `key`, checked. */
function rowNumber(row: unknown, key: string, command: string, where: string): number {
  const value = isMapping(row)
    ? row[key]
    : null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${PREFIX}: ${command} answered ${where}.${key} as ${describeValue(value)}, expected a positive whole number`);
  }
  return value;
}

/** The string a row carries at `key`, checked. */
function rowText(row: unknown, key: string, command: string, where: string): string {
  const value = isMapping(row)
    ? row[key]
    : null;
  if (typeof value !== 'string') {
    throw new Error(`${PREFIX}: ${command} answered ${where}.${key} as ${describeValue(value)}, expected a string`);
  }
  return value;
}

/** One open issue a roadmap search answered. */
export interface RoadmapCandidate {
  readonly number: number;
  readonly title: string;
}

/** Every open issue titled {@link ROADMAP_TITLE}; the seam the search goes through. */
export type RoadmapSearch = () => Promise<readonly RoadmapCandidate[]>;

/**
 * The search over `options.gh`: one
 * `gh issue list --state open --search "Roadmap in:title"`, answered as
 * candidates. The search is GitHub's, so it matches loosely; the title
 * is compared exactly, trimmed and case-folded, by
 * {@link resolveRoadmapIssue}.
 */
export function createGhRoadmapSearch(options: { readonly gh: GhRunner }): RoadmapSearch {
  const { gh } = options;
  const search = `${ROADMAP_TITLE} in:title`;
  const args = ['issue', 'list', '--state', 'open', '--search', search, '--json', ISSUE_LIST_FIELDS];
  const command = `gh issue list --state open --search "${search}" --json ${ISSUE_LIST_FIELDS}`;

  return async (): Promise<readonly RoadmapCandidate[]> => {
    const result = await gh(args);
    if (!result.ok) throw new Error(`${PREFIX}: ${detailOf(result, command)}`);
    return Object.freeze(parseRows(result.stdout, command).map((row, index) => ({
      number: rowNumber(row, 'number', command, `issue ${String(index)}`),
      title: rowText(row, 'title', command, `issue ${String(index)}`),
    })));
  };
}

/** The sentence a repository with no roadmap issue is refused with. */
export function noRoadmapMessage(): string {
  return `no open issue is titled ${ROADMAP_TITLE}, so there is no roadmap to read;`
    + ` run rafa init --board to open one, or set ${ROADMAP_SETTING} to the issue that holds the order`;
}

/** The sentence a repository with several roadmap issues is refused with. */
export function severalRoadmapsMessage(numbers: readonly number[]): string {
  const named = numbers.map((number) => `#${String(number)}`).join(', ');
  return `${String(numbers.length)} open issues are titled ${ROADMAP_TITLE} (${named}),`
    + ` so which one holds the order is not this command to guess; set ${ROADMAP_SETTING} to it`;
}

/**
 * The roadmap issue: `options.configured` when a layer named one, else
 * the one open issue titled {@link ROADMAP_TITLE}.
 *
 * `configured` is whatever the caller resolved, and the caller ranks
 * `--next=<n>` above `roadmap.issue` itself: this module never reads a
 * flag. Throws `CommandExit({@link ROADMAP_REFUSAL_EXIT}, ...)` when the
 * search answers no issue or more than one; the module note holds why
 * the second is a refusal rather than a pick.
 */
export async function resolveRoadmapIssue(options: {
  readonly configured: number | null;
  readonly search: RoadmapSearch;
}): Promise<number> {
  const { configured, search } = options;
  if (configured !== null) return configured;

  const wanted = ROADMAP_TITLE.toLowerCase();
  const titled = (await search()).filter((issue) => issue.title.trim().toLowerCase() === wanted);
  if (titled.length === 0) throw new CommandExit(ROADMAP_REFUSAL_EXIT, noRoadmapMessage());
  if (titled.length > 1) {
    throw new CommandExit(ROADMAP_REFUSAL_EXIT, severalRoadmapsMessage(titled.map((issue) => issue.number)));
  }
  return titled[0]?.number ?? 0;
}

/** One open pull request, as the taken reading needs it. */
export interface RoadmapPullRequest {
  readonly number: number;
  /** The branch it is from, kept for a message rather than for a match. */
  readonly headRefName: string;
  /** Its body, which the closing keywords are read out of. */
  readonly body: string;
}

/** Every open pull request; the seam the taken reading goes through. */
export type OpenPullRequestLister = () => Promise<readonly RoadmapPullRequest[]>;

/**
 * The lister over `options.gh`: one
 * `gh pr list --state open --json number,headRefName,body`, capped at
 * {@link OPEN_PULL_REQUEST_LIMIT}.
 *
 * `PullRequests` (`src/pr/types.ts`) already lists open pull requests
 * and is NOT used, for the reason `./issue-board.ts` gives for its own
 * narrow interface: its `list` answers a summary with no BODY, and the
 * closing keywords live in the body. Reading one `get` per open pull
 * request to reach them would spend a call each where this spends one
 * for all of them.
 */
export function createGhOpenPullRequests(options: { readonly gh: GhRunner }): OpenPullRequestLister {
  const { gh } = options;
  const limit = String(OPEN_PULL_REQUEST_LIMIT);
  const args = ['pr', 'list', '--state', 'open', '--json', PR_LIST_FIELDS, '--limit', limit];
  const command = `gh pr list --state open --json ${PR_LIST_FIELDS} --limit ${limit}`;

  return async (): Promise<readonly RoadmapPullRequest[]> => {
    const result = await gh(args);
    if (!result.ok) throw new Error(`${PREFIX}: ${detailOf(result, command)}`);
    return Object.freeze(parseRows(result.stdout, command).map((row, index) => ({
      number: rowNumber(row, 'number', command, `pull request ${String(index)}`),
      headRefName: rowText(row, 'headRefName', command, `pull request ${String(index)}`),
      body: rowText(row, 'body', command, `pull request ${String(index)}`),
    })));
  };
}

/** Every issue `body` closes, by GitHub's own keywords, in the order written. */
export function closedIssuesIn(body: string): readonly number[] {
  return Object.freeze([...body.matchAll(CLOSING)]
    .map((found) => Number.parseInt(found[1] ?? '', 10))
    .filter((issue) => Number.isSafeInteger(issue) && issue > 0));
}

/**
 * True when `ref` names the branch `feat/rafa-<issue>` or one spelled
 * under that id, wherever the ref's own prefix puts it:
 * `feat/rafa-20-x`, `origin/feat/rafa-20-x` and
 * `refs/heads/feat/rafa-20-x` all claim issue 20, and `feat/rafa-2-x`
 * claims issue 2 and not issue 20.
 */
export function branchClaims(ref: string, issue: number): boolean {
  const claim = `${BRANCH_PREFIX}/${boardId(issue)}`;
  return new RegExp(`(?:^|/)${claim}(?:-|$)`, 'u').test(ref);
}

/** Every branch ref a walk has in hand, with what could not be read. */
export interface BranchScan {
  /** The refs read, as git spelled them. */
  readonly refs: readonly string[];
  /** A sentence per reading that failed; the module note holds the policy. */
  readonly problems: readonly string[];
}

/** The lines of a git command's output, blank ones dropped. */
function outputLines(stdout: string): readonly string[] {
  return stdout.split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * Every branch this clone and `remote` hold, read once for a whole walk.
 *
 * `git for-each-ref` over `refs/heads` and `refs/remotes` answers what
 * the clone knows; `git ls-remote --heads <remote>` answers what the
 * remote holds now. Either failing is reported through
 * {@link BranchScan.problems} and leaves the other's refs in place, so a
 * scan is never silently half-read.
 */
export function scanClaimBranches(git: GitRunner, remote: string = DEFAULT_REMOTE): BranchScan {
  const local = git(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']);
  const pushed = git(['ls-remote', '--heads', remote]);

  const localRefs = local.ok
    ? outputLines(local.stdout)
    : [];
  const pushedRefs = pushed.ok
    ? outputLines(pushed.stdout).map((line) => line.split('\t').at(-1) ?? '')
    : [];

  const problems = [
    local.ok
      ? ''
      : `the branches of this checkout could not be read, so a branch held only here was not seen: ${detailOf(local, 'git for-each-ref')}`,
    pushed.ok
      ? ''
      : `the branches on ${remote} could not be read, so a branch pushed but not fetched was not seen: ${detailOf(pushed, `git ls-remote --heads ${remote}`)}`,
  ].filter((problem) => problem !== '');

  return Object.freeze({
    refs: Object.freeze([...localRefs, ...pushedRefs].filter((ref) => ref !== '')),
    problems: Object.freeze(problems),
  });
}

/** The three questions a walk asks about one roadmap line. */
export interface RoadmapReadings {
  /** Whether GitHub holds the issue closed, which is the other done reading. */
  readonly isClosed: (issue: number) => Promise<boolean>;
  /**
   * The branch claiming the issue, or null. Synchronous: the scan is
   * taken once before the walk, so this reads a list already in hand.
   */
  readonly branchFor: (issue: number) => string | null;
  /** The open pull request closing the issue, or null. */
  readonly pullRequestFor: (issue: number) => Promise<number | null>;
}

/** What {@link createRoadmapReadings} is made with. */
export interface RoadmapReadingsOptions {
  /** Reads one issue by number; `./issue.ts`'s own seam. */
  readonly issues: SpecIssueReader;
  /** The branches, scanned once by {@link scanClaimBranches}. */
  readonly branches: BranchScan;
  /** The open pull requests, read once on the first line that asks. */
  readonly pullRequests: OpenPullRequestLister;
}

/**
 * The readings over one issue reader, one branch scan and one pull
 * request list. The list is read at most once per walk, on the first
 * line that gets as far as asking for it.
 */
export function createRoadmapReadings(options: RoadmapReadingsOptions): RoadmapReadings {
  const { issues, branches, pullRequests } = options;
  let open: Promise<readonly RoadmapPullRequest[]> | null = null;

  return Object.freeze({
    isClosed: async (issue: number): Promise<boolean> => (await issues(issue)).state === 'CLOSED',

    branchFor: (issue: number): string | null => branches.refs
      .find((ref) => branchClaims(ref, issue)) ?? null,

    pullRequestFor: async (issue: number): Promise<number | null> => {
      open = open ?? pullRequests();
      const closing = (await open).find((pull) => closedIssuesIn(pull.body).includes(issue));
      return closing?.number ?? null;
    },
  });
}

/** Why a line was passed over. The two done readings, then the two taken ones. */
export type RoadmapSkipReason = 'ticked' | 'closed' | 'branch' | 'pull-request';

/** One line passed over, and what was read about it. */
export interface RoadmapSkip {
  /** The line skipped. */
  readonly line: RoadmapLine;
  /** Which reading answered yes. */
  readonly reason: RoadmapSkipReason;
  /** What it read: a branch name or a pull request, empty for the done readings. */
  readonly detail: string;
}

/** The sentence a walk prints for one skipped line; the spec's own shape. */
export function skipSentence(skip: RoadmapSkip): string {
  const id = `#${String(skip.line.issue)}`;
  if (skip.reason === 'ticked') return `${id} done: ticked on the roadmap`;
  if (skip.reason === 'closed') return `${id} done: the issue is closed`;
  return skip.reason === 'branch'
    ? `${id} taken: branch ${skip.detail} exists`
    : `${id} taken: PR ${skip.detail} open`;
}

/** The first line neither done nor taken, and every line passed to reach it. */
export interface RoadmapPick {
  /** The answer, or null when the roadmap is exhausted. */
  readonly line: RoadmapLine | null;
  /** Every line skipped before it, in order, each with its reason. */
  readonly skipped: readonly RoadmapSkip[];
}

/** Why `line` is passed over, or null when it is the answer. */
async function skipOf(line: RoadmapLine, readings: RoadmapReadings): Promise<RoadmapSkip | null> {
  if (line.ticked) return { line, reason: 'ticked', detail: '' };
  if (await readings.isClosed(line.issue)) return { line, reason: 'closed', detail: '' };

  const branch = readings.branchFor(line.issue);
  if (branch !== null) return { line, reason: 'branch', detail: branch };

  const pull = await readings.pullRequestFor(line.issue);
  return pull === null
    ? null
    : { line, reason: 'pull-request', detail: `#${String(pull)}` };
}

/**
 * Walks `lines` from the top and answers the first neither done nor
 * taken, with every line it passed and why.
 *
 * It never skips AHEAD: a line it cannot pass stops the walk, because
 * stepping over one would reorder the roadmap without anyone saying so
 * (`.specs/rafa-20-pr-commands.md`). The walk is one line at a time on
 * purpose — reading them in parallel would spend a `gh issue view` on
 * every line of a long roadmap to answer a question the first line
 * usually settles.
 */
export async function pickNextRoadmapLine(
  lines: readonly RoadmapLine[],
  readings: RoadmapReadings,
): Promise<RoadmapPick> {
  let skipped: readonly RoadmapSkip[] = [];

  for (const line of lines) {
    const skip = await skipOf(line, readings);
    if (skip === null) return Object.freeze({ line, skipped: Object.freeze(skipped) });
    skipped = [...skipped, skip];
  }

  return Object.freeze({ line: null, skipped: Object.freeze(skipped) });
}

/**
 * What a walk that found nothing has to say. `plan create --next` exits
 * 0 with it: an empty roadmap is a project with its work done, not a
 * command that failed.
 */
export function exhaustedMessage(roadmap: number, skipped: readonly RoadmapSkip[]): string {
  const id = `issue #${String(roadmap)}`;
  return skipped.length === 0
    ? `the roadmap, ${id}, carries no "- [ ] #<n>" line; add the next spec to its task list`
    : `every line of the roadmap, ${id}, is done or taken (${String(skipped.length)} of them);`
      + ' open the next spec issue and add it to the task list';
}
