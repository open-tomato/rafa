/**
 * `rafa init`: sets up a rafa project. Steps 1 to 4 of `rafa init` under
 * "Scope resolution" in the phase 1 installable spec, with the `.gitignore`
 * entry of "Tracking (Q29)" and the `PATH` check from the spec's "Ports"
 * section for `init`.
 *
 * A top-level command, its action spelled as its subject, so it sits
 * directly under `src/commands/`. It wraps no phase 0 command, and it
 * needs no project: it is the command that makes one, so it declares
 * `needsProject: false` and the dispatcher resolves none for it.
 *
 * ## Choosing the root
 *
 *   - `--root=<path>` names the root, absolute or relative to the working
 *     directory, and nothing is asked or listed.
 *   - `--yes` takes the first candidate `rootCandidates` answers for the
 *     working directory (`src/project/roots.ts`): the git toplevel, or the
 *     working directory itself outside a repository.
 *   - Neither: on a terminal it lists the candidates and reads a
 *     candidate's number or a path typed freely
 *     (`src/project/root-choice.ts`). Without a terminal it refuses with
 *     exit code 1, listing the candidates and naming both flags, so a
 *     session, a test or a loop task never waits on input nobody types.
 *
 * `--root` outranks `--yes`, which then changes nothing. A root refused,
 * however it was named, is refused with exit code 1 and its reason, and
 * so is the first candidate under `--yes` when it is refused: `--yes`
 * takes the first candidate, and never quietly the second. A terminal is
 * a standard input that is a TTY, since that is where an answer is read
 * from: measured on bun 1.3.14, a piped standard input answers `isTTY`
 * as undefined. The list and each question go to stderr, so a json-mode
 * stdout stays NDJSON.
 *
 * ## What it writes
 *
 * Nothing until every check has passed, so a refusal leaves no byte
 * behind: a path the scopes cannot be written at (`scaffoldConflicts`),
 * a config either scope holds that `loadConfig` refuses, and a
 * `.gitignore` whose markers the entry cannot be placed between. Then, in
 * order:
 *
 *   1. The project scope: `.rafa/`, `.rafa/config.yaml` and the tree,
 *      each only when missing (`src/project/scaffold.ts`).
 *   2. The `.gitignore` entry for the `tracking` flags as the config
 *      resolves them, and the `tracking.all` notice when the flags
 *      changed since it last printed, through `applyTracking`
 *      (`src/project/gitignore.ts`), which records their digest.
 *   3. The user scope: `~/.rafa/`, `~/.rafa/config.yaml` and
 *      `~/.rafa/instincts/`, each only when missing.
 *
 * `init` asks nothing about tracking. On a first init the project has no
 * file of its own, so the flags are the user scope's or the defaults, and
 * the entry is `.rafa/`. Opting in is setting a flag in
 * `.rafa/config.yaml` and running `init` again, which rewrites the block.
 *
 * ## The release step
 *
 * Once the scopes are on disk, one question decides whether this
 * project bumps a version and writes a changelog entry with every pull
 * request, and the answer is written as `release.enabled` into the
 * `.rafa/config.yaml` this run has just made. The decision, the
 * question and the line are `./init-release.ts`'s; what is decided HERE
 * is that it runs after the scopes and BEFORE the board step, which
 * stays the last thing `init` does. Like the board step it refuses
 * nothing: a config it cannot read or write is a warning.
 *
 * `--release` and `--no-release` answer the question for a script, and
 * `--yes` leaves the setting unset — `--yes` is how a line says it will
 * answer nothing. The value of `--release` is read at the TOP of the
 * run, with `--board`'s and for the same reason.
 *
 * ## The board step
 *
 * A repository whose pull request provider resolves to `gh` ends with
 * the board step: one question, and the labels, the spec issue template
 * and the pinned Roadmap issue `src/board/setup.ts` makes. The decision,
 * the question and the lines are `./init-board.ts`'s; what is decided
 * HERE is that it runs LAST, after the scopes are on disk. The
 * `roadmap.issue` it may write goes into the `.rafa/config.yaml` this
 * run has just made, and nothing it asks or sends can keep the project
 * from being set up: a `gh` that is not installed, a repository nobody
 * is authenticated for and a label that would not be made are reported
 * as refused parts, never as a refusal of `init`.
 *
 * `--board` and `--no-board` answer the question for a script. The value
 * of `--board` is read at the TOP of the run, before a root is chosen
 * and so before anything is written, because `--board=later` is a line
 * to refuse while `Nothing was written.` is still true.
 *
 * ## A rerun
 *
 * Each writer writes only what is missing or stale, so a rerun over a
 * project `init` set up changes no byte and no modification time, and
 * says so: the head line says the root is already a rafa project whose
 * `.rafa/config.yaml` is left as it was, and `Nothing changed.` follows.
 * An existing `.rafa/config.yaml` is never rewritten. A path missing
 * since, or a `tracking` flag changed since, is written and listed. The
 * board step keeps that true: every part it finds already there is
 * reported as present and nothing is written, so `Nothing changed.`
 * follows the board rows. The release step keeps it too: a project
 * whose config already names `release.enabled` is left as it is and
 * asked nothing.
 *
 * ## The `PATH` check
 *
 * Once the scopes are written, `readBinPath` (`src/project/bin-path.ts`)
 * reads the `PATH` of the context's environment, the one this invocation
 * was handed, never a shell profile, and a warning is written when
 * `~/.rafa/bin` is not on it ahead of `~/.bun/bin`. It warns and never
 * refuses: the project is set up whichever `rafa` a shell finds.
 *
 * ## The agent warning
 *
 * `vendorableAgents` (`src/agents/vendorable.ts`) then reads the plans
 * under the config's `plan.dir`, and a warning is written for every
 * `agent=` of a still-to-run task that resolves only in
 * `~/.claude/agents` under the resolved `loop.settingSources`, naming
 * the plan, its lines and `rafa agent vendor <name>`. It warns, copies
 * nothing and refuses nothing: `loop start`'s preflight and `rafa plan
 * validate` are where such a name stops a run, and a missing name no
 * user definition carries is left to them, having no vendor fix to
 * name. On a fresh project `plan.dir` holds no plan and nothing is
 * warned.
 *
 * ## What it prints
 *
 * In text mode, the head line naming the root and where it came from,
 * then one line per path created or updated, a path under the root
 * relative to it and a directory ending in `/`, then the release step's
 * line and the board step's own rows. Warnings go through the context's
 * `warn`: a `package.json` the monorepo walk could not read, an unknown
 * config key, the `tracking.all` notice, the `PATH` warning and every
 * sentence the release step and the board step came back with. In json mode the terminal result's `data`
 * is an {@link InitResult}, every path absolute, and each warning a
 * `log` event.
 *
 * ## Seams
 *
 * The working directory, the home, whether standard input is a terminal,
 * the prompter, the roots filesystem, the git probe, the `origin` probe
 * and the `gh` runner are {@link InitSeams}. The terminal and the
 * prompter are what the release step and the board step ask through. The registered command
 * reads `process.cwd()`, `homedir()` and `process.stdin`, prompts on
 * stderr, and spawns git and `gh` in the root. The writes go to the
 * disk, under the root and the home the seams name.
 */
