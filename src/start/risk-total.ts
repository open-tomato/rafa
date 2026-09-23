/**
 * The risk total `loop start` prints before the standing notices: the
 * one line `riskTotalLine` words (`plan/risk.ts`), e.g.
 * `🛡  Risk: 2 high, 6 notes — rafa plan risk .rafa/plans/PLAN-x.md`.
 *
 * `start.ts` calls {@link announceRiskTotal} immediately ahead of
 * `requireNoticesAnswered()`, on every run, whether the notices are
 * pending or dismissed, so the person reads the count before being asked
 * to consent to a run under their accounts. It goes through the active
 * output at `info`, so text mode prints it as a line and json mode reads
 * it as a `log` event.
 *
 * The reading is the one `rafa plan risk` makes (`commands/plan/risk.ts`):
 * the plan's text, the run's resolved config for `loop.settingSources`
 * and the accounts, and the environment's keys, never its values. git
 * and `gh` run at the project root unless a test plants other runners.
 *
 * The line is advice, not a gate: a reading that throws does not stop
 * the run. The throw is written as a warning naming the plan and what
 * was thrown, and the run goes on to the notices.
 */
import type { RafaConfig } from '../config.js';
import type { AccountSeams } from '../plan/risk/accounts.js';
import type { Output } from '../ports/index.js';

import { readFileSync } from 'node:fs';

import { activeOutput } from '../adapters/output/active.js';
import { createGhRunner } from '../adapters/tracker/github.js';
import { assessPlanRisk, riskTotalLine } from '../plan/risk.js';
import { createGitRunner } from '../pr/git.js';

/** What the reading is taken over. */
export interface RiskTotalInput {
  /** The project root, absolute. */
  readonly repoRoot: string;
  /** The home directory, absolute. */
  readonly home: string;
  /** The plan the run executes, absolute. */
  readonly planPath: string;
  /** The run's resolved config. */
  readonly config: Pick<RafaConfig, 'settingSources' | 'prProvider' | 'trackerDefault' | 'trackerFallback'>;
  /** The environment a run inherits; only its keys are read. */
  readonly environment: Readonly<Record<string, string | undefined>>;
}

/** What the announcement reaches beyond its input. */
export interface RiskTotalSeams {
  /** git and `gh` for a root: both spawn there when left out. */
  readonly runners?: (root: string) => AccountSeams;
  /** Where the line goes: the active output when left out. */
  readonly output?: Output;
}

/** The runners that spawn git and `gh` at `root`. */
function spawningRunners(root: string): AccountSeams {
  return { git: createGitRunner(root), gh: createGhRunner({ cwd: root }) };
}

/** The one-line risk total of the plan at `input.planPath`. */
export async function readRiskTotalLine(input: RiskTotalInput, seams: RiskTotalSeams = {}): Promise<string> {
  const makeRunners = seams.runners ?? spawningRunners;
  const report = await assessPlanRisk({ path: input.planPath, text: readFileSync(input.planPath, 'utf8') }, {
    repoRoot: input.repoRoot,
    home: input.home,
    settingSources: input.config.settingSources,
    environment: input.environment,
    accounts: {
      prProvider: input.config.prProvider,
      trackerDefault: input.config.trackerDefault,
      trackerFallback: input.config.trackerFallback,
    },
    runners: makeRunners(input.repoRoot),
  });
  return riskTotalLine(report);
}

/**
 * Prints the risk total at `info`, or, when the reading throws, a
 * warning saying so; never throws itself. See the module note.
 */
export async function announceRiskTotal(input: RiskTotalInput, seams: RiskTotalSeams = {}): Promise<void> {
  const output = seams.output ?? activeOutput();
  try {
    output.info(await readRiskTotalLine(input, seams));
  } catch (error) {
    const said = error instanceof Error
      ? error.message
      : String(error);
    output.warn(`⚠️  Risk: could not read ${input.planPath} — ${said}`);
  }
}
