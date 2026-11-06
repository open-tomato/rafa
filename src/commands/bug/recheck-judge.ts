/**
 * The per-bug judge of `rafa bug recheck` (#953): every bug already read
 * off the tracker, judged into one {@link RecheckRow} each, in the order
 * given. The command (`./recheck.ts`) reads the line, the tracker and
 * the config, and hands the bugs here with {@link JudgeBugsOptions}.
 *
 * ## One bug
 *
 * The `Rerun` value of the body's record (`parseBugRecord`) is read
 * strictly through `readTestReference`, and a value it refuses is a
 * `manual` row carrying the record's `Reproduce` text. A runnable one is
 * resolved against the checkout: a file outside it is `manual`, a file
 * not there `stale`.
 *
 * Then trust, for a runnable bug only, and never on the `local` tracker,
 * which holds no accounts. The author is the one the bug was read with,
 * else `editable(ref).author`, read once per bug, and weighed by
 * `readBoardTrust` over the lazy {@link JudgeBugsOptions.trust} once per
 * login, so a recheck with no runnable bug off `local` never builds the
 * `BoardTrust`. An author the tracker does not name, and a tracker
 * without `editable`, read as a refusal. An untrusted author is a
 * `skipped` row opening "opened by <login>, " with
 * `trustRefusalClause`'s reason, and nothing runs for it.
 *
 * Only then does the `recheck` runner run the reference, with
 * `1 + runs` runs at most, each under `timeoutMs`. A bug whose runs
 * passed a deadline gets a warning through `warn` saying how many timed
 * out.
 *
 * ## The environment and the JUnit files
 *
 * The child's environment is `suiteEnv(env)` with every variable the
 * named `secrets` name removed, and the answer lists those names, sorted
 * and once each, as `secretsLeftOut`. Each bug's JUnit files go in a
 * folder `issue-<n>` of its own under one `mkdtempSync` directory in
 * `tmpdir()`, removed in `finally`, so a runner that throws leaves none
 * behind; the throw is not caught.
 */
import type { RecheckRow } from './recheck-report.js';
import type { RecheckBugOptions, RecheckRun } from './recheck-run.js';
import type { SpawnEnv } from '@open-tomato/rafa/core/loop';
import type { IssueRef, Tracker } from '@open-tomato/rafa/ports';
import type { NamedSecret } from '@open-tomato/rafa/triage/filed-text';
import type { BoardTrust, TrustReading } from '@open-tomato/rafa-board';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { issueName, readBoardTrust, trustRefusalClause } from '@open-tomato/rafa-board';

import { parseBugRecord } from '@open-tomato/rafa/bugs/record';
import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { suiteEnv } from '@open-tomato/rafa/suite/run';

import { readTestReference, resolveTestReference } from '../../bugs/test-reference.js';

import { referenceText } from './recheck-report.js';

/** The tracker kind that holds no accounts, so no author is weighed on it. */
const LOCAL_KIND = 'local';

/** The milliseconds of a second, for a deadline written in seconds. */
export const MS_PER_SECOND = 1000;

/** One bug as read off the tracker. */
export interface ReadBug {
  readonly ref: IssueRef;
  readonly issue: number;
  readonly title: string;
  readonly body: string;
  /** The author as already read, `''` for none the tracker names, or null when it is yet to be read. */
  readonly author: string | null;
}

/** What {@link judgeBugs} judges every bug with; see the module note. */
export interface JudgeBugsOptions {
  /** The tracker the bugs were read off, asked for an author not yet read. */
  readonly tracker: Tracker;
  /** The board trust authors are weighed by, built on its first call only. */
  readonly trust: () => BoardTrust;
  /** The checkout a reference is resolved against and run in. */
  readonly checkout: string;
  /** The base environment the child's is made from. */
  readonly env: Readonly<SpawnEnv>;
  /** The named secrets left out of the child's environment. */
  readonly secrets: readonly NamedSecret[];
  /** The further runs after a first pass. */
  readonly runs: number;
  /** One run's deadline, in milliseconds. */
  readonly timeoutMs: number;
  /** What rechecks one runnable bug. */
  readonly recheck: (options: RecheckBugOptions) => Promise<RecheckRun>;
  /** Where a warning goes. */
  readonly warn: (message: string) => void;
}

/** What {@link judgeBugs} answers: a row per bug in the order given, and the names left out of the child's environment. */
export interface JudgedBugs {
  readonly rows: readonly RecheckRow[];
  readonly secretsLeftOut: readonly string[];
}

/** What answers why a runnable bug is not to run, or null when it may. */
type TrustGate = (bug: ReadBug) => Promise<string | null>;

/** What every bug of one recheck is checked with. */
interface BugContext {
  readonly checkout: string;
  readonly env: Readonly<SpawnEnv>;
  readonly runs: number;
  readonly timeoutMs: number;
  readonly junitRoot: string;
  readonly trust: TrustGate;
  readonly recheck: (options: RecheckBugOptions) => Promise<RecheckRun>;
  readonly warn: (message: string) => void;
}

