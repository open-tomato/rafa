import type { RetryNotice } from './retry.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';

import { describe, expect, test } from 'bun:test';

import { callNumber, callSubject, classifyFailure, retryingGhRunner } from './retry.js';

/** The stderr `gh` wrote for issue #725 in the live run of 2026-10-07. */
const MEASURED_TIMEOUT = 'Post "https://api.github.com/graphql": read tcp 10.0.0.2:50000->140.82.112.6:443: read: operation timed out';

/** Each retried word of the spec, inside a stderr line `gh` could write. */
const RETRIED_CASES: readonly (readonly [stderr: string, reason: string])[] = [
  [MEASURED_TIMEOUT, 'operation timed out'],
  ['Post "https://api.github.com/graphql": dial tcp: i/o timeout', 'i/o timeout'],
  ['Post "https://api.github.com/graphql": net/http: TLS handshake timeout', 'TLS handshake timeout'],
  ['Post "https://api.github.com/graphql": read: connection reset by peer', 'connection reset'],
  ['Post "https://api.github.com/graphql": EOF', 'EOF'],
  ['HTTP 502: Bad Gateway (https://api.github.com/graphql)', 'HTTP 502'],
  ['HTTP 503: Service Unavailable (https://api.github.com/graphql)', 'HTTP 503'],
  ['HTTP 504: Gateway Timeout (https://api.github.com/graphql)', 'HTTP 504'],
];

/** Each never-retried answer, inside a stderr line `gh` could write. */
const PERMANENT_CASES: readonly (readonly [name: string, stderr: string, reason: string])[] = [
  ['NOT_FOUND', '{"errors":[{"type":"NOT_FOUND","message":"Could not resolve to an Issue with the number of 9999."}]}', 'NOT_FOUND'],
  ['a bad id', 'GraphQL: Could not resolve to a node with the global id of \'X_bad\' (node)', 'Could not resolve to a node with the global id of \'X_bad\' (node)'],
  ['a missing scope', 'GraphQL: Your token has not been granted the required scopes to execute this query. The \'id\' field requires one of the following scopes: [\'read:project\'] (INSUFFICIENT_SCOPES)', 'not been granted the required scopes'],
  ['a scope hint from gh', 'error: your authentication token is missing required scopes [read:project]\nTo request it, run:  gh auth refresh -s read:project\nneeds the "read:project" scope', 'needs the "read:project" scope'],
  ['a rate-limit refusal', 'GraphQL: API rate limit exceeded for user ID 1. (RATE_LIMITED)', 'rate limit'],
  ['a secondary rate limit over a 503 word', 'HTTP 403: You have exceeded a secondary rate limit (https://api.github.com/graphql)', 'secondary rate limit'],
];

/** A runner answering `answers` in turn, the last one again once they run out, recording each call. */
function scripted(answers: readonly GhResult[]): { readonly gh: GhRunner; readonly calls: (readonly [readonly string[], string | undefined])[] } {
  const calls: (readonly [readonly string[], string | undefined])[] = [];
  const gh: GhRunner = (args, stdin) => {
    calls.push([args, stdin]);
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (answer === undefined) throw new Error('scripted runner holds no answer');
    return Promise.resolve(answer);
  };
  return { gh, calls };
}

/** A failed call with `stderr`. */
function failure(stderr: string): GhResult {
  return { ok: false, stdout: '', stderr };
}

const SUCCESS: GhResult = { ok: true, stdout: '{"data":{}}', stderr: '' };

/** A content lookup for issue #725, as `./gh.ts` builds it. */
const LOOKUP_ARGS = Object.freeze(['api', 'graphql', '-f', 'owner=o', '-f', 'name=r', '-F', 'number=725', '-f', 'query=query($owner: String!) { repository(owner: $owner) { id } }']);

/** An add, which carries no number. */
const ADD_ARGS = Object.freeze(['api', 'graphql', '-f', 'project=P', '-f', 'content=C', '-f', 'query=mutation($project: ID!) { addProjectV2ItemById(input: {}) { item { id } } }']);

