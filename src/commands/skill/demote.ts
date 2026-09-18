/**
 * `rafa skill demote <dir> [--apply]`: the demotion pass over one
 * skills directory, in the two halves the spec separates — a report
 * written with nothing moved, and a reviewed report applied.
 *
 * The work is `src/demote/`'s: `select.ts` answers which directory and
 * which files, `classify.ts` what each file is, `draft.ts` the report a
 * run writes, `report.ts` how it is spelled, and `apply.ts` what a
 * reviewed one does. This module is the declaration, the reading of the
 * line, and the lines a run prints.
 *
 * ## The two halves, and why they are one command
 *
 * Without `--apply` the run classifies every selected file and writes
 * `<base>/.rafa/demoted/report.md`. It moves NOTHING — not a file, not
 * an instinct — which is the whole point of the pass: 124 verdicts made
 * by a rule over a corpus nobody wrote for it are proposals, and the
 * report is where a person settles them. With `--apply` the run reads
 * that report back, refuses it unless the review marked it
 * `status: reviewed`, and carries out what it says.
 *
 * They are one command because they share the one thing that must not
 * drift: the path arithmetic that turns `<dir>` into a scope. Two
 * commands would be two places for `~/.claude/skills` to become
 * `~/.rafa/demoted/`, and a disagreement between them would file
 * records in a directory the report never named.
 *
 * ## The directory decides the scope, and every other directory is refused
 *
 * `<dir>` must be a `<base>/.claude/skills`. `<base>` being the home
 * makes it the user scope, writing to `~/.rafa/`; any other `<base>` is
 * a project scope, writing under that project's `.rafa/`. Nothing else
 * is accepted — the refusal is the reason this command runs INSIDE a
 * project where `rafa skill check` does not: the home is what tells the
 * two scopes apart, and the command reads it off the project the
 * dispatcher resolved, as `rafa skill list` and `rafa instinct list`
 * read theirs.
 *
 * ## The exit code
 *
 * A run that writes the report exits 0 whatever the verdicts say: the
 * report reports. An `--apply` run exits with the number of rows it
 * REFUSED, capped at 255, as `rafa skill check` exits with its failing
 * files; a run that refused nothing exits 0 even when every row was
 * left untouched. Exit code 1 is kept for the refusals that stop the
 * run before it looks at a row: no directory, a second word, an
 * `--apply` that read the directory as its value, a `<dir>` that is no
 * `.claude/skills`, a `<dir>` that is not there, a missing report, a
 * report that does not parse, and a report still marked `draft`.
 */
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { DemotionAction, DemotionActionKind } from '../../demote/apply.js';
import type { DemotionVerdict } from '../../demote/classify.js';
import type { DemotionReport } from '../../demote/report.js';
import type { DemotionScope } from '../../demote/select.js';
import type { ProjectFound } from '../../project/scope.js';
import type { InstinctScope } from '../../schema/instinct.js';

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { pathDirectories } from '../../check/references.js';
import { CommandExit } from '../../cli/command.js';
import { applyDemotion, DEMOTION_ACTION_KINDS, planDemotion } from '../../demote/apply.js';
import { DEMOTION_VERDICTS } from '../../demote/classify.js';
import { buildDemotionReport } from '../../demote/draft.js';
import {
  countVerdicts,
  parseDemotionReport,
  REVIEWED_STATUS,
  writeDemotionReport,
} from '../../demote/report.js';
import { resolveDemotionScope, selectSources } from '../../demote/select.js';

/** The one thing neither the context nor the registry carries. */
export interface SkillDemoteSeams {
  /** The working directory `<dir>` is resolved against. */
  readonly cwd: () => string;
}

/** The seams the registered command runs with. */
export const DEFAULT_DEMOTE_SEAMS: SkillDemoteSeams = Object.freeze({
  cwd: () => process.cwd(),
});

/** The usage line every refusal names. */
export const DEMOTE_USAGE = 'rafa skill demote <dir> [--apply]';

/** The exit code of a run that refused more rows than a code can carry. */
export const REFUSED_ROW_CAP = 255;

/** What json mode gives as the terminal result's `data` for a run that wrote the report. */
export interface SkillDemoteWriteResult {
  /** Whether the run applied the report. Always false here. */
  readonly applied: false;
  /** Which scope the directory is. */
  readonly scope: InstinctScope;
  /** The skills directory, resolved against the working directory. */
  readonly dir: string;
  /** The report written. */
  readonly reportPath: string;
  /** The status it carries: `draft`, or `reviewed` where a matching review survived. */
  readonly status: string;
  /** How many files were selected. */
  readonly files: number;
  /** How many rows carry each verdict, the override where a row has one. */
  readonly counts: Readonly<Record<DemotionVerdict, number>>;
}

