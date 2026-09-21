/**
 * What `rafa loop start` does about the branch when it is started on the
 * base: which question it asks, which refusal follows an answer, and
 * which git steps a yes turns into — all of it as data, none of it
 * spawning anything.
 *
 * The split is the `pr` subject's (`src/pr/merge.ts` beside
 * `src/commands/pr/merge.ts`): everything here is the part that can be
 * decided without a repository, leaving the other half — the one that
 * takes these readings off a `GitRunner` and a `Prompter` and runs the
 * steps — as the only place anything is spawned. Three things follow
 * from drawing the line here:
 *
 *  - Every refusal is measurable from a literal. A diverged base, a
 *    fetch that could not reach the remote and a tracked file modified
 *    are three states that would otherwise each need a repository
 *    planted into them, and the case that matters most — a branch that
 *    should NOT be created — is the one hardest to plant.
 *  - The steps the run walks are one array, so what is reported, what is
 *    run and what a test asserts cannot drift apart.
 *  - The question texts are fixed by
 *    `.rafa/specs/rafa-49-rafa-uses-own-default.md` and are checked here
 *    against a literal, rather than being read out of a terminal
 *    transcript.
 *
 * ## When there is no offer at all
 *
 * {@link readBranchOffer} answers `stand-aside` three ways, and each of
 * them leaves the branch guard in `src/start.ts` to have the last word:
 *
 *  - `--any-branch`: an operator who asked to run on `main` is not then
 *    asked whether to leave it. It outranks `--create-branch` too, since
 *    it is the escape hatch and the other is an answer to a question
 *    that is no longer asked.
 *  - No plan stub: the branch name would be `feat/` and nothing else.
 *  - No terminal and no `--create-branch`: nobody can answer, so the
 *    guard refuses as it did before, naming the flag. The refusal is the
 *    guard's alone; a second spelling of it here could drift from it.
 *
 * ## The route, and which readings decide it
 *
 * `feat/<stub>` that already exists is never fetched over. The local
 * reading outranks the remote-tracking one, because a local branch is
 * what `git switch <branch>` would move to whatever the remote holds,
 * and both outrank creating: `create` is only for a name git has never
 * seen. The remote-tracking reading is `refs/remotes/<remote>/<branch>`
 * — a ref already in the clone — and NOT `git ls-remote`, which keeps
 * the whole decision off the network.
 *
 * ## The order on a yes, and what it refuses on
 *
 * The working tree first ({@link treeRefusal}), then the steps of the
 * route. Only changes to TRACKED files refuse: a checkout carries
 * untracked files across, where a modified tracked file is work that
 * would either block the switch or ride into the loop's first commit.
 * The tree is read after the answer, as the spec words it — the
 * question costs nothing, and an operator who declines is never told
 * about a file they were not going to move.
 *
 * ## What git said, as measured
 *
 * Measured on git 2.50.1 (Apple Git-155) under macOS with `LC_ALL=C`
 * set, in a clone of a bare remote (2026-09-20). Each reading is what a
 * function here parses or refuses on:
 *
 *  - `git status --porcelain` wrote ` M a.txt` for a modified tracked
 *    file, `A  "sp ace.txt"` for a staged path with a space, quoting
 *    included, and `?? untracked.txt` for an untracked one. So the
 *    untracked test is the two-character prefix and nothing else is
 *    interpreted.
 *  - `git rev-list --left-right --count main...origin/main` wrote
 *    `0\t0` up to date, `1\t0` one local commit ahead, `0\t1` one
 *    behind, and `1\t1` diverged. Left is the local side, right the
 *    remote one.
 *  - `git merge --ff-only origin/main` exited 0 saying `Already up to
 *    date.` both when the two agreed and when the local side was ahead
 *    ALONE, exited 0 saying `Fast-forward` when it was behind, and
 *    exited 128 with `fatal: Not possible to fast-forward, aborting.`
 *    when they had diverged. The step therefore runs on every standing
 *    the reading lets through, and git's own refusal stands behind the
 *    measured one.
 *  - `git fetch origin nosuchbranch` and a fetch of a remote that is not
 *    a repository both exited 128 with a `fatal:` line.
 *  - `git switch --track origin/feat/x` exited 0 with `Switched to a new
 *    branch 'feat/x'` and `branch 'feat/x' set up to track
 *    'origin/feat/x'.`, and `git switch -c feat/x` on a name already
 *    taken exited 128 with `fatal: a branch named 'feat/x' already
 *    exists` — which is the route split above, held up by git.
 *
 * ## Being ahead is not being diverged
 *
 * A base carrying local commits the remote has not got is left alone and
 * branched from: those commits are the operator's, and the new branch
 * carries them. Only a base that is ahead AND behind refuses, since
 * fast-forwarding it is then impossible and branching from it would
 * start the plan off the latest base — the one thing the offer exists to
 * prevent.
 */
