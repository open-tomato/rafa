/**
 * Test helpers for the retrying runner (`./project-runner.ts`): a runner
 * that fails the calls a case picks a planted number of times before it
 * hands them on, and a recorder of the retries heard and the waits asked
 * for. Neither spawns a process, reaches GitHub or waits.
 *
 * {@link flakyGh} counts the calls it saw and the failures it answered,
 * so a case reads "sent again" off the counts rather than off the inner
 * runner's answer alone: a runner that never retried answers the planted
 * failure, one that did answers the inner runner's.
 */
import type { ProjectRunnerSeams } from './project-runner.js';
import type { RetryNotice } from './retry.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';

/** The `operation timed out` stderr of the first live run, issue #725 on 2026-10-07. */
export const TIMED_OUT_STDERR = 'Post "https://api.github.com/graphql": read: operation timed out\n';

/** A runner whose picked calls fail first; see the module note. */
export interface FlakyGh {
  /** The runner a case hands its opener. */
  readonly gh: GhRunner;
  /** Every call's arguments, failed ones included, in order. */
  readonly sent: () => readonly (readonly string[])[];
  /** How many planted failures were answered. */
  readonly failed: () => number;
}

/** A runner answering `stdout` to every call. */
export function answeringGh(stdout: string): GhRunner {
  return () => Promise.resolve({ ok: true, stdout, stderr: '' });
}

/**
 * `gh`, with each call `picks` matches answered as a failure writing the
 * next of `failures` on stderr while any is left; every other call, and
 * a picked one once they ran out, goes to `gh`.
 */
export function flakyGh(gh: GhRunner, failures: readonly string[], picks: (args: readonly string[]) => boolean = () => true): FlakyGh {
  const sent: (readonly string[])[] = [];
  let failed = 0;
  const run: GhRunner = (args, stdin) => {
    sent.push([...args]);
    if (picks(args) && failed < failures.length) {
      const stderr = failures[failed] ?? '';
      failed += 1;
      const failure: GhResult = { ok: false, stdout: '', stderr };
      return Promise.resolve(failure);
    }
    return gh(args, stdin);
  };
  return { gh: run, sent: () => [...sent], failed: () => failed };
}

/** The retries a case heard and the waits it was asked for. */
export interface RetryRecorder {
  /** The seams an opener takes: a sleep that resolves at once, and the recording report. */
  readonly seams: Required<ProjectRunnerSeams>;
  readonly notices: () => readonly RetryNotice[];
  readonly waits: () => readonly number[];
}

/** A recorder whose sleep waits for nothing; see the module note. */
export function recordRetries(): RetryRecorder {
  const notices: RetryNotice[] = [];
  const waits: number[] = [];
  return {
    seams: {
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
      onRetry: (notice) => {
        notices.push(notice);
      },
    },
    notices: () => [...notices],
    waits: () => [...waits],
  };
}
