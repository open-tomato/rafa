/**
 * `rafa skill backfill <dir> [--propose|--apply] [--project=<root>]`:
 * the backfill over one skills directory, in the three halves the spec
 * separates — what the deterministic derivation WOULD write, the
 * proposal pass that asks a session for what no table can derive, and
 * the apply that writes the reviewed proposals and then derives.
 *
 * The work is `src/backfill/`'s: `derive.ts` answers `stack`, `paths`
 * and `when_to_use` from tables and from a skill's own bytes,
 * `proposal-batch.ts` selects and batches what a session is asked,
 * `propose.ts` runs the sessions and applies the reviewed answers, and
 * `backup.ts` takes the copy that makes a rewrite reversible. This
 * module is the declaration, the reading of the line, and the lines a
 * run prints.
 *
 * ## The three modes, and why they are one command
 *
 * Without a flag the run PLANS: it reads every skill, answers what the
 * derivation would write and how many files a proposal pass would ask
 * about, and writes nothing at all. With `--propose` it runs the
 * sessions and writes one `proposals-<nn>.yaml` per batch of twenty,
 * each `status: draft`, touching no skill. With `--apply` it reads
 * those files back, writes every reviewed row into its skill, and then
 * runs the derivation over the result — in that order, because
 * `when_to_use` is derived from the `prevents` the proposals wrote and
 * a derivation running first would have nothing to build it from.
 *
 * They are one command because they share the arithmetic that must not
 * drift: `<dir>` is a `<base>/.claude/skills`, and everything the pass
 * writes outside the skills directory — the proposal files and the
 * backups — goes under that one `<base>/.rafa/backfill/`. Three
 * commands would be three places for `~/.claude/skills` to become
 * `~/.rafa/`, and a disagreement between them would read proposals
 * from a directory no session ever wrote to.
 *
 * ## Every rewritten file outside the checkout is copied first
 *
 * An `--apply` run copies each file it is about to rewrite to
 * `<base>/.rafa/backfill/backup/<relative path>` before the write, both
 * for the proposal rows and for the derivation
 * (`src/backfill/backup.ts`). A file under the checkout the command
 * runs in is not copied: git holds it, and the loop commits the pass's
 * edits like any task's. The copies are taken BEFORE the writes rather
 * than per write, so a run that dies between two files has a copy of
 * both.
 *
 * ## `--project` is the tier's consumer, as it is for the checker
 *
 * Both halves of an apply re-check every file they wrote with
 * `checkFile` and put back anything that came out worse, and a body's
 * paths resolve against the checkout the bodies are CONSUMED in, not
 * against the one the command runs in. `--project=<root>` is that
 * checkout, exactly as `rafa skill check --project` is, and without it
 * a project-looking path in a body is left unchecked.
 *
 * ## The exit code
 *
 * A plan run and a `--propose` run exit 0 whatever they found: both
 * report. An `--apply` run exits with the number of rows and files it
 * REFUSED, capped at 255, as `rafa skill demote --apply` does. Exit
 * code 1 is kept for the refusals that stop the run before it looks at
 * a file: no directory, a second word, `--propose` and `--apply`
 * together, a flag that read the directory as its value, a bare
 * `--project`, a `<dir>` that is no `.claude/skills`, a `<dir>` that is
 * not there, and a proposal file that does not parse.
 */
import type { BackupResult } from '../../backfill/backup.js';
import type { DerivationAction, DerivationKind, DerivationOptions, DerivationPlan } from '../../backfill/derive.js';
import type { ProposalFile } from '../../backfill/proposal-file.js';
import type { ProposalAction, ProposalActionKind } from '../../backfill/propose.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { DemotionScope } from '../../demote/select.js';
import type { ProjectFound } from '../../project/scope.js';
import type { InstinctScope } from '../../schema/instinct.js';
import type { CapturingSpawner } from '../../utils/claude.js';

import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { backupDirectory, backupFiles, countBackups } from '../../backfill/backup.js';
import { applyDerivation, countDerivations, DERIVATION_KINDS, planDerivation } from '../../backfill/derive.js';
import { selectProposals } from '../../backfill/proposal-batch.js';
import { ANSWERED_ROW, BACKFILL_PATH, readProposalFiles, REVIEWED_FILE } from '../../backfill/proposal-file.js';
import {
  applyProposals,
  PROPOSAL_ACTION_KINDS,
  runProposalPass,
} from '../../backfill/propose.js';
import { pathDirectories } from '../../check/references.js';
import { CommandExit } from '../../cli/command.js';
import { loadConfig } from '../../config-load.js';
import { resolveDemotionScope } from '../../demote/select.js';

