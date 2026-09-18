/**
 * `rafa pr triage [<n>] [--no-comment] [--max-attempts=<count>]`: one
 * pull request assessed IN CODE — its class, the evidence the class was
 * read from, and a follow-up prompt a session can be handed as it
 * stands.
 *
 * No session is spawned and nothing is asked of a model. The whole
 * assessment is `src/pr/triage/`, every module of which is pure: the
 * closed class list (`classes.ts`), the classifier (`classify.ts`), the
 * log reader (`evidence.ts`), the conflict parser (`conflict.ts`), the
 * comment format (`comment.ts`), the four re-run readings (`rerun.ts`)
 * and the selection rule (`select.ts`). `./triage-read.ts` gathers what
 * they need from the provider and from git, and `./triage-report.ts`
 * renders what they concluded. This module is the order those happen in.
 *
 * ## The order, and what each step costs
 *
 * The line first, then the config and the provider through
 * `openPrContext`, as every `pr` action orders them, so a line with a
 * stray word spawns no `gh`. Then, per pull request assessed: `get`,
 * `checks`, `comments`, one `run view --log-failed` per DISTINCT run the
 * failing rows name, and at most one comment write. The conflict is read
 * locally, with no network and no fetch (`./triage-read.ts`).
 *
 * The re-run reading comes BEFORE the logs and the conflict: three of
 * its four readings assess nothing, and there is no reason to pull a
 * 5000-line log for a pull request whose head has not moved since it was
 * last assessed.
 *
 * ## Which pull request, with no `<n>`
 *
 * `selectTriagePullRequests` decides, and it is handed two readings: the
 * open pull request of the branch checked out at the project root, and
 * the RED ones. Red is `verdictOf` over each open pull request's rows,
 * which is the reading `select.ts` documents its input as.
 *
 * That is `red` and not `none`. A repository with no workflows at all
 * answers `no checks reported` for every pull request forever — this one
 * does, `context/verification.md` — so counting `none` as a candidate
 * would make a bare `rafa pr triage` select every open pull request in
 * such a repository. The cost is that a conflicting pull request GitHub
 * scheduled no run for is not picked up by the bare form; it is reached
 * by `rafa pr triage <n>`, and by standing on its branch, which is rule
 * 1 of the selection and outranks the candidates whatever colour they
 * are.
 *
 * A detached HEAD, and a branch git cannot read, are WARNINGS here and
 * not refusals, where `pr show` and `pr merge` refuse on both: they act
 * on the branch's pull request and have nothing to do without it, and
 * this command falls back on the red ones. `pickPullRequest` is not used
 * for the same reason — it refuses a branch with no open pull request,
 * which is the ordinary first case of the selection.
 *
 * ## `--max-attempts` is read, and spends nothing
 *
 * `attempts` in the triage block counts the `--resolve` runs a pull
 * request has had. An assessment spends none: it reads the stored count,
 * carries it into the comment unchanged, and prints it against the cap
 * so an operator can see how much room a later `--resolve` has. The flag
 * is read and refused here rather than at the resolve stage so that the
 * count a comment carries and the cap a line sets are one reading.
 *
 * `--resolve` itself is NOT read by this command. `PR_USAGE.triage`
 * spells it because the usage line is the spec's, and the resolve stage
 * is what makes it act; until then a line carrying it is assessed and
 * nothing is resolved.
 *
 * ## What is allowed to fail
 *
 * A comment that could not be written is REPORTED and does not refuse
 * the run, the way `pr show` reports a checks read that failed. Two
 * reasons: the assessment and the follow-up prompt are the output, and
 * they are in hand by then; and a bare run may be assessing three pull
 * requests, where one refused write would throw away the other two
 * reports. The line saying so is in the report and the reason is in
 * `writeProblem`, so neither mode hides it. A `--log-failed` that
 * rejected is reported the same way (`./triage-read.ts`).
 *
 * ## Refusals
 *
 * `pr-context.ts`'s: exit 2 for a provider that is not `gh`, exit 1 for
 * a second word, a word that is no whole number from 1, a flag that
 * swallowed the number, and a config that cannot be used. Its own, all
 * exit 1: a `--max-attempts` that is no whole number from 1, a number
 * the repository has no pull request for, and a provider call that
 * rejected.
 */