import type { BoardStepResult } from './init-board.js';
import type { ReleaseStepResult } from './init-release.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { VendorableAgent } from '../agents/vendorable.js';
import type { RafaCommand, RafaContext } from '../cli/command.js';
import type { Prompter } from '../cli/prompt/confirm.js';
import type { RafaConfig } from '../config.js';
import type { BinPathReading } from '../project/bin-path.js';
import type { TrackingApplied, TrackingFlags } from '../project/gitignore.js';
import type { ChosenRoot, RootReading, RootSource } from '../project/root-choice.js';
import type { GitToplevelProbe, RefusalSeams, RootCandidates, RootsFileSystem } from '../project/roots.js';
import type { ScopeWrite, ScopeWriteChange } from '../project/scaffold.js';

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';

import { createGhRunner } from '../adapters/tracker/github.js';
import { vendorableAgents, vendorableAgentWarnings } from '../agents/vendorable.js';
import { CommandExit } from '../cli/command.js';
import { createLinePrompter } from '../cli/prompt/confirm.js';
import { loadConfig } from '../config-load.js';
import { messageOf } from '../config-sections.js';
import { ConfigError, configFilePath } from '../config.js';
import { resolvePrProvider } from '../pr/provider.js';
import { readBinPath } from '../project/bin-path.js';
import {
  applyTracking,
  GITIGNORE_FILE,
  GitignoreError,
  TRACKING_DIGEST_FILE,
  withTrackingBlock,
} from '../project/gitignore.js';
import { candidateLines, firstCandidate, namedRoot, promptForRoot } from '../project/root-choice.js';
import { DISK_ROOTS_FILE_SYSTEM, gitToplevel, rootCandidates } from '../project/roots.js';
import { scaffoldConflicts, writeProjectScope, writeUserScope } from '../project/scaffold.js';
import { gitRemoteUrl } from '../schema/project-id.js';

