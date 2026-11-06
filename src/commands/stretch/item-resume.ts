/**
 * `rafa stretch item <issue> --resume` (#1191): finishes an item whose
 * loop has ended, from the pull request the item's log names. It starts
 * no plan and no loop; `./item.ts` branches here once the stretch base is
 * read, before its plan step, its loop line and its running-loop refusal.
 *
 * ## The steps
 *
 * Before any step runs, {@link resumeItem} refuses, with exit code 1:
 *
 *   - an issue the item ledger already holds (`readItems`), naming that
 *     line's pull request and time: the item is finished;
 *   - an issue with no plan in `plan.dir`, or with two (`issuePlans` of
 *     `./item.ts`, handed in as data so this module imports nothing of
 *     it): the ledger line keeps the plan's stub;
 *   - a log naming no pull request ({@link readLogPullRequest}): no log,
 *     a log that cannot be read, or one holding no `rafa· pr #<n> opened`
 *     line, the reason and the log's path named.
 *
 * Then `gh pr view` reads the pull request (`viewPull`):
 *
 *   - `OPEN`: `mergePull` of `./item-merge.ts`, the base guard, the
 *     mergeability and checks waits, `rafa pr merge <pr> --yes` and the
 *     read of its merge commit;
 *   - `MERGED` with a merge commit, as after a `pr merge` run by hand:
 *     a base that is no `stretch/*` branch is refused as `mergePull`
 *     refuses it, else `#<pr> is merged already at <sha>; skipping the
 *     merge` is printed and no `pr merge` line runs;
 *   - any other state: a refusal naming it.
 *
 * Both go on to `finishItem`: the CI wait, the ledger line, the
 * `rafa effort collect` line and the pit-stop readings, the recheck
 * reading judged with the `recheckConfig` `./item.ts` hands in. New bugs are counted from the ledger's last line,
 * else the `startedAt` of `stretch.json`, else the log's last-change
 * time, read before the merge.
 *
 * ## `--dry-run`
 *
 * {@link resumeDryRunLines}: the read of the log, then the merge half's
 * lines (`mergeDryRunLines`), the merge line marked as skipped when the
 * pull request is merged already. Nothing is read or run.
 *
 * Every process goes through `ItemMergeSeams`, so no test runs `rafa`,
 * reaches GitHub or sleeps.
 */
import type { ItemMergeSeams, ItemRecheckConfig, MergedPull } from './item-merge.js';
import type { ViewedPull } from './item-pull.js';
import type { StretchItem } from '../../stretch/items.js';
import type { RafaContext } from '@open-tomato/rafa/core/command';

import { readFileSync, statSync } from 'node:fs';
import { posix } from 'node:path';

import { EVENT_PREFIX } from '@open-tomato/rafa/adapters/output/events';
import { CommandExit } from '@open-tomato/rafa/core/command';
import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { errorCode } from '@open-tomato/rafa/core/loop';
import { stubOfPlanFile } from '@open-tomato/rafa/core/plan';

import { itemsPath, readItems } from '../../stretch/items.js';
import { lineText } from '../../stretch/launch.js';

import { finishItem, mergeDryRunLines, mergePull, stretchStartedAt } from './item-merge.js';
import { viewPull } from './item-pull.js';
import { STRETCH_BRANCH_PREFIX } from './start.js';

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa stretch item';

/** The exit code of a refusal. */
const REFUSED_EXIT = 1;

/** The exit code of a reading that failed. */
const FAILED_EXIT = 2;

/** How many characters of a commit a line shows. */
const SHORT_SHA = 7;

/** The events line a loop writes once it has opened its pull request, after {@link EVENT_PREFIX}. */
const PR_OPENED = /^pr #([1-9]\d*) opened$/;

/** What the log says of the item's pull request: its number, or why none was read. */
export type LogPullRequest =
  | { readonly kind: 'pr'; readonly number: number }
  | { readonly kind: 'none'; readonly reason: string };

/** What a resume needs of the item. */
export interface ResumeInput {
  readonly root: string;
  /** The stretch `pr.base` names. */
  readonly n: number;
  readonly issue: number;
  /** The plans of the issue in `plan.dir`, as `issuePlans` answers them. */
  readonly plans: readonly string[];
  /** `plan.dir` as the config spells it. */
  readonly plansLabel: string;
  /** The item's log, `.rafa/stretch/<n>/loop-<issue>.log`. */
  readonly log: string;
  /** The environment a rafa child runs with. */
  readonly env: Readonly<Record<string, string>>;
  /** What the recheck reading of the pit-stop readings judges with, handed on to `finishItem`. */
  readonly recheckConfig: ItemRecheckConfig;
}

/** A refusal with exit code 1 naming `why`. */
function refusal(why: string): CommandExit {
  return new CommandExit(REFUSED_EXIT, `❌ ${COMMAND_NAME}: ${why}`);
}

/** A failure with exit code 2 naming `why`. */
function failure(why: string): CommandExit {
  return new CommandExit(FAILED_EXIT, `❌ ${COMMAND_NAME}: ${why}`);
}

