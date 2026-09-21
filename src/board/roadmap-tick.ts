/**
 * The tick `rafa pr merge` writes on the roadmap after a merge: which
 * lines a merged pull request ticks, the two `gh api` calls that read
 * and write the roadmap body, and the one retry an edit that did not
 * land gets.
 *
 * GitHub closes an issue a merged pull request says `Closes #<n>` for,
 * and it does NOT tick the `- [ ] #<n>` box that names that issue on the
 * roadmap (`.rafa/specs/rafa-20-pr-commands.md`). `plan create --next` reads
 * a ticked box as done, so a roadmap nobody ticks stays correct only
 * because the second done reading — the issue being closed — costs a
 * `gh issue view` per line. Ticking is what keeps the cheap reading
 * true, and this module is the whole of it.
 *
 * Nothing here spawns: the board arrives through the {@link GhRunner}
 * seam declared in `src/adapters/tracker/github.ts`, as it does for
 * `./issue.ts`, `./issue-board.ts` and `./roadmap.ts`. Every case in
 * `./roadmap-tick.test.ts` drives a fake runner over a planted body, so
 * none reaches GitHub, spawns `gh` or reads the configuration `gh`
 * keeps under the home.
 *
 * ## Which lines are ticked
 *
 * The issues the pull request's body closes, by GitHub's own keywords
 * ({@link closedIssuesIn}), matched against the roadmap's lines as
 * {@link parseRoadmapBody} reads them — so a `- [ ] #33` shown inside a
 * fenced example is not a line, here as there.
 *
 * Every unticked line naming a closed issue is ticked, not just the
 * first. `./roadmap.ts` de-duplicates nothing on purpose, because a body
 * naming one issue twice is a list that needs an edit; ticking one of
 * the two and leaving the other would leave `--next` walking back onto
 * work that is finished.
 *
 * Only the box changes. The text after it, the indentation and the
 * bullet character are the body's own, and the line breaks are kept as
 * they were spelled: {@link splitKeepingBreaks} carries each separator
 * beside its line, so a CRLF body comes back CRLF and a merge does not
 * rewrite a roadmap it was only meant to tick one character of.
 *
 * ## The two calls, and why the write's answer is read
 *
 * | Step | Command |
 * |---|---|
 * | read | `gh api repos/{owner}/{repo}/issues/<n>` |
 * | write | `gh api repos/{owner}/{repo}/issues/<n> -X PATCH -f body=<body>` |
 *
 * One REST resource, read and written, with `{owner}/{repo}` left for
 * `gh` to expand from the directory its runner runs in, as
 * `./issue-board.ts` leaves it: no second source of truth for the
 * repository can disagree with it.
 *
 * The REST resource answers the whole issue to a PATCH, so the write
 * says what the body IS now, and {@link tickRoadmapIssue} compares it
 * with what it sent. That comparison is the edit conflict this module
 * can actually see. `gh` sends no conditional request and the issues API
 * takes no `If-Match`, so a body somebody else edited between the read
 * and the write is a lost update GitHub will not report as one — what it
 * leaves behind is a stored body that is not the one that was sent, and
 * that is what is looked for.
 *
 * ## The one retry
 *
 * A write that failed, and a write whose answer is not what was sent,
 * are both retried ONCE, and the retry re-reads the body first so the
 * second tick is computed over whatever is there now
 * (`.rafa/specs/rafa-20-pr-commands.md`). Three things follow from
 * re-reading rather than re-sending:
 *
 *   - A body somebody else ticked in between comes back
 *     {@link RoadmapTickStatus} `nothing-to-tick` rather than being
 *     written over with a tick computed from a body that is gone.
 *   - An edit that added lines keeps them: the second write carries
 *     them, where re-sending the first attempt's text would delete them.
 *   - A retry that fails again is reported and never tried a third time.
 *     The merge is done by the time any of this runs, so the cost of
 *     stopping is one box an operator ticks by hand, and the cost of
 *     looping is a command that hangs on a board that is down.
 *
 * Nothing here throws for a board that would not take the tick: the
 * caller gets a {@link RoadmapTickResult} saying what happened, because
 * a merge that went through is not a failed command
 * (`src/commands/pr/merge.ts`).
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { describeValue, isMapping, messageOf } from '../config-sections.js';

import { parseRoadmapBody } from './roadmap.js';

/** What every failure this module reports opens with. */
const PREFIX = 'board roadmap';

