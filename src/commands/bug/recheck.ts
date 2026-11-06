/**
 * `rafa bug recheck [<n>…] [--all] [--comment]`: reruns the test each
 * bug's `Rerun` section names and judges whether the bug still
 * reproduces (#953). Starts no Claude session and declares no `spends`.
 *
 * ## The line
 *
 * Refused with exit code 1 before any tracker is resolved: no number and
 * no `--all`, a number beside `--all`, a word that is no whole number
 * from 1, and a value given to `--all` or `--comment` (`readSwitch`). A
 * number given twice is rechecked once.
 *
 * ## The tracker
 *
 * The config is read as every project command reads it, then the tracker
 * through the chain (`../issue/issue-tracker.ts`). A chain that landed
 * past `tracker.default` exits 1 before any issue is read: a number on
 * the tracker it fell back to names another issue.
 *
 * With `--all`, the bugs are `openIssues('bug')`; a tracker with no
 * listing, or one whose listing throws, exits 1. With numbers, each is
 * read through `editable`, or `get` on a tracker without it; one that
 * cannot be read is a `skipped` row naming the error.
 *
 * ## The bugs judged
 *
 * Every bug read is judged by `judgeBugs` (`./recheck-judge.ts`), whose
 * module note is the authority on one bug: the `Rerun` value read
 * strictly through `readTestReference`, a refused one `manual` with the
 * record's `Reproduce` text, a file outside the checkout `manual` and one
 * not there `stale`; then, off the `local` tracker, the author weighed by
 * `readBoardTrust` once per login, an untrusted one `skipped` with
 * nothing run; and only then `recheckBug` (`./recheck-run.ts`).
 *
 * What this command hands it: the tracker; a lazy `ghBoardTrust` over
 * `gh`, `board.trustedAuthors` and the checkout's repository label; the
 * checkout (`checkoutOf` over the git of the directory rafa runs in);
 * `process.env` and the secrets `namedSecrets` names in it;
 * `bugs.recheck.runs`; `bugs.recheck.timeoutSeconds` in milliseconds;
 * the `recheck` seam; and the output's `warn`. The judge leaves the named
 * secrets out of the child's environment and answers their names, which
 * the report lists; it owns the JUnit temp dir and removes it whatever
 * happens. A numbered bug that could not be read keeps its `skipped` row
 * and is not handed over; the rows stay in the line's order.
 *
 * ## `--comment`
 *
 * Posts `recheckComment` on every `gone` and `flaky` bug through
 * `tracker.comment`, the text passed through the record's redaction
 * (`localPathRedactor` over the checkout and the project root, then
 * `redactSecrets`), and marks the row `commented`. It never closes a
 * bug. A comment that throws is a warning, not an exit.
 *
 * ## Output and exit
 *
 * Text mode prints `renderRecheck`; json mode gives the `RecheckReport`
 * as the terminal result's data. Exit code 0 whatever the verdicts; 1 for
 * a refused line, a config the reader refuses, a degraded chain and a
 * listing that failed.
 *
 * ## Seams
 *
 * {@link RecheckSeams}: the issue seams (the adapter registry, `gh`,
 * `git` and the directory rafa runs in), `recheck` for `recheckBug`, and
 * `env` for `process.env`, so the tests plant a tracker, a `gh` and a
 * runner. The registered command runs with `DEFAULT_ISSUE_SEAMS`.
 */
import type { ReadBug } from './recheck-judge.js';
import type { RecheckReport, RecheckRow } from './recheck-report.js';
import type { RecheckBugOptions, RecheckRun } from './recheck-run.js';
import type { RafaCommand, RafaContext } from '@open-tomato/rafa/core/command';
import type { RafaConfig } from '@open-tomato/rafa/core/config';
import type { GitRunner } from '@open-tomato/rafa/core/git';
import type { SpawnEnv } from '@open-tomato/rafa/core/loop';
import type { IssueRef, Tracker } from '@open-tomato/rafa/ports';
import type {
  BoardTrust,
  IssueSeams,
  IssueTrackerData,
  LineFlags,
} from '@open-tomato/rafa-board';

