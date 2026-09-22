/**
 * The classifier: five readings of a pull request in, one
 * {@link TriageClass} out.
 *
 * `rafa pr triage` assesses in CODE, and this module is where the
 * assessment happens. Everything it needs has already been captured by
 * the time it is called — the pull request as `gh pr view --json …`
 * answered it, the check rows through `parseChecks` (`../checks.ts`),
 * the failing step out of `gh run view <id> --log-failed`
 * (`./evidence.ts`), the conflicting paths out of
 * `git merge-tree --write-tree` (`./conflict.ts`), and the repository's
 * workflow count through `PullRequests.workflowCount` (`../types.ts`) —
 * so nothing here spawns a process, reads a file or awaits. It is a
 * pure function over those five, which is what lets one case per class
 * drive it from literals and what keeps the class set measurable from
 * both ends.
 *
 * It also never throws. A triage that crashed on an odd reading would
 * leave the pull request unassessed and uncommented, where the two
 * catch-alls the vocabulary already carries — `ci-other` and
 * `conflict-other` — say "red, and nothing recognised it" and still get
 * reported. So every branch here ends at a class.
 *
 * ## The precedence, and why a conflict outranks a red check
 *
 * {@link classifyTriage} asks five questions in this order: does the
 * pull request conflict, is anything pending, is anything failing, does
 * it report no checks at all, and otherwise it is green.
 *
 * The conflict goes first because a conflicting pull request's checks
 * are not evidence about its code. GitHub builds a workflow run against
 * `refs/pull/<n>/merge`, which it cannot produce for a head that does
 * not merge, so a conflicting pull request either reports no checks at
 * all (`../checks.ts` records that shape) or reports rows from a merge
 * base that no longer exists. Classing such a pull request `ci-test` on
 * those rows would send a resolve plan after a test failure that is an
 * artefact of the stale merge, and would leave the conflict — the thing
 * actually blocking it — unnamed.
 *
 * Pending outranks failing for the reason `verdictOf` already reduces
 * that way: a partial reading of a run still in flight is not a red
 * pull request yet.
 *
 * ## No checks is not green
 *
 * Verdict `none` — zero check rows — is `no-checks`, never `green`:
 * nothing failed, but nothing passed either, and `rafa pr merge`
 * refuses it without `--skip-checks`. So its reason carries the two
 * things a reader needs to decide: the workflow count as
 * `workflowCountLine` (`../unchecked.ts`) spells it — zero is the
 * no-workflow case, one or more or an unreadable count (`null`) the
 * riskier one where CI may simply not have started — and the
 * `rafa pr merge <n> --skip-checks` line that merges it anyway. A
 * conflicting pull request with no checks stays a conflict: the
 * conflict branch comes first, and GitHub reports no checks for a head
 * it cannot merge.
 *
 * ## Who decides that it conflicts
 *
 * GitHub decides THAT, the file list decides WHICH class.
 *
 * `mergeable` is computed against the real base tip, and the local
 * `git merge-tree` reading is only as fresh as the last fetch, so a
 * `mergeable` or `conflicting` answer from GitHub is taken as it
 * stands. `unknown` — which is what GitHub answers while it computes,
 * and the commonest reading on a pull request opened seconds ago — is
 * the one case where the other two readings break the tie:
 * {@link DIRTY_MERGE_STATE}, GitHub's own word for a conflict on
 * `mergeStateStatus`, and failing that a non-empty conflicting file
 * list, which `merge-tree` only ever produces from a real conflict
 * (the `ConflictReading` discrimination in `./conflict.ts`).
 *
 * The file list can be EMPTY on a pull request that does conflict: the
 * head may not be fetched, and that reading comes back as
 * `conflict-other` rather than as a wrong green, with
 * {@link TriageAssessment.reason} saying no file was read.
 *
 * ## What a path list can and cannot answer
 *
 * `conflict-lockfile` needs EVERY conflicting path to be a lockfile,
 * not merely one of them, because its resolve plan takes the base's
 * lockfile and reinstalls; a conflict on `src/config.ts` beside
 * `bun.lock` is not fixed by that and must not be offered to it.
 * `conflict-manifest` is the same rule one file wider — every path a
 * manifest or a lockfile, at least one a manifest — and it outranks
 * `conflict-lockfile` on a pull request where both conflict, because
 * its plan merges the manifest entries and then reinstalls, which
 * regenerates the lockfile anyway, while the lockfile plan would take
 * the base's manifest and lose the pull request's own additions.
 *
 * {@link MANIFEST_FILES} holds `package.json` alone on purpose. The
 * spec's `conflict-manifest` is "`package.json` where both sides added
 * or bumped entries", and its pinned plan is written for that file's
 * dependency objects; a `Cargo.toml` or a `pyproject.toml` classed
 * `conflict-manifest` would be handed to a plan that cannot read it.
 * They are `conflict-other`, which is assessed and never auto-resolved.
 *
 * The second half of that sentence — "where both sides added or bumped
 * entries" — is NOT something a path list can answer, and this module
 * does not pretend to: a `package.json` conflict where one side deleted
 * the file reads as `conflict-manifest` here. Confirming the shape of
 * the conflict is the resolve plan's own first step, in the worktree,
 * where both sides' text is actually available.
 *
 * ## How the step decides a `ci-*` class
 *
 * The spec says the failing STEP name decides, and the step arrives in
 * one of two shapes (`./evidence.ts`): a provider-supplied step label
 * such as `Install dependencies`, or — on every capture measured so far
 * — the step's COMMAND inferred from the runner's group marker, such as
 * `bun install --frozen-lockfile`. {@link classifyFailedStep} matches
 * both by reducing the name to its alphanumeric tokens and looking for
 * whole-token phrases ({@link CI_STEP_RULES}).
 *
 * Tokens rather than substrings, because the substring readings are
 * wrong in both directions on names CI really uses: `attest` and
 * `latest` contain `test`, and `vitest` does not contain the token
 * `test` at all, which is why it is listed in its own right.
 *
 * The rules are ORDERED, and the order is the order a pipeline runs
 * its gates: install, lint, types, test. A step that names two of them
 * — `bun run test:types`, `lint:fix` — is classed as the earlier,
 * because the earlier gate is the one a resolve plan has to fix first.
 * A step nothing matches, and a failure that named no step at all, are
 * `ci-other`.
 */