import type { PrSeams } from './pr-context.js';
import type { TriageReading } from './triage-report.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { GitRunner, PullRequestDetail, PullRequestSummary } from '../../pr/index.js';
import type { TriageSelection } from '../../pr/triage/select.js';

import { messageOf } from '../../config-sections.js';
import { createGitRunner } from '../../pr/index.js';
import { classifyTriage } from '../../pr/triage/classify.js';
import { findTriageComment, triageCommentBody, writeTriageComment } from '../../pr/triage/comment.js';
import { buildFollowUpPrompt } from '../../pr/triage/follow-up.js';
import { readTriageRerun } from '../../pr/triage/rerun.js';
import { selectTriagePullRequests } from '../../pr/triage/select.js';

import {
  lineRefusal,
  onProvider,
  openPrContext,
  PR_USAGE,
  readBooleanFlag,
  readPullArgument,
} from './pr-context.js';
import { readConflictFiles, readFailedLogs } from './triage-read.js';
import { evidenceOf, renderTriages } from './triage-report.js';

/** The usage line this action's refusals name. */
const USAGE = PR_USAGE.triage;

/** How many `--resolve` runs a pull request gets when the line names no cap. */
export const DEFAULT_MAX_ATTEMPTS = 2;

/**
 * What `git rev-parse --abbrev-ref HEAD` writes at a detached HEAD,
 * measured for `pr-context.ts` and read here so the fallback is taken
 * rather than a pull request looked up for the branch `HEAD`.
 */
const DETACHED_HEAD = 'HEAD';

/** Whether a `--resolve` run has already fixed the pull request; see the module note. */
const RESOLVED = false;

/** How this action reaches git and the clock, beside what every `pr` action reaches. */
export interface TriageSeams extends PrSeams {
  /** The git runner for a root, which the conflict is read through. `createGitRunner` when left out. */
  readonly git?: (root: string) => GitRunner;
  /** The clock a triage is stamped with, ISO 8601. The system clock when left out. */
  readonly now?: () => string;
}

/** The seams the registered command runs with: the system's own, every one. */
export const DEFAULT_TRIAGE_SEAMS: TriageSeams = Object.freeze({});

/** What json mode gives as the terminal result's `data`. */
export interface PrTriageResult {
  /** What the selection decided, or null when `<n>` named the pull request. */
  readonly selection: TriageSelection | null;
  /** One reading per pull request assessed, in the order they were. */
  readonly readings: readonly TriageReading[];
  /** The report text mode writes. */
  readonly text: string;
}

/** What one pull request's assessment runs with. */
interface AssessOptions {
  /** The provider, the project and the config, as `openPrContext` answered them. */
  readonly pr: ReturnType<typeof openPrContext>;
  /** The git runner the conflict is read through. */
  readonly git: GitRunner;
  /** The pull request number. */
  readonly number: number;
  /** False under `--no-comment`, which reads the stored comment and writes none. */
  readonly wantsComment: boolean;
  /** `--max-attempts`, carried onto the reading for the report. */
  readonly maxAttempts: number;
  /** When the assessment was read, ISO 8601. */
  readonly at: string;
}

/**
 * The cap `--max-attempts` sets. A value that is not a whole number from
 * 1 is refused naming the order that works, as `readBooleanFlag` refuses
 * a flag that swallowed the number.
 */
export function readMaxAttempts(flags: RafaContext['flags'], usage: string): number {
  const value = flags['max-attempts'];
  if (value === undefined) return DEFAULT_MAX_ATTEMPTS;
  const spelled = typeof value === 'boolean'
    ? '--max-attempts with no value'
    : `"${value}"`;
  const count = typeof value === 'string'
    ? Number(value)
    : Number.NaN;
  if (!Number.isSafeInteger(count) || count < 1) {
    throw lineRefusal(
      `${spelled} is no attempt count, which is a whole number from 1;`
        + ' type the pull request number before the flags',
      usage,
    );
  }
  return count;
}

/** The branch checked out at the project root, or null with a warning; see the module note. */
function readBranchOrNone(
  pr: AssessOptions['pr'],
  warn: (message: string) => void,
): string | null {
  const fallback = 'so the red pull requests are the candidates';
  let branch: string;
  try {
    branch = pr.readBranch();
  } catch (error) {
    warn(`The branch at ${pr.project.root} cannot be read, ${fallback}: ${messageOf(error)}`);
    return null;
  }
  if (branch === '' || branch === DETACHED_HEAD) {
    warn(`${pr.project.root} is on no branch, ${fallback}.`);
    return null;
  }
  return branch;
}

