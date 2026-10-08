/**
 * The retry of the project's `gh` calls
 * (`.rafa/specs/rafa-924-board-project-fixes.md`, "Network errors
 * retried"): {@link classifyFailure} sorts what a failed call wrote on
 * stderr into a class that is tried again and one that never is, and
 * {@link retryingGhRunner} wraps a `GhRunner` (`src/adapters/tracker/github.ts`)
 * so a call that failed in the retried class is sent again after a wait.
 *
 * ## The classes
 *
 * | Class | Matched on stderr |
 * |---|---|
 * | never retried | a rate-limit refusal (`RATE_LIMITED`, `rate limit`), a missing scope (`INSUFFICIENT_SCOPES`, `not been granted the required scopes`, `needs the "<scope>" scope`), a GraphQL error GitHub gave on purpose (`NOT_FOUND`, `Could not resolve to`) |
 * | retried | a timeout (`operation timed out`, `i/o timeout`, `TLS handshake timeout`), a reset or closed connection (`connection reset`, `EOF`), an HTTP 502, 503 or 504 (`HTTP 502` and so on) |
 * | never retried | anything else: an unknown error counts as permanent |
 *
 * The never-retried words are read first, so an answer GitHub gave on
 * purpose is never sent again even when its text also holds a retried
 * word. An unknown error counts as permanent, so the worst case is the
 * behaviour before this module: the call fails once.
 *
 * Only `read: operation timed out` is a reading: it is what `gh` wrote
 * on the POST to `api.github.com/graphql` for issue #725 in the first
 * live run on 2026-10-07. The other retried words are the spec's list,
 * NOT readings: no run met them. The never-retried words are the ones
 * `./refresh-warnings.ts` and `./writes.ts` already match, from GitHub's
 * documentation. The runner's own deadline (`GhRunnerOptions.timeoutMs`)
 * answers `timed out after <n>ms and was killed`, which matches none of
 * the retried words, so a call killed at its deadline is not tried again.
 *
 * ## The wait
 *
 * Before the first retry the wrapper waits `board.project.retryWaitSeconds`,
 * then twice that before each later one, and a call stops after
 * `board.project.retries` retries, answering its last failure as it came.
 * With the defaults (3 retries from 2 s) one call waits 2 + 4 + 8 = 14 s
 * at most. `retries: false` hands back the runner itself, so every call
 * is sent once. The wait goes through an injected `sleep`, `Bun.sleep`
 * when left out, so no test waits.
 *
 * Each retry is reported to `onRetry` before its wait, with the retry's
 * place (`1 of 3`), the matched words as its reason, the call's
 * {@link callSubject} and the wait. The wrapper prints nothing: the
 * commands render the `retrying #725 (1 of 3): operation timed out` line
 * or its json event.
 */
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { BoardProjectRetries } from '../../config-schema-board-project.js';

/** What a failed call's stderr says about sending it again. */
export type FailureClass = 'retried' | 'permanent';

/** A failed call, sorted: its class and the words that decided it. */
export interface FailureReading {
  readonly kind: FailureClass;
  /**
   * The words matched, as `gh` wrote them, or the last line of stderr
   * (`unknown error` when it is empty) for an unknown error.
   */
  readonly reason: string;
}

/** Words of an answer GitHub gave on purpose: never retried. */
const NEVER_RETRIED: readonly RegExp[] = Object.freeze([
  /RATE_LIMITED|(?:secondary )?rate limit/iu,
  /INSUFFICIENT_SCOPES|not been granted the required scopes|needs the "[^"]*" scope/u,
  /NOT_FOUND|Could not resolve to [^\n]*/u,
]);

/** Words of a network failure: retried. */
const RETRIED: readonly RegExp[] = Object.freeze([
  /operation timed out|i\/o timeout|TLS handshake timeout/u,
  /connection reset|\bEOF\b/u,
  /\bHTTP 50[234]\b/u,
]);

/** The reason of an unknown error with nothing on stderr. */
const UNKNOWN_REASON = 'unknown error';

/** The first match of any of `patterns` in `text`, or undefined. */
function firstMatch(patterns: readonly RegExp[], text: string): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match !== null) return match[0];
  }
  return undefined;
}

/** The last non-blank line of `text`, trimmed, or {@link UNKNOWN_REASON}. */
function lastLine(text: string): string {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return lines.at(-1) ?? UNKNOWN_REASON;
}