/** The pull request of the last `rafa· pr #<n> opened` line of `log`, or why there is none; see the module note. */
export function readLogPullRequest(log: string): LogPullRequest {
  let text: string;
  try {
    text = readFileSync(log, 'utf8');
  } catch (error) {
    return errorCode(error) === 'ENOENT'
      ? { kind: 'none', reason: `there is no log at ${log}` }
      : { kind: 'none', reason: `the log ${log} could not be read: ${messageOf(error)}` };
  }
  const numbers = text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith(EVENT_PREFIX))
    .map((line) => PR_OPENED.exec(line.slice(EVENT_PREFIX.length))?.[1])
    .filter((word) => word !== undefined);
  const last = numbers.at(-1);
  return last === undefined || !Number.isSafeInteger(Number(last))
    ? { kind: 'none', reason: `the log ${log} holds no "${EVENT_PREFIX}pr #<n> opened" line` }
    : { kind: 'pr', number: Number(last) };
}

/** The lines `--resume --dry-run` prints; see the module note. */
export function resumeDryRunLines(rafa: readonly string[], root: string, n: number, log: string): string[] {
  const merge = `${lineText([...rafa, 'pr', 'merge'])} <pr> `;
  return [
    `read the pull request from ${log}`,
    ...mergeDryRunLines(rafa, root, n).map((line) => (line.startsWith(merge)
      ? `${line}  (skipped when #<pr> is merged already)`
      : line)),
  ];
}

/** The items the ledger holds, a ledger that cannot be read being exit code 2. */
function ledgerItems(root: string, n: number): readonly StretchItem[] {
  try {
    return readItems(root, n).items;
  } catch (error) {
    throw failure(`${itemsPath(root, n)} could not be read: ${messageOf(error)}. Nothing was run.`);
  }
}

/** Refuses an issue the ledger already holds. */
function refuseLedgered(input: ResumeInput, items: readonly StretchItem[]): void {
  const issue = String(input.issue);
  const held = items.find((item) => item.issue === issue);
  if (held === undefined) return;
  throw refusal(`#${issue} is in ${itemsPath(input.root, input.n)} already: pull request #${String(held.pullRequest)},`
    + ` written at ${held.at}. The item is finished. Nothing was run.`);
}

/** The stub of the issue's one plan; a refusal for none or several. */
function resumedStub(input: ResumeInput): string {
  const issue = String(input.issue);
  const [plan, ...others] = input.plans;
  if (plan === undefined) {
    throw refusal(`${input.plansLabel} holds no plan of #${issue}, and the ledger line keeps the plan's stub. Nothing was run.`);
  }
  if (others.length > 0) {
    throw refusal([`${input.plansLabel} holds ${String(input.plans.length)} plans of #${issue}, and an item runs one:`,
      ...input.plans.map((name) => `  ${name}`),
      'Remove the ones not wanted. Nothing was run.'].join('\n'));
  }
  const stub = stubOfPlanFile(posix.basename(plan));
  if (stub === null) throw refusal(`${plan} is no PLAN-<stub>.md file. Nothing was run.`);
  return stub;
}

/** The cut-off new bugs are counted from: the ledger's last line, else the stretch's start, else the log's last change. */
function resumeCutOff(input: ResumeInput, items: readonly StretchItem[], seams: ItemMergeSeams): Date {
  const times = items.map((item) => Date.parse(item.at)).filter((time) => !Number.isNaN(time));
  if (times.length > 0) return new Date(Math.max(...times));
  return stretchStartedAt(input.root, input.n) ?? statSync(input.log, { throwIfNoEntry: false })?.mtime ?? seams.now();
}

/** The pull request read merged already, after the base guard; see the module note. */
function mergedAlready(context: RafaContext, pull: ViewedPull & { readonly mergeCommit: string }): MergedPull {
  if (!pull.base.startsWith(STRETCH_BRANCH_PREFIX) || pull.base === STRETCH_BRANCH_PREFIX) {
    throw refusal(`#${String(pull.number)} merged into ${pull.base}, not a ${STRETCH_BRANCH_PREFIX}* branch: an item`
      + ' merges into an integration branch, never the default branch. Nothing was run.');
  }
  context.output.info(`#${String(pull.number)} is merged already at ${pull.mergeCommit.slice(0, SHORT_SHA)}; skipping the merge`);
  return pull;
}

/** Finishes the item from the pull request its log names; see the module note. */
export async function resumeItem(context: RafaContext, input: ResumeInput, seams: ItemMergeSeams): Promise<void> {
  const items = ledgerItems(input.root, input.n);
  refuseLedgered(input, items);
  const stub = resumedStub(input);
  const read = readLogPullRequest(input.log);
  if (read.kind === 'none') {
    throw refusal(`${read.reason}, so there is no pull request to resume #${String(input.issue)} from. Nothing was run.`);
  }
  const { number } = read;
  context.output.info(`read #${String(number)} from ${input.log}`);
  const since = resumeCutOff(input, items, seams);

  const pull = await viewPull(seams.gh(input.root), number);
  let merged: MergedPull;
  if (pull.state === 'OPEN') {
    merged = await mergePull(context, input, number, seams);
  } else if (pull.state === 'MERGED' && pull.mergeCommit !== null) {
    merged = mergedAlready(context, { ...pull, mergeCommit: pull.mergeCommit });
  } else {
    throw refusal(`#${String(number)} is ${pull.state}, neither open nor merged. Nothing was run.`);
  }
  const finish = { root: input.root, n: input.n, issue: input.issue, stub, since, env: input.env, recheckConfig: input.recheckConfig };
  await finishItem(context, finish, merged, seams);
}