/** A sleep recording each wait and waiting for none. */
function recordedSleep(): { readonly sleep: (ms: number) => Promise<void>; readonly waits: number[] } {
  const waits: number[] = [];
  return { waits, sleep: (ms) => {
    waits.push(ms);
    return Promise.resolve();
  } };
}

describe('classifyFailure', () => {
  for (const [stderr, reason] of RETRIED_CASES) {
    test(`retries ${reason}`, () => {
      expect(classifyFailure(stderr)).toEqual({ kind: 'retried', reason });
    });
  }

  for (const [name, stderr, reason] of PERMANENT_CASES) {
    test(`never retries ${name}`, () => {
      expect(classifyFailure(stderr)).toEqual({ kind: 'permanent', reason });
    });
  }

  test('counts an unknown error as permanent, naming its last line', () => {
    expect(classifyFailure('something odd\nunexpected failure: 42\n')).toEqual({ kind: 'permanent', reason: 'unexpected failure: 42' });
  });

  test('counts an empty stderr as a permanent unknown error', () => {
    expect(classifyFailure('  \n')).toEqual({ kind: 'permanent', reason: 'unknown error' });
  });

  test('does not retry the runner\'s own deadline', () => {
    expect(classifyFailure('gh in /repo timed out after 30000ms and was killed').kind).toBe('permanent');
  });

  test('does not read EOF inside a longer word', () => {
    expect(classifyFailure('GEOFENCE refused').kind).toBe('permanent');
  });

  test('does not retry an HTTP 500 or 501', () => {
    expect(classifyFailure('HTTP 500: Internal Server Error').kind).toBe('permanent');
    expect(classifyFailure('HTTP 501: Not Implemented').kind).toBe('permanent');
  });
});

describe('callNumber and callSubject', () => {
  test('name the issue a call carries as -F number=<n>', () => {
    expect(callNumber(LOOKUP_ARGS)).toBe(725);
    expect(callSubject(LOOKUP_ARGS)).toBe('#725');
  });

  test('name the first field a call without a number selects', () => {
    expect(callNumber(ADD_ARGS)).toBeUndefined();
    expect(callSubject(ADD_ARGS)).toBe('addProjectV2ItemById');
  });

  test('ignore a number passed as -f, which is a string variable', () => {
    expect(callNumber(['api', 'graphql', '-f', 'number=725'])).toBeUndefined();
  });

  test('fall back to the gh subcommand when no query is sent', () => {
    expect(callSubject(['issue', 'view', '7'])).toBe('issue view');
  });
});