/** Sorts a failed call's stderr into its class; see the module note. */
export function classifyFailure(stderr: string): FailureReading {
  const permanent = firstMatch(NEVER_RETRIED, stderr);
  if (permanent !== undefined) return { kind: 'permanent', reason: permanent };
  const retried = firstMatch(RETRIED, stderr);
  if (retried !== undefined) return { kind: 'retried', reason: retried };
  return { kind: 'permanent', reason: lastLine(stderr) };
}

/** The value of the `-F number=<n>` argument, when the call carries one. */
export function callNumber(args: readonly string[]): number | undefined {
  for (let index = 0; index + 1 < args.length; index += 1) {
    const value = args[index + 1] ?? '';
    if (args[index] !== '-F' || !value.startsWith('number=')) continue;
    const number = Number(value.slice('number='.length));
    if (Number.isSafeInteger(number)) return number;
  }
  return undefined;
}

/** The first field a GraphQL query text selects, after its first `{`. */
const FIRST_FIELD = /\{\s*([A-Za-z_]\w*)/u;

/**
 * What a retry line names: `#<n>` when the call carries `-F number=<n>`,
 * otherwise the first field its `query=` text selects, otherwise the
 * `gh` subcommand.
 */
export function callSubject(args: readonly string[]): string {
  const number = callNumber(args);
  if (number !== undefined) return `#${String(number)}`;
  const query = args.find((arg) => arg.startsWith('query='));
  const field = query === undefined
    ? undefined
    : FIRST_FIELD.exec(query)?.[1];
  return field ?? args.slice(0, 2).join(' ');
}

/** One retry, as {@link RetryOptions.onRetry} hears it before its wait. */
export interface RetryNotice {
  /** The retry's place, from 1. */
  readonly attempt: number;
  /** The most retries the call is given: `board.project.retries`. */
  readonly of: number;
  /** The words the failure matched, `operation timed out` say. */
  readonly reason: string;
  /** What the call reads; see {@link callSubject}. */
  readonly subject: string;
  /** The issue the call names, when it carries `-F number=<n>`. */
  readonly number: number | undefined;
  /** The wait before this retry, in milliseconds. */
  readonly waitMs: number;
  /** The arguments the call is sent with. */
  readonly args: readonly string[];
}

/** What {@link retryingGhRunner} is made with. */
export interface RetryOptions {
  /** `board.project.retries`: the retries per call, or `false` for none. */
  readonly retries: BoardProjectRetries;
  /** `board.project.retryWaitSeconds`: the first wait; each later one doubles. */
  readonly retryWaitSeconds: number;
  /** The wait before a retry; `Bun.sleep` when left out. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Hears each retry before its wait. */
  readonly onRetry?: (notice: RetryNotice) => void;
}

/** Milliseconds in a second. */
const MS_PER_SECOND = 1000;

/** True for a whole number of at least `min`. */
function isWholeFrom(value: number, min: number): boolean {
  return Number.isSafeInteger(value) && value >= min;
}

/** Throws a `RangeError` for a retry count or wait the config schema would refuse. */
function checkOptions(options: RetryOptions): void {
  if (options.retries !== false && !isWholeFrom(options.retries, 1)) {
    throw new RangeError(`board.project.retries must be false or a whole number from 1, not ${String(options.retries)}`);
  }
  if (!isWholeFrom(options.retryWaitSeconds, 1)) {
    throw new RangeError(`board.project.retryWaitSeconds must be a whole number from 1, not ${String(options.retryWaitSeconds)}`);
  }
}

/**
 * `gh` wrapped so a call failing in the retried class is sent again, up
 * to `options.retries` times with a doubling wait; see the module note.
 * A retry count or first wait the config schema would refuse throws a
 * `RangeError` when the wrapper is made.
 */
export function retryingGhRunner(gh: GhRunner, options: RetryOptions): GhRunner {
  checkOptions(options);
  const { retries, retryWaitSeconds, onRetry } = options;
  if (retries === false) return gh;
  const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms));
  return async (args, stdin) => {
    let result: GhResult = await gh(args, stdin);
    for (let attempt = 1; attempt <= retries && !result.ok; attempt += 1) {
      const reading = classifyFailure(result.stderr);
      if (reading.kind === 'permanent') return result;
      const waitMs = retryWaitSeconds * MS_PER_SECOND * 2 ** (attempt - 1);
      onRetry?.({
        attempt,
        of: retries,
        reason: reading.reason,
        subject: callSubject(args),
        number: callNumber(args),
        waitMs,
        args,
      });
      await sleep(waitMs);
      result = await gh(args, stdin);
    }
    return result;
  };
}
