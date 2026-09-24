/**
 * The `github` Tracker adapter: issues on GitHub, through the `gh` CLI,
 * for a project whose repository lives there.
 *
 * Copied from `createGithubTracker` in open-tomato's
 * `packages/shared/issue-tracker/src/adapters/github.ts` at commit
 * `45aaab563e5b4f4e6258e19ebf752b7cfeb67bf0` (2026-08-05), and retyped
 * against rafa's `Tracker` port, which `src/ports/index.ts` copies from
 * the same commit's `port.ts`.
 *
 * ## The `gh` runner seam
 *
 * The adapter spawns nothing itself. It is made with a {@link GhRunner},
 * which is handed the arguments after `gh` and answers whether the
 * command exited 0 and what it wrote. {@link createGhRunner} is the
 * runner that spawns `gh`. The tests hand over the recorded fake in
 * `github-fake.ts` instead, so no case reaches GitHub or reads the
 * configuration `gh` keeps under the home. Authentication is the one
 * `gh` holds, as in the source: nothing here reads a token.
 *
 * ## Which repository
 *
 * The source named its repository in its config (`github.org` and
 * `github.repo`, with `modules.*.repo` routing a module elsewhere) and
 * passed `--repo` to every command. rafa's config has no `github`
 * section, and its `modules` are add-on sources, so the adapter passes
 * no `--repo` of its own: `gh` resolves the repository of the directory
 * the runner runs in, which the registry makes the repository root.
 * `gh help environment` names `GH_REPO` as the override, and the runner
 * hands `gh` the environment it inherits, or the one its `env` option
 * names. A close goes through `gh api`
 * over `repos/{owner}/{repo}/issues/<number>`, and `gh api --help` says
 * those placeholders are filled from the same repository.
 *
 * A ref carrying `repo` is read in that repository, as the source read
 * it: the name is passed as `--repo`, and in the `gh api` path. Nothing
 * here makes such a ref; one arrives from a caller.
 *
 * `preflight` asks `gh repo view` for the repository after
 * `gh auth status`, where the source probed Projects v2. A checkout
 * `gh` resolves no repository for then fails preflight, and the
 * degradation chain moves on, where it would otherwise pass and fail
 * every command after it. Read off `gh` 2.100.0 on 2026-09-14 in
 * scratch directories: with no git repository, `gh repo view` exits 1
 * with `failed to run git: fatal: not a git repository (or any of the
 * parent directories): .git`. In a repository with no remote it exits 1
 * with `no git remotes found`, and `gh api` over the placeholder path
 * exits 1 with `unable to expand placeholder in path: no git remotes
 * found`.
 *
 * ## Left out
 *
 *   - Projects v2: the catalogue probe, the board placement `create`
 *     made, the board column `get` read and `transition` wrote, and
 *     `board.ts` behind them, which phase 1 does not port.
 *     `capabilities` answers `projects` and `customFields` false,
 *     `draft.project` is never sent, and no ref carries a placement
 *     `warning`. `get` answers `project: null`, as the source did.
 *   - Org issue types: the `github.issueTypes` map and the `--type`
 *     `create` passed from it. `capabilities` answers `issueTypes`
 *     false, and an issue's type travels as its `type:` label alone.
 *
 * ## What the copy changes
 *
 *   - Identity. rafa ports no OPT ledger, and triage passes `opt: 0` in
 *     every draft, so `create` stamps no `[OPT-<opt>]` onto the title
 *     and `get` reads no opt back off one: the title is sent, and
 *     answered, as the draft held it. The issue number is the identity,
 *     answered as `externalId`. `create` answers the draft's `opt`, `get`
 *     the ref's, and `find`, which has no ref to read one from, 0.
 *   - Labels. The source's configurable label names are fixed at its
 *     defaults, {@link GITHUB_LABELS}, since rafa's config has none.
 *   - States. Without a board, GitHub holds an issue open or closed, and
 *     closed with a reason. `get` answers `todo` for an open issue,
 *     `cancelled` for one closed as not planned, and `done` for any other
 *     closed one. The source read the not-planned reason whatever the
 *     issue's state; the copy reads it on a closed issue alone.
 *     `transition` makes the open or closed write the source made, and
 *     answers a `warning` for the four states that write cannot hold:
 *     `backlog`, `in-progress` and `in-review` read back as `todo`, and
 *     `released` as `done`. The source warned the same way when a board
 *     column could not be set.
 *   - Refs. A ref of another kind is refused, as the `local` adapter
 *     refuses one. An `externalId` that is not an issue number is refused
 *     before any argument is built from it, so no ref hands `gh` a flag,
 *     such as `--web`, where a number goes. A `repo` that is not
 *     `owner/name` is refused, `.` and `..` included, so no ref steers
 *     the `gh api` path.
 *   - Pull requests. `gh issue view` answers a pull request's number
 *     too. Read off `gh` 2.100.0 on 2026-09-14, `gh issue view 1 --repo
 *     cli/cli` exited 0 with `state` `MERGED`, `stateReason` an empty
 *     string and a `url` ending `/pull/1`. `get` refuses a payload whose
 *     url does not end `/issues/<number>`, where the source read that
 *     pull request as an issue in `todo`.
 *   - Validation. The JSON `gh` writes is checked by hand where the
 *     source cast it, and a draft is checked before any command runs, so
 *     a draft no `get` could answer files nothing. A module holding a
 *     comma is refused, in a draft and in a query: `gh issue create
 *     --help` shows `--label "bug,help wanted"` adding two labels, so
 *     `module:a,b` would be made as one label and sent as two.
 *   - Errors open with `github tracker:` and name the command. A runner
 *     that rejects makes `preflight` answer not ok, where the source's
 *     `preflight` would have thrown.
 *   - Every port function is a property, and the tracker answered is
 *     frozen, as the `local` adapter's is.
 *
 * Kept as the source has them: `create` makes every label it sends with
 * `gh label create --force` before `gh issue create`, because the source
 * found `gh issue create` fails whole on a label that does not exist,
 * and remembers each label it made for the tracker's life. A null
 * priority is sent as `needs-triage` and any other as `priority:<value>`,
 * never both, and `blockedBy` as `blocked-by:OPT-<number>` labels, the
 * port still naming those OPT numbers. `get` answers `code` for a
 * missing or foreign type label, null for a priority label, and
 * `unassigned` for a module label. `find` refuses any state, naming the
 * states that share its open or closed bucket, and lists `--state all`,
 * 30 issues unless `limit` says otherwise, narrowed by module and type
 * labels and by `--search` text. A close goes through `gh api -X PATCH`
 * with a `state_reason`, because the source found `gh issue close
 * --reason` makes no call on an issue already closed and drops the
 * changed reason; a reopen goes through `gh issue reopen`.
 */
