/**
 * Staging and committing one task's work, on the loop's behalf.
 *
 * Until now every scoped task committed for itself, because
 * `PROMPT.md` told it to. That put the loop's most mechanical step
 * inside the most expensive context there is, and it made the step
 * unobservable: a session that forgot, or that wrote a subject
 * describing something else, left the loop with no way to tell.
 * Moving it here makes the commit a function with a return value.
 *
 * Three outcomes, and the middle one is the reason this module is
 * not a two-line wrapper around `execSync`:
 *
 *   - `committed` — something was staged and the commit stuck.
 *   - `nothing-to-commit` — the task legitimately changed no tracked
 *     file. A plan task that only WRITES to `.plans/`, `.specs/` or
 *     `progress.txt` has exactly that shape, all three being
 *     gitignored, and so does a measurement task whose whole output
 *     is a `/tmp` capture. That is a success, not a failure, and a
 *     caller that cannot tell it from one either blocks a correct
 *     task or commits an empty tree.
 *   - `failed` — `git` refused. A rejected pre-commit hook is the
 *     expected member here (this repo runs `gate:control-bytes` over
 *     the staged blobs), and it is deliberately NOT its own outcome:
 *     from the loop's side a hook refusal and a broken index need the
 *     same response, and {@link CommitAttempt.message} carries the
 *     reason either way.
 *
 * Nothing-to-commit is decided by `git diff --cached --quiet` AFTER
 * the stage, never by reading what `git commit` printed. git's
 * `nothing to commit, working tree clean` is localised prose, so a
 * parser keyed on it reports every non-English clone as a commit
 * failure; the exit code is 0 for no staged difference and 1 for
 * some, and it answers that way on an unborn HEAD too (measured,
 * git 2.50.1).
 *
 * `--no-verify` is deliberately absent. The hooks are the point of
 * running the commit at all — a loop that skipped them would push a
 * branch whose only remaining gate is CI.
 *
 * Two properties of `git add -A` that the caller inherits and that
 * are worth stating rather than discovering. It stages the WHOLE
 * worktree regardless of the directory git runs in, so a task that
 * left something behind in another package has it swept in here. And
 * it cannot distinguish this task's work from an EARLIER task's
 * uncommitted leftover, so a commit made here can carry both under a
 * subject describing only the later one. Neither is fixable inside
 * this module; the loop's own reading of the tree before dispatch is
 * where that distinction lives.
 */
import { spawnSync } from 'node:child_process';

/**
 * Conventional type of a derived subject.
 *
 * Exactly the six {@link COMMIT_TYPE_RULES} can select, one of which
 * is also {@link DEFAULT_COMMIT_TYPE}. `ci` and `perf` are legal in
 * this repo's history and are absent here on purpose: no rule selects
 * them, and a member the inference can never answer would be a column
 * that always reads empty.
 */
export type CommitType =
  | 'chore'
  | 'docs'
  | 'feat'
  | 'fix'
  | 'refactor'
  | 'test';

/** What a task text is labelled when no rule matches it. */
export const DEFAULT_COMMIT_TYPE: CommitType = 'chore';

/**
 * How far into the task text a test noun still means "this is a test
 * task".
 *
 * Every module task in this tree ends `plus its TSDoc and colocated
 * unit tests`, so an unbounded search for the word makes EVERY task a
 * test task. The window is measured rather than picked. Over twenty
 * task sentences from the plan this module was written for, split by
 * hand into the ten that are genuinely test tasks and the ten that
 * add a module: the test tasks name their test noun at index 6 to 23,
 * and the module tasks first reach one at index 120 to 320 — the
 * trailing boilerplate. Forty sits in that gap with room either side,
 * and the gap is what the number is chosen for rather than the number
 * itself.
 */
const TEST_NOUN_WINDOW = 40;

/** One inference rule. The first whose pattern matches wins. */
export interface CommitTypeRule {
  /** Type this rule selects. */
  type: CommitType;
  /** Matched against the normalised, still-capitalised task text. */
  pattern: RegExp;
}