/** What json mode gives as the terminal result's `data` for a clean `--apply` run. */
export interface SkillDemoteApplyResult {
  /** Whether the run applied the report. Always true here. */
  readonly applied: true;
  /** Which scope the directory is. */
  readonly scope: InstinctScope;
  /** The skills directory, resolved against the working directory. */
  readonly dir: string;
  /** The report applied. */
  readonly reportPath: string;
  /** One entry per row, in report order. */
  readonly actions: readonly DemotionAction[];
  /** How many rows came to each kind. */
  readonly counts: Readonly<Record<DemotionActionKind, number>>;
}

/** What json mode gives as the terminal result's `data`. */
export type SkillDemoteResult = SkillDemoteApplyResult | SkillDemoteWriteResult;

/** The value of `--apply` as a boolean, refusing a value the flag cannot take. */
export function readApply(value: string | boolean | undefined): boolean {
  if (value === undefined || value === false || value === 'false') return false;
  if (value === true || value === 'true') return true;
  throw new CommandExit(
    1,
    `❌ --apply takes no value, and read "${value}" as one; type it after the directory`
    + `\nUsage: ${DEMOTE_USAGE}`,
  );
}

/** The directory the line names, resolved against `cwd`. */
export function readDemoteDirectory(args: readonly string[], cwd: () => string): string {
  const [dir, extra] = args;
  if (dir === undefined) {
    throw new CommandExit(1, `❌ Expected a skills directory, got none\nUsage: ${DEMOTE_USAGE}`);
  }
  if (extra !== undefined) {
    throw new CommandExit(1, `❌ Expected one directory, and read "${extra}" as a second\nUsage: ${DEMOTE_USAGE}`);
  }
  return resolve(cwd(), dir);
}

/** Whether a path is a directory, with anything unreadable answering false. */
function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The scope `<dir>` is, or exit 1 naming the two shapes that are accepted. */
export function demotionScopeOf(dir: string, home: string): DemotionScope {
  const scope = resolveDemotionScope(dir, home);
  if (scope === null) {
    throw new CommandExit(
      1,
      `❌ ${dir} is no skills directory: the pass runs over ${home}/.claude/skills, which is the user`
      + ' scope, or over a project\'s <root>/.claude/skills, and writes under the matching <base>/.rafa/'
      + `\nUsage: ${DEMOTE_USAGE}`,
    );
  }
  if (!isDirectory(dir)) {
    throw new CommandExit(1, `❌ ${dir} is not a directory\nUsage: ${DEMOTE_USAGE}`);
  }
  return scope;
}

/** The project the dispatcher resolved, which this command declares it needs. */
function projectOf(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error('rafa skill demote runs inside a project, and was handed none');
  return context.project;
}

/** A line of counts: `124 file(s): 81 observation, 29 procedure, 14 unclassified`. */
export function verdictLine(report: DemotionReport): string {
  const counts = countVerdicts(report.rows);
  const parts = DEMOTION_VERDICTS.map((verdict) => `${String(counts[verdict])} ${verdict}`);
  return `${String(report.rows.length)} file(s): ${parts.join(', ')}`;
}

/** The report already at `path`, or null when there is none and none that parses. */
function previousReport(path: string, context: RafaContext): DemotionReport | null {
  if (!existsSync(path)) return null;

  const parsed = parseDemotionReport(readFileSync(path, 'utf8'));
  if (parsed.report !== null) return parsed.report;

  context.output.warn(
    `the report already at ${path} does not parse, so no override in it is carried forward:`
    + ` ${parsed.issues.map((issue) => `line ${String(issue.line)} ${issue.code}`).join(', ')}`,
  );
  return null;
}

/** Writes the report and says what it holds. Moves nothing; see the module note. */
function runWrite(context: RafaContext, scope: DemotionScope): void {
  const files = selectSources(scope);
  const report = buildDemotionReport(files, previousReport(scope.reportPath, context));

  mkdirSync(dirname(scope.reportPath), { recursive: true });
  writeFileSync(scope.reportPath, writeDemotionReport(report), 'utf8');

  const result: SkillDemoteWriteResult = {
    applied: false,
    scope: scope.scope,
    dir: scope.dir,
    reportPath: scope.reportPath,
    status: report.status,
    files: report.rows.length,
    counts: countVerdicts(report.rows),
  };
  if (context.outputMode === 'json') {
    context.output.result(result);
    return;
  }
  for (const line of [
    `${scope.scope} scope: ${scope.dir}`,
    verdictLine(report),
    `Report written to ${scope.reportPath} (status: ${report.status}); nothing was moved`,
    `Review each row, then mark the report ${REVIEWED_STATUS} and re-run with --apply`,
  ]) context.output.info(line);
}

/** The report `--apply` acts on, or exit 1 saying why it may not. */
function reviewedReport(scope: DemotionScope): DemotionReport {
  if (!existsSync(scope.reportPath)) {
    throw new CommandExit(
      1,
      `❌ No report at ${scope.reportPath}; run "rafa skill demote ${scope.dir}" first, then review it`,
    );
  }

  const parsed = parseDemotionReport(readFileSync(scope.reportPath, 'utf8'));
  if (parsed.report === null) {
    const lines = parsed.issues.map((issue) => `   line ${String(issue.line)} ${issue.code}: ${issue.message}`);
    throw new CommandExit(1, [`❌ ${scope.reportPath} does not parse:`, ...lines].join('\n'));
  }
  if (parsed.report.status !== REVIEWED_STATUS) {
    throw new CommandExit(
      1,
      `❌ ${scope.reportPath} is still "${parsed.report.status}", and --apply acts on a reviewed report alone;`
      + ` decide every row, then set "status: ${REVIEWED_STATUS}" in its header`,
    );
  }
  return parsed.report;
}