/** The repository placeholders `gh` expands from the directory it runs in. */
const REPO_PATH = '{owner}/{repo}';

/** How many times one tick is written before it is given up on; see the module note. */
export const TICK_ATTEMPTS = 2;

/** The unticked box a line carries, and the ticked one it is written as. */
const UNTICKED = /\[ \]/u;

/** What an unticked box becomes. */
const TICKED = '[x]';

/** A line break as a body spells it, kept beside its line. */
const LINE_BREAK = /(\r\n|\n|\r)/u;

/** The lines of `body` with each separator kept, so `join('')` is the body again. */
export function splitKeepingBreaks(body: string): readonly string[] {
  return Object.freeze(body.split(LINE_BREAK));
}

/** Where the text of line `lineNumber`, counting from 1, sits in a split body. */
function textIndex(lineNumber: number): number {
  return (lineNumber - 1) * 2;
}

/** What ticking a roadmap body for a list of issues comes to. */
export interface RoadmapTickEdit {
  /** The body with every line that could be ticked ticked. */
  readonly body: string;
  /** The issues a line was ticked for, in the order asked. */
  readonly ticked: readonly number[];
  /** The issues whose every line was ticked already. */
  readonly already: readonly number[];
  /** The issues the roadmap carries no line for. */
  readonly absent: readonly number[];
}

/** `issues` with each number once, in the order first written. */
function onceEach(issues: readonly number[]): readonly number[] {
  return Object.freeze([...new Set(issues)]);
}

/**
 * `body` with the box of every unticked line naming one of `issues`
 * ticked, and which issues that came to; see the module note.
 */
export function tickRoadmapLines(body: string, issues: readonly number[]): RoadmapTickEdit {
  const lines = parseRoadmapBody(body);
  let indices: readonly number[] = [];
  let ticked: readonly number[] = [];
  let already: readonly number[] = [];
  let absent: readonly number[] = [];

  for (const issue of onceEach(issues)) {
    const named = lines.filter((line) => line.issue === issue);
    const open = named.filter((line) => !line.ticked);
    if (named.length === 0) absent = [...absent, issue];
    else if (open.length === 0) already = [...already, issue];
    else {
      indices = [...indices, ...open.map((line) => textIndex(line.lineNumber))];
      ticked = [...ticked, issue];
    }
  }

  const parts = splitKeepingBreaks(body);
  const edited = indices.length === 0
    ? body
    : parts.map((part, index) => (indices.includes(index)
      ? part.replace(UNTICKED, TICKED)
      : part)).join('');

  return Object.freeze({
    body: edited,
    ticked: Object.freeze(ticked),
    already: Object.freeze(already),
    absent: Object.freeze(absent),
  });
}

/** The read and the write one tick makes on the roadmap issue. */
export interface RoadmapBody {
  /** The issue's body as it reads now. Rejects naming the command when `gh` failed. */
  readonly read: (issue: number) => Promise<string>;
  /** Replaces the body and answers what the resource holds afterwards. */
  readonly write: (issue: number, body: string) => Promise<string>;
}

/** What a failed command wrote, for a message. Never empty. */
function detailOf(result: GhResult, command: string): string {
  const written = result.stderr.trim() || result.stdout.trim();
  return written === ''
    ? `${command} failed and wrote nothing`
    : `${command} failed: ${written}`;
}

/** The `body` of what `command` answered, checked. */
function bodyOf(stdout: string, command: string): string {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new Error(`${PREFIX}: ${command} wrote output that is not JSON: ${messageOf(error)}`, { cause: error });
  }
  const body = isMapping(payload)
    ? payload['body']
    : null;
  if (typeof body !== 'string') {
    throw new Error(`${PREFIX}: ${command} answered body as ${describeValue(body)}, expected a string`);
  }
  return body;
}

/** The issue number a member was handed, as a path segment. */
function issueSegment(value: number, member: string): string {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(
      `${PREFIX}: ${member} refused issue number ${describeValue(value)}, expected a positive whole number`,
    );
  }
  return String(value);
}