import type { GitResult, WorkingTreeStatus } from '../pr/index.js';

import { gitSaid } from '../pr/index.js';

/** The remote a plan's branch is created from and tracked on. */
export const REMOTE = 'origin';

/** What every plan branch is called: this, and the plan's stub. */
export const BRANCH_PREFIX = 'feat/';

/** The indent a refusal's listed lines carry, as `src/pr/merge.ts` indents its own. */
const INDENT = '   ';

/** The two-character prefix `git status --porcelain` gives an untracked path; see the module note. */
const UNTRACKED_PREFIX = '??';

/** How many porcelain lines a modified-tree refusal lists before eliding. */
const MAX_LISTED_CHANGES = 10;

/** A count of commits, as `git rev-list --count` writes one. */
const COUNT = /^\d+$/;

/** The branch a plan with this stub runs on. */
export function branchNameFor(planStub: string): string {
  return `${BRANCH_PREFIX}${planStub}`;
}

/** The ref `branch` is read at locally. */
export function localRef(branch: string): string {
  return `refs/heads/${branch}`;
}

/** The ref `branch` is read at on {@link REMOTE}, without asking the remote. */
export function remoteTrackingRef(branch: string): string {
  return `refs/remotes/${REMOTE}/${branch}`;
}

/** How a run reaches `feat/<stub>`: making it, or taking one that is already there. */
export type BranchRoute = 'create' | 'switch-local' | 'switch-remote';

/** The two branches every question, step and refusal here is built from. */
export interface BranchPlan {
  /** The plan's branch, `feat/<stub>`. */
  readonly branch: string;
  /** The base the run is on, which the branch is cut from. */
  readonly base: string;
}

/** Why no branch is offered at all; see the module note. */
export type StandAsideReason = 'any-branch' | 'no-plan-stub' | 'no-terminal';

/** What the run knows before it asks anything. */
export interface BranchSituation {
  /** The plan's stub, or null when the plan path gave none. */
  readonly planStub: string | null;
  /** The base branch the run is on, which the caller found checked out. */
  readonly base: string;
  /** True when `--any-branch` was passed, which outranks everything here. */
  readonly anyBranch: boolean;
  /** True when `--create-branch` was passed, which answers the question yes. */
  readonly createBranch: boolean;
  /** True when a terminal can answer the question. */
  readonly canAsk: boolean;
  /** True when `feat/<stub>` is a local branch ({@link localRef}). */
  readonly localBranch: boolean;
  /** True when `feat/<stub>` is a remote-tracking ref ({@link remoteTrackingRef}). */
  readonly remoteBranch: boolean;
}

/** What follows from the situation, before any git command has run. */
export type BranchOffer =
  | {
    readonly kind: 'stand-aside';
    /** Why nothing is offered; see the module note. */
    readonly why: StandAsideReason;
  }
  | {
    readonly kind: 'ask';
    /** The branch the run would end on. */
    readonly branch: string;
    readonly route: BranchRoute;
    /** The question, spelled `[y/N]` and ending in a space to type after. */
    readonly question: string;
  }
  | {
    readonly kind: 'take';
    /** The branch the run ends on, `--create-branch` having answered yes. */
    readonly branch: string;
    readonly route: BranchRoute;
  };

/** A reading of no offer. */
function standAside(why: StandAsideReason): BranchOffer {
  return Object.freeze({ kind: 'stand-aside', why });
}

/** Which route a branch is reached by; the local reading outranks the remote one. */
function routeFor(situation: BranchSituation): BranchRoute {
  if (situation.localBranch) return 'switch-local';
  if (situation.remoteBranch) return 'switch-remote';
  return 'create';
}

/**
 * The question a route is offered under, verbatim from the spec. Both
 * end in a space, so what is typed follows the `[y/N]` on the same line.
 */
export function questionFor(route: BranchRoute, plan: BranchPlan): string {
  return route === 'create'
    ? `Create ${plan.branch} from the latest ${REMOTE}/${plan.base} and run there? [y/N] `
    : `Switch to the existing ${plan.branch}? [y/N] `;
}

/**
 * What to do about the branch: ask a question, take the branch without
 * asking because `--create-branch` said so, or stand aside and leave the
 * guard in `src/start.ts` to have the last word. See the module note for
 * the order these are read in.
 */
