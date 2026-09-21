/**
 * The board side of `rafa plan create`: the seams `./spec-source.ts`
 * needs, built for one project, and the checks that run between an issue
 * being read and its body being written down.
 *
 * `src/plan.ts` reads the command line and runs the planner session.
 * What it must not also carry is the wiring: which runner reads the
 * board, which readings answer "taken", which checks a route runs and
 * what the readiness gate then publishes on. That is this module, and
 * `plan create` is its one caller
 * (`.rafa/specs/rafa-20-pr-commands.md`, `context/cli.md`).
 *
 * ```text
 * plan.ts   readSpecSourceFlags(argv)      the words
 *    │
 *    └─► resolvePlanSpec                   the seams, and the checks
 *           └─► resolveSpecSource          the route (./spec-source.ts)
 *                  ├─► createGhSpecIssueReader     gh issue view
 *                  ├─► inspectSpecIssue            the checks below
 *                  └─► writeSpecSnapshot           <specs.dir>/rafa-<n>-<slug>.md
 * ```
 *
 * The two runners are made LAZILY in the sense that matters: making one
 * spawns nothing (`createGhRunner`, `createGitRunner` answer functions),
 * and the `--spec=<file>` route calls neither. So a run that plans from a
 * file needs no `gh` on the PATH and no network, exactly as it did before
 * the board routes existed, and `src/plan.test.ts` — whose child PATH
 * carries no `gh` — proves it: every `--spec` case there is green with
 * this module wired in.
 *
 * Both are seams anyway ({@link PlanSpecOptions.gh},
 * {@link PlanSpecOptions.git}), so `./plan-spec.test.ts` drives fakes and
 * no case here reaches GitHub, spawns `gh` or `git`, or reads the
 * configuration `gh` keeps under the home.
 *
 * ## Which checks run, and which one does not yet
 *
 * The readiness gate is four checks, cheapest first
 * (`.rafa/specs/rafa-20-pr-commands.md`). {@link inspectSpecIssue} is the
 * three this stage wires, in the spec's order, and each is a refusal
 * that exits {@link BOARD_REFUSAL_EXIT} before the body is snapshotted:
 *
 *  1. the `spec:ready` label (`./readiness.ts`), a person's decision;
 *  2. the leak refusal (`./leak.ts`), the half of check 2 that keeps a
 *     home path or a credential out of a prompt and off the disk;
 *  3. the completeness gaps (`requireCompleteSpec` in `./readiness.ts`),
 *     the other half of check 2: every template heading present and
 *     non-empty, "Tasks the plan must carry" and "Definition of done"
 *     each holding a list item, and no placeholder left in the text.
 *
 * ONE is deliberately not here, and it is not forgotten. Check 0, the
 * author's trust (`./trust.ts`), needs the issue's author, and
 * `ISSUE_VIEW_FIELDS` does not ask for it (`./issue.ts` records why the
 * field list is the spec's own). Wiring it is a widening of that read,
 * not a line here, so an issue body check 0 would have caught still
 * reaches the planner, which judges the spec itself as check 3 and
 * refuses it there (`./gate.ts`). The cost is a session, not a wrong
 * plan.
 *
 * ## What the completeness refusal costs
 *
 * Check 2's completeness half was written and left unwired, and this
 * note argued for leaving it that way. What ran in its place was a
 * WARNING over the two headings a plan is written from, printed and
 * never refused. Both are gone: the spec decided the refusal, and the
 * warning could not have survived beside it anyway, since every gap
 * `findListSectionGaps` names is a gap `requireCompleteSpec` refuses
 * and a warning printed after a refusal reaches no output.
 * `./readiness.ts` keeps the warning pair with its own cases and no
 * caller.
 *
 * The argument for leaving it unwired was a real cost, and wiring it
 * does not make that cost go away — it decides to pay it. An issue
 * opened before `src/board/templates/spec.md` carries none of the six
 * headings, so it is refused on its first reading, with all six named
 * missing in one sentence, nothing snapshotted and nothing planned.
 * The remedy is the refusal's own last clause, fill each gap and
 * rerun, which for such a body means pasting the template over it and
 * filling it in once, by hand. `--next` STOPS at a line that refuses
 * rather than skipping ahead (`./spec-source.ts`), so one unmigrated
 * issue on the roadmap holds up the walk until somebody edits it.
 *
 * That is the trade the spec took. A body nobody has migrated costs an
 * edit; every body that HAS been migrated stops costing a planner
 * session to discover it was thin, because this refusal is free and
 * check 3 is a session.
 *
 * ## The gate's issue
 *
 * A not-ready verdict posts its gaps on the issue and swaps its labels,
 * and `./gate.ts` takes that as a {@link GateIssue}: the number and the
 * board to write through. Only the issue routes have one, so this module
 * answers it beside the spec — null under `--spec=<file>`, which has no
 * labels to move and nothing to comment on.
 */
import type { GateIssue } from './gate.js';
import type { SpecIssue } from './issue.js';
import type { ResolvedSpec, SpecSourceRequest, SpecSourceStop } from './spec-source.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { Output } from '../ports/index.js';
import type { GitRunner } from '../pr/git.js';

