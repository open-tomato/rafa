/**
 * `rafa plan risk [<plan>] [--strict]`: the risk reading of one plan
 * (`src/plan/risk.ts`), printed. What a run of the plan may do on this
 * machine and under the person's accounts, read in code: the command
 * starts no Claude session and so declares no `spends`.
 *
 * ## What is read
 *
 * The plan the line names, resolved against the project root as
 * `loop start --plan=` and `rafa doctor --plan=` resolve theirs
 * (`start/plan-path.ts`), so the `rafa plan risk <plan>` the one-line
 * total names works from anywhere in the project. With no plan named it
 * is the default plan `loop start` falls back to: `PLAN.md` in
 * `plan.dir`, else at the project root. A plan named that is no file,
 * and no default plan at either place, are refused with exit code 1.
 *
 * The rest of the reading is the config that resolves for the project,
 * refused with exit code 1 when `loadConfig` refuses it: `plan.dir`,
 * `loop.settingSources` for the agents a session would resolve, and
 * `pr.provider`, `tracker.default` and `tracker.fallback` for the
 * accounts. git and `gh` run at the project root through the runners
 * {@link PlanRiskSeams} makes, which a test plants. The environment is
 * the invocation's, `RafaContext.env`, and only its keys are read, by
 * `scanSecretNames`: no value can reach a line this command writes.
 *
 * ## What it writes
 *
 * Text mode writes `renderRiskText`'s report a line at a time: the `high`
 * findings, then the `note` ones, the one-line total and the footer
 * saying the reading is not a sandbox. json mode gives the
 * {@link RiskReport} as the data of the terminal result.
 *
 * The exit code is 0 whatever the reading found. Under `--strict` it is 1
 * when any finding is `high`: text mode has written the whole report
 * first, and the refusal counting the `high` findings goes to stderr. A
 * failed result carries no data (`src/cli/dispatch.ts`), so in json mode
 * each `high` finding is written first as an `error` log event, as
 * {@link riskLine} words it; a script wanting the notes too reads the
 * report without `--strict` and its `total.high`.
 *
 * `--strict` takes no value. Typed ahead of the plan, the parser reads
 * the plan as its value, and the line is refused with exit code 1 rather
 * than read as the default plan (`readSwitch`, `plan-files.ts`).
 */
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { RafaConfig } from '../../config.js';
import type { AccountSeams } from '../../plan/risk/accounts.js';
import type { RiskFinding, RiskReport } from '../../plan/risk.js';
import type { ProjectFound } from '../../project/scope.js';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createGhRunner } from '../../adapters/tracker/github.js';
import { CommandExit } from '../../cli/command.js';
import { assessPlanRisk, renderRiskText } from '../../plan/risk.js';
import { createGitRunner } from '../../pr/git.js';
import { DEFAULT_PLAN_FILE, resolvePlanPath } from '../../start/plan-path.js';

import { expectAtMostOneArgument, isFile, plural, readSwitch, requireProject, resolveProjectConfig } from './plan-files.js';

/** The command as a refusal names it. */
const COMMAND = 'rafa plan risk';

/** The usage line a refusal names. */
const USAGE = 'rafa plan risk [<plan>] [--strict]';

/** What a refusal of a value read into `--strict` says to do instead. */
const STRICT_HINT = `Type the plan first: ${COMMAND} <plan> --strict`;

/** What the command reaches beyond the plan and the config; see the module note. */
export interface PlanRiskSeams {
  /** The git and `gh` runners for a project root: both spawn there unless a test hands others. */
  readonly runners?: (root: string) => AccountSeams;
  /** The entry the rafa skill tier sits beside: `Bun.main` when left out. */
  readonly entry?: string;
}

/** The runners that spawn git and `gh` at `root`. */
function spawningRunners(root: string): AccountSeams {
  return { git: createGitRunner(root), gh: createGhRunner({ cwd: root }) };
}

/**
 * The plan the line names, resolved against the project root, or the
 * default plan when it names none; a refusal with exit code 1 for either
 * that is no file.
 */
export function riskPlanPath(root: string, planDir: string, typed: string | null): string {
  const path = resolvePlanPath(root, planDir, typed ?? undefined);
  if (isFile(path)) return path;
  if (typed !== null) throw new CommandExit(1, `❌ Plan file not found: ${path}`);
  const lookedFor = [...new Set([resolve(root, planDir, DEFAULT_PLAN_FILE), resolve(root, DEFAULT_PLAN_FILE)])];
  throw new CommandExit(1, `❌ No plan named, and no default plan at ${lookedFor.join(' or ')}\nUsage: ${USAGE}`);
}

