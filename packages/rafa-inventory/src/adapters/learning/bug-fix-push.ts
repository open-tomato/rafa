/**
 * Pushing bug-fix pairs into the `local` library, once each.
 *
 * {@link pushBugFixPairs} takes the pairs `pairBugFixes` answered
 * (`../../report/bug-fix-pairs.js`) and pushes each lesson through a
 * `local` adapter made from the options, with `now` as its clock. It
 * answers which pairs it pushed, which it skipped, and one problem line
 * for each pair whose lesson the adapter refused. It throws only when the
 * push log cannot be read.
 *
 * ## The key and the log
 *
 * A pair's key ({@link PushLogPair}, {@link bugFixPairKey}) is its
 * issue's reference, the bug's tracker URL (or `<kind>:<externalId>` for
 * a reference with none), and `filed_by`, the session that filed the bug.
 * Every decision a pair push makes is logged under the rule
 * `bug-fix-pair` with its pair's key, in place of the rule the merge
 * gave it, through the adapter's `logLine` option. The other fields of
 * the line are the adapter's.
 *
 * {@link readLoggedPairs} reads those keys back out of the push log,
 * `instincts.ndjson` under the library's directory: each line naming the
 * rule `bug-fix-pair` and a key whose `ref` and `filed_by` are strings,
 * once each, in log order. A missing file holds none. A line that is not
 * JSON, as a run killed mid-append leaves, or that names another rule or
 * no such key, is passed over: the worst it costs is a pair pushed again,
 * which `merge` settles as `same-action` onto its own sources.
 *
 * ## What a push does
 *
 * The log is read once, before anything is pushed. A pair whose key it
 * holds is skipped, so a second push of the same pairs writes no file
 * and appends no line. Pairs of one run that share a key, two loops that
 * fixed one filed bug, are each pushed: the key says the bug was paired,
 * and the run pairs it with both.
 *
 * The rest are pushed one payload per fixing session, in the order each
 * session first appears, its pairs in their order. The payload's
 * `source_id` is the fixing session and each lesson carries both
 * sessions in `sources`, so `merge` keeps both and the lesson's
 * `usage_count` is 2. The adapter refuses a payload whole, so when it
 * refuses one of several pairs, each of its pairs is pushed again alone:
 * the refused one costs one problem line and the others are pushed.
 *
 * No pair or value passed in is changed.
 */
import type { LocalLearningOptions, PushLogLine } from './local.js';
import type { BugFixPair } from '../../report/bug-fix-pairs.js';

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isMapping, messageOf } from '@open-tomato/rafa/core/config/sections';

import { createLocalLearning, PUSH_LOG_FILE } from './local.js';

/** The rule each decision of a pair push is logged under. */
export const BUG_FIX_PAIR_RULE = 'bug-fix-pair';

/** A pair's key in the push log: the issue's reference and the filing session. */
export type PushLogPair = NonNullable<PushLogLine['pair']>;

/** What a pair push is made with: the `local` adapter's options, its clock and log hook apart. */
export type BugFixPushOptions = Omit<LocalLearningOptions, 'now' | 'logLine'>;

/** What {@link pushBugFixPairs} answers. */
export interface BugFixPush {
  /** The pairs whose lessons were pushed, in push order. */
  readonly pushed: readonly BugFixPair[];
  /** The pairs whose key the push log already held, in their order. */
  readonly skipped: readonly BugFixPair[];
  /** One line per pair whose lesson the adapter refused, naming its key and the refusal. */
  readonly problems: readonly string[];
}

/** `pair`'s key, as its push-log lines hold it. */
export function bugFixPairKey(pair: BugFixPair): PushLogPair {
  const { trackerRef, sessionId } = pair.bug;
  return { ref: trackerRef.url ?? `${trackerRef.kind}:${trackerRef.externalId}`, filed_by: sessionId };
}

/** One string per key, equal for equal keys. */
function keyText(key: PushLogPair): string {
  return JSON.stringify([key.ref, key.filed_by]);
}

/** True when `error` carries the system error code `code`. */
function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

