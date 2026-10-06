/**
 * The release guard's step in `rafa pr merge`: read after every refusal
 * `readMergeRefusal` answers and before the merge question, so a branch
 * the guard stops is refused before anything is asked about the merge.
 *
 * What the guard answers and how it reads is `src/release/guard.ts`'s;
 * the fetches ahead of it and the reaction the two settings choose are
 * `src/release/guard-merge.ts`'s. This module is the half that acts on
 * that reaction:
 *
 *   - `silent` — prints nothing (`pr.versionCollision: allow`).
 *   - `print` — a `clean` branch: its lines go to stdout, the forecast
 *     among them, so what `pr merge` prints is the fold settle will run.
 *   - `report` — the lines go to stderr as warnings, and the merge goes
 *     on. A guard that could not read is always this.
 *   - `ask` — the lines as warnings, then `Merge #<n> with its release
 *     guard reading <answer>? [y/N]`, asked before `Merge? [y/N]`. Any
 *     answer but yes declines, as the merge question does, and ends 0
 *     with nothing merged. `--yes` does NOT answer it: the setting asks
 *     for this question by name, and a flag that skipped it would leave
 *     `ask` meaning `report` under every `rafa next --yes=merge`. So
 *     without a terminal it refuses with exit 1, naming the setting.
 *   - `refuse` — exit 1 before anything is asked: a `missing` or
 *     `stale` answer under `pr.versionCollision: refuse`, or a
 *     `collision` without `dangerous.acceptVersionCollision`.
 *   - `accept` — a `collision` under `dangerous.acceptVersionCollision`:
 *     the lines as warnings and one more naming the setting that let it
 *     through, and the merge goes on.
 *
 * Every refusal names the answer and the setting first and the guard's
 * lines after, so a `stale` or `collision` refusal still ENDS with
 * `rafa pr triage <n> --resolve`, the line the reader acts on.
 *
 * Settle's release pull request (`src/release/release-delivery.ts`) is
 * met before any of these: a head of `RELEASE_PR_BRANCH` the guard
 * reads as the delivery prints its one line,
 * `Release: #<n> is settle's release pull request; merging it lands
 * <version>`, on stdout, with no forecast and no `fix:` line, and the
 * merge goes on whatever `pr.versionCollision` says. The report carries
 * the answer `release` and the reaction `print` (#843).
 *
 * The guard runs only where the release does: `release.enabled` read as
 * the wrap-up reads it (`src/release/enabled.ts`), so a project with no
 * version file or no changelog under `auto` gets no step, no fetch and
 * no line, and its `pr merge` is what it was before the guard.
 */
import type { PrContext } from './pr-context.js';
import type { Prompter } from '../../cli/prompt/confirm.js';
import type { GitRunner, PullRequestDetail } from '../../pr/index.js';
import type { GuardReaction } from '../../release/guard-merge.js';
import type { GuardAnswer, GuardReading } from '../../release/guard.js';

import { CommandExit } from '../../cli/command.js';
import { resolveReleaseEnabled } from '../../release/enabled.js';
import { guardReaction, readMergeGuard } from '../../release/guard-merge.js';
import { guardLines, localPlanNotes } from '../../release/guard.js';
import { releaseDeliveryLine, releaseDeliveryOf } from '../../release/release-delivery.js';

/** The answers that mean yes to a question spelled `[y/N]`. */
const YES_ANSWERS: readonly string[] = ['y', 'yes'];

/** What the guard answered, as `pr merge`'s result carries it. */
export interface MergeGuardReport {
  /**
   * The guard's answer, `unread` where it could not read, or `release`
   * where the pull request is settle's own release delivery.
   */
  readonly answer: GuardAnswer | 'unread' | 'release';
  /** How the merge met it. */
  readonly reaction: GuardReaction;
  /** The lines the guard printed, or would have printed where it was `silent`. */
  readonly lines: readonly string[];
}

/** What the guard step decided: whether the merge goes on, and what it read. */
export interface MergeGuardOutcome {
  /** Null where the release does not run here, so the guard did not either. */
  readonly report: MergeGuardReport | null;
  /** False where the guard's question was answered with anything but yes. */
  readonly go: boolean;
}