export function readBranchOffer(situation: BranchSituation): BranchOffer {
  if (situation.anyBranch) return standAside('any-branch');

  const stub = situation.planStub?.trim() ?? '';
  if (stub === '') return standAside('no-plan-stub');

  const branch = branchNameFor(stub);
  const route = routeFor(situation);
  if (situation.createBranch) return Object.freeze({ kind: 'take', branch, route });
  if (!situation.canAsk) return standAside('no-terminal');

  return Object.freeze({
    kind: 'ask',
    branch,
    route,
    question: questionFor(route, { branch, base: situation.base }),
  });
}

/** The answers that mean yes to a question spelled `[y/N]`, as `rafa pr merge` reads them. */
export const YES_ANSWERS: readonly string[] = Object.freeze(['y', 'yes']);

/**
 * Whether an answer means yes. Anything else declines, the empty answer
 * and the null a prompter gives once its input has ended included: the
 * question is spelled `[y/N]` and the default is no.
 */
export function answeredYes(answer: string | null): boolean {
  return answer !== null && YES_ANSWERS.includes(answer.trim().toLowerCase());
}

/** `one` or `n things`, so a count reads as English. */
function plural(count: number, singular: string, many: string): string {
  return count === 1
    ? `1 ${singular}`
    : `${count} ${many}`;
}

/** The porcelain lines a refusal shows, capped and indented. */
function listChanges(entries: readonly string[]): readonly string[] {
  const shown = entries.slice(0, MAX_LISTED_CHANGES).map((entry) => `${INDENT}${entry}`);
  const hidden = entries.length - shown.length;
  return hidden > 0
    ? [...shown, `${INDENT}... and ${hidden} more`]
    : shown;
}

/**
 * The porcelain lines naming a tracked path, as git wrote them. An
 * untracked line is dropped and nothing else is interpreted; see the
 * module note.
 */
export function trackedChanges(tree: WorkingTreeStatus): readonly string[] {
  return Object.freeze(tree.entries.filter((entry) => !entry.startsWith(UNTRACKED_PREFIX)));
}

/**
 * The refusal a working tree with modified tracked files answers, or
 * null when the run may move. Read after the question, on a yes.
 */
export function treeRefusal(tree: WorkingTreeStatus, plan: BranchPlan): string | null {
  const changes = trackedChanges(tree);
  if (changes.length === 0) return null;

  return [
    `❌ Refusing to leave ${plan.base} for ${plan.branch}: `
      + `the working tree has ${plural(changes.length, 'change', 'changes')} to tracked files.`,
    ...listChanges(changes),
    `${INDENT}Commit or stash them, then run again. Untracked files are left alone.`,
  ].join('\n');
}

/** One step of a route, in the order it runs. */
export type BranchStepId =
  | 'fetch'
  | 'read-standing'
  | 'fast-forward'
  | 'create'
  | 'switch'
  | 'track';

/** One step: what it is called, and exactly what it runs. */
export interface BranchStep {
  readonly id: BranchStepId;
  /** What is reported as the step runs, lower case, no full stop. */
  readonly label: string;
  /** The whole command, `git` included, ready to spawn or to print. */
  readonly argv: readonly string[];
}

/**
 * The steps a route runs, in order, frozen.
 *
 * `create` fetches the base, reads how the local base stands against it,
 * fast-forwards it and cuts the branch from it — the spec's order, and
 * the reason a stale or diverged base can never reach the `create` step.
 * The two switch routes run one step and fetch nothing, since a branch
 * that already exists is never fetched over.
 */
export function branchSteps(route: BranchRoute, plan: BranchPlan): readonly BranchStep[] {
  const { base, branch } = plan;
  if (route === 'switch-local') {
    return Object.freeze([
      { id: 'switch', label: `switch to ${branch}`, argv: ['git', 'switch', branch] },
    ] as const);
  }
  if (route === 'switch-remote') {
    return Object.freeze([
      {
        id: 'track',
        label: `check out ${branch} tracking ${REMOTE}/${branch}`,
        argv: ['git', 'switch', '--track', `${REMOTE}/${branch}`],
      },
    ] as const);
  }
  return Object.freeze([
    {
      id: 'fetch',
      label: `fetch ${REMOTE} ${base}`,
      argv: ['git', 'fetch', REMOTE, base],
    },
    {
      id: 'read-standing',
      label: `read how ${base} stands against ${REMOTE}/${base}`,
      argv: ['git', 'rev-list', '--left-right', '--count', `${base}...${REMOTE}/${base}`],
    },
    {
      id: 'fast-forward',
      label: `fast-forward ${base} to ${REMOTE}/${base}`,
      argv: ['git', 'merge', '--ff-only', `${REMOTE}/${base}`],
    },
    {
      id: 'create',
      label: `create ${branch} from ${base}`,
      argv: ['git', 'switch', '-c', branch],
    },
  ] as const);
}