/** A row of `bug` with the fields `fields` gives, the rest empty. */
export function rowOf(bug: Pick<ReadBug, 'issue' | 'title'>, fields: Pick<RecheckRow, 'verdict'> & Partial<RecheckRow>): RecheckRow {
  return {
    issue: bug.issue,
    title: bug.title,
    reference: null,
    runs: 0,
    failedRuns: null,
    reason: null,
    reproduce: null,
    commented: false,
    ...fields,
  };
}

/** The author of `bug`: as already read, else `editable(ref).author`, `''` for none the tracker gives. */
async function authorOf(tracker: Tracker, bug: ReadBug): Promise<string> {
  if (bug.author !== null) return bug.author;
  if (tracker.editable === undefined) return '';
  return (await tracker.editable(bug.ref)).author;
}

/**
 * The trust gate of `tracker`: none on `local`; otherwise the author
 * weighed through `readBoardTrust` once per login, a refusal answered as
 * the row's reason. See the module note.
 */
function trustGateOf(tracker: Tracker, trust: () => BoardTrust): TrustGate {
  if (tracker.kind === LOCAL_KIND) return () => Promise.resolve(null);
  const readings = new Map<string, Promise<TrustReading>>();
  return async (bug) => {
    let author: string;
    try {
      author = await authorOf(tracker, bug);
    } catch (error) {
      return `could not read who opened ${issueName(bug.ref)}: ${messageOf(error)}`;
    }
    if (author === '') return `the ${tracker.kind} tracker names nobody who opened it, so no trust was read`;
    const board = trust();
    const key = author.toLowerCase();
    const reading = readings.get(key) ?? readBoardTrust(board, author);
    readings.set(key, reading);
    const answered = await reading;
    return answered.trusted
      ? null
      : `opened by ${author}, ${trustRefusalClause(board.repo, answered)}`;
  };
}

/** The row of one bug read off the tracker; see the module note. */
async function checkBug(bug: ReadBug, context: BugContext): Promise<RecheckRow> {
  const record = parseBugRecord(bug.body);
  const read = readTestReference(record.rerun);
  if (read.kind === 'manual') return rowOf(bug, { verdict: 'manual', reason: read.reason, reproduce: record.reproduce });

  const reference = { file: read.file, pattern: read.pattern };
  const resolved = resolveTestReference(read, context.checkout);
  if (resolved.kind === 'outside') {
    return rowOf(bug, { verdict: 'manual', reference, reason: `${read.file} lies outside the checkout`, reproduce: record.reproduce });
  }
  if (resolved.kind === 'missing') return rowOf(bug, { verdict: 'stale', reference, reason: `no file ${read.file} in the checkout` });

  const refused = await context.trust(bug);
  if (refused !== null) return rowOf(bug, { verdict: 'skipped', reference, reason: refused });

  const run = await context.recheck({
    path: resolved.path,
    pattern: read.pattern,
    checkout: context.checkout,
    env: context.env,
    runs: context.runs,
    timeoutMs: context.timeoutMs,
    junitDir: join(context.junitRoot, `issue-${bug.issue}`),
  });
  if (run.timedOutRuns > 0) {
    context.warn(`${issueName(bug.ref)}: ${run.timedOutRuns} of ${run.runs} runs timed out after ${context.timeoutMs / MS_PER_SECOND}s`);
  }
  return rowOf(bug, {
    verdict: run.verdict,
    reference,
    runs: run.runs,
    failedRuns: run.failedRuns,
    reason: run.verdict === 'stale'
      ? `no case of ${referenceText(reference)} was judged`
      : null,
  });
}

/** The child's environment and the names left out of it: `suiteEnv(base)` without each named secret. */
function childEnvOf(base: Readonly<SpawnEnv>, secrets: readonly NamedSecret[]): { env: SpawnEnv; leftOut: readonly string[] } {
  const leftOut = [...new Set(secrets.map((secret) => secret.name))].sort();
  const env = Object.fromEntries(Object.entries(suiteEnv(base)).filter(([name]) => !leftOut.includes(name)));
  return { env, leftOut };
}

/** Judges `bugs` one after another over `options`; see the module note. */
export async function judgeBugs(bugs: readonly ReadBug[], options: JudgeBugsOptions): Promise<JudgedBugs> {
  const { env, leftOut } = childEnvOf(options.env, options.secrets);
  const junitRoot = mkdtempSync(join(tmpdir(), 'rafa-bug-recheck-'));
  try {
    const context: BugContext = {
      checkout: options.checkout,
      env,
      runs: options.runs,
      timeoutMs: options.timeoutMs,
      junitRoot,
      trust: trustGateOf(options.tracker, options.trust),
      recheck: options.recheck,
      warn: options.warn,
    };
    const rows: RecheckRow[] = [];
    for (const bug of bugs) rows.push(await checkBug(bug, context));
    return { rows, secretsLeftOut: leftOut };
  } finally {
    rmSync(junitRoot, { recursive: true, force: true });
  }
}
