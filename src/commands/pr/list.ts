/**
 * `rafa pr list`: every open pull request, one row each, carrying its
 * number, its title, the branch it is from, how long ago it last moved,
 * the verdict over its checks and whether it merges.
 *
 * ## Three kinds of read, and what each one costs
 *
 * The port answers a list of SUMMARIES (`PullRequests.list`, one
 * `gh pr list`), and a summary carries neither the mergeability nor the
 * checks: `mergeable` and `mergeStateStatus` live on the DETAIL, which
 * is a per-pull-request read, and the checks are their own command
 * again. So the two columns the spec asks for past the summary are two
 * more `gh` invocations PER ROW, and the whole action is `1 + 2n`
 * commands. That is why {@link PROBE_LIMIT} exists: the probes run
 * through {@link mapWithLimit}, which keeps at most that many in flight,
 * where a plain `Promise.all` over 30 pull requests would spawn 60 `gh`
 * processes at once. The rows are answered in the order the provider
 * listed them whatever order the probes finish in, so the output does
 * not depend on which `gh` returned first.
 *
 * Widening the port's summary to carry `mergeable` would make this one
 * command per row instead of three, and it is deliberately NOT done
 * here: `PullRequestSummary` is what `findOpen` answers too, and that is
 * the read on the hot path of `pr current`, `pr show` and `pr view`.
 *
 * ## The age column is the age of the LAST MOVE
 *
 * `PullRequestSummary` carries `updatedAt` and no creation time — it is
 * the field the triage selection rule reads, and the adapter asks `gh`
 * for exactly the summary fields the port declares. So the column is
 * rendered `updated 3d ago` rather than as a bare `3d`, because a row
 * saying `3d` beside a pull request opened three weeks ago and pushed to
 * this morning would be read as its age and be wrong. A timestamp that
 * does not parse renders `updated ?` rather than an invented duration,
 * and a timestamp in the future — a machine whose clock is behind
 * GitHub's — renders `updated just now` rather than a negative age.
 *
 * ## A probe that failed is a cell and a line, never a refusal
 *
 * `list` itself failing refuses the command: there is nothing to print
 * without it. Each per-row probe is allowed to fail — every one is its
 * own `gh`, and a rate limit part-way through a list of thirty is the
 * ordinary way it happens — so a failed probe renders its cell as
 * {@link UNREADABLE} and says what the provider reported on its own line
 * under the table. The distinction `pr current` and `pr show` keep is
 * kept here: `checks none` is a pull request GitHub ran nothing for, and
 * `checks ?` with a line under the table is a question that could not be
 * asked.
 *
 * {@link renderList} is pure and total, and takes the clock as an
 * argument rather than reading `Date.now()`, so every shape — an empty
 * list, a blank title, a title past the cap, an unreadable cell, a
 * timestamp that does not parse — is driven by calling it.
 *
 * ## Refusals
 *
 * `pr-context.ts`'s, and no others: exit 2 for a provider that is not
 * `gh`, exit 1 for a stray word (the action takes no argument: it names
 * no single pull request, so nothing here reads a branch), a config that
 * cannot be used, and the `list` call itself rejecting.
 */
import type { PrSeams } from './pr-context.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { ChecksVerdict, Mergeability, PullRequests, PullRequestSummary } from '../../pr/index.js';

import { messageOf } from '../../config-sections.js';

import { SEPARATOR } from './current.js';
import {
  DEFAULT_PR_SEAMS,
  expectNoArguments,
  onProvider,
  openPrContext,
  PR_USAGE,
} from './pr-context.js';

/** The usage line this action's refusals name. */
const USAGE = PR_USAGE.list;

/** What a cell reads as when the provider could not be asked for it. */
export const UNREADABLE = '?';

/** How many per-row probes are in flight at once; see the module note. */
export const PROBE_LIMIT = 6;

/** How wide a title column is allowed to grow before a title is cut. */
export const TITLE_WIDTH = 60;