import type { TriageClass } from './classes.js';
import type { FailedStep } from './evidence.js';
import type { CheckRow, ChecksVerdict } from '../checks.js';
import type { PullRequestDetail } from '../types.js';

import { failingRows, verdictOf } from '../checks.js';
import { workflowCountLine } from '../unchecked.js';

import { isDependencyBump, isSimpleTriageClass } from './classes.js';

/**
 * GitHub's own `mergeStateStatus` word for a head that does not merge.
 * Read only when {@link PullRequestDetail.mergeable} is `unknown`; see
 * the module note.
 */
export const DIRTY_MERGE_STATE = 'DIRTY';

/**
 * The lockfiles, matched on the BASENAME so that a workspace's
 * `packages/cli/bun.lock` counts as one.
 *
 * Several ecosystems' files rather than bun's alone: the classifier is
 * used against whatever repository the pull request is in, and a
 * lockfile conflict is the same mechanical thing in each. Frozen, since
 * a caller that pushed onto it would change what every later reading
 * calls simple.
 */
export const LOCKFILE_FILES: readonly string[] = Object.freeze([
  'bun.lock',
  'bun.lockb',
  'Cargo.lock',
  'composer.lock',
  'Gemfile.lock',
  'go.sum',
  'package-lock.json',
  'Pipfile.lock',
  'pnpm-lock.yaml',
  'poetry.lock',
  'npm-shrinkwrap.json',
  'uv.lock',
  'yarn.lock',
] as const);