/** The marker an action's line opens with, or null for one that prints nothing. */
export function actionMarker(action: DemotionAction): string | null {
  if (action.kind === 'refused') return '❌';
  if (action.kind === 'demoted') return '✅';
  return action.move === null
    ? null
    : '🔧';
}

/** Every line an `--apply` run prints: the rows that did something, then the counts. */
export function renderApply(result: SkillDemoteApplyResult): readonly string[] {
  const rows = result.actions.flatMap((action) => {
    const marker = actionMarker(action);
    return marker === null
      ? []
      : [`${marker} ${action.path}: ${action.detail}`];
  });
  const parts = DEMOTION_ACTION_KINDS.map((kind) => `${String(result.counts[kind])} ${kind}`);
  return [...rows, `${String(result.actions.length)} row(s) of ${result.reportPath}: ${parts.join(', ')}`];
}

/** Applies the reviewed report. See the module note on the exit code. */
function runApply(context: RafaContext, scope: DemotionScope): void {
  const report = reviewedReport(scope);
  const plan = planDemotion(report, scope, {
    now: () => new Date().toISOString(),
    pathDirs: pathDirectories(context.env['PATH']),
  });
  applyDemotion(plan);

  const result: SkillDemoteApplyResult = {
    applied: true,
    scope: scope.scope,
    dir: scope.dir,
    reportPath: scope.reportPath,
    actions: plan.actions,
    counts: plan.counts,
  };
  const lines = renderApply(result);
  if (plan.counts.refused > 0) {
    throw new CommandExit(Math.min(plan.counts.refused, REFUSED_ROW_CAP), lines.join('\n'));
  }
  if (context.outputMode === 'json') {
    context.output.result(result);
    return;
  }
  for (const line of lines) context.output.info(line);
}

/** Runs one invocation. See the module note. */
function runDemote(context: RafaContext, seams: SkillDemoteSeams): void {
  const apply = readApply(context.flags['apply']);
  const dir = readDemoteDirectory(context.args, seams.cwd);
  const scope = demotionScopeOf(dir, projectOf(context).home);

  if (apply) {
    runApply(context, scope);
    return;
  }
  runWrite(context, scope);
}

/** The command, resolving `<dir>` through `seams`. See the module note. */
export function createSkillDemoteCommand(seams: SkillDemoteSeams = DEFAULT_DEMOTE_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'skill demote',
    subject: 'skill',
    action: 'demote',
    summary: 'classify a skills directory into the demotion report, and apply a reviewed one',
    description: 'Runs the demotion pass over one skills directory. Without `--apply` it classifies every'
      + ' skill the directory registers, and every `learned/` file it holds, as observation-shaped,'
      + ' procedure-shaped or unclassified, and writes `<base>/.rafa/demoted/report.md` with one row per'
      + ' file carrying its hash, its verdict, the rule that decided it and two empty override columns —'
      + ' moving nothing at all, since every verdict is a proposal a person settles. With `--apply` it'
      + ' reads that report back and refuses it unless the review marked it `status: reviewed`: each'
      + ' observation becomes an instinct under `<base>/.rafa/instincts/`, checked by the same checker'
      + ' `rafa instinct check` runs BEFORE it is written, with the original kept under'
      + ' `<base>/.rafa/demoted/` so a wrong verdict is a `mv`; each procedure stays a skill; and an'
      + ' unclassified row the review did not decide is left alone. A row whose file changed since the'
      + ' report, and a record the checker fails, are refused one row at a time, and the exit code is the'
      + ' number of rows refused, capped at 255. `<dir>` is `~/.claude/skills` or a project\'s'
      + ' `.claude/skills`, and anything else is refused. A second `--apply` over an applied report'
      + ' changes nothing. With `--output=json` the counts, or the per-row actions, are the data of the'
      + ' terminal result event.',
    args: [
      {
        name: 'dir',
        description: 'The skills directory to pass over: `~/.claude/skills` or a project\'s `.claude/skills`.',
        type: 'string',
        required: true,
      },
    ],
    flags: [
      {
        name: 'apply',
        description: 'Carry out a reviewed report: write the instincts, and move the originals under `.rafa/demoted/`.',
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa skill demote ~/.claude/skills',
        note: 'Classifies the user tier into `~/.rafa/demoted/report.md`, moving nothing.',
      },
      {
        cmd: 'rafa skill demote ~/.claude/skills --apply',
        note: 'Applies that report once its header says `status: reviewed`, refusing any row whose file changed.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      runDemote(context, seams);
    },
  };
  return Object.freeze(command);
}

export default createSkillDemoteCommand();