import {
  DEFAULT_ISSUE_SEAMS,
  boardRepoLabel,
  createGhRunner,
  ghBoardTrust,
  issueName,
  issueRef,
  lineRefusal,
  onTracker,
  resolveIssueTracker,
} from '@open-tomato/rafa-board';

import { checkoutOf } from '@open-tomato/rafa/bugs/fill';
import { DIRTY_MARK, NO_COMMIT, codeVersionOf } from '@open-tomato/rafa/bugs/versions';
import { readSwitch, requireProject, resolveProjectConfig } from '@open-tomato/rafa/commands/plan/plan-files';
import { CommandExit, RAFA_VERSION } from '@open-tomato/rafa/core/command';
import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { createGitRunner } from '@open-tomato/rafa/core/git';
import { namedSecrets, redactSecrets } from '@open-tomato/rafa/triage/filed-text';
import { localPathRedactor } from '@open-tomato/rafa/triage/local-paths';

import { judgeBugs, MS_PER_SECOND, rowOf } from './recheck-judge.js';
import { recheckComment, renderRecheck } from './recheck-report.js';
import { recheckBug } from './recheck-run.js';

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa bug recheck';

/** The line the refusals end with. */
export const RECHECK_USAGE = 'rafa bug recheck [<n>…] [--all] [--comment]';

const ALL_FLAG = 'all';
const COMMENT_FLAG = 'comment';

/** An issue number as a line types it: a whole number from 1. */
const ISSUE_NUMBER = /^[1-9]\d*$/;

/** What the seams of {@link runRecheck} hold; see the module note. */
export interface RecheckSeams extends IssueSeams {
  /** What rechecks one runnable bug. `recheckBug` when left out. */
  readonly recheck?: (options: RecheckBugOptions) => Promise<RecheckRun>;
  /** The environment the child's is made from and the secrets are named in. `process.env` when left out. */
  readonly env?: () => Readonly<SpawnEnv>;
}

/** What a line asks: the numbers to recheck, or null for `--all`, and whether to comment. */
export interface RecheckLine {
  readonly numbers: readonly number[] | null;
  readonly comment: boolean;
}

/** A row and the ref its comment goes to. */
interface RowAt {
  readonly row: RecheckRow;
  readonly ref: IssueRef;
}

/** The line's words and flags read; see the module note. */
export function readRecheckLine(args: readonly string[], flags: LineFlags): RecheckLine {
  const hint = `Usage: ${RECHECK_USAGE}`;
  const all = readSwitch(ALL_FLAG, flags[ALL_FLAG], hint);
  const comment = readSwitch(COMMENT_FLAG, flags[COMMENT_FLAG], hint);
  if (all && args.length > 0) {
    throw lineRefusal(`--${ALL_FLAG} rechecks every open bug: give it or bug numbers, not both`, RECHECK_USAGE);
  }
  if (all) return { numbers: null, comment };
  if (args.length === 0) throw lineRefusal(`Name a bug by its number, or give --${ALL_FLAG}`, RECHECK_USAGE);
  const wrong = args.find((word) => !ISSUE_NUMBER.test(word));
  if (wrong !== undefined) {
    throw lineRefusal(`${JSON.stringify(wrong)} is no issue number: a whole number from 1`, RECHECK_USAGE);
  }
  return { numbers: [...new Set(args.map(Number))], comment };
}

/** The bugs `--all` rechecks: the tracker's open bugs; exit 1 for a tracker that lists none or throws. */
async function openBugs(tracker: Tracker): Promise<readonly ReadBug[]> {
  const { openIssues } = tracker;
  if (openIssues === undefined) {
    throw new CommandExit(1, `❌ ${COMMAND_NAME} --${ALL_FLAG}: the ${tracker.kind} tracker lists no open issues; name the bugs by number`);
  }
  const open = await onTracker(tracker, 'list the open bugs', () => openIssues('bug'));
  return open.map((issue) => ({
    ref: issue.ref,
    issue: Number(issue.ref.externalId),
    title: issue.title,
    body: issue.body,
    author: null,
  }));
}