/** A finding as one line: `<file>:<line>: <kind>: <text>`, each place part only where the finding has it. */
export function riskLine(finding: RiskFinding): string {
  const line = finding.line === undefined
    ? ''
    : `:${String(finding.line)}`;
  const place = finding.file === undefined
    ? ''
    : `${finding.file}${line}: `;
  return `${place}${finding.kind}: ${finding.text}`;
}

/** The refusal `--strict` ends a reading holding `high` findings with. */
export function strictRefusal(report: RiskReport): string {
  return `❌ ${report.plan}: ${plural(report.total.high, 'high finding')}; --strict refuses a plan with any`;
}

/** The reading of the plan at `path`, under `project` and its `config`. */
async function readRisk(
  path: string,
  project: ProjectFound,
  config: RafaConfig,
  context: RafaContext,
  seams: PlanRiskSeams,
): Promise<RiskReport> {
  const makeRunners = seams.runners ?? spawningRunners;
  return assessPlanRisk({ path, text: readFileSync(path, 'utf8') }, {
    repoRoot: project.root,
    home: project.home,
    settingSources: config.settingSources,
    environment: context.env,
    accounts: {
      prProvider: config.prProvider,
      trackerDefault: config.trackerDefault,
      trackerFallback: config.trackerFallback,
    },
    runners: makeRunners(project.root),
    entry: seams.entry,
  });
}

/** The command, reaching git, `gh` and the rafa skill tier through `seams`; see the module note. */
export function createPlanRiskCommand(seams: PlanRiskSeams = {}): RafaCommand {
  const command: RafaCommand = {
    name: 'plan risk',
    subject: 'plan',
    action: 'risk',
    summary: 'read what a run of a plan may do on this machine and under your accounts, starting no session',
    description: 'Reads one plan in code, with no model, and reports what a run of it may do: per open task'
      + ' the tools it may use, its model and its budget; destructive commands on the command lines of the'
      + ' plan, its task lines\' code spans and the shell fences of the agents and skills its tasks'
      + ' declare; paths outside the repository those commands name; the push remote and its visibility,'
      + ' the issue tracker and the pull request provider; and the NAMES of the environment variables that'
      + ' look like credentials, never their values. Each finding is `high` or `note`. It reads what the'
      + ' plan and its skills say, not what a session will decide to do: it is not a sandbox. The plan is'
      + ' read relative to the project root, as `rafa loop start --plan=` reads it, and is the default'
      + ' plan `loop start` would run when none is named. Exits 0 whatever it finds, unless `--strict`'
      + ' is typed and a finding is `high`. With `--output=json` the reading is the data of the terminal'
      + ' result event; under `--strict` each `high` finding is an error log event instead.',
    args: [
      {
        name: 'plan',
        description: 'The plan file to read, relative to the project root; the default plan when left out.',
        type: 'string',
      },
    ],
    flags: [
      {
        name: 'strict',
        description: 'Exits 1 when any finding is `high`, for scripts and CI. Type it after the plan.',
        type: 'boolean',
      },
    ],
    examples: [
      {
        cmd: 'rafa plan risk .rafa/plans/PLAN-my-feature.md',
        note: 'Prints the high findings, then the notes, then the one-line total and what the reading is not.',
      },
      {
        cmd: 'rafa plan risk .rafa/plans/PLAN-my-feature.md --strict',
        note: 'Prints the same report, and exits 1 when any finding is high.',
      },
      {
        cmd: 'rafa plan risk --output=json',
        note: 'Writes a start event, then a result event whose data is the default plan\'s reading.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const strict = readSwitch('strict', context.flags['strict'], STRICT_HINT);
      const typed = expectAtMostOneArgument(context.args, USAGE);
      const project = requireProject(context, COMMAND);
      const config = resolveProjectConfig(project, COMMAND, (message) => {
        context.output.warn(message);
      });
      const path = riskPlanPath(project.root, config.planDir, typed);
      const report = await readRisk(path, project, config, context, seams);
      const refused = strict && report.total.high > 0;

      if (context.outputMode === 'json') {
        if (!refused) {
          context.output.result(report);
          return;
        }
        for (const finding of report.findings) {
          if (finding.level === 'high') context.output.error(riskLine(finding));
        }
      } else {
        for (const line of renderRiskText(report).split('\n')) context.output.info(line);
      }
      if (refused) throw new CommandExit(1, strictRefusal(report));
    },
  };
  return Object.freeze(command);
}

export default createPlanRiskCommand();