import type {
  Issue,
  IssueDraft,
  IssueQuery,
  IssueRef,
  IssueState,
  IssueType,
  PreflightResult,
  Tracker,
  TrackerCapabilities,
  TransitionResult,
} from '../../ports/index.js';

import { describeValue, isMapping, messageOf } from '../../config-sections.js';

import { ISSUE_PRIORITIES, ISSUE_STATES, ISSUE_TYPES } from './issue-values.js';

/** What every refusal opens with. */
const PREFIX = 'github tracker';

/** What one `gh` command answered. */
export interface GhResult {
  /** True when `gh` exited 0. */
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs `gh` with the arguments after its name. A command that fails,
 * or could not be run, answers `ok` false rather than rejecting.
 */
export type GhRunner = (args: readonly string[]) => Promise<GhResult>;

/** What the runner spawning `gh` is made with. */
export interface GhRunnerOptions {
  /** The directory `gh` runs in, whose repository it resolves. */
  readonly cwd: string;
  /**
   * The executable spawned: `gh` when left out. A bare name is looked up
   * on `PATH` — the rafa process's, or `env.PATH` when `env` is given.
   */
  readonly command?: string;
  /**
   * The whole environment `gh` is spawned with, in place of the rafa
   * process's own, and the one whose `PATH` the command is looked up on.
   * An `env` with no `PATH` finds a bare command nowhere: nothing falls
   * back to the rafa process's `PATH`. Left out, `gh` inherits
   * `process.env`, as before this option existed.
   */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * How long one command may run, in milliseconds. Past it the spawned
   * process is sent `SIGKILL` and the command answers `ok` false with a
   * stderr naming the timeout. Left out, a command runs as long as it
   * takes, as before this option existed.
   */
  readonly timeoutMs?: number;
}

/** The label names a draft is projected onto: the source's defaults, fixed. */
export const GITHUB_LABELS = Object.freeze({
  modulePrefix: 'module:',
  typePrefix: 'type:',
  priorityPrefix: 'priority:',
  needsTriage: 'needs-triage',
  blockedByPrefix: 'blocked-by:OPT-',
});

/** The fields `get` asks `gh issue view` for. */
const VIEW_FIELDS = 'number,title,body,state,stateReason,labels,url';

/** The fields `find` asks `gh issue list` for. */
const LIST_FIELDS = 'number,url,labels';

/** How many issues `find` lists when the query sets no limit: `gh issue list`'s default. */
const DEFAULT_FIND_LIMIT = 30;

/** The close reason `gh issue view` answers for an issue closed as not planned. */
const NOT_PLANNED = 'NOT_PLANNED';

/** An issue number as written: a positive whole number with no leading zero. */
const ISSUE_NUMBER = /^[1-9]\d*$/;

/** One half of `owner/name`. */
const REPO_PART = /^[\w.-]+$/;

/** The URL `gh issue create` prints, capturing the issue number. */
const CREATED_ISSUE_URL = /^https:\/\/[^\s/]+\/[\w.-]+\/[\w.-]+\/issues\/([1-9]\d*)$/;

/**
 * The GitHub issue state each port state is written as: closed for the
 * three the source closes, open for the rest. `satisfies` closes the
 * record over `IssueState` both ways.
 */
const REST_STATES = {
  'backlog': 'open',
  'todo': 'open',
  'in-progress': 'open',
  'in-review': 'open',
  'done': 'closed',
  'released': 'closed',
  'cancelled': 'closed',
} satisfies Record<IssueState, 'open' | 'closed'>;

/**
 * Makes the runner that spawns `gh` in `options.cwd`, with stdin closed
 * and stdout and stderr read to their end.
 *
 * Measured on bun 1.3.14: `Bun.spawn` throws, rather than answering an
 * exit code, when the executable is not found (`Executable not found in
 * $PATH`, code `ENOENT`) and when `cwd` does not exist, and that second
 * message names the executable rather than the directory. Either throw
 * is answered as `ok` false with a stderr naming both.
 *
 * With `options.env`, the command is resolved by `Bun.which` on
 * `env.PATH` (relative to `cwd`) before anything is spawned, and spawned
 * by the path found, with `env` as its whole environment. A command not
 * found there answers `ok` false, with a stderr naming the command, the
 * directory, the `PATH` searched and `ENOENT`, and spawns nothing. The
 * lookup is made here rather than left to `Bun.spawn`: bun 1.3.14 does
 * look a bare name up on `env.PATH` without falling back to its own, but
 * a lookup made here keeps that reading, and the message a missing `gh`
 * answers, independent of the bun version.
 *
 * With `options.timeoutMs`, a command still running at the deadline is
 * killed and answered as `ok` false, with empty stdout and a stderr naming
 * the command, the directory and the timeout. The runner waits for the
 * killed process to exit but not for its pipes to close: a process it
 * started (a shell's `sleep`, say) survives the kill holding them open,
 * and reading them to their end would wait on it.
 */
export function createGhRunner(options: GhRunnerOptions): GhRunner {
  const { cwd, command = 'gh', env, timeoutMs } = options;
  return async (args) => {
    const executable = env === undefined
      ? command
      : Bun.which(command, { PATH: env.PATH ?? '', cwd });
    if (executable === null) {
      return { ok: false, stdout: '', stderr: notOnPath(command, cwd, env?.PATH) };
    }
    try {
      const proc = Bun.spawn([executable, ...args], {
        cwd,
        ...(env === undefined
          ? {}
          : { env: { ...env } }),
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const finished = Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      const outcome = await withDeadline(finished, timeoutMs);
      if (outcome === TIMED_OUT) {
        proc.kill('SIGKILL');
        await proc.exited;
        return { ok: false, stdout: '', stderr: `${command} in ${cwd} timed out after ${timeoutMs}ms and was killed` };
      }
      const [stdout, stderr, exitCode] = outcome;
      return { ok: exitCode === 0, stdout, stderr };
    } catch (error) {
      return { ok: false, stdout: '', stderr: `could not run ${command} in ${cwd}: ${messageOf(error)}` };
    }
  };
}

/** What {@link withDeadline} answers when the deadline passed first. */
const TIMED_OUT = Symbol('timed out');

/**
 * `work`'s value, or {@link TIMED_OUT} when `timeoutMs` passes first; with
 * no `timeoutMs`, `work` alone. The timer is cleared either way.
 */
async function withDeadline<T>(work: Promise<T>, timeoutMs: number | undefined): Promise<T | typeof TIMED_OUT> {
  if (timeoutMs === undefined) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** What the runner answers for a command its `env.PATH` does not hold. */
function notOnPath(command: string, cwd: string, path: string | undefined): string {
  const searched = path === undefined
    ? 'an environment with no PATH'
    : `PATH ${JSON.stringify(path)}`;
  return `could not run ${command} in ${cwd}: not found on ${searched} (ENOENT)`;
}

/** True when `value` is one of `members`. */
function isOneOf<T extends string>(members: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (members as readonly string[]).includes(value);
}

/** True for an issue number within `Number.MAX_SAFE_INTEGER`, as a string. */
function isIssueNumber(value: unknown): value is string {
  return typeof value === 'string' && ISSUE_NUMBER.test(value) && Number.isSafeInteger(Number(value));
}

/** True for `owner/name`, with neither half `.` or `..`. */
function isRepoName(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const parts = value.split('/');
  return parts.length === 2 && parts.every((part) => REPO_PART.test(part) && part !== '.' && part !== '..');
}

/** True for a string `gh` sends as one label: one holding no comma. */
function isLabelPart(value: unknown): value is string {
  return typeof value === 'string' && !value.includes(',');
}

/** A flag and its value, or nothing when the value is absent. */
function optionalFlag(name: string, value: string | undefined): string[] {
  return value === undefined
    ? []
    : [name, value];
}

/** What a failed command wrote, for a refusal or a preflight reason. Never empty. */
function detailOf(result: GhResult): string {
  return result.stderr.trim() || result.stdout.trim() || 'it exited non-zero and wrote nothing';
}

/** Whether a draft field's value is acceptable, and what an acceptable one is. */
type DraftCheck = readonly [key: keyof IssueDraft, accepts: (value: unknown) => boolean, expected: string];

/** Each draft field's check, in the order a refusal names the first failing one. */
const DRAFT_CHECKS: readonly DraftCheck[] = [
  ['opt', (value) => typeof value === 'number' && Number.isFinite(value), 'a number'],
  ['title', (value) => typeof value === 'string', 'a string'],
  ['body', (value) => typeof value === 'string', 'a string'],
  ['type', (value) => isOneOf(ISSUE_TYPES, value), `one of: ${ISSUE_TYPES.join(', ')}`],
  ['module', isLabelPart, 'a string holding no comma'],
  [
    'priority',
    (value) => value === null || isOneOf(ISSUE_PRIORITIES, value),
    `null or one of: ${ISSUE_PRIORITIES.join(', ')}`,
  ],
  ['project', (value) => value === null || typeof value === 'string', 'a string or null'],
  [
    'blockedBy',
    (value) => Array.isArray(value) && value.every((item) => Number.isSafeInteger(item) && item > 0),
    'a list of positive whole numbers',
  ],
];

/** The first thing wrong with a draft, or null when nothing is. */
function draftProblem(draft: unknown): string | null {
  if (!isMapping(draft)) return `the draft is ${describeValue(draft)}, expected a mapping`;
  const failed = DRAFT_CHECKS.find(([key, accepts]) => !accepts(draft[key]));
  return failed === undefined
    ? null
    : `${failed[0]} is ${describeValue(draft[failed[0]])}, expected ${failed[2]}`;
}

/** The labels a draft is sent with; see the module note. */
function labelsFor(draft: IssueDraft): string[] {
  const priority = draft.priority === null
    ? GITHUB_LABELS.needsTriage
    : `${GITHUB_LABELS.priorityPrefix}${draft.priority}`;
  return [
    `${GITHUB_LABELS.modulePrefix}${draft.module}`,
    `${GITHUB_LABELS.typePrefix}${draft.type}`,
    ...draft.blockedBy.map((opt) => `${GITHUB_LABELS.blockedByPrefix}${opt}`),
    priority,
  ];
}

/**
 * The issue number a ref names, as `gh` is handed it. Throws when the
 * ref is of another kind, its `externalId` is not an issue number, or
 * its `repo` is not `owner/name`.
 */
function issueNumberOfRef(ref: IssueRef): string {
  if (ref.kind !== 'github') {
    throw new Error(
      `${PREFIX}: refused a ref of kind ${describeValue(ref.kind)}; this tracker reads github refs only`,
    );
  }
  if (!isIssueNumber(ref.externalId)) {
    throw new Error(
      `${PREFIX}: externalId ${describeValue(ref.externalId)} is not a GitHub issue number,`
        + ' expected a positive whole number with no leading zero',
    );
  }
  if (ref.repo !== undefined && !isRepoName(ref.repo)) {
    throw new Error(`${PREFIX}: repo ${describeValue(ref.repo)} is not a repository, expected owner/name`);
  }
  return ref.externalId;
}

/** What `command` wrote, parsed as JSON. Throws, naming the command, when it is not JSON. */
function parseJson(stdout: string, command: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new Error(`${PREFIX}: ${command} wrote output that is not JSON: ${messageOf(error)}`, {
      cause: error,
    });
  }
}

/** The names of a payload's labels, or null when they are not a list of named labels. */
function labelNames(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const names = value.map((label) => (isMapping(label) && typeof label['name'] === 'string'
    ? label['name']
    : null));
  return names.every((name): name is string => name !== null)
    ? names
    : null;
}

/** An issue as `gh issue view` answered it, checked. */
interface ViewedIssue {
  readonly title: string;
  readonly body: string;
  readonly state: 'OPEN' | 'CLOSED';
  readonly stateReason: string | null;
  readonly labels: readonly string[];
  readonly url: string;
}

/** The first thing wrong with a `gh issue view` payload for issue `number`, or null. */
function viewProblem(payload: unknown, number: string): string | null {
  if (!isMapping(payload)) return `${describeValue(payload)}, expected a mapping`;
  const { title, body, state, stateReason, labels, url } = payload;
  if (typeof url !== 'string' || !url.endsWith(`/issues/${number}`)) {
    return `url ${describeValue(url)}, expected an issue URL ending /issues/${number},`
      + ` where a pull request URL ends /pull/${number}`;
  }
  if (typeof title !== 'string') return `title ${describeValue(title)}, expected a string`;
  if (typeof body !== 'string') return `body ${describeValue(body)}, expected a string`;
  if (state !== 'OPEN' && state !== 'CLOSED') return `state ${describeValue(state)}, expected "OPEN" or "CLOSED"`;
  if (stateReason !== null && typeof stateReason !== 'string') {
    return `stateReason ${describeValue(stateReason)}, expected a string or null`;
  }
  return labelNames(labels) === null
    ? 'labels that are not a list of named labels'
    : null;
}

/** The issue `gh issue view <number>` wrote. Throws when it is not one. */
function viewedIssue(stdout: string, number: string): ViewedIssue {
  const command = `gh issue view ${number}`;
  const payload = parseJson(stdout, command);
  const problem = viewProblem(payload, number);
  if (problem !== null) throw new Error(`${PREFIX}: ${command} answered ${problem}`);
  // Every field was checked above.
  const checked = payload as { [K in keyof ViewedIssue]: ViewedIssue[K] } & { labels: unknown };
  return { ...checked, labels: labelNames(checked.labels) ?? [] };
}

/** One row `gh issue list` wrote, checked. */
interface ListedIssue {
  readonly number: number;
  readonly url: string;
  readonly labels: readonly string[];
}

/** The rows `gh issue list` wrote. Throws, naming the first row refused, when they are not issues. */
function listedIssues(stdout: string): ListedIssue[] {
  const command = 'gh issue list';
  const payload = parseJson(stdout, command);
  if (!Array.isArray(payload)) {
    throw new Error(`${PREFIX}: ${command} answered ${describeValue(payload)}, expected a list`);
  }
  return payload.map((row: unknown, index): ListedIssue => {
    const refuse = (problem: string): Error => new Error(`${PREFIX}: ${command} answered row ${index} ${problem}`);
    if (!isMapping(row)) throw refuse(`${describeValue(row)}, expected a mapping`);
    const { number, url } = row;
    const labels = labelNames(row['labels']);
    if (typeof number !== 'number' || !isIssueNumber(String(number))) {
      throw refuse(`with number ${describeValue(number)}, expected an issue number`);
    }
    if (typeof url !== 'string') throw refuse(`with url ${describeValue(url)}, expected a string`);
    if (labels === null) throw refuse('with labels that are not a list of named labels');
    return { number, url, labels };
  });
}

/** The value a label with `prefix` carries, or undefined when no label has it. */
function labelValue(labels: readonly string[], prefix: string): string | undefined {
  return labels.find((label) => label.startsWith(prefix))?.slice(prefix.length);
}

/**
 * The type an issue's labels carry: the value of its first `type:`
 * label when that is one of the port's types, else `code`. `get` answers
 * it, and the board listing (`src/board/roadmap-board.ts`) reads each
 * row's type with it, so the two cannot disagree about one issue.
 */
export function typeOfLabels(labels: readonly string[]): IssueType {
  const type = labelValue(labels, GITHUB_LABELS.typePrefix);
  return isOneOf(ISSUE_TYPES, type)
    ? type
    : 'code';
}

/**
 * The module an issue's labels carry: the value of its first `module:`
 * label, else `unassigned`. Read by `get` and by the board listing, as
 * {@link typeOfLabels} is.
 */
export function moduleOfLabels(labels: readonly string[]): string {
  return labelValue(labels, GITHUB_LABELS.modulePrefix) ?? 'unassigned';
}

/** The state `get` answers for a viewed issue; see the module note. */
function stateOf(viewed: ViewedIssue): IssueState {
  if (viewed.state === 'OPEN') return 'todo';
  return viewed.stateReason === NOT_PLANNED
    ? 'cancelled'
    : 'done';
}

/** The issue `get` answers for `ref`, from what `gh issue view` wrote. */
function issueOf(ref: IssueRef, viewed: ViewedIssue): Issue {
  const priority = labelValue(viewed.labels, GITHUB_LABELS.priorityPrefix);
  return {
    opt: ref.opt,
    title: viewed.title,
    body: viewed.body,
    type: typeOfLabels(viewed.labels),
    module: moduleOfLabels(viewed.labels),
    priority: isOneOf(ISSUE_PRIORITIES, priority)
      ? priority
      : null,
    project: null,
    blockedBy: viewed.labels
      .map((label) => (label.startsWith(GITHUB_LABELS.blockedByPrefix)
        ? label.slice(GITHUB_LABELS.blockedByPrefix.length)
        : ''))
      .filter(isIssueNumber)
      .map(Number),
    ref: { ...ref, url: viewed.url },
    state: stateOf(viewed),
  };
}

/** The state `get` answers once an issue has been moved to `state`. */
function readBackState(state: IssueState): IssueState {
  if (REST_STATES[state] === 'open') return 'todo';
  return state === 'cancelled'
    ? 'cancelled'
    : 'done';
}

/** Why `find` refuses to narrow by `state`. */
function stateQueryRefusal(state: IssueState): string {
  const bucket = REST_STATES[state];
  const siblings = ISSUE_STATES.filter((other) => other !== state && REST_STATES[other] === bucket);
  return `${PREFIX}: find cannot narrow by state ${describeValue(state)}: GitHub holds an issue open or`
    + ` closed, and ${state} shares ${bucket} with ${siblings.join(', ')}, so a result would include`
    + ' those too. Search without a state, then read each issue with get.';
}

/** What a GitHub tracker is made with. */
export interface GithubTrackerOptions {
  /** Runs every `gh` command the tracker issues. */
  readonly gh: GhRunner;
}

/** Makes a `github` tracker over `options.gh`; see the module note. */
export function createGithubTracker(options: GithubTrackerOptions): Tracker {
  const { gh } = options;
  // Labels this tracker made or found made, for its life.
  let knownLabels: ReadonlySet<string> = new Set();

  /** What `args` wrote to stdout. Rejects, naming `command`, when it failed. */
  async function run(args: readonly string[], command: string): Promise<string> {
    const result = await gh(args);
    if (!result.ok) throw new Error(`${PREFIX}: ${command} failed: ${detailOf(result)}`);
    return result.stdout;
  }

  /** Makes every label in `names` this tracker has not made yet. */
  async function ensureLabels(names: readonly string[]): Promise<void> {
    const missing = [...new Set(names)].filter((name) => !knownLabels.has(name));
    for (const name of missing) {
      // `--force` makes it idempotent: a label made meanwhile is updated, not refused.
      await run(['label', 'create', name, '--force'], `gh label create ${describeValue(name)}`);
    }
    knownLabels = new Set([...knownLabels, ...missing]);
  }

  const tracker: Tracker = {
    kind: 'github',

    capabilities: (): TrackerCapabilities => ({
      projects: false,
      customFields: false,
      issueTypes: false,
    }),

    preflight: async (): Promise<PreflightResult> => {
      try {
        const auth = await gh(['auth', 'status']);
        if (!auth.ok) return { ok: false, reason: `gh auth status: ${detailOf(auth)}` };
        const repo = await gh(['repo', 'view', '--json', 'nameWithOwner']);
        if (!repo.ok) return { ok: false, reason: `gh repo view: ${detailOf(repo)}` };
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: `gh could not be run: ${messageOf(error)}` };
      }
    },

    create: async (draft: IssueDraft): Promise<IssueRef> => {
      const problem = draftProblem(draft);
      if (problem !== null) throw new TypeError(`${PREFIX}: refused to file an invalid draft: ${problem}`);

      const labels = labelsFor(draft);
      // Before `gh issue create`: nothing is filed yet, so a failure orphans nothing.
      await ensureLabels(labels);
      const stdout = await run([
        'issue',
        'create',
        '--title',
        draft.title,
        '--body',
        draft.body,
        ...labels.flatMap((label) => ['--label', label]),
      ], 'gh issue create');

      const url = stdout.trim().split('\n')
        .at(-1) ?? '';
      const number = CREATED_ISSUE_URL.exec(url)?.[1];
      if (number === undefined) {
        throw new Error(
          `${PREFIX}: gh issue create exited 0 and printed no issue URL, so the issue may exist`
            + ` unrecorded; it wrote ${describeValue(stdout)}`,
        );
      }
      return { opt: draft.opt, kind: 'github', externalId: number, url, module: draft.module };
    },

    get: async (ref: IssueRef): Promise<Issue> => {
      const number = issueNumberOfRef(ref);
      const stdout = await run(
        ['issue', 'view', number, ...optionalFlag('--repo', ref.repo), '--json', VIEW_FIELDS],
        `gh issue view ${number}`,
      );
      return issueOf(ref, viewedIssue(stdout, number));
    },

    find: async (query: IssueQuery): Promise<IssueRef[]> => {
      if (query.state !== undefined) throw new Error(stateQueryRefusal(query.state));
      if (query.module !== undefined && !isLabelPart(query.module)) {
        throw new TypeError(`${PREFIX}: find refused module ${describeValue(query.module)}, expected a string holding no comma`);
      }

      const moduleLabel = query.module === undefined
        ? undefined
        : `${GITHUB_LABELS.modulePrefix}${query.module}`;
      const typeLabel = query.type === undefined
        ? undefined
        : `${GITHUB_LABELS.typePrefix}${query.type}`;
      const stdout = await run([
        'issue',
        'list',
        '--state',
        'all',
        '--json',
        LIST_FIELDS,
        '--limit',
        String(query.limit ?? DEFAULT_FIND_LIMIT),
        ...optionalFlag('--label', moduleLabel),
        ...optionalFlag('--label', typeLabel),
        ...optionalFlag('--search', query.text),
      ], 'gh issue list');

      return listedIssues(stdout).map((row): IssueRef => {
        const module = labelValue(row.labels, GITHUB_LABELS.modulePrefix);
        const ref: IssueRef = { opt: 0, kind: 'github', externalId: String(row.number), url: row.url };
        return module === undefined
          ? ref
          : { ...ref, module };
      });
    },

    comment: async (ref: IssueRef, body: string): Promise<void> => {
      const number = issueNumberOfRef(ref);
      if (typeof body !== 'string') {
        throw new TypeError(`${PREFIX}: refused a comment body ${describeValue(body)}, expected a string`);
      }
      await run(
        ['issue', 'comment', number, ...optionalFlag('--repo', ref.repo), '--body', body],
        `gh issue comment ${number}`,
      );
    },

    transition: async (ref: IssueRef, state: IssueState): Promise<TransitionResult> => {
      const number = issueNumberOfRef(ref);
      if (!isOneOf(ISSUE_STATES, state)) {
        throw new TypeError(
          `${PREFIX}: refused state ${describeValue(state)}, expected one of: ${ISSUE_STATES.join(', ')}`,
        );
      }

      if (REST_STATES[state] === 'closed') {
        const path = `repos/${ref.repo ?? '{owner}/{repo}'}/issues/${number}`;
        const reason = state === 'cancelled'
          ? 'not_planned'
          : 'completed';
        await run(
          ['api', path, '-X', 'PATCH', '-f', 'state=closed', '-f', `state_reason=${reason}`],
          `gh api PATCH ${path}`,
        );
      } else {
        await run(['issue', 'reopen', number, ...optionalFlag('--repo', ref.repo)], `gh issue reopen ${number}`);
      }

      const readBack = readBackState(state);
      if (readBack === state) return {};
      return {
        warning: `issue #${number} is now ${REST_STATES[state]}, but GitHub Issues without a board`
          + ` holds no ${state} state, so get reads it back as ${readBack}`,
      };
    },
  };
  return Object.freeze(tracker);
}
