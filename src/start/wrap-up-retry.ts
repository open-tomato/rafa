/**
 * The prompt a RETRY wrap-up session is given: the session the runner
 * spawns when the wrap-up before it ended and no pull request is open
 * for the branch (`.rafa/specs/rafa-579-loop-run-ends-delivered.md`,
 * #576). `loop.wrapUp.retries` (`config-schema-wrap-up.ts`) says how
 * many of these a run spawns before the runner opens the pull request
 * itself.
 *
 * A retry is a wrap-up, not a new kind of session: it still has to sync
 * the branch with the base, rewrite the release fragment's notes,
 * promote the listed lessons, commit, push and open the pull request,
 * and the earlier session may have done any part of that or none. So
 * the prompt is {@link buildWrapUpPrompt}'s, built with no open pull
 * request, which gives it the `gh pr create` bullet, and one bullet
 * more: {@link missingPullRequestBullet}, saying the pull request is
 * missing and quoting the earlier session's final message.
 *
 * That bullet goes SECOND, straight below the first line. The first
 * line stays the `wrap-up` classifier key `effort/classify.ts` buckets
 * on, so a retry session is counted as a wrap-up; and the session reads
 * why it was spawned before the steps it is asked to repeat, rather than
 * after a plan that can run to hundreds of lines.
 *
 * The final message is what the earlier session wrote to stdout, as
 * `runClaudeCaptured` (`utils/claude.ts`) answers it: the CLI runs with
 * `-p` in text mode, where stdout is the session's final message. It is
 * quoted whole, each line behind `> ` and indented under the bullet, so
 * a fence or a heading inside it stays inside the quote and cannot read
 * as a section of this prompt. A message that is empty or only
 * whitespace — a session that crashed before answering — is named as
 * such instead of being quoted as an empty block.
 */
import type { InstinctRecord } from '../learning/index.js';
import type { ReleasePreparation } from '../release/prepare.js';

import { buildWrapUpPrompt } from './wrap-up.js';

/** What a retry wrap-up prompt is built from. */
export interface WrapUpRetryPrompt {
  /** The run's branch, the one with no open pull request. */
  readonly branch: string;
  /** The plan the run executed, appended whole as the wrap-up's is. */
  readonly planContent: string;
  /** Step 1's release record, as the first wrap-up was given it, or null. */
  readonly release: ReleasePreparation | null;
  /** The lessons to promote, as the first wrap-up was given them. */
  readonly lessons: readonly InstinctRecord[];
  /** The earlier wrap-up session's final message: its captured stdout. */
  readonly previousMessage: string;
}

/** The earlier message, each line quoted and indented under the bullet. */
function quoted(message: string): readonly string[] {
  return message
    .trimEnd()
    .split('\n')
    .map((line) => line.trimEnd() === ''
      ? '  >'
      : `  > ${line.trimEnd()}`);
}

/**
 * The bullet saying the pull request is missing, followed by the
 * earlier session's final message as a quote, or by a line saying it
 * left none.
 */
export function missingPullRequestBullet(branch: string, previousMessage: string): readonly string[] {
  const opening = `* The pull request is MISSING. An earlier wrap-up session on this run ended, and no open pull request exists for ${branch}. Check what it left — whether the base is merged, what is committed, whether the branch is pushed — finish whatever of the steps below it did not, and open the pull request: this run is not finished until it is open.`;
  if (previousMessage.trim() === '') {
    return [opening, '  The earlier session left no final message.'];
  }
  return [opening, '  Its final message follows, quoted:', '', ...quoted(previousMessage), ''];
}

/**
 * Builds the retry wrap-up prompt: the wrap-up prompt with no open pull
 * request, and {@link missingPullRequestBullet} straight below its first
 * line. The caller stamps it (`start/stamp.ts`), as it does the first.
 */
export function buildWrapUpRetryPrompt(retry: WrapUpRetryPrompt): string {
  const base = buildWrapUpPrompt(retry.branch, retry.planContent, null, retry.release, retry.lessons);
  const [classifierKey, ...rest] = base.split('\n');
  return [
    classifierKey,
    ...missingPullRequestBullet(retry.branch, retry.previousMessage),
    ...rest,
  ].join('\n');
}