/** What the guard step reads and reaches. */
export interface MergeGuardStep {
  readonly pr: PrContext;
  /** Git at the project root. */
  readonly git: GitRunner;
  readonly detail: PullRequestDetail;
  readonly now: Date;
  /** Writes one line to stdout. */
  readonly info: (message: string) => void;
  /** Writes one warning to stderr. */
  readonly warn: (message: string) => void;
  /** True when a question can be answered. */
  readonly isTerminal: () => boolean;
  /** Opens the prompter the question is asked through. Called only to ask. */
  readonly openPrompter: () => Prompter;
}

/** The guard's answer, or `unread`. */
function answerOf(reading: GuardReading): GuardAnswer | 'unread' {
  return reading.ok
    ? reading.verdict.answer
    : 'unread';
}

/** A refusal with exit code 1: `head`, then the guard's lines indented under it. */
function guardRefusal(head: string, lines: readonly string[]): CommandExit {
  return new CommandExit(1, [`❌ ${head}`, ...lines.map((line) => `  ${line}`)].join('\n'));
}

/** Why the guard refuses `answer`, naming the setting that decided. */
function refusalHead(number: number, answer: GuardAnswer | 'unread'): string {
  return answer === 'collision'
    ? `rafa pr merge refuses #${number}: its release guard reads collision, which only dangerous.acceptVersionCollision lets through.`
    : `rafa pr merge refuses #${number}: its release guard reads ${answer}, and pr.versionCollision is refuse.`;
}

/** Asks the guard's question; true for a yes. See the module note. */
async function askGuard(step: MergeGuardStep, answer: GuardAnswer | 'unread', lines: readonly string[]): Promise<boolean> {
  const { number } = step.detail;
  if (!step.isTerminal()) {
    throw guardRefusal(
      `rafa pr merge asks before merging #${number} with its release guard reading ${answer} (pr.versionCollision is ask),`
      + ' and standard input is no terminal; --yes does not answer it.',
      lines,
    );
  }
  for (const line of lines) step.warn(line);
  const prompter = step.openPrompter();
  try {
    const said = await prompter.ask(`Merge #${number} with its release guard reading ${answer}? [y/N] `);
    return said !== null && YES_ANSWERS.includes(said.trim().toLowerCase());
  } finally {
    prompter.close();
  }
}

/** Prints the guard's lines as `reaction` says; see the module note. */
function printLines(step: MergeGuardStep, reaction: GuardReaction, lines: readonly string[]): void {
  if (reaction === 'silent') return;
  const write = reaction === 'print'
    ? step.info
    : step.warn;
  for (const line of lines) write(line);
  if (reaction === 'accept') {
    step.warn(`#${step.detail.number} merges anyway: dangerous.acceptVersionCollision is true.`);
  }
}

/**
 * The guard over the pull request, read and acted on; see the module
 * note. Throws the refusals; answers whether the merge goes on.
 */
export async function guardBeforeMerge(step: MergeGuardStep): Promise<MergeGuardOutcome> {
  const settings = step.pr.versionGuard;
  const root = step.pr.project.root;
  if (!resolveReleaseEnabled(settings, root).enabled) return { report: null, go: true };

  const reading = readMergeGuard({
    git: step.git,
    settings,
    base: step.detail.baseRefName,
    head: step.detail.headRefName,
    pullRequest: step.detail.number,
    now: step.now,
    readNotes: localPlanNotes(root),
  });
  const delivery = releaseDeliveryOf(reading);
  if (delivery !== null) {
    const lines = [releaseDeliveryLine(delivery)];
    printLines(step, 'print', lines);
    return { report: { answer: 'release', reaction: 'print', lines }, go: true };
  }
  const answer = answerOf(reading);
  const reaction = guardReaction(reading, settings);
  const lines = guardLines(reading, settings.releaseVersionFile);
  const report: MergeGuardReport = { answer, reaction, lines };

  if (reaction === 'refuse') throw guardRefusal(refusalHead(step.detail.number, answer), lines);
  if (reaction === 'ask') return { report, go: await askGuard(step, answer, lines) };
  printLines(step, reaction, lines);
  return { report, go: true };
}