/** What the columns of a row are separated by. */
const GAP = '  ';

/** What every row and every problem line is indented by. */
const INDENT = '  ';

/** What a title is cut with, and what is left for it when one is. */
const CUT = '...';

/** Milliseconds in the three units an age is written in. */
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** One open pull request, and what the two per-row probes answered for it. */
export interface PrListRow {
  /** The pull request as the provider listed it. */
  readonly pull: PullRequestSummary;
  /** The verdict over its checks, or null when the provider could not be asked. */
  readonly checks: ChecksVerdict | null;
  /** What the checks read said when it failed, and null when it did not. */
  readonly checksProblem: string | null;
  /** Whether it merges, or null when the provider could not be asked. */
  readonly mergeable: Mergeability | null;
  /** What the detail read said when it failed, and null when it did not. */
  readonly mergeableProblem: string | null;
}

/** What json mode gives as the terminal result's `data`. */
export interface PrListResult {
  /** Every open pull request, in the order the provider listed them. */
  readonly rows: readonly PrListRow[];
  /** The table text mode writes. */
  readonly text: string;
}

/**
 * `work` over every item, at most `limit` of them at once, answered in
 * the items' own order. See the module note for why the limit is there.
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const answers = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      answers[index] = await work(items[index] as T);
    }
  };
  const width = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: width }, () => worker()));
  return answers;
}

/** How long ago `updatedAt` was, as a column says it; see the module note. */
export function ageCell(updatedAt: string, now: number): string {
  const at = Date.parse(updatedAt);
  if (!Number.isFinite(at)) return `updated ${UNREADABLE}`;
  const elapsed = now - at;
  if (elapsed < MINUTE_MS) return 'updated just now';
  if (elapsed < HOUR_MS) return `updated ${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `updated ${Math.floor(elapsed / HOUR_MS)}h ago`;
  return `updated ${Math.floor(elapsed / DAY_MS)}d ago`;
}

/** The title column: trimmed, marked when blank, and cut at {@link TITLE_WIDTH}. */
export function titleCell(title: string): string {
  const trimmed = title.trim();
  if (trimmed === '') return '(no title)';
  return trimmed.length > TITLE_WIDTH
    ? `${trimmed.slice(0, TITLE_WIDTH - CUT.length)}${CUT}`
    : trimmed;
}

/** The head line: how many open pull requests there are. */
function headLine(count: number): string {
  return count === 1
    ? '1 open pull request'
    : `${count} open pull requests`;
}

/** The columns of one row, in the order the spec lists them. */
function cellsOf(row: PrListRow, now: number): readonly string[] {
  return [
    `#${row.pull.number}`,
    titleCell(row.pull.title),
    row.pull.headRefName,
    ageCell(row.pull.updatedAt, now),
    `checks ${row.checks ?? UNREADABLE}`,
    row.mergeable ?? UNREADABLE,
  ];
}

/** Each column padded to the widest cell in it, the last one left as it is. */
function padColumns(cells: readonly (readonly string[])[]): string[] {
  const widths = cells[0]?.map((_, column) => Math.max(...cells.map((row) => (row[column] ?? '').length))) ?? [];
  return cells.map((row) => row
    .map((cell, column) => (column === row.length - 1
      ? cell
      : cell.padEnd(widths[column] ?? 0)))
    .join(GAP)
    .trimEnd());
}

/** One line per probe that failed, naming the pull request and what the provider said. */
function problemLines(rows: readonly PrListRow[]): string[] {
  return rows.flatMap((row) => [
    row.checksProblem === null
      ? null
      : `#${row.pull.number} checks could not be read${SEPARATOR}${row.checksProblem}`,
    row.mergeableProblem === null
      ? null
      : `#${row.pull.number} mergeable could not be read${SEPARATOR}${row.mergeableProblem}`,
  ].filter((line): line is string => line !== null));
}

