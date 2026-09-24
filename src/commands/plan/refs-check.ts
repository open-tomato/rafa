/**
 * Check 4 of the readiness gate in its place on `rafa plan create`: the
 * start-of-run line `dangerous.acceptStaleRefs` prints, and the check
 * itself run over the saved copy a board route settled, before the
 * planner session (`.rafa/specs/rafa-151-references-specs-bugs-are.md`).
 *
 * What the check DOES with each reference state is
 * `src/board/refs-gate.ts`'s. This module is what `src/plan.ts` calls it
 * through, and it holds the three things that module leaves to its
 * caller: which runs it covers, the acceptance a run holds, and the
 * verifier the targets are read with.
 *
 * ## Which runs, and where in them
 *
 * {@link checkCreateRefs} runs on a spec a board route resolved,
 * `--issue=<n>` or `--next`, and answers null for `--spec=<file>`,
 * which has no issue and so no saved copy holding stamps. `src/plan.ts`
 * calls it once the resolution has answered a spec — after checks 0–2
 * and the snapshot settle — and once the plan-already-there refusal has
 * passed, before `checkUsage` and the notices, so a refusal writes no
 * plan file and starts no session, and a line that would be refused for
 * free is not charged the `gh` reads check 4 spends first.
 *
 * `--dry-run` never reaches it: the resolution stops that run before a
 * spec is answered, so no snapshot is written and there is no copy to
 * read the stamps of. It stops before check 3 for the same reason.
 * `rafa plan needs --issue` resolves through the same route and does not
 * run it, and neither does `rafa issue ready`.
 *
 * ## The acceptance
 *
 * `--accept-refs` on the line, and `dangerous.acceptStaleRefs: true` in
 * the config, each re-stamp every reference and plan
 * (`refsAcceptance`, the flag winning). {@link announceCreateRefs}
 * prints the setting's pass line at the START of the run, before any
 * board read, and only on a run check 4 will cover: a board route that
 * is not `--dry-run`. A `--spec` run and a dry run would be told that
 * check 4 re-stamps every reference "on this run" when it reads none.
 *
 * ## The verifier
 *
 * {@link createPlanRefsVerifier} reads each target through a `gh` and a
 * `git` runner made for the project root, `ts-symbols` when it is on
 * the `PATH`, and the core command roster. Making it spawns nothing:
 * the runners are functions, and the roster is built on the first
 * reference read, so a copy naming none reads no roster.
 *
 * The roster is `CORE_REGISTRY` as `describeRegistry` reads it, and it
 * is imported DYNAMICALLY. A static import is a cycle that breaks on
 * one evaluation order: `src/commands/index.ts` builds its roster at
 * load from `./plan/create.ts`'s default export, which imports
 * `src/plan.ts`, which imports this module; a caller loading
 * `create.ts` first reaches `index.ts` while `create.ts`'s export is
 * not yet made. That is measured, not guessed: the static import, tried
 * on 2026-09-24, reddened `src/plan.test.ts`, whose child loads
 * `create.ts` first, with `ReferenceError: Cannot access 'planCreate'
 * before initialization.` By the time a reference is read, every module
 * is loaded. The core roster holds no mounted module's commands, so a
 * `rafa module exec …` line a spec names is read against core alone.
 *
 * ## Nothing here is untestable
 *
 * The verifier is a seam ({@link CreateRefsCheckSeams.verifier}), so
 * `./refs-check.test.ts` drives a fake over copies under the temp
 * directory; its one case over {@link createPlanRefsVerifier} reads a
 * command and a key, which spawn nothing.
 */
import type { RefsGateAnswer } from '../../board/refs-gate.js';
import type { SpecSourceRequest, ResolvedSpec } from '../../board/spec-source.js';
import type { DescribeDocument } from '../../cli/describe.js';
import type { Output } from '../../ports/index.js';
import type { RefVerifier } from '../../refs/verify.js';

import path from 'path';

import { version } from '../../../package.json';
import { activeOutput } from '../../adapters/output/active.js';
import { createGhRunner } from '../../adapters/tracker/github.js';
import { announceAcceptStaleRefs, enforceRefsGate, readAcceptRefsFlag, refsAcceptance } from '../../board/refs-gate.js';
import { readSpecSourceFlags } from '../../board/spec-source.js';
import { createGitRunner } from '../../pr/git.js';
import { createRefVerifier, ghIssueReader, tsSymbolsOutliner } from '../../refs/verify.js';