/** The two calls over one `gh` runner; the module note holds the commands. */
export function createGhRoadmapBody(options: { readonly gh: GhRunner }): RoadmapBody {
  const { gh } = options;
  const pathOf = (issue: number, member: string): string => `repos/${REPO_PATH}/issues/${issueSegment(issue, member)}`;

  return Object.freeze({
    read: async (issue: number): Promise<string> => {
      const path = pathOf(issue, 'read');
      const result = await gh([path]);
      if (!result.ok) throw new Error(`${PREFIX}: ${detailOf(result, `gh api ${path}`)}`);
      return bodyOf(result.stdout, `gh api ${path}`);
    },

    write: async (issue: number, body: string): Promise<string> => {
      const path = pathOf(issue, 'write');
      const result = await gh([path, '-X', 'PATCH', '-f', `body=${body}`]);
      const command = `gh api ${path} -X PATCH -f body=<body>`;
      if (!result.ok) throw new Error(`${PREFIX}: ${detailOf(result, command)}`);
      return bodyOf(result.stdout, command);
    },
  });
}

/** How a tick ended. */
export type RoadmapTickStatus = 'ticked' | 'nothing-to-tick' | 'failed';

/** What one tick came to, as the caller reports it. */
export interface RoadmapTickResult {
  /** The roadmap issue the tick was written on. */
  readonly roadmap: number;
  readonly status: RoadmapTickStatus;
  /** The issues a box was ticked for. Empty unless the status is `ticked`. */
  readonly ticked: readonly number[];
  /** The issues whose box was ticked already. */
  readonly already: readonly number[];
  /** The issues the roadmap carries no line for. */
  readonly absent: readonly number[];
  /** How many writes were attempted: 0 when there was nothing to write, else 1 or {@link TICK_ATTEMPTS}. */
  readonly attempts: number;
  /** What went wrong, for a warning. Empty unless the status is `failed`. */
  readonly problem: string;
}

/** The edit that did not land, as a problem sentence. */
function conflictProblem(issue: number): string {
  return `${PREFIX}: issue #${String(issue)} answered a body other than the one that was written,`
    + ' so somebody edited it in between';
}

/** One read, one tick and one write; answers the result or the problem to retry on. */
async function attemptTick(
  roadmap: number,
  issues: readonly number[],
  board: RoadmapBody,
  attempt: number,
): Promise<RoadmapTickResult | string> {
  let edit: RoadmapTickEdit;
  try {
    edit = tickRoadmapLines(await board.read(roadmap), issues);
  } catch (error) {
    return messageOf(error);
  }

  const answered: RoadmapTickResult = {
    roadmap,
    status: 'nothing-to-tick',
    ticked: [],
    already: edit.already,
    absent: edit.absent,
    attempts: attempt - 1,
    problem: '',
  };
  if (edit.ticked.length === 0) return Object.freeze(answered);

  try {
    const stored = await board.write(roadmap, edit.body);
    return stored === edit.body
      ? Object.freeze({ ...answered, status: 'ticked' as const, ticked: edit.ticked, attempts: attempt })
      : conflictProblem(roadmap);
  } catch (error) {
    return messageOf(error);
  }
}

/**
 * Ticks the lines of roadmap issue `options.roadmap` naming
 * `options.issues`, re-reading and retrying once when the write did not
 * land; see the module note. Never throws for the board.
 */
export async function tickRoadmapIssue(options: {
  readonly roadmap: number;
  readonly issues: readonly number[];
  readonly board: RoadmapBody;
}): Promise<RoadmapTickResult> {
  const { roadmap, issues, board } = options;
  let problem = '';

  for (let attempt = 1; attempt <= TICK_ATTEMPTS; attempt += 1) {
    const outcome = await attemptTick(roadmap, issues, board, attempt);
    if (typeof outcome !== 'string') return outcome;
    problem = outcome;
  }

  return Object.freeze({
    roadmap,
    status: 'failed' as const,
    ticked: [],
    already: [],
    absent: [],
    attempts: TICK_ATTEMPTS,
    problem,
  });
}

/** `#<n>, #<m>` for a message. */
function named(issues: readonly number[]): string {
  return issues.map((issue) => `#${String(issue)}`).join(', ');
}

/** The one line a tick prints, whatever it came to. */
export function tickSentence(result: RoadmapTickResult): string {
  const roadmap = `the roadmap, issue #${String(result.roadmap)}`;
  if (result.status === 'failed') {
    return `${roadmap} was not ticked after ${String(result.attempts)} attempts: ${result.problem}`;
  }
  if (result.status === 'ticked') return `Ticked ${named(result.ticked)} on ${roadmap}.`;
  if (result.already.length > 0) return `${named(result.already)} is ticked on ${roadmap} already.`;
  return `${roadmap} carries no line for ${named(result.absent)}, so nothing was ticked.`;
}