/** Verbs that open a task repairing something that already exists. */
const FIX_VERBS = ['fix', 'repair', 'correct', 'resolve'];

/** Verbs that open a task moving or deleting existing code. */
const REFACTOR_VERBS = [
  'remove', 'delete', 'drop', 'move', 'rename',
  'relocate', 'extract', 'split', 'inline', 'collapse',
];

/** Verbs that open a task adding behaviour. */
const FEAT_VERBS = [
  'add', 'implement', 'introduce', 'register', 'extend',
  'call', 'wire', 'expose', 'parse', 'strip', 'enforce', 'generate',
];

/** Verbs that open a task whose product is a reading, not a change. */
const CHORE_VERBS = [
  'capture', 'measure', 'run', 'sweep', 'verify', 'ensure',
  'regenerate', 'update', 'gitignore', 'take', 'bump', 'pin',
];

/**
 * A pattern matching a task text that OPENS on one of these verbs.
 *
 * Built from a list rather than written as a literal so each set
 * stays readable at this file's width and so a test can drive the
 * verbs themselves — a regex literal long enough to need wrapping
 * cannot be wrapped without changing what it matches.
 */
function openingVerbs(verbs: readonly string[]): RegExp {
  return new RegExp(`^(?:${verbs.join('|')})\\b`, 'i');
}

/**
 * The inference table, in priority order.
 *
 * It is a LABEL and not a classification: a wrong type costs a
 * slightly-off word at the front of a subject whose body carries the
 * whole task text, so the rules are kept few and readable rather
 * than exhaustive. Two orderings in it are load-bearing.
 *
 * `test` runs first because a test task is the one shape whose verb
 * is indistinguishable from a feature's — both begin `Add` — and only
 * the noun separates them.
 *
 * `docs` runs before every verb rule because a documentation task's
 * verb is whatever the edit happens to be (`Remove the four commit
 * instructions from PROMPT.md`, `Rewrite the root AGENTS.md`,
 * `Split packages/service/AGENTS.md`), while the thing it names is
 * reliably a markdown file. The known cost of that order is a real
 * code task that merely mentions a `.md` path, which is labelled
 * `docs`; the body still says what it did.
 */
export const COMMIT_TYPE_RULES: readonly CommitTypeRule[] = [
  {
    type: 'test',
    pattern: new RegExp(`^.{0,${TEST_NOUN_WINDOW}}?\\btests?\\b`, 'i'),
  },
  { type: 'docs', pattern: /\.md\b/i },
  { type: 'fix', pattern: openingVerbs(FIX_VERBS) },
  { type: 'refactor', pattern: openingVerbs(REFACTOR_VERBS) },
  { type: 'feat', pattern: openingVerbs(FEAT_VERBS) },
  { type: 'chore', pattern: openingVerbs(CHORE_VERBS) },
];

/**
 * Longest subject this module will produce, including the type
 * prefix. Git's own convention, and the ceiling GitHub renders
 * without eliding.
 */
export const MAX_SUBJECT_LENGTH = 72;

/** Description used when the task text carries no words at all. */
export const FALLBACK_DESCRIPTION = 'complete the scoped task';

/**
 * Characters of a failed git invocation kept on the result.
 *
 * A rejected hook can print a finding per staged file, and the loop
 * echoes this to a console a human is scrolling. Truncation is
 * marked, so a caller can tell a short message from a cut one.
 */
export const MAX_MESSAGE_CHARS = 4000;

/** Collapses every whitespace run, newlines included, to one space. */
export function normaliseTaskText(taskText: string): string {
  return taskText.replace(/\s+/g, ' ').trim();
}

/**
 * Picks the conventional type for a task text.
 *
 * Falls back to {@link DEFAULT_COMMIT_TYPE}, which is what an
 * unrecognised verb gets rather than an exception: the loop must
 * still be able to commit a task whose wording nobody anticipated.
 */