/** Bug `issue` read off `tracker`, or a `skipped` row naming why it could not be. */
async function numberedBug(tracker: Tracker, issue: number): Promise<ReadBug | RowAt> {
  const ref = issueRef(tracker, String(issue));
  try {
    if (tracker.editable !== undefined) {
      const read = await tracker.editable(ref);
      return { ref: read.ref, issue, title: read.title, body: read.body, author: read.author };
    }
    const read = await tracker.get(ref);
    return { ref: read.ref, issue, title: read.title, body: read.body, author: '' };
  } catch (error) {
    return { ref, row: rowOf({ issue, title: '' }, { verdict: 'skipped', reason: `could not read ${issueName(ref)}: ${messageOf(error)}` }) };
  }
}

/** Each of `read` with its row: a row read as one kept, a bug given the row `judged` holds at its place in `bugs`. */
function rowsAt(read: readonly (ReadBug | RowAt)[], bugs: readonly ReadBug[], judged: readonly RecheckRow[]): RowAt[] {
  return read.map((bug) => {
    if ('row' in bug) return bug;
    const row = judged[bugs.indexOf(bug)];
    if (row === undefined) throw new Error(`${COMMAND_NAME}: no row was judged for ${issueName(bug.ref)}`);
    return { ref: bug.ref, row };
  });
}

/** The code version of `git`'s checkout as one word, `-dirty` on a tree with changes. */
function codeOf(git: GitRunner): string {
  const version = codeVersionOf(git);
  if (version.commit === null) return NO_COMMIT;
  return version.dirty
    ? `${version.commit}${DIRTY_MARK}`
    : version.commit;
}

/** The degraded chain's refusal, before any issue is read. */
function degradedRefusal(data: IssueTrackerData, config: RafaConfig): CommandExit {
  const why = data.fallbackReason === null
    ? ''
    : ` (${data.fallbackReason})`;
  return new CommandExit(1, `❌ ${COMMAND_NAME}: the tracker chain fell back to ${data.kind}, not tracker.default `
    + `${config.trackerDefault}${why}; a bug number there names another issue, so no bug was read`);
}

/** `rows` with a comment posted on each `gone` and `flaky` one, redacted; a comment that throws is a warning. */
async function commentedRows(
  rows: readonly RowAt[],
  report: RecheckReport,
  tracker: Tracker,
  redact: (text: string) => string,
  warn: (message: string) => void,
): Promise<readonly RecheckRow[]> {
  const out: RecheckRow[] = [];
  for (const { row, ref } of rows) {
    const text = recheckComment(row, report);
    if (text === null) {
      out.push(row);
      continue;
    }
    try {
      await tracker.comment(ref, redact(text));
      out.push({ ...row, commented: true });
    } catch (error) {
      warn(`could not comment on ${issueName(ref)}: ${messageOf(error)}`);
      out.push(row);
    }
  }
  return out;
}