/**
 * The manifests. One file, deliberately; see the module note for why a
 * `Cargo.toml` is `conflict-other` and not this.
 */
export const MANIFEST_FILES: readonly string[] = Object.freeze([
  'package.json',
] as const);

/** One `ci-*` class and the whole-token phrases that name it. */
export interface CiStepRule {
  /** The class a matching step is classed as. */
  readonly triageClass: TriageClass;
  /**
   * The phrases, each already in the form {@link stepTokens} produces:
   * lower case, alphanumeric tokens, single spaces. A phrase is matched
   * on token boundaries, so `test` never matches `attest`.
   */
  readonly phrases: readonly string[];
}

/**
 * The step rules in pipeline order — install, lint, types, test — which
 * is the order a step naming two of them is resolved by; see the module
 * note. Frozen for the same reason the file lists are.
 */
export const CI_STEP_RULES: readonly CiStepRule[] = Object.freeze([
  {
    triageClass: 'ci-install',
    phrases: Object.freeze(['install', 'npm ci', 'bun i']),
  },
  {
    triageClass: 'ci-lint',
    phrases: Object.freeze([
      'lint',
      'eslint',
      'oxlint',
      'biome',
      'stylelint',
      'prettier',
      'clippy',
      'ruff',
      'fmt',
      'format',
    ]),
  },
  {
    triageClass: 'ci-types',
    phrases: Object.freeze([
      'tsc',
      'typecheck',
      'type check',
      'check types',
      'types',
      'typing',
      'mypy',
      'pyright',
    ]),
  },
  {
    triageClass: 'ci-test',
    phrases: Object.freeze([
      'test',
      'tests',
      'jest',
      'vitest',
      'pytest',
      'spec',
      'specs',
      'coverage',
    ]),
  },
]);

/**
 * The part of a pull request the classifier reads.
 *
 * A `Pick` of {@link PullRequestDetail} rather than its own interface,
 * so a detail straight off the port is passed in whole and a rename on
 * the port reaches this module through the compiler.
 */
export type ClassifiedPullRequest = Pick<
  PullRequestDetail,
  'author' | 'mergeable' | 'mergeStateStatus' | 'number' | 'title'
>;

/** The five captured readings {@link classifyTriage} decides on. */
export interface ClassifyTriageInput {
  /** The pull request as `gh pr view --json …` answered it. */
  readonly pr: ClassifiedPullRequest;
  /** Its check rows, as `parseChecks` read them. */
  readonly rows: readonly CheckRow[];
  /**
   * The failing step of the failing job, or `undefined` when no log
   * named one — a cancelled run, a job killed by a timeout, a log
   * GitHub has dropped.
   */
  readonly step: FailedStep | undefined;
  /**
   * The conflicting paths, as `readConflict` answered them. Empty for a
   * pull request that merges cleanly AND for one whose conflict could
   * not be read; see the module note.
   */
  readonly conflictFiles: readonly string[];
  /**
   * The repository's workflow count as `PullRequests.workflowCount`
   * answered it, or `null` when it could not be read. Read only on
   * verdict `none`, where it goes into the `no-checks` reason; see the
   * module note.
   */
  readonly workflowCount: number | null;
}