import { boardStepChanged, renderBoardStep, runBoardStep } from './init-board.js';
import { renderReleaseStep, runReleaseStep } from './init-release.js';

/** What `init` reads beside its line; see the module note. */
export interface InitSeams {
  /** The working directory, absolute: candidates are found from it and a relative `--root` resolved against it. */
  readonly cwd: () => string;
  /** The home directory, absolute: the user scope's base, and the base of both bin directories. */
  readonly home: () => string;
  /** True when an answer can be read from a terminal. */
  readonly isTerminal: () => boolean;
  /** Opens the prompter the candidates are listed and answers read through. Called only to prompt. */
  readonly openPrompter: () => Prompter;
  /** The filesystem the candidates and refusals read. */
  readonly fs: RootsFileSystem;
  /** The git probe the candidates read. */
  readonly gitToplevel: GitToplevelProbe;
  /** The `origin` probe the pull request provider is resolved from. */
  readonly readRemote: (dir: string) => string | null;
  /** Opens the runner the board step sends every `gh` command through, in the root. */
  readonly gh: (root: string) => GhRunner;
}

/** The seams the registered command runs with. */
export const DEFAULT_INIT_SEAMS: InitSeams = Object.freeze({
  cwd: () => process.cwd(),
  home: () => homedir(),
  isTerminal: () => process.stdin.isTTY === true,
  openPrompter: () => createLinePrompter(process.stdin, process.stderr),
  fs: DISK_ROOTS_FILE_SYSTEM,
  gitToplevel,
  readRemote: gitRemoteUrl,
  gh: (root: string) => createGhRunner({ cwd: root }),
});

/** What json mode gives as the terminal result's `data`. */
export interface InitResult {
  /** The project root, a real path. */
  readonly root: string;
  /** Where the root came from. */
  readonly source: RootSource;
  /** The working directory `init` ran from. */
  readonly start: string;
  /** True when `.rafa/config.yaml` was already under the root, and left as it was. */
  readonly configExisted: boolean;
  /** True when any write created or updated its path, a board part this run made included. */
  readonly changed: boolean;
  /** Every path checked, in the order written: the project scope, `.gitignore`, the digest, the user scope. */
  readonly writes: readonly ScopeWrite[];
  /** True when the `tracking.all` notice printed. */
  readonly trackingNotice: boolean;
  /** Where `~/.rafa/bin` sits on the `PATH` handed in. */
  readonly binPath: BinPathReading;
  /** Each agent a plan under `plan.dir` routes to that resolves only in `~/.claude/agents`. */
  readonly vendorableAgents: readonly VendorableAgent[];
  /** What the release step came to: the setting it wrote, or why it wrote none (`./init-release.ts`). */
  readonly release: ReleaseStepResult;
  /** What the board step came to: what it made, or why it did not run (`./init-board.ts`). */
  readonly board: BoardStepResult;
}

