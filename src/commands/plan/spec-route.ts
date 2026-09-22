/**
 * Which spec a `rafa plan create` run plans from: the words read as a
 * route, the `--spec` file looked for, and the two board routes
 * resolved with the offers a terminal makes possible wired in.
 *
 * `src/plan.ts` builds the prompt, runs the planner session and prints
 * what it wrote. What it no longer carries is this: the usage refusal a
 * line naming no source gets, the candidate rule `--spec` looks a file
 * up with, and the call that turns `--issue` or `--next` into one spec
 * path. The board side of that call is `src/board/plan-spec.ts`, which
 * builds the `gh` and `git` runners and runs the cheap checks; this
 * module is what `plan create` hands it.
 *
 * ## Which spec, and where the plan is
 *
 * Three flags name one spec, and they are mutually exclusive:
 * `--spec=<file>`, `--issue=<n>` and `--next[=<roadmap-issue>]`. The
 * words are read by `board/spec-source.ts` and the routes are resolved
 * by `board/plan-spec.ts`, which answers ONE spec path — a file for
 * `--spec`, and for the two board routes the snapshot of the issue body
 * written under `specs.dir`. Everything past that point is what
 * `--spec` always did: the stub, the prompt, the session, the stamp and
 * the classifier keys. A line naming no source is refused with
 * {@link usageRefusal}, and one naming two with the exclusion refusal,
 * both exit code 1.
 *
 * `--dry-run` reads and refuses everything and writes nothing, and
 * `--next` over a roadmap with nothing left prints a message; both
 * answer a `stopped` resolution, which ends the command at 0 before any
 * session is paid for. That is why `plan create` resolves the spec as
 * the first thing after the config.
 *
 * An issue a board route reads that carries no `spec:ready` label is
 * OFFERED the label rather than refused outright, when there is a
 * terminal to ask on: `./ready-offer.ts` puts `rafa issue ready`'s own
 * run — its readings, its question and its one label swap — where
 * check 1's refusal stood, and the resolution goes on only after a yes.
 * A run with no terminal is handed no offer, because
 * {@link createPlanReadyOffer} answers null for one, and a `--dry-run`
 * run is handed none by `board/plan-spec.ts` because a label swap is a
 * write; both keep that refusal exactly.
 *
 * A `--next` run whose next line is BLOCKED — its issue labelled
 * `spec:blocked` with a blocker still open — plans neither that line
 * nor the one under it silently: it names what the line waits on,
 * `#57 is blocked by #24 (open)`, offers by number the first line under
 * it that is ready, not blocked and not taken, and plans that one only
 * on a yes (`./blocked-offer.ts`, `board/blocked-line.ts`). A run with
 * no terminal and a `--dry-run` run are handed no offer, print what a
 * run could plan instead, and plan nothing. Every one of those endings
 * exits 0: the roadmap is in the state it is in, and no command failed.
 *
 * An issue whose body no longer reads as its saved copy is ASKED about
 * rather than refused outright, when there is a terminal and no
 * `--refresh`: {@link createPlanRefreshOffer} puts the dated question
 * once every check has run on the body as it reads now
 * (`board/snapshot-settle.ts`), and a yes plans from it and keeps the
 * old copy under `previous/`. No terminal, a no, an ended input or
 * `--dry-run` keeps the refusal exactly; `--refresh` rebuilds without
 * asking.
 *
 * The board routes resolve BEFORE the plan-already-there refusal,
 * because the stub is read off the snapshot's name and there is no name
 * until the issue has been read. So `--issue` against a stub already
 * planned writes the snapshot and then refuses; the snapshot is the
 * text of an issue either way, and the refusal names the plan to
 * remove.
 *
 * `--spec` names a file against the project root, and when nothing is
 * there, the same name under `specs.dir`; a spec in neither is refused,
 * naming both paths. So `--spec=my-feature.md` reads
 * `.rafa/specs/my-feature.md` in a project whose root holds no
 * `my-feature.md`, and a path written from the root, such as
 * `.rafa/specs/my-feature.md`, reads as it did before `specs.dir` was
 * read. An absolute `--spec` has the one candidate. The planner is
 * handed the candidate found, as the port documents a spec path:
 * repository-relative or absolute.
 *
 * ## Nothing here spawns
 *
 * The resolution and the three offers are seams ({@link SpecRouteSeams}), so
 * `./spec-route.test.ts` measures what a route is handed without
 * reaching GitHub or opening a terminal. The defaults spawn nothing of
 * their own either: making the `gh` and `git` runners is free and the
 * `--spec` route calls neither (`board/plan-spec.ts`), and
 * {@link createPlanReadyOffer}, {@link createPlanBlockedOffer} and
 * {@link createPlanRefreshOffer} read
 * `process.stdin.isTTY` and open a prompter only to ask.
 */
import type { AlternativeOffer } from '../../board/blocked-line.js';
import type { PlanSpecOptions, PlanSpecResolution, ReadyOffer } from '../../board/plan-spec.js';
import type { RefreshOffer } from '../../board/snapshot-settle.js';

import fs from 'fs';
import path from 'path';

import { resolvePlanSpec } from '../../board/plan-spec.js';
import { noSourceMessage, readSpecSourceFlags, SOURCE_REFUSAL_EXIT } from '../../board/spec-source.js';
import { CommandExit } from '../../cli/command.js';

