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
 * passed, before the `progress.txt` read and the notices, so a refusal
 * writes no plan file and starts no session, and a line that would be
 * refused for free is not charged the `gh` reads check 4 spends first.
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
 * the `PATH`, and the roster {@link planRoster} answers. Making it
 * spawns nothing: the runners are functions, and the roster is read on
 * the first reference read, so a copy naming none reads no roster.
 *
 * ## The roster
 *
 * Commands and flags are read against the checkout's OWN roster when
 * the project root is rafa itself, and against the core roster
 * otherwise. A spec of rafa's names the commands and flags its branch
 * adds, which the installed rafa running the check does not hold, so
 * read against that rafa's roster they read `absent` (#172).
 *
 * The root is rafa itself when its `package.json` is named
 * `@open-tomato/rafa` and git tracks `src/rafa.ts` there
 * ({@link readCheckoutRoster}). Its roster is then what `bun src/rafa.ts
 * describe --output=json` answers in the root, run by the bun running
 * this process (`process.execPath`): the `data` of the result event,
 * held to the shape the verifier reads (schema 2, each subject, action
 * and flag named, the aliases listed). Json mode rather than text, so a
 * line anything else writes is not read as the document. Measured in
 * this repository on 2026-10-05: 0.15 s, writing two lines, the start
 * event and the result.
 *
 * A root that is not rafa reads the core roster and says nothing: that
 * is every other project. A root that is rafa whose roster cannot be
 * read — git refusing the tracked-file read, `describe` exiting
 * non-zero or killed after {@link CHECKOUT_ROSTER_TIMEOUT_MS}, or its
 * output holding no result of that shape — reads the core roster too,
 * with ONE warning line naming why, written when the roster is read,
 * once per verifier. A branch whose own entry is broken still has its
 * references read, and is told what they were read against.
 *
 * The core roster is `CORE_REGISTRY` as `describeRegistry` reads it, and it
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
 * directory, and so is the checkout's roster
 * ({@link PlanRefsVerifierOptions.checkoutRoster}). The default
 * {@link readCheckoutRoster} is read over repositories planted there
 * whose `src/rafa.ts` writes a roster of its own, fails, or writes the
 * wrong shape, and over this repository itself. The timeout is not
 * driven: a case would wait it out.
 */
import type { RefsGateAnswer } from '../../board/refs-gate.js';
import type { SpecSourceRequest, ResolvedSpec } from '../../board/spec-source.js';
import type { DescribeDocument } from '../../cli/describe.js';
import type { Output } from '../../ports/index.js';
import type { RefVerifier } from '../../refs/verify.js';

import { readFileSync } from 'node:fs';
import path from 'path';

import { version } from '../../../package.json';
import { activeOutput } from '../../adapters/output/active.js';
import { createGhRunner } from '../../adapters/tracker/github.js';
import { announceAcceptStaleRefs, enforceRefsGate, readAcceptRefsFlag, refsAcceptance } from '../../board/refs-gate.js';
import { readSpecSourceFlags } from '../../board/spec-source.js';
import { DESCRIBE_SCHEMA_VERSION } from '../../cli/describe.js';
import { messageOf } from '../../config-sections.js';
import { createGitRunner, gitSaid } from '../../pr/git.js';
import { createRefVerifier, ghIssueReader, tsSymbolsOutliner } from '../../refs/verify.js';

/** The `name` in `package.json` of a project root that is rafa itself. */
export const RAFA_PACKAGE_NAME = '@open-tomato/rafa';

/** The entry a rafa checkout's `describe` is run through, relative to its root. */
export const RAFA_ENTRY = 'src/rafa.ts';

/** How long a checkout's `describe` may run before it is killed; see the module note. */
export const CHECKOUT_ROSTER_TIMEOUT_MS = 30_000;

/** The line the checkout's roster is read with, as a person would type it. */
const DESCRIBE_LINE = `bun ${RAFA_ENTRY} describe --output=json`;

/**
 * What reading the checkout's own roster answered: the root is not
 * rafa, the roster it holds, or why a root that is rafa gave none.
 */
export type CheckoutRosterRead =
  | { readonly kind: 'not-rafa' }
  | { readonly kind: 'read'; readonly roster: DescribeDocument }
  | { readonly kind: 'failed'; readonly detail: string };

/** Reads the roster of the checkout at a project root; see the module note. Never rejects. */
export type CheckoutRosterReader = (repoRoot: string) => Promise<CheckoutRosterRead>;

/**
 * The core roster commands and flags are read against when the project
 * is not rafa itself; see the module note for why it is loaded late.
 */
export async function coreRoster(): Promise<DescribeDocument> {
  const [{ CORE_REGISTRY }, { describeRegistry }] = await Promise.all([
    import('../index.js'),
    import('../../cli/describe.js'),
  ]);
  return describeRegistry(CORE_REGISTRY, version);
}

/** `value` as a record, or null when it is no plain object. */
function recordOf(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** True for a list of strings. */
function isStringList(value: unknown): boolean {
  return Array.isArray(value) && value.every((each) => typeof each === 'string');
}

/** True for an entry with a string `name` and its `aliases` listed: a flag as the verifier reads one. */
function isNamedWithAliases(value: unknown): boolean {
  const entry = recordOf(value);
  return entry !== null && typeof entry['name'] === 'string' && isStringList(entry['aliases']);
}

/** True for an action or a top-level command as the verifier reads one. */
function isRosterAction(value: unknown): boolean {
  const flags = recordOf(value)?.['flags'];
  return isNamedWithAliases(value) && Array.isArray(flags) && flags.every(isNamedWithAliases);
}

/** True for a subject as the verifier reads one. */
function isRosterSubject(value: unknown): boolean {
  const subject = recordOf(value);
  const actions = subject?.['actions'];
  return subject !== null && typeof subject['name'] === 'string' && Array.isArray(actions) && actions.every(isRosterAction);
}

/** True for a schema 2 document holding every field the verifier reads; see the module note. */
function isRosterDocument(value: unknown): value is DescribeDocument {
  const document = recordOf(value);
  const { subjects, commands } = document ?? {};
  return document?.['schemaVersion'] === DESCRIBE_SCHEMA_VERSION
    && Array.isArray(subjects) && subjects.every(isRosterSubject)
    && Array.isArray(commands) && commands.every(isRosterAction);
}

/** The first line of `text` holding anything, trimmed, or null when none does. */
function firstLine(text: string): string | null {
  return text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '') ?? null;
}