/** The line every refusal ends with. */
const NOTHING_WRITTEN = 'Nothing was written.';

/** Where each root source came from, as the head line says it. */
const SOURCE_PHRASES: Readonly<Record<RootSource, string>> = {
  'git-toplevel': 'the git toplevel',
  'directory': 'the working directory',
  'monorepo': 'the outermost monorepo root',
  'root-flag': 'named by --root',
  'typed': 'typed at the prompt',
};

/** A refusal with exit code 1 of `lines`, ending with {@link NOTHING_WRITTEN}. */
function refusal(lines: readonly string[]): CommandExit {
  return new CommandExit(1, [...lines, NOTHING_WRITTEN].join('\n'));
}

/** Refuses a line handing `init` a positional word. */
function expectNoArgument(args: readonly string[]): void {
  if (args.length === 0) return;
  const got = `${String(args.length)}: ${args.join(' ')}`;
  throw refusal([`rafa init: expected no argument, got ${got}; name a root with --root=<path>`]);
}

/** The value of `--yes` as a boolean, refusing a value that is neither `true` nor `false`. */
export function readYesFlag(value: string | boolean | undefined): boolean {
  if (value === undefined || value === false || value === 'false') return false;
  if (value === true || value === 'true') return true;
  throw refusal([`rafa init: --yes takes no value, and read "${value}" as one; name a root with --root=<path>`]);
}

/**
 * True for `--board`, false for `--no-board` and null when the line said
 * neither, which leaves the board step to ask. A value refuses: the
 * board is set up or it is not, and `--board=later` names neither.
 */
export function readBoardFlag(value: string | boolean | undefined): boolean | null {
  if (value === undefined) return null;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw refusal([`rafa init: --board takes no value, and read "${value}" as one;`
    + ' set the board up with --board, or leave it alone with --no-board']);
}

/**
 * True for `--release`, false for `--no-release` and null when the line
 * said neither, which leaves the release step to ask. A value refuses,
 * for the reason {@link readBoardFlag} gives.
 */
export function readReleaseFlag(value: string | boolean | undefined): boolean | null {
  if (value === undefined) return null;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw refusal([`rafa init: --release takes no value, and read "${value}" as one;`
    + ' turn the release on with --release, or leave it alone with --no-release']);
}

/** The path `--root` names, or null without the flag, refusing the flag with no path. */
export function readRootFlag(value: string | boolean | undefined): string | null {
  if (value === undefined) return null;
  if (typeof value === 'string' && value !== '') return value;
  throw refusal(['rafa init: --root needs a path: --root=<path>']);
}

/** The root a reading names, or its problem as a refusal listing `found`'s candidates when given. */
function takeReading(reading: RootReading, found: RootCandidates | null): ChosenRoot {
  if (reading.root !== null) return reading.root;
  const listed = found === null
    ? []
    : [...candidateLines(found), 'Name another root with --root=<path>.'];
  throw refusal([`rafa init: refused: ${reading.problem}`, ...listed]);
}

/** Lists the candidates through a prompter and reads a root, refusing when the input ends first. */
async function promptedRoot(found: RootCandidates, seams: InitSeams, refusalSeams: RefusalSeams): Promise<ChosenRoot> {
  const prompter = seams.openPrompter();
  try {
    const root = await promptForRoot(found, prompter, refusalSeams);
    if (root === null) throw refusal(['rafa init: the input ended before a root was chosen.']);
    return root;
  } finally {
    prompter.close();
  }
}