import { activeOutput } from '../adapters/output/active.js';
import { createGhRunner } from '../adapters/tracker/github.js';
import { createGitRunner } from '../pr/git.js';

import { createGhIssueBoard } from './issue-board.js';
import { createGhSpecIssueReader } from './issue.js';
import { requireNoLeak } from './leak.js';
import { requireCompleteSpec, requireSpecReadyLabel } from './readiness.js';
import { createGhOpenPullRequests, createGhRoadmapSearch } from './roadmap.js';
import { resolveSpecSource } from './spec-source.js';

/** The exit code every board refusal this module composes carries; the spec's own. */
export const BOARD_REFUSAL_EXIT = 2;

/** What a refusal calls the issue it refused: `issue #20`. */
export function issueSource(issue: number): string {
  return `issue #${String(issue)}`;
}

/**
 * The checks that run on an issue as read, before a byte of it is
 * written: the `spec:ready` label, then the leak refusal, then the
 * completeness gaps over every template heading. Throws
 * `CommandExit({@link BOARD_REFUSAL_EXIT}, ...)` at the first that
 * refuses; the module note holds which checks are here, which one is
 * not, and what the completeness refusal costs.
 *
 * The order is the spec's, and it is also what keeps a leak out of a
 * refusal sentence: nothing is read off the body until a person has
 * marked the issue ready, and the completeness refusal QUOTES headings
 * taken from the body, so it must not run over a body `requireNoLeak`
 * has not cleared first. `./plan-spec.test.ts` measures both orderings.
 *
 * Answers a promise because that is what {@link resolveSpecSource} takes
 * for the seam, and not because anything here waits.
 */
export function inspectSpecIssue(issue: SpecIssue): Promise<void> {
  const source = issueSource(issue.number);
  requireSpecReadyLabel(issue.number, issue.labels);
  requireNoLeak(source, issue.body);
  requireCompleteSpec(source, issue.body);
  return Promise.resolve();
}

/** What {@link resolvePlanSpec} is asked. */
export interface PlanSpecOptions {
  /** The source the command line named, as `readSpecSourceFlags` read it. */
  readonly request: SpecSourceRequest;
  /** True under `--refresh`. */
  readonly refresh: boolean;
  /** True under `--dry-run`. */
  readonly dryRun: boolean;
  /** The project root every path and every runner is made against. */
  readonly repoRoot: string;
  /** Where snapshots live, as `specs.dir` resolved it. */
  readonly specsDir: string;
  /** `roadmap.issue` as config resolved it, or null for the titled issue. */
  readonly roadmapIssue: number | null;
  /** Where `--spec` looks for its file; `src/plan.ts`'s own candidate rule. */
  readonly findSpec: (spec: string) => string;
  /** Runs `gh`; one made for the project root when left out. */
  readonly gh?: GhRunner;
  /** Runs `git`; one made for the project root when left out. */
  readonly git?: GitRunner;
  /** Where the lines go; the active output when left out. */
  readonly output?: Output;
}

/** What a resolution answers: one spec with its issue, or the reason it stopped. */
export type PlanSpecResolution =
  | { readonly outcome: 'stopped'; readonly reason: SpecSourceStop }
  | {
    readonly outcome: 'spec';
    /** The spec the run plans from. */
    readonly spec: ResolvedSpec;
    /** The issue the readiness gate publishes on, or null under `--spec`. */
    readonly gate: GateIssue | null;
  };

/**
 * The spec a `plan create` run plans from, resolved for one project, or
 * the reason the run stops without one.
 *
 * Throws the `CommandExit` of every refusal the routes carry: exit 1 for
 * the words typed (`./spec-source.ts`) and exit
 * {@link BOARD_REFUSAL_EXIT} for the board's own state — a closed or
 * unlabelled issue, a leaking body, a snapshot that differs with no
 * `--refresh`, a roadmap that cannot be resolved.
 */
export async function resolvePlanSpec(options: PlanSpecOptions): Promise<PlanSpecResolution> {
  const { repoRoot } = options;
  const gh = options.gh ?? createGhRunner({ cwd: repoRoot });
  const git = options.git ?? createGitRunner(repoRoot);
  const output = options.output ?? activeOutput();

  const resolution = await resolveSpecSource({
    request: options.request,
    refresh: options.refresh,
    dryRun: options.dryRun,
    repoRoot,
    specsDir: options.specsDir,
    findSpec: options.findSpec,
    issues: createGhSpecIssueReader({ gh }),
    inspect: inspectSpecIssue,
    roadmap: {
      configured: options.roadmapIssue,
      search: createGhRoadmapSearch({ gh }),
      git,
      pullRequests: createGhOpenPullRequests({ gh }),
    },
    output,
  });

  if (resolution.outcome === 'stopped') {
    return Object.freeze({ outcome: 'stopped' as const, reason: resolution.reason });
  }

  const { spec } = resolution;
  return Object.freeze({
    outcome: 'spec' as const,
    spec,
    gate: spec.issue === null
      ? null
      : Object.freeze({ number: spec.issue, board: createGhIssueBoard({ gh }) }),
  });
}