/** The two things neither the context nor the registry carries. */
export interface SkillBackfillSeams {
  /** The working directory `<dir>` and `--project` are resolved against. */
  readonly cwd: () => string;
  /** The spawner each proposal session runs through, the real capturing one by default. */
  readonly spawn?: CapturingSpawner;
}

/** The seams the registered command runs with. */
export const DEFAULT_BACKFILL_SEAMS: SkillBackfillSeams = Object.freeze({
  cwd: () => process.cwd(),
});

/** The usage line every refusal names. */
export const BACKFILL_USAGE = 'rafa skill backfill <dir> [--propose|--apply] [--project=<root>]';

/** The exit code of a run that refused more rows than a code can carry. */
export const REFUSED_CAP = 255;

/** Which half of the backfill a run is. */
export type BackfillMode = 'plan' | 'propose' | 'apply';

/** One action as json mode gives it, without the file bodies a plan carries. */
export interface BackfillActionData {
  /** The file, absolute. */
  readonly path: string;
  /** What happened, or would happen, to it. */
  readonly kind: string;
  /** The one line the text mode run prints for it. */
  readonly detail: string;
  /** The fields written, with their values. */
  readonly changes: Readonly<Record<string, unknown>>;
}

/** What every mode's result carries. */
interface BackfillResultBase {
  /** Which half the run was. */
  readonly mode: BackfillMode;
  /** Which scope the directory is. */
  readonly scope: InstinctScope;
  /** The skills directory, resolved against the working directory. */
  readonly dir: string;
  /** `<base>/.rafa/backfill`, which the proposals and the backups go under. */
  readonly backfillDir: string;
}

/** What json mode gives as the terminal result's `data` for a run that wrote nothing. */
export interface SkillBackfillPlanResult extends BackfillResultBase {
  readonly mode: 'plan';
  /** One entry per file the derivation looked at, in path order. */
  readonly actions: readonly BackfillActionData[];
  /** How many files came to each derivation kind. */
  readonly counts: Readonly<Record<DerivationKind, number>>;
  /** How many files a proposal pass would ask a session about. */
  readonly candidates: number;
}

/** One proposal file, as json mode names it. */
export interface BackfillProposalFileData {
  /** The file, absolute. */
  readonly path: string;
  /** Which batch it holds, 1-based. */
  readonly batch: number;
  /** The exit code of the session that answered it. */
  readonly exitCode: number;
  /** How many rows it holds. */
  readonly rows: number;
  /** How many of those rows carry no answer. */
  readonly unanswered: number;
}

/** What json mode gives as the terminal result's `data` for a `--propose` run. */
export interface SkillBackfillProposeResult extends BackfillResultBase {
  readonly mode: 'propose';
  /** How many files the pass had something to ask about. */
  readonly candidates: number;
  /** One entry per file written, in batch order. */
  readonly files: readonly BackfillProposalFileData[];
}

/** What json mode gives as the terminal result's `data` for a clean `--apply` run. */
export interface SkillBackfillApplyResult extends BackfillResultBase {
  readonly mode: 'apply';
  /** One entry per proposal row, in file and then row order. */
  readonly proposals: readonly BackfillActionData[];
  /** How many rows came to each kind. */
  readonly proposalCounts: Readonly<Record<ProposalActionKind, number>>;
  /** One entry per file the derivation looked at, in path order. */
  readonly derivation: readonly BackfillActionData[];
  /** How many files came to each derivation kind. */
  readonly derivationCounts: Readonly<Record<DerivationKind, number>>;
  /** How many files were copied before they were rewritten. */
  readonly backups: number;
}

/** What json mode gives as the terminal result's `data`. */
export type SkillBackfillResult =
  | SkillBackfillApplyResult
  | SkillBackfillPlanResult
  | SkillBackfillProposeResult;

/** The value of a boolean flag, refusing a value it cannot take. */
export function readSwitch(name: string, value: string | boolean | undefined): boolean {
  if (value === undefined || value === false || value === 'false') return false;
  if (value === true || value === 'true') return true;
  throw new CommandExit(
    1,
    `❌ --${name} takes no value, and read "${value}" as one; type it after the directory`
    + `\nUsage: ${BACKFILL_USAGE}`,
  );
}