/** The `data` of the result event among the json lines `stdout` holds, or undefined when it holds none. */
function resultData(stdout: string): unknown {
  for (const line of stdout.split('\n')) {
    let event: Readonly<Record<string, unknown>> | null = null;
    try {
      event = recordOf(JSON.parse(line));
    } catch {
      continue;
    }
    if (event?.['type'] === 'result' && event['ok'] === true) return event['data'];
  }
  return undefined;
}

/** True when the `package.json` at `repoRoot` is named {@link RAFA_PACKAGE_NAME}; false when it is missing or unreadable. */
function isRafaPackage(repoRoot: string): boolean {
  try {
    const manifest = recordOf(JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')));
    return manifest?.['name'] === RAFA_PACKAGE_NAME;
  } catch {
    return false;
  }
}

/**
 * Reads the roster of the checkout at `repoRoot` by running its own
 * `describe` when the root is rafa itself, and answers `not-rafa`
 * without spawning `bun` when it is not; see the module note. Never
 * rejects.
 */
export async function readCheckoutRoster(repoRoot: string): Promise<CheckoutRosterRead> {
  if (!isRafaPackage(repoRoot)) return { kind: 'not-rafa' };
  const tracked = createGitRunner(repoRoot)(['ls-files', '--', RAFA_ENTRY]);
  if (!tracked.ok) return { kind: 'failed', detail: `git could not say whether ${RAFA_ENTRY} is tracked: ${firstLine(gitSaid(tracked)) ?? 'it said nothing'}` };
  if (tracked.stdout.trim() !== RAFA_ENTRY) return { kind: 'not-rafa' };

  const run = createGhRunner({ cwd: repoRoot, command: process.execPath, timeoutMs: CHECKOUT_ROSTER_TIMEOUT_MS });
  const result = await run([RAFA_ENTRY, 'describe', '--output=json']);
  if (!result.ok) {
    const said = firstLine(result.stderr) ?? firstLine(result.stdout) ?? 'it wrote nothing';
    return { kind: 'failed', detail: `${DESCRIBE_LINE} failed: ${said}` };
  }
  const roster = resultData(result.stdout);
  return isRosterDocument(roster)
    ? { kind: 'read', roster }
    : { kind: 'failed', detail: `${DESCRIBE_LINE} wrote no schema ${String(DESCRIBE_SCHEMA_VERSION)} roster` };
}

/** The warning a root that is rafa gets when its own roster could not be read; see the module note. */
export function checkoutRosterWarning(detail: string): string {
  return `references: this checkout's own command roster could not be read (${detail});`
    + ' commands and flags are read against the core roster';
}

/** How the roster commands and flags are read against is found; each left out is the system's own. */
export interface PlanRefsVerifierOptions {
  /** Reads the checkout's own roster; {@link readCheckoutRoster} when left out. */
  readonly checkoutRoster?: CheckoutRosterReader;
  /** Where the warning line goes; the active output when left out. */
  readonly output?: Output;
}

/**
 * The roster commands and flags are read against for the project at
 * `repoRoot`: the checkout's own when it is rafa itself, the core
 * roster otherwise, with one warning line when the checkout's could not
 * be read. See the module note. `rafa doctor`'s references row
 * (`../doctor-refs.ts`) reads against the same one.
 */
export async function planRoster(repoRoot: string, options: PlanRefsVerifierOptions = {}): Promise<DescribeDocument> {
  const reader = options.checkoutRoster ?? readCheckoutRoster;
  let read: CheckoutRosterRead;
  try {
    read = await reader(repoRoot);
  } catch (error) {
    read = { kind: 'failed', detail: messageOf(error) };
  }
  if (read.kind === 'read') return read.roster;
  if (read.kind === 'failed') (options.output ?? activeOutput()).warn(checkoutRosterWarning(read.detail));
  return coreRoster();
}

/**
 * The verifier `plan create` reads a copy's references with, made for
 * the project at `repoRoot`; see the module note. The roster and the
 * `ts-symbols` lookup are made on the first reference read, once.
 */
export function createPlanRefsVerifier(repoRoot: string, options: PlanRefsVerifierOptions = {}): RefVerifier {
  const gh = createGhRunner({ cwd: repoRoot });
  const git = createGitRunner(repoRoot);
  let made: Promise<RefVerifier> | null = null;
  const verifier = async (): Promise<RefVerifier> => createRefVerifier({
    issues: ghIssueReader(gh),
    git,
    outline: tsSymbolsOutliner({ cwd: repoRoot }),
    roster: await planRoster(repoRoot, options),
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
  const output = options.output ?? activeOutput();
  const makeVerifier = seams.verifier ?? ((root: string) => createPlanRefsVerifier(root, { output }));
  return enforceRefsGate({
    path: path.resolve(repoRoot, spec.path),
    issue: spec.issue,
    source: spec.source,
    verify: makeVerifier(repoRoot),
    acceptance: refsAcceptance(readAcceptRefsFlag(options.args), options.acceptStaleRefs),
    output,
  });
}