/** The key a push-log line holds under `bug-fix-pair`, or null when it holds none. */
function loggedKey(line: string): PushLogPair | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isMapping(value) || value.rule !== BUG_FIX_PAIR_RULE || !isMapping(value.pair)) return null;
  const { ref, filed_by: filedBy } = value.pair;
  return typeof ref === 'string' && typeof filedBy === 'string'
    ? { ref, filed_by: filedBy }
    : null;
}

/**
 * Every pair key the push log under `dir` holds, once each, in log
 * order; none when the log does not exist. Rejects when it exists and
 * cannot be read. See the module note.
 *
 * @param dir - the library's directory, as `localInstinctsDir` answers it.
 */
export async function readLoggedPairs(dir: string): Promise<PushLogPair[]> {
  let contents: string;
  try {
    contents = await readFile(join(dir, PUSH_LOG_FILE), 'utf8');
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return [];
    throw error;
  }
  const keys = new Map<string, PushLogPair>();
  for (const line of contents.split('\n')) {
    const key = line === ''
      ? null
      : loggedKey(line);
    if (key !== null && !keys.has(keyText(key))) keys.set(keyText(key), key);
  }
  return [...keys.values()];
}

/** `pairs` grouped by fixing session, each session in the order it first appears. */
function byFixingSession(pairs: readonly BugFixPair[]): BugFixPair[][] {
  const groups = new Map<string, BugFixPair[]>();
  for (const pair of pairs) {
    const group = groups.get(pair.fix.sessionId);
    if (group === undefined) groups.set(pair.fix.sessionId, [pair]);
    else group.push(pair);
  }
  return [...groups.values()];
}

/** The line a refused pair costs. */
function problemLine(pair: BugFixPair, refusal: string): string {
  const key = bugFixPairKey(pair);
  return `bug-fix pair ${key.ref} filed by ${key.filed_by} was not pushed: ${refusal}`;
}

/**
 * Pushes `group`, the pairs of one fixing session, as one payload, its
 * log lines under `bug-fix-pair` with each pair's key. Answers null once
 * pushed, else the push's refusal, the adapter having written nothing.
 */
async function pushGroup(
  options: BugFixPushOptions,
  group: readonly BugFixPair[],
  now: string,
): Promise<string | null> {
  const keys = group.map(bugFixPairKey);
  const learning = createLocalLearning({
    ...options,
    now: () => now,
    logLine: (line, index) => ({ ...line, rule: BUG_FIX_PAIR_RULE, pair: keys[index]! }),
  });
  try {
    await learning.push({ source_id: group[0]!.fix.sessionId, instincts: group.map((pair) => pair.lesson) });
    return null;
  } catch (error) {
    return messageOf(error);
  }
}

/**
 * Pushes each pair of `pairs` whose key the push log does not hold, one
 * payload per fixing session, and answers what it pushed, skipped and
 * could not push. See the module note.
 *
 * @param options - the `local` adapter's options; its `instinctsDir` is the library pushed into.
 * @param pairs - the pairs `pairBugFixes` answered.
 * @param now - the clock every merge is stamped from.
 * @returns the pairs pushed and skipped, and one problem line per pair refused.
 */
export async function pushBugFixPairs(
  options: BugFixPushOptions,
  pairs: readonly BugFixPair[],
  now: Date,
): Promise<BugFixPush> {
  const logged = new Set((await readLoggedPairs(options.instinctsDir)).map(keyText));
  const isLogged = (pair: BugFixPair): boolean => logged.has(keyText(bugFixPairKey(pair)));
  const stamp = now.toISOString();
  const pushed: BugFixPair[] = [];
  const problems: string[] = [];
  for (const group of byFixingSession(pairs.filter((pair) => !isLogged(pair)))) {
    const refusal = await pushGroup(options, group, stamp);
    if (refusal === null) {
      pushed.push(...group);
    } else if (group.length === 1) {
      problems.push(problemLine(group[0]!, refusal));
    } else {
      for (const pair of group) {
        const alone = await pushGroup(options, [pair], stamp);
        if (alone === null) pushed.push(pair);
        else problems.push(problemLine(pair, alone));
      }
    }
  }
  return { pushed, skipped: pairs.filter(isLogged), problems };
}