/** What one classification concluded. */
export interface TriageAssessment {
  /** The class. Exactly one, out of `TRIAGE_CLASSES`. */
  readonly triageClass: TriageClass;
  /**
   * Whether `rafa pr triage --resolve` may act on it, which is the
   * class and the bump reading together (`./classes.ts`).
   */
  readonly simple: boolean;
  /** Whether the pull request read as a dependency bump. */
  readonly dependencyBump: boolean;
  /** The one verdict over the rows, kept so a report can show `none`. */
  readonly verdict: ChecksVerdict;
  /** Whether the pull request was read as conflicting; see the module note. */
  readonly conflicting: boolean;
  /**
   * The conflicting paths behind a `conflict-*` class, in git's order.
   * Empty for every other class, so a caller never reports files beside
   * a conclusion they did not decide.
   */
  readonly files: readonly string[];
  /**
   * The step behind a `ci-*` class. `undefined` for every other class,
   * and for a `ci-other` reached because nothing named a step.
   */
  readonly step: FailedStep | undefined;
  /** The failing rows, for the evidence a report and a comment show. */
  readonly failing: readonly CheckRow[];
  /**
   * One lower-case sentence naming what decided the class, for the
   * comment's headline and the console. Never empty.
   */
  readonly reason: string;
}

/** How many conflicting paths a reason names before it counts the rest. */
const REASON_FILE_LIMIT = 3;

/** Everything that is not an alphanumeric run, which is a token break. */
const TOKEN_BREAK = /[^a-z0-9]+/;

/** The basename of a path, which is what the file lists are matched on. */
function baseName(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1
    ? path
    : path.slice(cut + 1);
}

/** Whether `path` names one of {@link LOCKFILE_FILES}. */
export function isLockfilePath(path: string): boolean {
  return LOCKFILE_FILES.includes(baseName(path));
}

/** Whether `path` names one of {@link MANIFEST_FILES}. */
export function isManifestPath(path: string): boolean {
  return MANIFEST_FILES.includes(baseName(path));
}

/**
 * Which `conflict-*` class a list of conflicting paths is.
 *
 * An EMPTY list is `conflict-other`: this function is only ever asked
 * about a pull request already read as conflicting, and a conflict
 * whose paths could not be read is precisely the unrecognised case.
 */
export function classifyConflictFiles(files: readonly string[]): TriageClass {
  if (files.length === 0) return 'conflict-other';
  const manifests = files.filter((file) => isManifestPath(file));
  const lockfiles = files.filter((file) => isLockfilePath(file));
  if (manifests.length + lockfiles.length < files.length) return 'conflict-other';
  return manifests.length === 0
    ? 'conflict-lockfile'
    : 'conflict-manifest';
}

/**
 * A step name reduced to its lower-case alphanumeric tokens:
 * `bunx tsc --noEmit` reads as `bunx tsc noemit`.
 */
export function stepTokens(step: string): readonly string[] {
  return step.toLowerCase()
    .split(TOKEN_BREAK)
    .filter((token) => token !== '');
}

/**
 * Which `ci-*` class a failing step name is, by the ordered rules in
 * {@link CI_STEP_RULES}.
 *
 * `undefined`, and a name with no tokens at all, are `ci-other`: a
 * failure nobody named a step for is still reported, it is simply never
 * resolved automatically.
 */
export function classifyFailedStep(step: string | undefined): TriageClass {
  if (step === undefined) return 'ci-other';
  const tokens = stepTokens(step);
  if (tokens.length === 0) return 'ci-other';
  const haystack = ` ${tokens.join(' ')} `;
  const rule = CI_STEP_RULES.find(
    (one) => one.phrases.some((phrase) => haystack.includes(` ${phrase} `)),
  );
  return rule === undefined
    ? 'ci-other'
    : rule.triageClass;
}

/**
 * Whether the pull request conflicts: GitHub's reading, with the
 * `mergeStateStatus` word and then the local file list breaking an
 * `unknown`. See the module note.
 */
export function readsAsConflicting(
  pr: ClassifiedPullRequest,
  conflictFiles: readonly string[],
): boolean {
  if (pr.mergeable === 'conflicting') return true;
  if (pr.mergeable === 'mergeable') return false;
  if (pr.mergeStateStatus.trim().toUpperCase() === DIRTY_MERGE_STATE) return true;
  return conflictFiles.length > 0;
}

/** `one check` or `<n> checks`, so a reason reads as a sentence. */
function checkCount(count: number): string {
  return count === 1
    ? '1 check'
    : `${count} checks`;
}

