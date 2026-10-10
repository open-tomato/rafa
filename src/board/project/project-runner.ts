/**
 * The project's runner, opened retrying: {@link openProjectRunner} wraps
 * a `GhRunner` in `./retry.ts`'s {@link retryingGhRunner} with the two
 * `board.project` retry keys off the config, and reports each retry
 * through {@link retryReporter}
 * (`.rafa/specs/rafa-924-board-project-fixes.md`, "Network errors
 * retried").
 *
 * ## Who opens through it
 *
 * Every place that opens a runner the project's calls go through:
 *
 * | Opener | Covers |
 * |---|---|
 * | `src/commands/init-board-project.ts` (`runProjectStep`) | `rafa init --board --project`: the adds, the facts reads and the field writes |
 * | `src/commands/board/sync.ts` | `rafa board sync` |
 * | `src/commands/issue/create.ts` | the `openGh` `rafa issue create` hands `./add-issue.ts` |
 * | `src/commands/epic/epic-project.ts` | the `rafa epic` actions, the add of `epic new` included |
 * | `src/commands/pr/merge-project.ts` | `rafa pr merge` |
 * | `src/commands/release/settle-project.ts` | `rafa release settle` |
 * | `./issue-board-refresh.ts` | the refreshing issue board's refresh, and every caller of `refreshIssueItems` |
 * | `src/commands/doctor-project.ts` | the project section of `rafa doctor` |
 *
 * ## Opened once
 *
 * A runner this module opened is remembered, and opening it again hands
 * it back unchanged. So an opener and a helper it calls may both open
 * the same runner (`pr merge` opens it, then `refreshIssueItems` opens
 * what it was handed) and one call is still retried at most
 * `board.project.retries` times, never that squared.
 *
 * ## The line and the event
 *
 * A retry is reported before its wait. In text mode it is one `info`
 * line, `retrying #725 (1 of 3): operation timed out`, written with no
 * `warn: ` prefix: a retry that then succeeds is not a warning. In json
 * mode it is one named event, {@link RETRY_EVENT}, whose summary is the
 * same line and whose data holds the retry's place, reason, subject,
 * issue and wait. An opener with a command context at hand reports to
 * that command's output; one without reports to the active output
 * (`src/adapters/output/active.ts`), read at each retry, as the
 * refreshing issue board's warnings are.
 *
 * ## The wait
 *
 * The wait goes through the opener's `sleep` seam: the same one its
 * write pause goes through, `Bun.sleep` when left out, so a test that
 * plants one waits for neither.
 */
import type { RetryNotice } from './retry.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { RafaConfig } from '../../config-schema.js';
import type { OutputMode } from '../../config-sections.js';
import type { CliEventNamed, Output } from '../../ports/index.js';

import { activeOutput, activeOutputMode } from '../../adapters/output/active.js';

import { retryingGhRunner } from './retry.js';

/** The two config keys a retrying runner is opened with. */
export type ProjectRetryConfig = Pick<RafaConfig, 'boardProjectRetries' | 'boardProjectRetryWaitSeconds'>;

/** Hears one retry, before its wait. */
export type RetryReport = (notice: RetryNotice) => void;

/** The name of the json event a retry is reported as. */
export const RETRY_EVENT = 'retry';

/** What {@link openProjectRunner} waits and reports through. */
export interface ProjectRunnerSeams {
  /** The wait before a retry; `Bun.sleep` when left out. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Hears each retry; {@link activeRetryReport} when left out. */
  readonly onRetry?: RetryReport;
}

/** The runners {@link openProjectRunner} answered, so a second open hands one back unchanged. */
const OPENED = new WeakSet<GhRunner>();

/** The text line of one retry: `retrying #725 (1 of 3): operation timed out`. */
export function retryLine(notice: RetryNotice): string {
  return `retrying ${notice.subject} (${String(notice.attempt)} of ${String(notice.of)}): ${notice.reason}`;
}

/** The json event of one retry, stamped `now`. */
export function retryEvent(notice: RetryNotice, now: Date): CliEventNamed {
  return {
    type: 'event',
    name: RETRY_EVENT,
    summary: retryLine(notice),
    data: {
      attempt: notice.attempt,
      of: notice.of,
      reason: notice.reason,
      subject: notice.subject,
      number: notice.number ?? null,
      waitMs: notice.waitMs,
    },
    ts: now.toISOString(),
  };
}

/**
 * Reports each retry to `output`: one `info` line in text mode, one
 * {@link RETRY_EVENT} event in json mode; see the module note.
 */
export function retryReporter(output: Output, mode: OutputMode, now: () => Date = () => new Date()): RetryReport {
  return (notice) => {
    if (mode === 'json') output.emit(retryEvent(notice, now()));
    else output.info(retryLine(notice));
  };
}

/**
 * The seams of an opener with a command's `output` and `mode` at hand:
 * each retry reported there, and waited through `sleep` when given.
 */
export function commandRetrySeams(output: Output, mode: OutputMode, sleep?: (ms: number) => Promise<void>): ProjectRunnerSeams {
  const onRetry = retryReporter(output, mode);
  return sleep === undefined
    ? { onRetry }
    : { onRetry, sleep };
}

/** Reports each retry to the output active when it happens, in its mode. */
export const activeRetryReport: RetryReport = (notice) => {
  retryReporter(activeOutput(), activeOutputMode())(notice);
};

/**
 * `gh` opened retrying, with `config`'s `board.project.retries` and
 * `retryWaitSeconds`; a runner this function already answered is handed
 * back unchanged. See the module note.
 */
export function openProjectRunner(gh: GhRunner, config: ProjectRetryConfig, seams: ProjectRunnerSeams = {}): GhRunner {
  if (OPENED.has(gh)) return gh;
  const onRetry = seams.onRetry ?? activeRetryReport;
  const base = { retries: config.boardProjectRetries, retryWaitSeconds: config.boardProjectRetryWaitSeconds, onRetry };
  const opened = retryingGhRunner(gh, seams.sleep === undefined
    ? base
    : { ...base, sleep: seams.sleep });
  if (opened !== gh) OPENED.add(opened);
  return opened;
}