/** The open pull requests whose checks read `red`; see the module note. */
async function redPullRequests(
  pr: AssessOptions['pr'],
): Promise<readonly PullRequestSummary[]> {
  const open = await onProvider('list the open pull requests', () => pr.pulls.list());
  const red: PullRequestSummary[] = [];
  for (const one of open) {
    const checks = await onProvider(`read the checks of #${one.number}`, () => pr.pulls.checks(one.number));
    if (checks.verdict === 'red') red.push(one);
  }
  return red;
}

/** Which pull requests a bare `rafa pr triage` assesses, through `selectTriagePullRequests`. */
async function selectTargets(
  pr: AssessOptions['pr'],
  warn: (message: string) => void,
  now: string,
): Promise<TriageSelection> {
  const branch = readBranchOrNone(pr, warn);
  const current = branch === null
    ? null
    : await onProvider(
      `read the open pull request for the branch "${branch}"`,
      () => pr.pulls.findOpen(branch),
    );
  if (current !== null) return selectTriagePullRequests({ current, candidates: [], now });
  return selectTriagePullRequests({ current: null, candidates: await redPullRequests(pr), now });
}

/** The pull request in full, or the refusal for a number the repository has none under. */
async function detailOf(pr: AssessOptions['pr'], number: number): Promise<PullRequestDetail> {
  const detail = await onProvider(`read pull request #${number}`, () => pr.pulls.get(number));
  if (detail === null) {
    throw lineRefusal(`No pull request #${number} in the repository at ${pr.project.root}`, USAGE);
  }
  return detail;
}

/** The marker comment on a pull request, through the port's comment list. */
async function triageCommentOf(
  pr: AssessOptions['pr'],
  number: number,
): Promise<ReturnType<typeof findTriageComment>> {
  const comments = await onProvider(`read the comments of #${number}`, () => pr.pulls.comments(number));
  return findTriageComment(comments);
}

/** What a reading that assessed nothing answers: the stored triage and no class. */
function storedOnly(
  detail: PullRequestDetail,
  rerun: TriageReading['rerun'],
  maxAttempts: number,
): TriageReading {
  return {
    detail,
    rerun,
    assessment: null,
    logs: null,
    conflict: null,
    prompt: null,
    write: null,
    writeProblem: null,
    attempts: rerun.block?.attempts ?? 0,
    maxAttempts,
  };
}

/** Writes or edits the triage comment, answering what a failed write said instead of throwing. */
async function commentOn(
  options: AssessOptions,
  reading: TriageReading,
  existing: ReturnType<typeof findTriageComment>,
): Promise<Pick<TriageReading, 'write' | 'writeProblem'>> {
  const { assessment, detail } = reading;
  if (reading.rerun.write === 'none' || assessment === null) return { write: null, writeProblem: null };
  const body = triageCommentBody({
    pr: detail,
    assessment,
    at: options.at,
    attempts: reading.attempts,
    resolved: RESOLVED,
    evidence: evidenceOf(reading),
  });
  try {
    const write = await writeTriageComment({ pulls: options.pr.pulls, number: options.number, body, existing });
    return { write, writeProblem: null };
  } catch (error) {
    return { write: null, writeProblem: messageOf(error) };
  }
}

/** Assesses one pull request: the four reads, the classification, and the comment. */
async function assessOne(options: AssessOptions): Promise<TriageReading> {
  const { git, maxAttempts, number, pr } = options;
  const detail = await detailOf(pr, number);
  const checks = await onProvider(`read the checks of #${number}`, () => pr.pulls.checks(number));
  const existing = await triageCommentOf(pr, number);
  const rerun = readTriageRerun({
    comment: existing,
    head: detail.headRefOid,
    rows: checks.rows,
    noComment: !options.wantsComment,
  });
  if (!rerun.assesses) return storedOnly(detail, rerun, maxAttempts);

  const logs = await readFailedLogs(pr.pulls, checks.rows);
  const conflict = detail.mergeable === 'mergeable'
    ? null
    : readConflictFiles(git, detail);
  const assessment = classifyTriage({
    pr: detail,
    rows: checks.rows,
    step: logs.chosen?.evidence.step,
    conflictFiles: conflict?.files ?? [],
  });
  const assessed: TriageReading = {
    detail,
    rerun,
    assessment,
    logs,
    conflict,
    prompt: buildFollowUpPrompt({ pr: detail, assessment, evidence: logs.chosen?.evidence }),
    write: null,
    writeProblem: null,
    attempts: rerun.block?.attempts ?? 0,
    maxAttempts,
  };
  return { ...assessed, ...await commentOn(options, assessed, existing) };
}