/** The core roster commands and flags are read against; see the module note for why it is loaded late. */
async function coreRoster(): Promise<DescribeDocument> {
  const [{ CORE_REGISTRY }, { describeRegistry }] = await Promise.all([
    import('../index.js'),
    import('../../cli/describe.js'),
  ]);
  return describeRegistry(CORE_REGISTRY, version);
}

/**
 * The verifier `plan create` reads a copy's references with, made for
 * the project at `repoRoot`; see the module note. The roster and the
 * `ts-symbols` lookup are made on the first reference read, once.
 */
export function createPlanRefsVerifier(repoRoot: string): RefVerifier {
  const gh = createGhRunner({ cwd: repoRoot });
  const git = createGitRunner(repoRoot);
  let made: Promise<RefVerifier> | null = null;
  const verifier = async (): Promise<RefVerifier> => createRefVerifier({
    issues: ghIssueReader(gh),
    git,
    outline: tsSymbolsOutliner({ cwd: repoRoot }),
    roster: await coreRoster(),
  });
  return async (ref) => {
    made ??= verifier();
    return (await made)(ref);
  };
}

/** True for a request check 4 covers: `--issue` or `--next`, not `--spec`. */
function isBoardRequest(request: SpecSourceRequest | null): boolean {
  return request !== null && request.kind !== 'spec';
}

/**
 * Prints the `dangerous.acceptStaleRefs` pass line when the setting is
 * on and the line names a board route that is not `--dry-run`; nothing
 * otherwise. Called first thing in a `plan create` run, before any
 * board read.
 *
 * Throws what `readSpecSourceFlags` throws for a line naming two
 * sources, which is the refusal the resolution would throw next.
 */
export function announceCreateRefs(
  args: readonly string[],
  acceptStaleRefs: boolean,
  output: Output = activeOutput(),
): void {
  if (!acceptStaleRefs) return;
  const flags = readSpecSourceFlags(args);
  announceAcceptStaleRefs(isBoardRequest(flags.request) && !flags.dryRun, output);
}

/** What {@link checkCreateRefs} is handed. */
export interface CreateRefsCheckOptions {
  /** The spec the resolution answered. */
  readonly spec: ResolvedSpec;
  /** The project root the spec's path is read against. */
  readonly repoRoot: string;
  /** The words the command was handed; `--accept-refs` is read off them. */
  readonly args: readonly string[];
  /** `dangerous.acceptStaleRefs` as the config resolved it. */
  readonly acceptStaleRefs: boolean;
  /** Where the lines go; the active output when left out. */
  readonly output?: Output;
}

/** How {@link checkCreateRefs} reads its targets; each left out is the command's own. */
export interface CreateRefsCheckSeams {
  /** Makes the verifier for a project root; {@link createPlanRefsVerifier} when left out. */
  readonly verifier?: (repoRoot: string) => RefVerifier;
}

/**
 * Runs check 4 over the saved copy of a spec a board route resolved,
 * and answers what it let through; null for a `--spec` spec, whose
 * verifier is never made.
 *
 * Throws `CommandExit(BOARD_REFUSAL_EXIT, ...)` as `enforceRefsGate`
 * does: a dangling or suspect reference no acceptance lets through, a
 * board issue that could not be read and a refs block that could not be
 * read.
 */
export async function checkCreateRefs(
  options: CreateRefsCheckOptions,
  seams: CreateRefsCheckSeams = {},
): Promise<RefsGateAnswer | null> {
  const { spec, repoRoot } = options;
  if (spec.issue === null) return null;
  const makeVerifier = seams.verifier ?? createPlanRefsVerifier;
  return enforceRefsGate({
    path: path.resolve(repoRoot, spec.path),
    issue: spec.issue,
    source: spec.source,
    verify: makeVerifier(repoRoot),
    acceptance: refsAcceptance(readAcceptRefsFlag(options.args), options.acceptStaleRefs),
    output: options.output ?? activeOutput(),
  });
}