/**
 * The whole table for a list of rows, as of `now`: the head line, one
 * padded row each, and a line for every probe that failed. Pure and
 * total; see the module note.
 */
export function renderList(rows: readonly PrListRow[], now: number): string {
  if (rows.length === 0) return 'No open pull requests.';
  const table = padColumns(rows.map((row) => cellsOf(row, now))).map((line) => `${INDENT}${line}`);
  const problems = problemLines(rows).map((line) => `${INDENT}${line}`);
  const blocks = [[headLine(rows.length), ...table].join('\n')];
  return problems.length === 0
    ? blocks.join('\n')
    : [...blocks, problems.join('\n')].join('\n\n');
}

/** What a probe answered, or what the provider said when it failed. */
interface Probe<T> {
  readonly value: T | null;
  readonly problem: string | null;
}

/** Runs a read that is allowed to fail, answering what the provider said when it does. */
async function probe<T>(call: () => Promise<T>): Promise<Probe<T>> {
  try {
    return { value: await call(), problem: null };
  } catch (error) {
    return { value: null, problem: messageOf(error) };
  }
}

/**
 * One pull request's row: its summary, the verdict over its checks and
 * whether it merges, each probe's failure kept rather than thrown.
 *
 * A number the repository has no pull request for answers `null` from
 * `get` rather than throwing (the port's rule), which here is a pull
 * request closed between the list and the probe: the cell is unreadable
 * and the line under the table says so.
 */
async function rowOf(pulls: PullRequests, pull: PullRequestSummary): Promise<PrListRow> {
  const [checks, detail] = await Promise.all([
    probe(() => pulls.checks(pull.number)),
    probe(() => pulls.get(pull.number)),
  ]);
  const gone = detail.value === null && detail.problem === null;
  return {
    pull,
    checks: checks.value?.verdict ?? null,
    checksProblem: checks.problem,
    mergeable: detail.value?.mergeable ?? null,
    mergeableProblem: gone
      ? `the repository holds no pull request #${pull.number}`
      : detail.problem,
  };
}

/** Lists the open pull requests and probes each one; see the module note. */
export async function readList(context: RafaContext, seams: PrSeams, now: number): Promise<PrListResult> {
  expectNoArguments(context.args, USAGE);
  const pr = openPrContext(context, seams);
  const open = await onProvider('list the open pull requests', () => pr.pulls.list());
  const rows = await mapWithLimit(open, PROBE_LIMIT, (pull) => rowOf(pr.pulls, pull));
  return { rows, text: renderList(rows, now) };
}

/** The command, reaching the provider through `seams`; see the module note. */
export function createPrListCommand(seams: PrSeams = DEFAULT_PR_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'pr list',
    subject: 'pr',
    action: 'list',
    summary: 'list the open pull requests with their checks and mergeability',
    description: 'Lists every open pull request of the repository at the project root, one row each carrying its'
      + ' number, its title, the branch it is from, how long ago it last moved, the verdict over its checks and'
      + ' whether it merges. The checks and the mergeability are read per pull request, so the command sends one'
      + ' GitHub CLI command for the list and two more for each row; a read that failed leaves its cell as `?` and'
      + ' says what the CLI reported on a line under the table rather than refusing the whole list. A pull request'
      + ' GitHub ran nothing for reads `checks none`. With `--output=json` every row and the rendered table are the'
      + ' data of the terminal result event. Refuses with exit code 2 where `pr.provider` is not `gh`.',
    args: [],
    flags: [],
    examples: [
      {
        cmd: 'rafa pr list',
        note: 'Lists the open pull requests of the repository at the project root.',
      },
      {
        cmd: 'rafa pr list --output=json',
        note: 'Writes a start event, then a result event holding every row and the rendered table.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const listed = await readList(context, seams, Date.now());
      if (context.outputMode === 'json') {
        context.output.result(listed);
        return;
      }
      context.output.info(listed.text);
    },
  };
  return Object.freeze(command);
}

export default createPrListCommand();