/** Which half the flags name, refusing the pair that names two. */
export function readMode(flags: Readonly<Record<string, string | boolean | undefined>>): BackfillMode {
  const propose = readSwitch('propose', flags['propose']);
  const apply = readSwitch('apply', flags['apply']);
  if (propose && apply) {
    throw new CommandExit(
      1,
      '❌ --propose asks the sessions and --apply writes their reviewed answers, so a run is one or the'
      + ` other\nUsage: ${BACKFILL_USAGE}`,
    );
  }
  if (propose) return 'propose';
  return apply
    ? 'apply'
    : 'plan';
}

/** The directory the line names, resolved against `cwd`. */
export function readBackfillDirectory(args: readonly string[], cwd: () => string): string {
  const [dir, extra] = args;
  if (dir === undefined) {
    throw new CommandExit(1, `❌ Expected a skills directory, got none\nUsage: ${BACKFILL_USAGE}`);
  }
  if (extra !== undefined) {
    throw new CommandExit(1, `❌ Expected one directory, and read "${extra}" as a second\nUsage: ${BACKFILL_USAGE}`);
  }
  return resolve(cwd(), dir);
}

/** The project root `--project` names, or null when the line left it out. */
export function readConsumerRoot(
  value: string | boolean | undefined,
  cwd: () => string,
): string | null {
  if (value === undefined || value === false) return null;
  if (value === true || value === '') {
    throw new CommandExit(1, `❌ --project needs a path, and the line gave it none\nUsage: ${BACKFILL_USAGE}`);
  }
  return resolve(cwd(), value);
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
export function backfillScopeOf(dir: string, home: string): DemotionScope {
  const scope = resolveDemotionScope(dir, home);
  if (scope === null) {
    throw new CommandExit(
      1,
      `❌ ${dir} is no skills directory: the backfill runs over ${home}/.claude/skills, which is the user`
      + ' scope, or over a project\'s <root>/.claude/skills, and writes its proposals and its backups under'
      + ` the matching <base>/.rafa/backfill/\nUsage: ${BACKFILL_USAGE}`,
    );
  }
  if (!isDirectory(dir)) {
    throw new CommandExit(1, `❌ ${dir} is not a directory\nUsage: ${BACKFILL_USAGE}`);
  }
  return scope;
}

/** The project the dispatcher resolved, which this command declares it needs. */
function projectOf(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error('rafa skill backfill runs inside a project, and was handed none');
  return context.project;
}

/** One derivation or proposal action, as json mode names it. */
function actionData(action: DerivationAction | ProposalAction): BackfillActionData {
  return { path: action.path, kind: action.kind, detail: action.detail, changes: action.changes };
}

/** A line of derivation counts: `12 file(s): 3 derived, 9 unchanged, ...`. */
export function derivationLine(plan: DerivationPlan): string {
  const parts = DERIVATION_KINDS.map((kind) => `${String(plan.counts[kind])} ${kind}`);
  return `${String(plan.actions.length)} file(s): ${parts.join(', ')}`;
}

/** A line of proposal counts: `20 row(s): 14 applied, 4 unchanged, ...`. */
export function proposalLine(
  rows: number,
  counts: Readonly<Record<ProposalActionKind, number>>,
): string {
  const parts = PROPOSAL_ACTION_KINDS.map((kind) => `${String(counts[kind])} ${kind}`);
  return `${String(rows)} row(s): ${parts.join(', ')}`;
}

/** The marker an action's line opens with, or null for one that prints nothing. */
export function actionMarker(kind: string): string | null {
  if (kind === 'refused') return '❌';
  if (kind === 'derived' || kind === 'applied') return '🔧';
  return null;
}

/** Every action with something to say, one line each. */
function actionLines(actions: readonly BackfillActionData[]): readonly string[] {
  return actions.flatMap((action) => {
    const marker = actionMarker(action.kind);
    return marker === null
      ? []
      : [`${marker} ${action.path}: ${action.detail}`];
  });
}

/** What every mode resolves the checker against. */
function checkOptions(context: RafaContext, projectRoot: string | null): DerivationOptions {
  return { projectRoot, pathDirs: pathDirectories(context.env['PATH']) };
}

/** The result event in json mode, the lines on stdout otherwise. */
function report(context: RafaContext, result: SkillBackfillResult, lines: readonly string[]): void {
  if (context.outputMode === 'json') {
    context.output.result(result);
    return;
  }
  for (const line of lines) context.output.info(line);
}

/** Plans the derivation and counts what a proposal pass would ask. Writes nothing. */
function runPlan(
  context: RafaContext,
  scope: DemotionScope,
  backfillDir: string,
  projectRoot: string | null,
): void {
  const plan = planDerivation(scope.dir, checkOptions(context, projectRoot));
  const candidates = selectProposals(scope.dir).length;
  const actions = plan.actions.map(actionData);
  const result: SkillBackfillPlanResult = {
    mode: 'plan',
    scope: scope.scope,
    dir: scope.dir,
    backfillDir,
    actions,
    counts: plan.counts,
    candidates,
  };

  report(context, result, [
    `${scope.scope} scope: ${scope.dir}`,
    ...actionLines(actions),
    derivationLine(plan),
    `${String(candidates)} file(s) a proposal pass would ask a session about`,
    'Nothing was written; re-run with --propose to ask, then with --apply to write',
  ]);
}

/** Runs the proposal pass and says what each session came to. Touches no skill. */
async function runPropose(
  context: RafaContext,
  scope: DemotionScope,
  backfillDir: string,
  seams: SkillBackfillSeams,
): Promise<void> {
  const project = projectOf(context);
  const config = loadConfig(
    { root: project.root, home: project.home },
    {},
    (message) => { context.output.warn(message); },
  ).config;
  const pass = await runProposalPass({
    root: scope.dir,
    backfillDir,
    settingSources: config.settingSources,
    spawn: seams.spawn,
  });

  const files: readonly BackfillProposalFileData[] = pass.written.map((written) => ({
    path: written.path,
    batch: written.file.batch,
    exitCode: written.file.exitCode,
    rows: written.file.rows.length,
    unanswered: written.file.rows.filter((row) => row.status !== ANSWERED_ROW).length,
  }));
  const result: SkillBackfillProposeResult = {
    mode: 'propose',
    scope: scope.scope,
    dir: scope.dir,
    backfillDir,
    candidates: pass.candidates,
    files,
  };

  report(context, result, [
    `${scope.scope} scope: ${scope.dir}`,
    `${String(pass.candidates)} file(s) to ask about, in ${String(files.length)} batch(es)`,
    ...files.map((file) => `✅ ${file.path}: batch ${String(file.batch)}, session exit ${String(file.exitCode)},`
      + ` ${String(file.rows)} row(s), ${String(file.unanswered)} unanswered`),
    `Review each file against its skill, mark it ${REVIEWED_FILE}, then re-run with --apply`,
  ]);
}

/** Every proposal file under `dir`, or exit 1 naming the one that does not parse. */
export function reviewedProposals(dir: string): readonly ProposalFile[] {
  const read = readProposalFiles(dir);
  const broken = read.filter((entry) => entry.result.file === null);
  if (broken.length > 0) {
    throw new CommandExit(1, [
      '❌ A proposal file does not parse, so no row of this directory was applied:',
      ...broken.map((entry) => `   ${entry.path}: ${entry.result.problem ?? 'unreadable'}`),
    ].join('\n'));
  }
  return read.flatMap((entry) => (entry.result.file === null
    ? []
    : [entry.result.file]));
}

/** Every file a reviewed row could rewrite, each as an absolute path. */
export function rowPaths(files: readonly ProposalFile[], root: string): readonly string[] {
  return files.flatMap((file) => (file.status !== REVIEWED_FILE
    ? []
    : file.rows
      .filter((row) => row.status === ANSWERED_ROW)
      .map((row) => join(root, ...row.path.split('/')))));
}

/** Writes the reviewed proposals, then derives, copying each file first. */
function runApply(
  context: RafaContext,
  scope: DemotionScope,
  backfillDir: string,
  projectRoot: string | null,
): void {
  const options = checkOptions(context, projectRoot);
  const backupDir = backupDirectory(scope.base);
  const repoRoot = projectOf(context).root;
  const backups: BackupResult[] = [];

  const files = reviewedProposals(backfillDir);
  backups.push(...backupFiles(rowPaths(files, scope.dir), { root: scope.dir, backupDir, repoRoot }));
  const proposals = applyProposals(files, scope.dir, options);

  const planned = planDerivation(scope.dir, { ...options, triggers: proposals.triggers });
  backups.push(...backupFiles(
    planned.actions.filter((action) => action.kind === 'derived').map((action) => action.path),
    { root: scope.dir, backupDir, repoRoot },
  ));
  const derived = applyDerivation(planned, options);

  const proposalActions = proposals.actions.map(actionData);
  const derivationActions = derived.actions.map(actionData);
  const copied = countBackups(backups).copied;
  const result: SkillBackfillApplyResult = {
    mode: 'apply',
    scope: scope.scope,
    dir: scope.dir,
    backfillDir,
    proposals: proposalActions,
    proposalCounts: proposals.counts,
    derivation: derivationActions,
    derivationCounts: countDerivations(derived.actions),
    backups: copied,
  };
  const lines = [
    `${scope.scope} scope: ${scope.dir}`,
    ...actionLines(proposalActions),
    proposalLine(proposals.actions.length, proposals.counts),
    ...actionLines(derivationActions),
    derivationLine(derived),
    `${String(copied)} file(s) copied under ${backupDir} before they were rewritten`,
  ];

  const refused = proposals.counts.refused + derived.counts.refused;
  if (refused > 0) throw new CommandExit(Math.min(refused, REFUSED_CAP), lines.join('\n'));
  report(context, result, lines);
}

/** Runs one invocation. See the module note. */
async function runBackfill(context: RafaContext, seams: SkillBackfillSeams): Promise<void> {
  const mode = readMode(context.flags);
  const dir = readBackfillDirectory(context.args, seams.cwd);
  const projectRoot = readConsumerRoot(context.flags['project'], seams.cwd);
  const scope = backfillScopeOf(dir, projectOf(context).home);
  const backfillDir = join(scope.base, BACKFILL_PATH);

  if (mode === 'propose') {
    await runPropose(context, scope, backfillDir, seams);
    return;
  }
  if (mode === 'apply') {
    runApply(context, scope, backfillDir, projectRoot);
    return;
  }
  runPlan(context, scope, backfillDir, projectRoot);
}

/** The command, resolving `<dir>` and its sessions through `seams`. See the module note. */
export function createSkillBackfillCommand(seams: SkillBackfillSeams = DEFAULT_BACKFILL_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'skill backfill',
    subject: 'skill',
    action: 'backfill',
    summary: 'fill in the fields a skills directory lacks, by proposal and by derivation',
    description: 'Runs the backfill over one skills directory, in the three halves the pass separates. With'
      + ' no flag it PLANS: it answers what the deterministic derivation would write — `stack` for a'
      + ' directory the ECC table names, `paths` from the glob table for a non-agnostic `stack`, and'
      + ' `when_to_use` from `"<trigger sentence>. Prevents: <prevents>"` trimmed to the listing cap — and'
      + ' how many files a proposal pass would ask about, writing nothing. With `--propose` it asks one'
      + ' `claude -p` session per batch of twenty files for the `prevents`, `signal`, trigger sentence and'
      + ' over-cap `description` no table can derive, and writes one `proposals-<nn>.yaml` per batch under'
      + ' `<base>/.rafa/backfill/`, each `status: draft` and each row of a session that answered nothing'
      + ' readable marked `unanswered` rather than guessed. With `--apply` it writes every reviewed row'
      + ' into its skill and then runs the derivation over the result, refusing a file still marked'
      + ' `draft`, a skill that changed since its proposal was written, and any write that fails a check'
      + ' the file passed before. Every file an apply rewrites outside the checkout the command runs in is'
      + ' copied to `<base>/.rafa/backfill/backup/` first, and no body is ever written. The exit code of an'
      + ' apply is the number of rows and files it refused, capped at 255. `<dir>` is `~/.claude/skills` or'
      + ' a project\'s `.claude/skills`, and anything else is refused. With `--output=json` the actions and'
      + ' their counts are the data of the terminal result event.',
    args: [
      {
        name: 'dir',
        description: 'The skills directory to backfill: `~/.claude/skills` or a project\'s `.claude/skills`.',
        type: 'string',
        required: true,
      },
    ],
    flags: [
      {
        name: 'propose',
        description: 'Ask one session per batch of twenty for what no table derives, and write the draft proposals.',
        type: 'boolean',
      },
      {
        name: 'apply',
        description: 'Write every reviewed proposal row into its skill, then run the derivation over the result.',
        type: 'boolean',
      },
      {
        name: 'project',
        description: 'The project root the bodies are consumed in, which their paths resolve against.',
        type: 'string',
      },
    ],
    examples: [
      {
        cmd: 'rafa skill backfill ~/.claude/skills',
        note: 'Says what the derivation would write and how many files a proposal pass would ask about.',
      },
      {
        cmd: 'rafa skill backfill ~/.claude/skills --propose',
        note: 'Asks one session per twenty files and writes the draft proposals under `~/.rafa/backfill/`.',
      },
      {
        cmd: 'rafa skill backfill .claude/skills --apply --project=.',
        note: 'Writes the reviewed rows, derives, and copies each rewritten file outside the checkout first.',
      },
    ],
    outputs: ['text', 'json'],
    spends: { when: 'with', flag: '--propose', what: 'one session per batch of skills' },
    run: async (context) => {
      await runBackfill(context, seams);
    },
  };
  return Object.freeze(command);
}

export default createSkillBackfillCommand();