/** The root the line and the seams choose; see the module note. */
async function chooseRoot(
  context: RafaContext,
  seams: InitSeams,
  start: string,
  home: string,
  yes: boolean,
): Promise<ChosenRoot> {
  const named = readRootFlag(context.flags['root']);
  const refusalSeams: RefusalSeams = { home, fs: seams.fs };
  if (named !== null) return takeReading(namedRoot(named, start, 'root-flag', refusalSeams), null);

  const found = rootCandidates(start, { ...refusalSeams, gitToplevel: seams.gitToplevel });
  for (const warning of found.warnings) context.output.warn(warning);
  if (yes) return takeReading(firstCandidate(found), found);
  if (!seams.isTerminal()) {
    throw refusal([
      'rafa init: no terminal to choose a root on.',
      ...candidateLines(found),
      'Take the first candidate with --yes, or name a root with --root=<path>.',
    ]);
  }
  return promptedRoot(found, seams, refusalSeams);
}

/** The config as it resolves for the root, refusing one `loadConfig` refuses. */
function resolvedConfig(root: string, home: string, warn: (message: string) => void): RafaConfig {
  try {
    return loadConfig({ root, home }, {}, warn).config;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    throw refusal(['rafa init: the config cannot be used:', ...error.problems.map((problem) => `  ${problem}`)]);
  }
}

/** Refuses a `.gitignore` under the root that cannot be read or cannot take the entry. */
function checkGitignore(root: string, flags: TrackingFlags): void {
  const file = join(root, GITIGNORE_FILE);
  try {
    const text = existsSync(file)
      ? readFileSync(file, 'utf8')
      : null;
    withTrackingBlock(text, flags, file);
  } catch (error) {
    const message = error instanceof GitignoreError
      ? error.message
      : `rafa init: ${file} cannot be read (${messageOf(error)})`;
    throw refusal([message]);
  }
}

/** Refuses paths the scopes cannot be written at. */
function checkConflicts(root: string, home: string): void {
  const conflicts = scaffoldConflicts(root, home);
  if (conflicts.length === 0) return;
  throw refusal(['rafa init: the scopes cannot be written:', ...conflicts.map((conflict) => `  ${conflict}`)]);
}

/** How the digest was left, from whether it existed and whether the notice rewrote it. */
function digestChange(existed: boolean, rewritten: boolean): ScopeWriteChange {
  if (!rewritten) return 'unchanged';
  return existed
    ? 'updated'
    : 'created';
}

/** The `.gitignore` and digest writes of an `applyTracking` run. */
function trackingWrites(applied: TrackingApplied, digestExisted: boolean): readonly ScopeWrite[] {
  return [
    { path: applied.gitignore.file, kind: 'file', change: applied.gitignore.change },
    { path: applied.notice.digestFile, kind: 'file', change: digestChange(digestExisted, applied.notice.changed) },
  ];
}

/** What the scopes came to, with the config they were written from. */
interface ScopesWritten {
  /** The result, but for the two steps that run once these are on disk. */
  readonly written: Omit<InitResult, 'board' | 'release'>;
  /** The config as it resolved for the root, which the provider is read from. */
  readonly config: RafaConfig;
}

/** Checks, then writes, the scopes for `root`; see the module note for the order. */
function initialise(root: ChosenRoot, start: string, home: string, context: RafaContext): ScopesWritten {
  const warn = (message: string): void => {
    context.output.warn(message);
  };
  checkConflicts(root.path, home);
  const config = resolvedConfig(root.path, home, warn);
  checkGitignore(root.path, config);

  const configExisted = existsSync(configFilePath(root.path));
  const digestExisted = existsSync(join(root.path, TRACKING_DIGEST_FILE));
  const project = writeProjectScope(root.path);
  const tracking = applyTracking(root.path, config, warn);
  const writes = [...project, ...trackingWrites(tracking, digestExisted), ...writeUserScope(home)];

  return {
    written: {
      root: root.path,
      source: root.source,
      start,
      configExisted,
      changed: writes.some((write) => write.change !== 'unchanged'),
      writes,
      trackingNotice: tracking.notice.printed,
      binPath: readBinPath(context.env['PATH'], home),
      vendorableAgents: vendorableAgents({
        repoRoot: root.path,
        home,
        planDir: config.planDir,
        settings: config,
      }),
    },
    config,
  };
}