import { createPlanBlockedOffer } from './blocked-offer.js';
import { createPlanReadyOffer } from './ready-offer.js';
import { createPlanRefreshOffer } from './refresh-offer.js';

/**
 * Where `--spec` looks for its spec, in order, each as the planner is
 * handed it: the value itself, read against the project root, then the
 * same value under `specsDir`. An absolute value is its one candidate,
 * and a second candidate spelled as the first is dropped.
 */
export function specCandidates(specArg: string, specsDir: string): string[] {
  if (path.isAbsolute(specArg)) return [specArg];
  return [...new Set([specArg, path.join(specsDir, specArg)])];
}

/**
 * The spec `--spec` names, as the planner is handed it: the first of
 * {@link specCandidates} that exists under `repoRoot`. When none does, a
 * `CommandExit` with exit code 1 naming every path looked at.
 */
export function findSpec(repoRoot: string, specArg: string, specsDir: string): string {
  const candidates = specCandidates(specArg, specsDir);
  const found = candidates.find((candidate) => fs.existsSync(path.resolve(repoRoot, candidate)));
  if (found === undefined) {
    const looked = [...new Set(candidates.map((candidate) => path.resolve(repoRoot, candidate)))];
    throw new CommandExit(1, `❌ Spec file not found: ${looked.join(', or ')}`);
  }
  return found;
}

/**
 * The refusal a line naming no spec source gets: the usage, then
 * {@link noSourceMessage}, which names each of the three flags and where
 * a `--spec` file is looked for.
 */
export function usageRefusal(specsDir: string): string {
  return [
    'Usage: rafa plan create (--spec=<file>.md | --issue=<n> | --next[=<roadmap-issue>])',
    '  [--stub=<name>] [--no-progress] [--refresh] [--dry-run] [--skip-review] [--no-comment]',
    noSourceMessage(specsDir),
  ].join('\n');
}

/** What {@link resolveCreateSpec} is asked, all of it off the command line and the config. */
export interface SpecRouteOptions {
  /** The words the command was handed; the source flags are read off them. */
  readonly args: readonly string[];
  /** The project root every path and every runner is made against. */
  readonly repoRoot: string;
  /** Where snapshots live and where a `--spec` file is looked for, as `specs.dir` resolved it. */
  readonly specsDir: string;
  /** `roadmap.issue` as config resolved it, or null for the titled issue. */
  readonly roadmapIssue: number | null;
  /** `board.trustedAuthors` as config resolved it; check 0's allow-list. */
  readonly trustedAuthors: readonly string[];
}

/** The resolution itself, as `board/plan-spec.ts` performs it. */
export type PlanSpecResolver = (options: PlanSpecOptions) => Promise<PlanSpecResolution>;

/** How the resolution and the three offers are reached; each left out is the command's own. */
export interface SpecRouteSeams {
  /** Resolves the route; `resolvePlanSpec` when left out. */
  readonly resolve?: PlanSpecResolver;
  /** Makes the `issue ready` offer; {@link createPlanReadyOffer} when left out. */
  readonly makeReadyOffer?: () => ReadyOffer | null;
  /** Makes the blocked-line offer; {@link createPlanBlockedOffer} when left out. */
  readonly makeAlternativeOffer?: () => AlternativeOffer | null;
  /** Makes the changed-issue question; {@link createPlanRefreshOffer} when left out. */
  readonly makeRefreshOffer?: () => RefreshOffer | null;
}

/** The seams a `plan create` run resolves with: the command's own, every one. */
export const DEFAULT_ROUTE_SEAMS: SpecRouteSeams = Object.freeze({});

/**
 * The spec a `plan create` run plans from, or the reason it stops
 * without one.
 *
 * Throws `CommandExit({@link SOURCE_REFUSAL_EXIT}, {@link usageRefusal})`
 * for a line naming no source, and every refusal the routes themselves
 * carry: exit 1 for the words typed and exit 2 for the board's own state
 * (`board/plan-spec.ts`).
 */
export async function resolveCreateSpec(
  options: SpecRouteOptions,
  seams: SpecRouteSeams = DEFAULT_ROUTE_SEAMS,
): Promise<PlanSpecResolution> {
  const { repoRoot, specsDir } = options;
  const source = readSpecSourceFlags(options.args);
  if (source.request === null) throw new CommandExit(SOURCE_REFUSAL_EXIT, usageRefusal(specsDir));

  const resolve = seams.resolve ?? resolvePlanSpec;
  const makeReadyOffer = seams.makeReadyOffer ?? createPlanReadyOffer;
  const makeAlternativeOffer = seams.makeAlternativeOffer ?? createPlanBlockedOffer;
  const makeRefreshOffer = seams.makeRefreshOffer ?? createPlanRefreshOffer;

  return await resolve({
    request: source.request,
    refresh: source.refresh,
    dryRun: source.dryRun,
    repoRoot,
    specsDir,
    roadmapIssue: options.roadmapIssue,
    trustedAuthors: options.trustedAuthors,
    findSpec: (spec) => findSpec(repoRoot, spec, specsDir),
    // All three are read for the terminal when they are made, which is once
    // per run and before any body is: see `./ready-offer.ts` for why
    // that reading must not wait until an unlabelled line turns up.
    offerReady: makeReadyOffer(),
    offerAlternative: makeAlternativeOffer(),
    offerRefresh: makeRefreshOffer(),
  });
}