/** The first few conflicting paths, with the rest counted. */
function fileList(files: readonly string[]): string {
  const shown = files.slice(0, REASON_FILE_LIMIT).join(', ');
  const rest = files.length - Math.min(files.length, REASON_FILE_LIMIT);
  return rest === 0
    ? shown
    : `${shown} and ${rest} more`;
}

/** The sentence behind a `conflict-*` class. */
function conflictReason(files: readonly string[]): string {
  return files.length === 0
    ? 'the head conflicts with the base and no conflicting file was read'
    : `the head conflicts with the base on ${fileList(files)}`;
}

/** The sentence behind a `ci-*` class. */
function failureReason(step: FailedStep | undefined, failing: readonly CheckRow[]): string {
  const count = checkCount(failing.length);
  return step === undefined
    ? `${count} failing, and no failing step was named`
    : `${count} failing, the failing step being "${step.name}"`;
}

/**
 * The sentence behind `no-checks`: that nothing reported, the workflow
 * count as `workflowCountLine` spells it, and the `--skip-checks` line.
 */
export function noChecksReason(number: number, workflowCount: number | null): string {
  const count = workflowCountLine(workflowCount).replace(/\.$/, '');
  return `the head reports no checks at all; ${count.charAt(0).toLowerCase()}${count.slice(1)};`
    + ` to merge it anyway, run rafa pr merge ${number} --skip-checks`;
}

/** What the precedence decides, before the flags are computed over it. */
type DecidedClass = Pick<TriageAssessment, 'files' | 'reason' | 'step' | 'triageClass'>;

/**
 * The precedence itself — conflict, then pending, then failing, then
 * no checks, then green — kept apart from the flags so that the order
 * is one readable list of five branches and nothing else.
 */
function decideClass(
  input: ClassifyTriageInput,
  verdict: ChecksVerdict,
  conflicting: boolean,
): DecidedClass {
  const { conflictFiles, rows, step } = input;
  if (conflicting) {
    return {
      triageClass: classifyConflictFiles(conflictFiles),
      files: conflictFiles,
      step: undefined,
      reason: conflictReason(conflictFiles),
    };
  }
  if (verdict === 'pending') {
    const pending = rows.filter((row) => row.outcome === 'pending');
    return {
      triageClass: 'pending',
      files: [],
      step: undefined,
      reason: `${checkCount(pending.length)} of ${rows.length} still running`,
    };
  }
  if (verdict === 'red') {
    return {
      triageClass: classifyFailedStep(step?.name),
      files: [],
      step,
      reason: failureReason(step, failingRows(rows)),
    };
  }
  if (verdict === 'none') {
    return {
      triageClass: 'no-checks',
      files: [],
      step: undefined,
      reason: noChecksReason(input.pr.number, input.workflowCount),
    };
  }
  return {
    triageClass: 'green',
    files: [],
    step: undefined,
    reason: `the head merges cleanly and all ${checkCount(rows.length)} passed`,
  };
}

/**
 * Classifies one pull request from its five captured readings.
 *
 * Total and pure: every input reaches exactly one class, nothing is
 * spawned, nothing is awaited and nothing is thrown. The precedence —
 * conflict, then pending, then failing, then no checks, then green — and the reason
 * each class is reached by are in the module note.
 */
export function classifyTriage(input: ClassifyTriageInput): TriageAssessment {
  const dependencyBump = isDependencyBump(input.pr);
  const verdict = verdictOf(input.rows);
  const conflicting = readsAsConflicting(input.pr, input.conflictFiles);
  const decided = decideClass(input, verdict, conflicting);

  return {
    ...decided,
    simple: isSimpleTriageClass(decided.triageClass, { dependencyBump }),
    dependencyBump,
    verdict,
    conflicting,
    failing: failingRows(input.rows),
  };
}