/** Runs `rafa bug recheck` over `seams`; see the module note. */
export async function runRecheck(context: RafaContext, seams: RecheckSeams): Promise<void> {
  const line = readRecheckLine(context.args, context.flags);
  const project = requireProject(context, COMMAND_NAME);
  // The chain reads the config again and writes its warnings once; this read stays quiet.
  const config = await resolveProjectConfig(project, COMMAND_NAME, () => undefined);
  const { tracker, data } = await resolveIssueTracker(context, seams);
  if (data.degraded) throw degradedRefusal(data, config);

  const warn = (message: string): void => {
    context.output.warn(message);
  };
  const git = seams.git ?? createGitRunner((seams.cwd ?? ((): string => process.cwd()))());
  const checkout = checkoutOf(git, project.root);
  const base = (seams.env ?? ((): Readonly<SpawnEnv> => process.env))();
  const secrets = namedSecrets(config, base);
  const gh = seams.gh ?? createGhRunner({ cwd: project.root });
  let board: BoardTrust | undefined;
  const trust = (): BoardTrust => {
    board ??= ghBoardTrust({ gh, trustedAuthors: config.boardTrustedAuthors, repo: boardRepoLabel(git) });
    return board;
  };

  const read = line.numbers === null
    ? await openBugs(tracker)
    : await Promise.all(line.numbers.map((issue) => numberedBug(tracker, issue)));
  const bugs = read.filter((bug): bug is ReadBug => !('row' in bug));
  const judged = await judgeBugs(bugs, {
    tracker,
    trust,
    checkout,
    env: base,
    secrets,
    runs: config.bugsRecheckRuns,
    timeoutMs: config.bugsRecheckTimeoutSeconds * MS_PER_SECOND,
    recheck: seams.recheck ?? recheckBug,
    warn,
  });
  const rows = rowsAt(read, bugs, judged.rows);

  const head = { rafa: RAFA_VERSION, code: codeOf(git), checkout, secretsLeftOut: judged.secretsLeftOut, tracker: data };
  const local = localPathRedactor([checkout, project.root], project.home);
  const redact = (text: string): string => redactSecrets(local(text), secrets);
  const report: RecheckReport = {
    ...head,
    rows: line.comment
      ? await commentedRows(rows, { ...head, rows: rows.map((at) => at.row) }, tracker, redact, warn)
      : rows.map((at) => at.row),
  };

  if (context.outputMode === 'json') {
    context.output.result(report);
    return;
  }
  for (const text of renderRecheck(report).split('\n')) context.output.info(text);
}

/** `rafa bug recheck`, as the registry holds it, over `seams`. */
export function createRecheckCommand(seams: RecheckSeams = DEFAULT_ISSUE_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'bug recheck',
    subject: 'bug',
    action: 'recheck',
    summary: 'rerun the test each bug\'s Rerun section names and judge whether the bug still reproduces',
    description: 'Reruns the test a bug\'s `Rerun` section names and judges each bug `reproduces`, `gone`, `flaky`, '
      + '`stale`, `manual` or `skipped`. A `Rerun` value is read strictly as `bun test <file> [-t "<case>"]` and '
      + 'run through the suite runner with no shell; anything else is `manual`, shown with the bug\'s `Reproduce` '
      + 'text. A file outside the checkout is `manual`, a file not there `stale`. A first run that fails is '
      + '`reproduces`; one that passes is followed by `bugs.recheck.runs` more, each under '
      + '`bugs.recheck.timeoutSeconds`, and all passing is `gone`, some failing `flaky`. On any tracker but '
      + '`local`, only a bug opened by a trusted author runs: an author outside `board.trustedAuthors` with no '
      + 'write access is `skipped`. The test runs with every named secret left out of its environment. '
      + 'A chain that fell back from `tracker.default` exits 1 before reading any bug. `--comment` posts the '
      + 'verdict on every `gone` and `flaky` bug, redacted, and closes none. With `--output=json` the report is '
      + 'the data of the terminal result event. Exits 0 whatever the verdicts, and starts no session.',
    args: [
      {
        name: 'n',
        description: 'A bug\'s issue number on the tracker; more than one may be named. Left out, --all is required.',
        type: 'string',
      },
    ],
    flags: [
      { name: ALL_FLAG, description: 'Recheck every open bug the tracker lists.', type: 'boolean' },
      {
        name: COMMENT_FLAG,
        description: 'Post the verdict on every gone and flaky bug, redacted; no bug is closed.',
        type: 'boolean',
      },
    ],
    examples: [
      { cmd: 'rafa bug recheck --all', note: 'Rechecks every open bug and prints one line per bug.' },
      { cmd: 'rafa bug recheck 412', note: 'Rechecks bug 412 alone.' },
      { cmd: 'rafa bug recheck 412 415 --comment', note: 'Rechecks two bugs and comments on each that is gone or flaky.' },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      await runRecheck(context, seams);
    },
  };
  return Object.freeze(command);
}

const command: RafaCommand = createRecheckCommand();
export default command;