/** How the local base stands against its remote-tracking branch, in commits. */
export interface BaseStanding {
  /** Commits the local base has that {@link REMOTE} has not. */
  readonly ahead: number;
  /** Commits {@link REMOTE} has that the local base has not. */
  readonly behind: number;
}

/**
 * The standing in `git rev-list --left-right --count <base>...<remote>/<base>`,
 * or null when that is not two counts. Left is the local side; see the
 * module note.
 */
export function parseBaseStanding(stdout: string): BaseStanding | null {
  const words = stdout.trim()
    .split(/\s+/)
    .filter((word) => word !== '');
  if (words.length !== 2) return null;

  const ahead = words[0] ?? '';
  const behind = words[1] ?? '';
  if (!COUNT.test(ahead) || !COUNT.test(behind)) return null;

  return Object.freeze({ ahead: Number(ahead), behind: Number(behind) });
}

/** True when the base and its remote have each got commits the other has not. */
export function hasDiverged(standing: BaseStanding): boolean {
  return standing.ahead > 0 && standing.behind > 0;
}

/** What the run does with what one step answered. */
export type StepOutcome =
  | { readonly kind: 'go' }
  | {
    readonly kind: 'refuse';
    /** The whole refusal, its first line opening with `❌`; the runner throws it. */
    readonly message: string;
  };

/** The one reading of going on. */
const GO: StepOutcome = Object.freeze({ kind: 'go' });

/** A refusal, its lines joined. */
function refuse(lines: readonly string[]): StepOutcome {
  return Object.freeze({ kind: 'refuse', message: lines.join('\n') });
}

/** What git said, each line indented, and nothing at all when it said nothing. */
function quotedLines(said: string): readonly string[] {
  return said === ''
    ? []
    : said.split('\n').map((line) => `${INDENT}${line}`);
}

/** The line every refusal here ends with: the run has not moved. */
function stillOn(plan: BranchPlan): string {
  return `${INDENT}The run is still on ${plan.base}.`;
}

/**
 * How a failed step opens. The fetch and the fast-forward say what they
 * are protecting — a branch cut from a stale or diverged base — and
 * every other step names itself through its own label, so the sentence
 * and the command reported cannot drift apart.
 */
function failureHead(step: BranchStep, plan: BranchPlan): string {
  if (step.id === 'fetch') {
    return `❌ Refusing to create ${plan.branch} from a stale ${REMOTE}/${plan.base}: ${step.label} failed.`;
  }
  if (step.id === 'fast-forward') {
    return `❌ Refusing to create ${plan.branch}: ${plan.base} would not fast-forward to ${REMOTE}/${plan.base}.`;
  }
  return `❌ Could not ${step.label}.`;
}

/** The refusal a base that has diverged from its remote answers. */
function divergedRefusal(standing: BaseStanding, plan: BranchPlan): StepOutcome {
  const ahead = plural(standing.ahead, 'commit', 'commits');
  const behind = plural(standing.behind, 'commit', 'commits');
  return refuse([
    `❌ Refusing to create ${plan.branch}: ${plan.base} has diverged from ${REMOTE}/${plan.base}.`,
    `${INDENT}${plan.base} is ${ahead} ahead of ${REMOTE}/${plan.base} and ${behind} behind it.`,
    `${INDENT}Push, rebase or reset ${plan.base}, then run again.`,
  ]);
}

/**
 * What follows the outcome of one step: going on to the next, or the
 * refusal that ends the run. A step git refused is always a refusal,
 * whichever it was; the `read-standing` step answers one more, since
 * counts it could not read and a base that has diverged both stop the
 * run as surely as a failed command.
 */
export function readStepOutcome(
  step: BranchStep,
  result: GitResult,
  plan: BranchPlan,
): StepOutcome {
  if (!result.ok) {
    return refuse([failureHead(step, plan), ...quotedLines(gitSaid(result)), stillOn(plan)]);
  }
  if (step.id !== 'read-standing') return GO;

  const standing = parseBaseStanding(result.stdout);
  if (standing === null) {
    return refuse([
      `❌ Could not ${step.label}.`,
      `${INDENT}git answered ${JSON.stringify(result.stdout)}, which is no pair of counts.`,
      stillOn(plan),
    ]);
  }
  return hasDiverged(standing)
    ? divergedRefusal(standing, plan)
    : GO;
}