/** Assesses what the line and the selection chose, and answers the whole report. */
export async function runTriage(context: RafaContext, seams: TriageSeams): Promise<PrTriageResult> {
  const wantsComment = readBooleanFlag(context.flags, 'comment', USAGE, true);
  const maxAttempts = readMaxAttempts(context.flags, USAGE);
  const asked = readPullArgument(context.args, USAGE);
  const pr = openPrContext(context, seams);
  const git = (seams.git ?? createGitRunner)(pr.project.root);
  const now = seams.now ?? ((): string => new Date().toISOString());

  const selection = asked === null
    ? await selectTargets(pr, (message) => {
      context.output.warn(message);
    }, now())
    : null;
  const numbers = asked === null
    ? (selection?.assess ?? []).map((one) => one.number)
    : [asked];

  const readings: TriageReading[] = [];
  for (const number of numbers) {
    readings.push(await assessOne({ pr, git, number, wantsComment, maxAttempts, at: now() }));
  }
  const text = [
    ...selection === null
      ? []
      : [selection.message],
    ...readings.length === 0
      ? []
      : [renderTriages(readings)],
  ].join('\n\n');
  return { selection, readings, text };
}

/** The command, reaching the provider, git, the branch and the clock through `seams`. */
export function createPrTriageCommand(seams: TriageSeams = DEFAULT_TRIAGE_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'pr triage',
    subject: 'pr',
    action: 'triage',
    summary: 'assess a pull request: its class, the evidence, and a follow-up prompt',
    description: 'Assesses one pull request in code — no session is started and no model is asked. It reads the pull'
      + ' request, its checks, the failing job logs and, for a head that does not merge, the conflicting files from'
      + ' `git merge-tree`, and classifies it as one of `green`, `pending`, `conflict-lockfile`, `conflict-manifest`,'
      + ' `conflict-other`, `ci-install`, `ci-lint`, `ci-types`, `ci-test` or `ci-other`. It prints the class, the'
      + ' evidence it was read from with the failing log capped at 40 lines, and a follow-up prompt carrying all of'
      + ' it, so a session handed that prompt assesses nothing again. It leaves one triage comment per pull request'
      + ' and edits that comment on every later assessment; a pull request whose head has not moved since it was'
      + ' assessed is shown its stored triage and assessed again by nothing. Without a number it assesses the open'
      + ' pull request of the branch checked out at the project root; with no pull request there it takes the red'
      + ' ones, assessing one, or the two or three of them that moved in the last 72 hours, and listing more than'
      + ' three with the command for each. With `--output=json` the selection, every'
      + ' reading and the rendered text are the data of the terminal result event. Refuses with exit code 2 where'
      + ' `pr.provider` is not `gh`.',
    args: [
      {
        name: 'n',
        description: 'The pull request number. The open pull request of the current branch when it is left out.',
        type: 'number',
      },
    ],
    flags: [
      {
        name: 'comment',
        description: 'Leave the triage as a comment on the pull request; `--no-comment` reads one and writes none.',
        type: 'boolean',
        default: true,
      },
      {
        name: 'max-attempts',
        description: 'How many resolve runs a pull request gets. An assessment spends none and reports the count.',
        type: 'number',
        default: DEFAULT_MAX_ATTEMPTS,
      },
    ],
    examples: [
      {
        cmd: 'rafa pr triage',
        note: 'Assesses the open pull request of the branch checked out at the project root, or the red ones.',
      },
      {
        cmd: 'rafa pr triage 41 --no-comment',
        note: 'Assesses pull request 41 and writes nothing to it, reading the triage comment already there.',
      },
      {
        cmd: 'rafa pr triage 41 --output=json',
        note: 'Writes a result event holding the class, the evidence and the follow-up prompt.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const triaged = await runTriage(context, seams);
      if (context.outputMode === 'json') {
        context.output.result(triaged);
        return;
      }
      if (triaged.text !== '') context.output.info(triaged.text);
    },
  };
  return Object.freeze(command);
}

export default createPrTriageCommand();
