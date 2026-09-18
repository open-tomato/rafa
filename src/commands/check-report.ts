/**
 * What `rafa skill check` and `rafa instinct check` share: the words
 * they read off a line, the seams they hand `src/check/run.ts`, the
 * lines they print, and the exit code they refuse with.
 *
 * The two commands differ in exactly three things — the {@link
 * CheckKind} they scan a directory as, the usage line a refusal names,
 * and whether `--fix` and `--project` are on the line at all — so the
 * runner is written once here and each command is its declaration plus
 * a call.
 *
 * ## The seams, and why no project is resolved
 *
 * Both commands declare `needsProject: false`. The checker's project
 * seam is `--project=<root>` and nothing else: a tier being checked is
 * often `~/.claude/skills`, which sits in no project, and the walk the
 * dispatcher would do from the working directory would answer a
 * project that has nothing to do with the directory named. Without the
 * flag {@link CheckOptions.projectRoot} is null, and every
 * project-looking path in a body is counted `unchecked-path`, a
 * warning that never reaches the exit code. `rafa instinct check`
 * declares no `--project` at all, so its runs always read that way.
 *
 * `PATH` is read off the context's `env`, which the dispatcher copies
 * from the environment it was handed, so a test points the tool lookup
 * at a directory of its own by dispatching with an `env` of its own.
 * The directory argument and `--project` are resolved against
 * {@link CheckCommandSeams.cwd}, which is the one thing neither the
 * context nor the registry carries.
 *
 * ## What is printed, and where a failing run's detail goes
 *
 * A clean entry prints nothing: a tier holds hundreds of files and the
 * answer worth reading is the ones that broke a rule. An entry with
 * issues prints its path and one line per issue, in
 * `CHECK_STAGES` order, and the run closes with a count.
 *
 * On a failing run those lines are the message of the
 * {@link CommandExit}, not `info` lines, which is `rafa doctor`'s
 * shape for a refusal that has to say what it found. It is also the
 * only shape that survives json mode: the dispatcher drops a nonzero
 * exit's `result` payload (`cli/dispatch.ts`), so a structured report
 * emitted there would be thrown away, while the message becomes the
 * terminal error's. So {@link CheckCommandResult} is given as the
 * result payload on a CLEAN run alone, and a failing run says
 * everything in its message.
 *
 * ## The flags are read before the directory
 *
 * `parseArgs` gives a flag the next word as its value unless that word
 * opens with `-`, whatever type the flag declares, so
 * `rafa skill check --fix ~/.claude/skills` reads the directory as the
 * value of `--fix` and leaves the command no argument at all. The
 * flags are therefore read FIRST, as `rafa agent vendor` reads
 * `--force` ahead of its names and for its reason: that line then
 * meets the refusal naming the order that works, rather than the one
 * saying it named no directory, which is true of it and says nothing
 * about why.
 *
 * ## The exit code
 *
 * The number of failing entries, capped at 255
 * (`FAILING_FILE_CAP`), which is `checkDirectory`'s own
 * `exitCode`. Warnings never count, so a user tier full of
 * `unchecked-path` and a skills directory with a `.DS_Store`-only
 * subdirectory both exit 0. Exit code 1 is kept for the refusals:
 * a line naming no directory or more than one, a `--fix` or
 * `--project` value the flag cannot take, and a directory the scan
 * finds nothing to scan at.
 */
import type { CheckKind } from '../check/layout.js';
import type { CheckIssue, CheckOptions, CheckReport, DirectoryReport } from '../check/run.js';
import type { RafaCommand, RafaContext } from '../cli/command.js';

import { resolve } from 'node:path';

import { pathDirectories } from '../check/references.js';
import { checkDirectory } from '../check/run.js';
import { CommandExit } from '../cli/command.js';

/** Answers the directory a relative path on the line is resolved against. */
export type Cwd = () => string;

/** The one thing neither the context nor the registry carries. */
export interface CheckCommandSeams {
  /** The working directory `<dir>` and `--project` are resolved against. */
  readonly cwd: Cwd;
}

/** The seams every command built here runs with by default. */
export const DEFAULT_CHECK_SEAMS: CheckCommandSeams = Object.freeze({
  cwd: () => process.cwd(),
});

/** What json mode gives as a clean run's terminal result `data`. */
export interface CheckCommandResult {
  /** Which directory it was checked as. */
  readonly kind: CheckKind;
  /** The directory, resolved against the working directory. */
  readonly root: string;
  /** The project a body was resolved in, or null when the line named none. */
  readonly projectRoot: string | null;
  /** One entry per path the layout scan found, in path order. */
  readonly reports: readonly CheckReport[];
  /** How many entries failed, uncapped. */
  readonly failingFiles: number;
  /** How many entries carry a warning and no failure. */
  readonly warningFiles: number;
}

/** The usage line `rafa skill check` refusals name. */
export const SKILL_CHECK_USAGE = 'rafa skill check <dir> [--fix] [--project=<root>]';

/** The usage line `rafa instinct check` refusals name. */
export const INSTINCT_CHECK_USAGE = 'rafa instinct check <dir>';

/**
 * The directory the line names, resolved against `cwd`. Exits 1 on a
 * line naming none and on one naming a second word, which is a
 * mistyped flag often enough to be worth naming rather than ignoring.
 */