export function inferCommitType(taskText: string): CommitType {
  const text = normaliseTaskText(taskText);
  for (const rule of COMMIT_TYPE_RULES) {
    if (rule.pattern.test(text)) return rule.type;
  }
  return DEFAULT_COMMIT_TYPE;
}

/** Backticks in a string, which is how a code span is counted. */
function countBackticks(text: string): number {
  let count = 0;
  for (const character of text) {
    if (character === '`') count += 1;
  }
  return count;
}

/**
 * Drops trailing words until no code span is left hanging open.
 *
 * A cut at a word boundary never splits an identifier, paths having
 * no spaces in them, but it can land between the two backticks of a
 * span and leave the subject reading as if a name were missing. When
 * nothing is left to drop the backticks themselves go, so the
 * function always answers something.
 */
function balanceCodeSpans(text: string): string {
  let result = text;
  while (countBackticks(result) % 2 === 1) {
    const lastSpace = result.lastIndexOf(' ');
    if (lastSpace <= 0) return result.replace(/`/g, '');
    result = result.slice(0, lastSpace).trimEnd();
  }
  return result;
}

/**
 * Removes a sentence-ending period without eating a file extension.
 *
 * The last space-delimited token is what decides: a dot already
 * inside it means the trailing one is part of a dotted name
 * (`v1.2.`, `foo.ts.`) rather than punctuation, and the text is left
 * alone.
 */
function stripTrailingPeriod(text: string): string {
  if (!text.endsWith('.')) return text;

  const withoutDot = text.slice(0, -1);
  const lastToken = withoutDot.slice(withoutDot.lastIndexOf(' ') + 1);
  if (lastToken.includes('.')) return text;

  return withoutDot;
}

/**
 * Lowercases the first character, so the description reads as the
 * imperative the convention wants.
 *
 * An all-caps first word is left alone — `CI`, `MCP` and `TSDoc`
 * are names rather than sentence openers — and so is a text that
 * opens on a backtick or a path.
 */
function lowerFirstWord(text: string): string {
  const match = text.match(/^[A-Za-z]+/);
  const word = match?.[0];
  if (word === undefined) return text;
  if (word.length > 1 && word === word.toUpperCase()) return text;

  return text.slice(0, 1).toLowerCase() + text.slice(1);
}

/**
 * Cuts a description to fit, at a word boundary wherever there is one
 * inside the budget. Trailing punctuation left dangling by the cut
 * goes with it, so the subject does not end on a comma.
 *
 * A first word LONGER than the budget has no boundary to cut at, and
 * that case is a hard cut mid-word rather than an empty description:
 * a truncated name still says more than nothing does.
 */
function truncateDescription(description: string, budget: number): string {
  if (budget <= 0) return '';
  if (description.length <= budget) return description;

  const window = description.slice(0, budget + 1);
  const lastSpace = window.lastIndexOf(' ');
  const cut = lastSpace > 0
    ? window.slice(0, lastSpace)
    : window.slice(0, budget);

  return balanceCodeSpans(cut.trimEnd()).replace(/[\s,;:-]+$/, '');
}

/** How a subject is built. */
export interface SubjectOptions {
  /** Conventional scope, rendered as `type(scope):`. Optional. */
  scope?: string;
  /** Cap including the prefix. Defaults to {@link MAX_SUBJECT_LENGTH}. */
  maxLength?: number;
}

/** A derived subject and what deriving it decided. */
export interface DerivedSubject {
  /** The whole subject line, prefix included. */
  subject: string;
  /** Type the rules selected. */
  type: CommitType;
  /** True when the description was cut to fit the cap. */
  truncated: boolean;
}

/**
 * Derives a conventional-commit subject from a task's text.
 *
 * Deterministic over its input: the same task text answers the same
 * subject on every machine and every run, which is what lets the
 * loop's commits be predicted by a test instead of inspected by a
 * human.
 */
export function deriveCommitSubject(
  taskText: string,
  options: SubjectOptions = {},
): DerivedSubject {
  const type = inferCommitType(taskText);
  const scope = options.scope;
  const prefix = scope === undefined || scope.length === 0
    ? `${type}: `
    : `${type}(${scope}): `;

  const normalised = normaliseTaskText(taskText);
  const full = normalised.length === 0
    ? FALLBACK_DESCRIPTION
    : lowerFirstWord(stripTrailingPeriod(normalised));

  const maxLength = options.maxLength ?? MAX_SUBJECT_LENGTH;
  const description = truncateDescription(full, maxLength - prefix.length);
  const truncated = description !== full;

  return {
    subject: `${prefix}${description}`,
    type,
    truncated,
  };
}

/** A subject with the body that keeps the truncation lossless. */
export interface CommitMessage extends DerivedSubject {
  /**
   * The whole normalised task text, or the empty string when the
   * subject already carries it. A message is never two spellings of
   * the same sentence.
   */
  body: string;
}

/**
 * Builds the message a task's commit is made with.
 *
 * The body exists so that truncating the subject loses nothing: a
 * plan's task sentences run past two hundred characters here, and
 * the sentence is the only record of what the commit was asked to
 * do. It is omitted entirely when the subject was not cut, rather
 * than repeated.
 */
export function buildCommitMessage(
  taskText: string,
  options: SubjectOptions = {},
): CommitMessage {
  const derived = deriveCommitSubject(taskText, options);
  const normalised = normaliseTaskText(taskText);
  const body = derived.truncated
    ? normalised
    : '';

  return { ...derived, body };
}

/** Argv that stages the whole worktree. */
export function stageAllArgs(): string[] {
  return ['add', '-A'];
}

/**
 * Argv that answers whether anything is staged: exit 0 for nothing,
 * exit 1 for something. Exported so a caller reading the exit code
 * can see which command produced it.
 */
export function stagedChangesArgs(): string[] {
  return ['diff', '--cached', '--quiet'];
}

/**
 * Argv that makes the commit.
 *
 * `--cleanup=whitespace` is spelled out because strip DELETES every
 * line beginning with `#`, and a task text is free to open on a shell
 * comment or a markdown heading. It is NOT defending against git's
 * default: for a `-m` message the default already behaves as
 * whitespace, strip being the default only when the message is to be
 * edited. What it defends against is a `commit.cleanup=strip`
 * CONFIGURATION, which a machine's global git config is free to set
 * (measured, git 2.50.1). Since {@link buildCommitMessage} collapses
 * the task text to one line, the whole reachable difference is a task
 * text that OPENS on a hash.
 *
 * Two `-m` arguments rather than one joined string: git inserts the
 * blank line between subject and body itself, so the separator
 * cannot drift.
 */
export function commitArgs(subject: string, body = ''): string[] {
  const args = ['commit', '--cleanup=whitespace', '-m', subject];
  if (body.length > 0) args.push('-m', body);
  return args;
}

/** Argv that reads the sha the commit just produced. */
export function headShaArgs(): string[] {
  return ['rev-parse', 'HEAD'];
}

/** One git invocation's result, as the runner reports it. */
export interface GitRunResult {
  /** Exit code, or null when the process was killed or never ran. */
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs git with the given argv. The seam every test drives. */
export type GitRunner = (args: string[]) => GitRunResult;

/** Which invocation a failure came from. */
export type CommitStep = 'stage' | 'inspect' | 'commit';

/** What one attempt did. */
export type CommitOutcome = 'committed' | 'nothing-to-commit' | 'failed';

/** The whole result of one attempt. */
export interface CommitAttempt {
  outcome: CommitOutcome;
  /** Subject the commit was made with, derived either way. */
  subject: string;
  /** Sha of the new commit, or null when none was made. */
  sha: string | null;
  /** Invocation that failed, or null when none did. */
  failedStep: CommitStep | null;
  /** That invocation's exit code, or null. */
  exitCode: number | null;
  /** Its stderr and stdout, capped. Empty when nothing failed. */
  message: string;
}

/** How an attempt is made. */
export interface CommitOptions {
  /** The task's text, which the subject is derived from. */
  taskText: string;
  /** Directory git runs in. Defaults to the current one. */
  cwd?: string;
  /** Conventional scope for the subject. Optional. */
  scope?: string;
  /** Cap for the subject. Defaults to {@link MAX_SUBJECT_LENGTH}. */
  maxLength?: number;
  /** Runner override. Defaults to a real `git` spawn in `cwd`. */
  runGit?: GitRunner;
}

/** Bytes a single git invocation may print before it is cut off. */
const MAX_GIT_BUFFER = 16 * 1024 * 1024;

/**
 * Joins what a failed invocation printed, stderr first.
 *
 * Both streams, because which one carries the reason depends on the
 * invocation rather than on the hook. A HOOK cannot choose: git
 * funnels a hook's stdout onto its own stderr, so a pre-commit
 * refusal arrives entirely on `stderr` however the hook printed it
 * (measured, git 2.50.1). Reading both is for git's other failure
 * paths, and the ordering matters only there.
 */
function failureMessage(result: GitRunResult): string {
  const combined = [result.stderr, result.stdout]
    .map((stream) => stream.trim())
    .filter((stream) => stream.length > 0)
    .join('\n');

  if (combined.length <= MAX_MESSAGE_CHARS) return combined;

  return `${combined.slice(0, MAX_MESSAGE_CHARS)}\n[truncated]`;
}

/** The failed shape, with the step and the reason attached. */
function failed(
  step: CommitStep,
  subject: string,
  result: GitRunResult,
): CommitAttempt {
  return {
    outcome: 'failed',
    subject,
    sha: null,
    failedStep: step,
    exitCode: result.status,
    message: failureMessage(result),
  };
}

/**
 * The default runner: a real `git` in `cwd`.
 *
 * `spawnSync` and not `execFileSync`, because two of the three
 * invocations use their exit code as an ANSWER rather than as an
 * error — `git diff --cached --quiet` exits 1 to say a commit is
 * warranted, and a thrown exception there would turn the ordinary
 * case into the failure path.
 */
export function spawnGit(cwd: string): GitRunner {
  return (args) => {
    const result = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: MAX_GIT_BUFFER,
    });
    if (result.error !== undefined) {
      return { status: null, stdout: '', stderr: result.error.message };
    }

    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  };
}

/**
 * Stages the worktree and commits it under a subject derived from
 * the task's text.
 *
 * The three invocations run in a fixed order and each one's failure
 * stops the attempt, so a caller never sees a `committed` result
 * whose commit did not happen. The fourth read — the sha — is the
 * exception: it runs AFTER the commit succeeded, so a failure there
 * leaves the outcome `committed` with a null sha rather than
 * retracting a commit that is already in the history.
 */
export function commitTaskWork(options: CommitOptions): CommitAttempt {
  const run = options.runGit ?? spawnGit(options.cwd ?? process.cwd());
  const message = buildCommitMessage(options.taskText, {
    scope: options.scope,
    maxLength: options.maxLength,
  });
  const { subject } = message;

  const staged = run(stageAllArgs());
  if (staged.status !== 0) return failed('stage', subject, staged);

  const pending = run(stagedChangesArgs());
  if (pending.status === 0) {
    return {
      outcome: 'nothing-to-commit',
      subject,
      sha: null,
      failedStep: null,
      exitCode: 0,
      message: '',
    };
  }
  if (pending.status !== 1) return failed('inspect', subject, pending);

  const committed = run(commitArgs(subject, message.body));
  if (committed.status !== 0) return failed('commit', subject, committed);

  const head = run(headShaArgs());
  const sha = head.status === 0
    ? head.stdout.trim()
    : null;

  return {
    outcome: 'committed',
    subject,
    sha,
    failedStep: null,
    exitCode: 0,
    message: '',
  };
}