describe('retryingGhRunner', () => {
  test('retries a timeout twice and answers the success that follows, doubling the wait', async () => {
    const { gh, calls } = scripted([failure(MEASURED_TIMEOUT), failure(MEASURED_TIMEOUT), SUCCESS]);
    const { sleep, waits } = recordedSleep();
    const notices: RetryNotice[] = [];
    const runner = retryingGhRunner(gh, { retries: 3, retryWaitSeconds: 2, sleep, onRetry: (notice) => notices.push(notice) });

    const result = await runner(LOOKUP_ARGS, 'in');

    expect(result).toEqual(SUCCESS);
    expect(calls).toEqual([[LOOKUP_ARGS, 'in'], [LOOKUP_ARGS, 'in'], [LOOKUP_ARGS, 'in']]);
    expect(waits).toEqual([2000, 4000]);
    expect(notices).toEqual([
      { attempt: 1, of: 3, reason: 'operation timed out', subject: '#725', number: 725, waitMs: 2000, args: LOOKUP_ARGS },
      { attempt: 2, of: 3, reason: 'operation timed out', subject: '#725', number: 725, waitMs: 4000, args: LOOKUP_ARGS },
    ]);
  });

  test('stops after the configured retries and answers the last failure, waiting 2 + 4 + 8 s', async () => {
    const last = failure('HTTP 503: Service Unavailable');
    const { gh, calls } = scripted([failure(MEASURED_TIMEOUT), failure('EOF'), failure('i/o timeout'), last]);
    const { sleep, waits } = recordedSleep();
    const runner = retryingGhRunner(gh, { retries: 3, retryWaitSeconds: 2, sleep });

    expect(await runner(ADD_ARGS)).toEqual(last);
    expect(calls).toHaveLength(4);
    expect(waits).toEqual([2000, 4000, 8000]);
  });

  for (const [stderr, reason] of RETRIED_CASES) {
    test(`sends a call failing on ${reason} again`, async () => {
      const { gh, calls } = scripted([failure(stderr), SUCCESS]);
      const runner = retryingGhRunner(gh, { retries: 1, retryWaitSeconds: 1, sleep: recordedSleep().sleep });

      expect(await runner(ADD_ARGS)).toEqual(SUCCESS);
      expect(calls).toHaveLength(2);
    });
  }

  for (const [name, stderr] of PERMANENT_CASES) {
    test(`sends a call refused with ${name} once, with no wait and no notice`, async () => {
      const refusal = failure(stderr);
      const { gh, calls } = scripted([refusal, SUCCESS]);
      const { sleep, waits } = recordedSleep();
      const notices: RetryNotice[] = [];
      const runner = retryingGhRunner(gh, { retries: 3, retryWaitSeconds: 2, sleep, onRetry: (notice) => notices.push(notice) });

      expect(await runner(LOOKUP_ARGS)).toEqual(refusal);
      expect(calls).toHaveLength(1);
      expect(waits).toEqual([]);
      expect(notices).toEqual([]);
    });
  }

  test('sends a call failing on an unknown error once', async () => {
    const unknown = failure('something nobody recorded');
    const { gh, calls } = scripted([unknown, SUCCESS]);
    const runner = retryingGhRunner(gh, { retries: 3, retryWaitSeconds: 2, sleep: recordedSleep().sleep });

    expect(await runner(ADD_ARGS)).toEqual(unknown);
    expect(calls).toHaveLength(1);
  });

  test('stops retrying when a retried failure turns into a permanent one', async () => {
    const refusal = failure('{"errors":[{"type":"NOT_FOUND"}]}');
    const { gh, calls } = scripted([failure(MEASURED_TIMEOUT), refusal, SUCCESS]);
    const { sleep, waits } = recordedSleep();
    const runner = retryingGhRunner(gh, { retries: 3, retryWaitSeconds: 2, sleep });

    expect(await runner(ADD_ARGS)).toEqual(refusal);
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([2000]);
  });

  test('sends a successful call once', async () => {
    const { gh, calls } = scripted([SUCCESS]);
    const runner = retryingGhRunner(gh, { retries: 3, retryWaitSeconds: 2, sleep: recordedSleep().sleep });

    expect(await runner(ADD_ARGS)).toEqual(SUCCESS);
    expect(calls).toHaveLength(1);
  });

  test('with retries: false sends a timed-out call once and hands back the runner itself', async () => {
    const timeout = failure(MEASURED_TIMEOUT);
    const { gh, calls } = scripted([timeout, SUCCESS]);
    const { sleep, waits } = recordedSleep();
    const runner = retryingGhRunner(gh, { retries: false, retryWaitSeconds: 2, sleep });

    expect(runner).toBe(gh);
    expect(await runner(LOOKUP_ARGS)).toEqual(timeout);
    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  test('refuses a retry count or wait the config schema would refuse', () => {
    const { gh } = scripted([SUCCESS]);
    expect(() => retryingGhRunner(gh, { retries: 0, retryWaitSeconds: 2 })).toThrow(RangeError);
    expect(() => retryingGhRunner(gh, { retries: -1, retryWaitSeconds: 2 })).toThrow(RangeError);
    expect(() => retryingGhRunner(gh, { retries: 3, retryWaitSeconds: 0 })).toThrow(RangeError);
    expect(() => retryingGhRunner(gh, { retries: 1, retryWaitSeconds: 1 })).not.toThrow();
  });
});
