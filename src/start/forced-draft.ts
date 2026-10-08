/**
 * The pull request a `rafa loop start --continue --force-wrap-up` run
 * delivers with passed-over tasks still open: converted to a draft, its
 * body listing each task, its strategy and the decision's reason.
 *
 * Whoever opened it, the wrap-up session, a retry or the runner
 * (`./wrap-up-run.ts`), opened it ready for review, so once the delivery
 * answers, {@link markForcedDraft} converts it with
 * `gh pr ready <n> --undo` (`gh pr ready --help`: "--undo Convert a pull
 * request to draft") and writes {@link passedOverSection} under the body
 * it reads back, a read-modify-write as `./release-body.ts` makes. A
 * body already holding {@link PASSED_OVER_HEADING} is left alone, so a
 * re-run writes the section once.
 *
 * `./wrap-up-run.ts` converts it right after the delivery, BEFORE the
 * `pr` event: a reader of the events (`rafa loop wait`, an operator, a
 * json caller) takes a `pr` for a delivered pull request, and a forced
 * wrap-up's is not one until it is a draft.
 *
 * The conversion is sent through the `gh` runner rather than the pull
 * request port (`pr/types.ts`), which has no draft member: widening the
 * port reaches every literal that implements it, and this is the one
 * caller. {@link markForcedDraft} never throws: a refused conversion is
 * one warning line naming what `gh` said, and its answer is false. The
 * caller then emits no `pr` event and ends the run through
 * {@link refuseUndraftedPullRequest}: a `halt` naming the pull request,
 * and exit code 20 (`DECISION_STOP_EXIT`, `./continue-exits.ts`) with a
 * line naming the command to run by hand, so the run's record ends
 * `stopped`, never `done`, over a pull request left ready for review. A
 * body that cannot be written is one warning line and nothing more: the
 * pull request is a draft either way.
 *
 * Every line goes through the active output (`adapters/output/active.ts`).
 */
import type { PassedOverTask } from './loop-events.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { PullRequests } from '../pr/index.js';

import { activeOutput } from '../adapters/output/active.js';
import { createGhRunner } from '../adapters/tracker/github.js';
import { messageOf } from '../config-sections.js';
import { ghPullRequestsIn } from '../pr/index.js';

import { DECISION_STOP_EXIT, LoopEnd } from './continue-exits.js';
import { emitLoopEvent } from './loop-events.js';

/** The heading the passed-over tasks sit under in the pull request body. */
export const PASSED_OVER_HEADING = '## Passed-over tasks';

/** What {@link markForcedDraft} reaches through; {@link forcedDraftSeamsIn} makes the real ones. */
export interface ForcedDraftSeams {
  /** Runs `gh` for the draft conversion. */
  readonly gh: GhRunner;
  /** The provider the body is read and written through. */
  readonly pulls: Pick<PullRequests, 'get' | 'editBody'>;
}

/** The real seams, each made in `dir`, the run's checkout. */
export function forcedDraftSeamsIn(dir: string): ForcedDraftSeams {
  return { gh: createGhRunner({ cwd: dir }), pulls: ghPullRequestsIn(dir) };
}

/** The section listing `tasks`, under {@link PASSED_OVER_HEADING}. */
export function passedOverSection(tasks: readonly PassedOverTask[]): string {
  return [
    PASSED_OVER_HEADING,
    '',
    'This pull request is a draft: `rafa loop start --continue --force-wrap-up` wrapped up with these tasks still open.',
    '',
    ...tasks.map((task) => `- line ${task.line} (${task.strategy}): ${task.text}. ${task.reason}`),
  ].join('\n');
}

/** `body` with the section appended, or `body` itself when it already holds the heading. */
export function bodyWithPassedOver(body: string, tasks: readonly PassedOverTask[]): string {
  if (body.includes(PASSED_OVER_HEADING)) return body;
  const kept = body.trimEnd();
  return kept === ''
    ? passedOverSection(tasks)
    : `${kept}\n\n${passedOverSection(tasks)}`;
}

/** Converts pull request `number` to a draft; one warning line when `gh` refuses. */
async function convertToDraft(number: number, gh: GhRunner): Promise<boolean> {
  const command = `gh pr ready ${number} --undo`;
  const result = await gh(['pr', 'ready', String(number), '--undo']);
  if (result.ok) return true;
  const said = result.stderr.trim() || result.stdout.trim() || 'nothing said';
  activeOutput().warn(`⚠️  The forced wrap-up could not mark pull request #${number} as a draft (${said}); run ${command} by hand.`);
  return false;
}

/** Writes the section into pull request `number`'s body; one warning line when it cannot. */
async function writeSection(number: number, tasks: readonly PassedOverTask[], pulls: ForcedDraftSeams['pulls']): Promise<void> {
  try {
    const pull = await pulls.get(number);
    if (pull === null) throw new Error(`no pull request #${number}`);
    const body = bodyWithPassedOver(pull.body, tasks);
    if (body !== pull.body) await pulls.editBody(number, body);
  } catch (error) {
    activeOutput().warn(`⚠️  The forced wrap-up could not write the passed-over tasks into pull request #${number} (${messageOf(error)}).`);
  }
}

/**
 * Converts the delivered pull request `number` to a draft and writes
 * `tasks` into its body; see the module note. True once it is a draft,
 * false when `gh` refused the conversion. Never throws.
 */
export async function markForcedDraft(
  number: number,
  tasks: readonly PassedOverTask[],
  seams: ForcedDraftSeams,
): Promise<boolean> {
  const drafted = await convertToDraft(number, seams.gh);
  await writeSection(number, tasks, seams.pulls);
  if (drafted) activeOutput().info(`📝 Pull request #${number} is a draft, listing the ${tasks.length} passed-over task(s) in its body.`);
  return drafted;
}

/**
 * Ends a forced wrap-up whose pull request `number` could not be made a
 * draft: a `halt` naming it, then exit code 20 and the command to run by
 * hand. See the module note.
 */
export function refuseUndraftedPullRequest(number: number): never {
  emitLoopEvent({ kind: 'halt', reason: `forced draft refused: pull request #${number} is ready for review` });
  throw new LoopEnd(DECISION_STOP_EXIT, [
    `⛔ The forced wrap-up's pull request #${number} could not be made a draft, so it is open ready for review with passed-over tasks left.`,
    `   Run gh pr ready ${number} --undo by hand. The run is recorded stopped, not done, and the CI wait was skipped.`,
  ].join('\n'));
}