/**
 * The board step for a project whose scopes are written: the provider
 * read off the config and `origin`, then `./init-board.ts`. It runs LAST
 * for two reasons — the `roadmap.issue` it may write goes into the
 * `.rafa/config.yaml` this run has just made, and nothing it asks or
 * sends can then keep the project from being set up.
 */
async function boardStep(
  scopes: ScopesWritten,
  wanted: boolean | null,
  seams: InitSeams,
): Promise<BoardStepResult> {
  const root = scopes.written.root;
  const provider = resolvePrProvider({
    configured: scopes.config.prProvider,
    dir: root,
    readRemote: seams.readRemote,
  }).provider;

  return runBoardStep({
    wanted,
    provider,
    root,
    openGh: () => seams.gh(root),
    isTerminal: seams.isTerminal,
    openPrompter: seams.openPrompter,
  });
}

/**
 * The release step for a project whose scopes are written: whether this
 * project bumps a version and writes a changelog entry with every pull
 * request, decided and written by `./init-release.ts` as
 * `release.enabled` in the `.rafa/config.yaml` this run has just made.
 * It runs before the board step, which stays the last thing `init`
 * does.
 */
async function releaseStep(
  scopes: ScopesWritten,
  wanted: boolean | null,
  yes: boolean,
  seams: InitSeams,
): Promise<ReleaseStepResult> {
  return runReleaseStep({
    wanted,
    yes,
    root: scopes.written.root,
    settings: scopes.config,
    isTerminal: seams.isTerminal,
    openPrompter: seams.openPrompter,
  });
}

/** A write's path as a line shows it: relative under the root, a directory ending in `/`. */
function shownPath(write: ScopeWrite, root: string): string {
  const shown = write.path.startsWith(`${root}${sep}`)
    ? relative(root, write.path)
    : write.path;
  return write.kind === 'directory'
    ? `${shown}/`
    : shown;
}

/** The lines text mode writes for a result; see the module note. */
export function renderInit(result: InitResult): readonly string[] {
  const where = `${result.root} (${SOURCE_PHRASES[result.source]})`;
  const head = result.configExisted
    ? `${where} is already a rafa project: its .rafa/config.yaml is left as it was.`
    : `Initialised a rafa project at ${where}.`;
  const changed = result.writes
    .filter((write) => write.change !== 'unchanged')
    .map((write) => `  ${write.change}   ${shownPath(write, result.root)}`);
  const steps = [...renderReleaseStep(result.release), ...renderBoardStep(result.board)];
  return result.changed
    ? [head, ...changed, ...steps]
    : [head, ...steps, 'Nothing changed.'];
}

/** Runs `init` with `seams`; see the module note. */
async function runInit(context: RafaContext, seams: InitSeams): Promise<void> {
  expectNoArgument(context.args);
  const wantsBoard = readBoardFlag(context.flags['board']);
  const wantsRelease = readReleaseFlag(context.flags['release']);
  const yes = readYesFlag(context.flags['yes']);
  const start = seams.cwd();
  const home = seams.home();
  const root = await chooseRoot(context, seams, start, home, yes);
  const scopes = initialise(root, start, home, context);
  const release = await releaseStep(scopes, wantsRelease, yes, seams);
  const board = await boardStep(scopes, wantsBoard, seams);
  const result: InitResult = {
    ...scopes.written,
    changed: scopes.written.changed || release.changed || boardStepChanged(board),
    release,
    board,
  };

  if (context.outputMode === 'json') context.output.result(result);
  else for (const line of renderInit(result)) context.output.info(line);
  if (result.binPath.warning !== null) context.output.warn(result.binPath.warning);
  for (const line of release.warnings) context.output.warn(line);
  for (const line of board.warnings) context.output.warn(line);
  for (const line of vendorableAgentWarnings(result.vendorableAgents, result.root)) context.output.warn(line);
}