export function readCheckDirectory(args: readonly string[], usage: string, cwd: Cwd): string {
  const [dir, extra] = args;
  if (dir === undefined) {
    throw new CommandExit(1, `❌ Expected a directory to check, got none\nUsage: ${usage}`);
  }
  if (extra !== undefined) {
    throw new CommandExit(1, `❌ Expected one directory, and read "${extra}" as a second\nUsage: ${usage}`);
  }
  return resolve(cwd(), dir);
}

/** The value of `--fix` as a boolean, refusing a value the flag cannot take. */
export function readFix(value: string | boolean | undefined, usage: string): boolean {
  if (value === undefined || value === false || value === 'false') return false;
  if (value === true || value === 'true') return true;
  throw new CommandExit(
    1,
    `❌ --fix takes no value, and read "${value}" as one; type it after the directory\nUsage: ${usage}`,
  );
}

/**
 * The project root `--project` names, resolved against `cwd`, or null
 * when the line left the flag out. A bare `--project` is refused: a
 * project root is a path, and reading a missing one as "no project"
 * would quietly turn every project path into a warning.
 */
export function readProjectRoot(value: string | boolean | undefined, usage: string, cwd: Cwd): string | null {
  if (value === undefined || value === false) return null;
  if (value === true || value === '') {
    throw new CommandExit(1, `❌ --project needs a path, and the line gave it none\nUsage: ${usage}`);
  }
  return resolve(cwd(), value);
}

/** The marker an entry's line opens with: a failure, a warning, or a fix. */
export function reportMarker(report: CheckReport): string {
  if (report.failed) return '❌';
  return report.fixed.length > 0
    ? '🔧'
    : '⚠️';
}

/** What an issue names after its stage: its field, its body line, or nothing. */
function issueWhere(issue: CheckIssue): string {
  if (issue.field !== null) return ` (${issue.field})`;
  return issue.line === null
    ? ''
    : ` (line ${String(issue.line)})`;
}

/** One issue as a line under its entry: the stage, the code, where, and the message. */
export function issueLine(issue: CheckIssue): string {
  return `   ${issue.stage} ${issue.code}${issueWhere(issue)}: ${issue.message}`;
}

/** An entry with something to say, as its path line and one line per issue. */
export function reportLines(report: CheckReport): readonly string[] {
  const fixed = report.fixed.length === 0
    ? ''
    : ` (filled ${report.fixed.join(', ')})`;
  return [
    `${reportMarker(report)} ${report.path}${fixed}`,
    ...report.issues.map(issueLine),
  ];
}

/** How many entries carry a warning and no failure. */
export function warningFileCount(reports: readonly CheckReport[]): number {
  return reports.filter((report) => !report.failed && report.issues.length > 0).length;
}

/** The count a run closes with. */
export function summaryLine(result: CheckCommandResult): string {
  return `${String(result.reports.length)} ${result.kind}(s) checked under ${result.root}:`
    + ` ${String(result.failingFiles)} failing, ${String(result.warningFiles)} with warnings`;
}

/** Every line a run prints: the entries with something to say, then the count. */
export function renderCheck(result: CheckCommandResult): readonly string[] {
  const entries = result.reports
    .filter((report) => report.issues.length > 0 || report.fixed.length > 0)
    .flatMap((report) => reportLines(report));
  return [...entries, summaryLine(result)];
}

/** A directory report as the result a clean run gives and a failing one prints. */
export function checkCommandResult(report: DirectoryReport, projectRoot: string | null): CheckCommandResult {
  return {
    kind: report.kind,
    root: report.root,
    projectRoot,
    reports: report.reports,
    failingFiles: report.failingFiles,
    warningFiles: warningFileCount(report.reports),
  };
}

/** The directory checked, or exit 1 naming the path the scan found nothing at. */
function scan(root: string, kind: CheckKind, options: CheckOptions, usage: string): DirectoryReport {
  try {
    return checkDirectory(root, kind, options);
  } catch (error) {
    const reason = error instanceof Error
      ? error.message
      : String(error);
    throw new CommandExit(1, `❌ ${usage}: ${reason}`);
  }
}

/** What one command hands the runner beside its context. */
export interface CheckCommandSpec {
  /** Which directory the line's argument is scanned as. */
  readonly kind: CheckKind;
  /** The usage line its refusals name. */
  readonly usage: string;
  /** Whether it declares `--fix` and `--project`. */
  readonly writes: boolean;
}

/** Runs one check command. See the module note. */
export async function runCheckCommand(
  context: RafaContext,
  spec: CheckCommandSpec,
  seams: CheckCommandSeams,
): Promise<void> {
  const fix = spec.writes && readFix(context.flags['fix'], spec.usage);
  const projectRoot = spec.writes
    ? readProjectRoot(context.flags['project'], spec.usage, seams.cwd)
    : null;
  const root = readCheckDirectory(context.args, spec.usage, seams.cwd);

  const report = scan(root, spec.kind, {
    projectRoot,
    pathDirs: pathDirectories(context.env['PATH']),
    fix,
  }, spec.usage);
  const result = checkCommandResult(report, projectRoot);
  const lines = renderCheck(result);

  if (report.exitCode > 0) throw new CommandExit(report.exitCode, lines.join('\n'));

  if (context.outputMode === 'json') {
    context.output.result(result);
    return;
  }
  for (const line of lines) context.output.info(line);
}

/** The `run` one check command declares, bound to its spec and seams. */
export function checkCommandRun(
  spec: CheckCommandSpec,
  seams: CheckCommandSeams,
): RafaCommand['run'] {
  return async (context) => {
    await runCheckCommand(context, spec, seams);
  };
}