/** The command, reading `seams`; see the module note. */
export function createInitCommand(seams: InitSeams = DEFAULT_INIT_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'init',
    subject: 'init',
    action: 'init',
    summary: 'set up a rafa project: its root, .rafa/config.yaml, the tree and the .gitignore entry',
    description: 'Sets up a rafa project. On a terminal it lists the root candidates, the git toplevel or'
      + ' the working directory outside a repository and then the outermost monorepo root above it, each'
      + ' refused one with its reason, and reads a candidate number or a path typed freely. `--root=<path>`'
      + ' names the root instead, absolute or relative to the working directory, and `--yes` takes the'
      + ' first candidate; without a terminal one of the two is needed. Under the root it writes'
      + ' `.rafa/config.yaml` with every setting commented out at its default, the tree `specs/`, `plans/`,'
      + ' `runs/`, `effort/` and `instincts/` under `.rafa/`, and the rafa block in `.gitignore` from the'
      + ' `tracking` settings; under the home it writes `~/.rafa/config.yaml` and `~/.rafa/instincts/` when'
      + ' they are missing. Only what is missing or stale is written, so a rerun changes no byte and says'
      + ' so. It warns when `~/.rafa/bin` is not on PATH ahead of `~/.bun/bin`, and when a plan under'
      + ' `plan.dir` routes to an agent that resolves only in `~/.claude/agents`, naming'
      + ' `rafa agent vendor <name>`. A repository whose pull request provider is `gh` ends with one'
      + ' question about setting up the GitHub board, which `--board` and `--no-board` answer for a'
      + ' script. On a terminal it also asks once whether every pull request bumps the version and gains'
      + ' a changelog entry, and writes the answer as `release.enabled`; `--release` and `--no-release`'
      + ' answer that one, and `--yes` leaves it unset. With `--output=json` the'
      + ' root and every path checked are the data of the terminal result event.',
    args: [],
    flags: [
      {
        name: 'root',
        description: 'The project root, absolute or relative to the working directory. No candidate is listed.',
        type: 'string',
      },
      {
        name: 'yes',
        description: 'Take the first root candidate without asking: the git toplevel, or the working directory.',
        type: 'boolean',
      },
      {
        name: 'board',
        description: 'Set up the GitHub board without asking: the labels, `.github/ISSUE_TEMPLATE/spec.md`'
          + ' and a pinned Roadmap issue named by `roadmap.issue`. `--no-board` leaves it alone. Without'
          + ' either, a terminal is asked once and a run with no terminal leaves it alone.',
        type: 'boolean',
      },
      {
        name: 'release',
        description: 'Write `release.enabled: true` without asking, so every pull request bumps'
          + ' `release.versionFile` and gains a `release.changelog` entry. `--no-release` writes `false`.'
          + ' Without either, a terminal is asked once, and `--yes` or a run with no terminal leaves the'
          + ' setting unset at its default `auto`.',
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa init',
        note: 'On a terminal, lists the root candidates and reads a candidate number or a path.',
      },
      {
        cmd: 'rafa init --yes',
        note: 'Takes the first candidate: the git toplevel, or the working directory outside a repository.',
      },
      {
        cmd: 'rafa init --root=../my-monorepo',
        note: 'Sets up the project at the root named, asking nothing.',
      },
      {
        cmd: 'rafa init --yes --release',
        note: 'Takes the first candidate and writes release.enabled: true, asking nothing.',
      },
      {
        cmd: 'rafa init --yes --board',
        note: 'Takes the first candidate and sets up the GitHub board without asking: the labels, the spec'
          + ' issue template and a pinned Roadmap issue. Each part already there is left as it is.',
      },
    ],
    outputs: ['text', 'json'],
    needsProject: false,
    run: async (context) => runInit(context, seams),
  };
  return Object.freeze(command);
}

export default createInitCommand();
