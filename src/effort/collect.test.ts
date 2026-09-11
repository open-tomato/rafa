/**
 * Tests for the effort collector's orchestration.
 *
 * Two halves, matching what the module actually owns. The FLAG PARSER
 * is pure and is driven exhaustively, including the three refusals
 * whose whole purpose is that a mistake cannot pass for a clean run —
 * an unreadable `--since`, an unrecognised argument, and both halves
 * switched off at once. The SKIP PATH is driven twice over: purely
 * through {@link selectSessionLogs} and {@link selectCommits}, where
 * the bucket arithmetic is checkable, and end to end through
 * {@link collectEffort} over a planted log tree in a temporary
 * directory, where a second run has to append nothing.
 *
 * The planted logs are built from {@link PROMPT_SHAPES} rather than
 * from a transcribed prompt literal. Nothing here is trying to test
 * the classifier — that file has its own drift guard against the
 * source that injects each prompt — so deriving the prefix keeps this
 * suite pinned to what it is about, which is whether attribution
 * reaches the row at all.
 *
 * No case reads the real session log directory or runs git. The
 * commit half is driven through {@link CollectOptions.readCommits},
 * which is why that seam exists; a case that shelled out to git would
 * be measuring this machine's history rather than the collector.
 *
 * The two properties with no behavioural case are named rather than
 * left implied. A row is FROZEN at whatever the log held when it was
 * read, and nothing in this suite can distinguish that from a
 * complete row, because the store's key projection makes the two
 * identical by construction — `sizeBytes` beside the counters is what
 * a reader checks instead. And the module reads each log in two
 * passes rather than one; that is unobservable from the row, exactly
 * as the streaming-versus-slurp property is unobservable in the
 * session reader beside it.
 *
 * Twenty-three module mutations were driven against this file and ALL
 * TWENTY-THREE reddened at least one case, with the restored module
 * green either side and byte-identical: dropping the `isFile` guard
 * so a directory named `*.jsonl` becomes a candidate, matching every
 * file name instead of only `.jsonl`, ordering newest first, reading
 * a missing log directory as an empty list, making the `--since`
 * bound exclusive, testing the store before the window so the two
 * buckets swap, skipping neither an already-stored session nor an
 * already-stored commit, swapping which half `--no-git` and
 * `--no-sessions` switch off, ignoring an unrecognised argument,
 * accepting a `--since` that could not be read, allowing both halves
 * to be switched off at once, letting the FIRST `--since` win instead
 * of the last, leaving a dot alone when encoding the log directory,
 * perturbing each of the two store key projections away from the id
 * the selection skips by, reading commits with the commit half
 * switched off, printing progress without `--verbose`, attributing
 * without the enqueue record, recording a zero size, rethrowing a
 * failed log read instead of counting it, and dropping the `--no-git`
 * line from the summary.
 */
import type { SessionLogCandidate } from './collect.js';
import type { CommitLogParseResult, CommitStats } from './commits.js';

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PROMPT_SHAPES } from './classify.js';
import {
  collectEffort,
  collectSessionRow,
  commitRowKey,
  formatCollectSummary,
  listSessionLogs,
  parseCollectArgs,
  parseSinceInstant,
  projectLogDirName,
  readPlanStubs,
  selectCommits,
  selectSessionLogs,
  sessionLogDir,
  sessionRowKey,
} from './collect.js';
import { readStoreRows } from './store.js';

/** The task prompt's prefix, taken from the shape that declares it. */
const TASK_PREFIX = PROMPT_SHAPES
  .find((shape) => shape.kind === 'task')?.prefix ?? '';

/**
 * Running as root defeats a permission-denied plant, so the one case
 * that needs one is skipped there rather than reporting a false red.
 */
const isRoot = process.getuid?.() === 0;

/** Temporary directories to remove once each case is done. */
const scratch: string[] = [];

afterEach(() => {
  while (scratch.length > 0) {
    const dir = scratch.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/** A temporary directory that this file's afterEach will remove. */
function makeScratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ralph-collect-'));
  scratch.push(dir);
  return dir;
}

/** One JSON record on one line. */
function record(fields: Record<string, unknown>): string {
  return JSON.stringify(fields);
}

/** The enqueue record a session's prompt arrives on. */
function enqueue(content: string): string {
  return record({
    type: 'queue-operation',
    operation: 'enqueue',
    content,
  });
}

/** One billable turn on a branch. */
function assistantTurn(branch: string, stamp: string): string {
  return record({
    type: 'assistant',
    timestamp: stamp,
    gitBranch: branch,
    entrypoint: 'sdk-cli',
    isSidechain: false,
    message: {
      model: 'claude-opus-5',
      usage: {
        input_tokens: 11,
        output_tokens: 22,
        cache_creation_input_tokens: 30,
        cache_read_input_tokens: 40,
        cache_creation: {
          ephemeral_1h_input_tokens: 30,
          ephemeral_5m_input_tokens: 0,
        },
      },
    },
  });
}

/** Writes one session log and answers its path. */
function writeLog(
  dir: string,
  sessionId: string,
  lines: readonly string[],
): string {
  const path = join(dir, `${sessionId}.jsonl`);
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}

/** A task session on one branch, with one turn. */
function taskLog(dir: string, sessionId: string, branch: string): string {
  return writeLog(dir, sessionId, [
    enqueue(`${TASK_PREFIX}Add the thing\nMore boilerplate here.`),
    assistantTurn(branch, '2026-09-08T10:00:00.000Z'),
  ]);
}

/** A candidate with no file behind it, for the pure selection cases. */
function candidate(
  sessionId: string,
  modifiedAtMs: number,
): SessionLogCandidate {
  return {
    path: `/logs/${sessionId}.jsonl`,
    sessionId,
    sizeBytes: 10,
    modifiedAtMs,
  };
}

/** A commit row carrying only what the key projection reads. */
function commitRow(sha: string): CommitStats {
  return {
    sha,
    timestamp: '2026-09-08T10:00:00+02:00',
    subject: `subject for ${sha}`,
    author: 'A Dev',
    branch: null,
    filesChanged: 1,
    insertions: 2,
    deletions: 3,
    parentCount: 1,
    minutesSincePrevious: null,
  };
}

/** A reader seam answering planted rows and counting its calls. */
function plantedCommits(rows: readonly CommitStats[]): {
  read: () => CommitLogParseResult;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    read: () => {
      calls.push('read');
      return {
        rows: rows.map((row) => ({ ...row })),
        lineCount: rows.length,
        unparsedLineCount: 0,
      };
    },
  };
}

describe('the project log directory', () => {
  it('replaces every slash and dot with a hyphen', () => {
    expect(projectLogDirName('/Users/dev/projects/agentic-research'))
      .toBe('-Users-dev-projects-agentic-research');
  });

  it('doubles the hyphen for a dot-directory segment', () => {
    expect(projectLogDirName('/Users/dev/repo/.claude/worktrees/x'))
      .toBe('-Users-dev-repo--claude-worktrees-x');
  });

  it('files the encoded name under the projects root', () => {
    expect(sessionLogDir('/Users/dev/repo', '/home'))
      .toBe(join('/home', '.claude', 'projects', '-Users-dev-repo'));
  });
});

describe('parseCollectArgs', () => {
  it('collects both halves and stays quiet by default', () => {
    const parsed = parseCollectArgs([]);

    expect(parsed.collectSessions).toBe(true);
    expect(parsed.collectCommits).toBe(true);
    expect(parsed.verbose).toBe(false);
    expect(parsed.since).toBeNull();
    expect(parsed.sinceEpochMs).toBeNull();
    expect(parsed.errors).toEqual([]);
  });

  it('switches off the commit half on --no-git', () => {
    const parsed = parseCollectArgs(['--no-git']);

    expect(parsed.collectCommits).toBe(false);
    expect(parsed.collectSessions).toBe(true);
    expect(parsed.errors).toEqual([]);
  });

  it('switches off the session half on --no-sessions', () => {
    const parsed = parseCollectArgs(['--no-sessions']);

    expect(parsed.collectSessions).toBe(false);
    expect(parsed.collectCommits).toBe(true);
    expect(parsed.errors).toEqual([]);
  });

  it('refuses both halves switched off at once', () => {
    const parsed = parseCollectArgs(['--no-git', '--no-sessions']);

    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toContain('nothing to collect');
  });

  it('raises verbose', () => {
    expect(parseCollectArgs(['--verbose']).verbose).toBe(true);
  });

  it('resolves --since to one instant', () => {
    const parsed = parseCollectArgs(['--since=2026-09-01']);

    expect(parsed.since).toBe('2026-09-01');
    expect(parsed.sinceEpochMs).toBe(Date.parse('2026-09-01'));
    expect(parsed.errors).toEqual([]);
  });

  it('refuses a --since it cannot read', () => {
    const parsed = parseCollectArgs(['--since=2.weeks']);

    expect(parsed.sinceEpochMs).toBeNull();
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toContain('2.weeks');
  });

  it('refuses a bare --since with no value', () => {
    const parsed = parseCollectArgs(['--since']);

    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toContain('takes a value');
  });

  it('refuses an empty --since value', () => {
    expect(parseCollectArgs(['--since=']).errors).toHaveLength(1);
    expect(parseCollectArgs(['--since=   ']).errors).toHaveLength(1);
  });

  it('refuses an unrecognised argument', () => {
    const parsed = parseCollectArgs(['--no-sessons']);

    expect(parsed.collectSessions).toBe(true);
    expect(parsed.errors).toEqual([
      'unrecognised argument: --no-sessons',
    ]);
  });

  it('refuses a bare positional argument', () => {
    expect(parseCollectArgs(['sessions']).errors).toHaveLength(1);
  });

  it('reports every refusal, not only the first', () => {
    const parsed = parseCollectArgs(['--nope', '--since=nope']);

    expect(parsed.errors).toHaveLength(2);
  });

  it('takes the last --since when it is repeated', () => {
    const parsed = parseCollectArgs([
      '--since=2026-09-01',
      '--since=2026-09-05',
    ]);

    expect(parsed.since).toBe('2026-09-05');
    expect(parsed.errors).toEqual([]);
  });

  it('accepts a repeated switch without complaint', () => {
    const parsed = parseCollectArgs(['--verbose', '--verbose']);

    expect(parsed.verbose).toBe(true);
    expect(parsed.errors).toEqual([]);
  });
});

describe('parseSinceInstant', () => {
  it('reads an ISO instant and a bare date', () => {
    expect(parseSinceInstant('2026-09-01T10:00:00Z'))
      .toBe(Date.parse('2026-09-01T10:00:00Z'));
    expect(parseSinceInstant('2026-09-01')).toBe(Date.parse('2026-09-01'));
  });

  it('answers null for a git relative form', () => {
    expect(parseSinceInstant('2.weeks')).toBeNull();
    expect(parseSinceInstant('yesterday')).toBeNull();
  });

  it('answers null for an empty value', () => {
    expect(parseSinceInstant('')).toBeNull();
    expect(parseSinceInstant('  ')).toBeNull();
  });
});

describe('listSessionLogs', () => {
  it('takes the loose logs and nothing one level down', () => {
    const dir = makeScratch();
    writeLog(dir, 'aaa', ['{}']);
    writeLog(dir, 'bbb', ['{}']);
    mkdirSync(join(dir, 'aaa', 'subagents'), { recursive: true });
    writeFileSync(join(dir, 'aaa', 'subagents', 'agent-1.jsonl'), '{}\n');

    const ids = listSessionLogs(dir).map((entry) => entry.sessionId);

    expect(ids.sort()).toEqual(['aaa', 'bbb']);
  });

  it('skips a directory whose name ends in .jsonl', () => {
    const dir = makeScratch();
    writeLog(dir, 'real', ['{}']);
    mkdirSync(join(dir, 'decoy.jsonl'));

    expect(listSessionLogs(dir).map((e) => e.sessionId)).toEqual(['real']);
  });

  it('skips a file that is not a session log', () => {
    const dir = makeScratch();
    writeLog(dir, 'real', ['{}']);
    writeFileSync(join(dir, 'notes.md'), 'hello\n');
    writeFileSync(join(dir, '.DS_Store'), 'x\n');

    expect(listSessionLogs(dir).map((e) => e.sessionId)).toEqual(['real']);
  });

  it('carries each log size and modification time', () => {
    const dir = makeScratch();
    const body = '{"a":1}';
    writeLog(dir, 'one', [body]);

    const found = listSessionLogs(dir);

    expect(found).toHaveLength(1);
    expect(found[0]?.sizeBytes).toBe(body.length + 1);
    expect(found[0]?.modifiedAtMs).toBeGreaterThan(0);
    expect(found[0]?.path).toBe(join(dir, 'one.jsonl'));
  });

  it('orders oldest first', () => {
    const dir = makeScratch();
    const older = writeLog(dir, 'zzz', ['{}']);
    writeLog(dir, 'aaa', ['{}']);
    utimesSync(older, 1_600_000, 1_600_000);

    expect(listSessionLogs(dir).map((e) => e.sessionId))
      .toEqual(['zzz', 'aaa']);
  });

  it('throws rather than reading a missing directory as empty', () => {
    const dir = join(makeScratch(), 'not-there');

    expect(() => listSessionLogs(dir)).toThrow(/no session log directory/);
  });
});

describe('selectSessionLogs', () => {
  const candidates = [
    candidate('a', 1_000),
    candidate('b', 2_000),
    candidate('c', 3_000),
  ];

  it('pends everything when nothing is stored', () => {
    const selection = selectSessionLogs(candidates, new Set(), null);

    expect(selection.pending.map((e) => e.sessionId)).toEqual(['a', 'b', 'c']);
    expect(selection.alreadyCollected).toEqual([]);
    expect(selection.outsideWindow).toEqual([]);
  });

  it('skips exactly the ids the store already holds', () => {
    const held = new Set(['a', 'c']);
    const selection = selectSessionLogs(candidates, held, null);

    expect(selection.pending.map((e) => e.sessionId)).toEqual(['b']);
    expect(selection.alreadyCollected.map((e) => e.sessionId))
      .toEqual(['a', 'c']);
  });

  it('skips nothing for an id the store does not hold', () => {
    const selection = selectSessionLogs(candidates, new Set(['zz']), null);

    expect(selection.pending).toHaveLength(3);
    expect(selection.alreadyCollected).toEqual([]);
  });

  it('drops candidates older than the since instant', () => {
    const selection = selectSessionLogs(candidates, new Set(), 2_000);

    expect(selection.pending.map((e) => e.sessionId)).toEqual(['b', 'c']);
    expect(selection.outsideWindow.map((e) => e.sessionId)).toEqual(['a']);
  });

  it('keeps a candidate sitting on the since instant', () => {
    const onTheInstant = [candidate('a', 2_000)];
    const selection = selectSessionLogs(onTheInstant, new Set(), 2_000);

    expect(selection.pending).toHaveLength(1);
  });

  it('puts an old stored candidate in the window bucket', () => {
    const held = new Set(['a']);
    const selection = selectSessionLogs(candidates, held, 2_000);

    expect(selection.outsideWindow.map((e) => e.sessionId)).toEqual(['a']);
    expect(selection.alreadyCollected).toEqual([]);
  });

  it('partitions its input across the three buckets', () => {
    const held = new Set(['c']);
    const selection = selectSessionLogs(candidates, held, 2_000);
    const total = selection.pending.length
      + selection.alreadyCollected.length
      + selection.outsideWindow.length;

    expect(total).toBe(candidates.length);
  });
});

describe('selectCommits', () => {
  const rows = [commitRow('aaa'), commitRow('bbb'), commitRow('ccc')];

  it('pends everything when nothing is stored', () => {
    expect(selectCommits(rows, new Set()).pending).toHaveLength(3);
  });

  it('skips exactly the shas the store already holds', () => {
    const selection = selectCommits(rows, new Set(['aaa', 'ccc']));

    expect(selection.pending.map((row) => row.sha)).toEqual(['bbb']);
    expect(selection.alreadyCollected.map((row) => row.sha))
      .toEqual(['aaa', 'ccc']);
  });

  it('partitions its input across the two buckets', () => {
    const selection = selectCommits(rows, new Set(['bbb']));
    const total = selection.pending.length
      + selection.alreadyCollected.length;

    expect(total).toBe(rows.length);
  });
});

describe('the store key projections', () => {
  it('keys a session row on its session id', () => {
    expect(sessionRowKey({ sessionId: 'abc' })).toBe('abc');
  });

  it('keys a commit row on its sha', () => {
    expect(commitRowKey({ sha: 'deadbeef' })).toBe('deadbeef');
  });
});

describe('readPlanStubs', () => {
  it('reads the stubs out of a plan directory', () => {
    const dir = makeScratch();
    writeFileSync(join(dir, 'PLAN-q19-loop-economics.md'), '# x\n');
    writeFileSync(join(dir, 'PLAN_TRACKER-q19-loop-economics.md'), '# x\n');
    writeFileSync(join(dir, 'PREREQUISITES-q19-loop-economics.md'), '# x\n');

    expect(readPlanStubs(dir)).toEqual(['q19-loop-economics']);
  });

  it('answers an empty roster for an absent directory', () => {
    expect(readPlanStubs(join(makeScratch(), 'nope'))).toEqual([]);
  });
});

describe('collectSessionRow', () => {
  it('merges the stats, the kind and the attribution', async () => {
    const dir = makeScratch();
    taskLog(dir, 'sess-1', 'feat/q19-loop-economics');
    const found = listSessionLogs(dir);
    const entry = found[0];
    if (entry === undefined) throw new Error('no candidate');

    const row = await collectSessionRow(entry, ['q19-loop-economics']);

    expect(row.sessionId).toBe('sess-1');
    expect(row.kind).toBe('task');
    expect(row.taskText).toBe('Add the thing');
    expect(row.branch).toBe('feat/q19-loop-economics');
    expect(row.branchType).toBe('feat');
    expect(row.planStub).toBe('q19-loop-economics');
    expect(row.planStubMatch).toBe('exact');
    expect(row.assistantRecordCount).toBe(1);
    expect(row.usage.inputTokens).toBe(11);
    expect(row.enqueueRecordIndex).toBe(0);
  });

  it('records the file size and time the walk saw', async () => {
    const dir = makeScratch();
    taskLog(dir, 'sess-2', 'feat/x');
    const found = listSessionLogs(dir);
    const entry = found[0];
    if (entry === undefined) throw new Error('no candidate');

    const row = await collectSessionRow(entry, []);

    expect(row.sizeBytes).toBe(entry.sizeBytes);
    expect(Date.parse(row.modifiedAt)).toBe(Math.trunc(entry.modifiedAtMs));
  });

  it('rejects rather than answering an empty row', async () => {
    const missing = {
      path: join(makeScratch(), 'gone.jsonl'),
      sessionId: 'gone',
      sizeBytes: 0,
      modifiedAtMs: 0,
    };

    await expect(collectSessionRow(missing, [])).rejects.toThrow();
  });

  it('attributes no plan against an empty roster', async () => {
    const dir = makeScratch();
    taskLog(dir, 'sess-3', 'feat/q19-loop-economics');
    const found = listSessionLogs(dir);
    const entry = found[0];
    if (entry === undefined) throw new Error('no candidate');

    const row = await collectSessionRow(entry, []);

    expect(row.branchStub).toBe('q19-loop-economics');
    expect(row.planStub).toBeNull();
    expect(row.planStubMatch).toBe('none');
  });
});

/** Builds a scratch repo root with a log tree and a plan roster. */
function makeTree(sessionIds: readonly string[]): {
  root: string;
  logDir: string;
  plansDir: string;
} {
  const root = makeScratch();
  const logDir = join(root, 'logs');
  const plansDir = join(root, 'plans');
  mkdirSync(logDir);
  mkdirSync(plansDir);
  writeFileSync(join(plansDir, 'PLAN-q19-loop-economics.md'), '# x\n');
  for (const sessionId of sessionIds) {
    taskLog(logDir, sessionId, 'feat/q19-loop-economics');
  }
  return { root, logDir, plansDir };
}

describe('collectEffort', () => {
  it('appends one row per log on a first run', async () => {
    const tree = makeTree(['s1', 's2']);
    const commits = plantedCommits([commitRow('aaa')]);

    const result = await collectEffort({
      repoRoot: tree.root,
      logDir: tree.logDir,
      plansDir: tree.plansDir,
      readCommits: commits.read,
      log: () => undefined,
    });

    expect(result.sessions?.candidates).toBe(2);
    expect(result.sessions?.read).toBe(2);
    expect(result.sessions?.appended).toBe(2);
    expect(result.sessions?.alreadyCollected).toBe(0);
    expect(result.sessions?.failed).toBe(0);
    expect(result.sessions?.planStubCount).toBe(1);
    expect(result.commits?.appended).toBe(1);
  });

  it('appends nothing at all on a second run', async () => {
    const tree = makeTree(['s1', 's2']);
    const commits = plantedCommits([commitRow('aaa')]);
    const options = {
      repoRoot: tree.root,
      logDir: tree.logDir,
      plansDir: tree.plansDir,
      readCommits: commits.read,
      log: () => undefined,
    };
    await collectEffort(options);

    const second = await collectEffort(options);

    expect(second.sessions?.candidates).toBe(2);
    expect(second.sessions?.alreadyCollected).toBe(2);
    expect(second.sessions?.read).toBe(0);
    expect(second.sessions?.appended).toBe(0);
    expect(second.commits?.alreadyCollected).toBe(1);
    expect(second.commits?.appended).toBe(0);
  });

  it('leaves the store files exactly as long', async () => {
    const tree = makeTree(['s1', 's2']);
    const commits = plantedCommits([commitRow('aaa'), commitRow('bbb')]);
    const options = {
      repoRoot: tree.root,
      logDir: tree.logDir,
      plansDir: tree.plansDir,
      readCommits: commits.read,
      log: () => undefined,
    };
    const first = await collectEffort(options);
    await collectEffort(options);

    const sessionPath = first.sessions?.storePath ?? '';
    const commitPath = first.commits?.storePath ?? '';

    expect(readStoreRows(sessionPath).rows).toHaveLength(2);
    expect(readStoreRows(commitPath).rows).toHaveLength(2);
  });

  it('reads only the log a second run has not seen', async () => {
    const tree = makeTree(['s1']);
    const commits = plantedCommits([]);
    const options = {
      repoRoot: tree.root,
      logDir: tree.logDir,
      plansDir: tree.plansDir,
      readCommits: commits.read,
      log: () => undefined,
    };
    await collectEffort(options);
    taskLog(tree.logDir, 's2', 'feat/q19-loop-economics');

    const second = await collectEffort(options);

    expect(second.sessions?.alreadyCollected).toBe(1);
    expect(second.sessions?.read).toBe(1);
    expect(second.sessions?.appended).toBe(1);
  });

  it('never re-appends a row on a key it already holds', async () => {
    const tree = makeTree(['s1']);
    const commits = plantedCommits([commitRow('aaa')]);
    const options = {
      repoRoot: tree.root,
      logDir: tree.logDir,
      plansDir: tree.plansDir,
      readCommits: commits.read,
      log: () => undefined,
    };
    const first = await collectEffort(options);
    const second = await collectEffort(options);

    expect(first.sessions?.skippedOnAppend).toBe(0);
    expect(second.sessions?.skippedOnAppend).toBe(0);
    expect(second.commits?.skippedOnAppend).toBe(0);
  });

  it('honours the since instant on both halves', async () => {
    const tree = makeTree(['s1']);
    const commits = plantedCommits([commitRow('aaa')]);
    utimesSync(join(tree.logDir, 's1.jsonl'), 1_600_000, 1_600_000);

    const result = await collectEffort({
      repoRoot: tree.root,
      logDir: tree.logDir,
      plansDir: tree.plansDir,
      sinceEpochMs: Date.parse('2026-09-01'),
      readCommits: commits.read,
      log: () => undefined,
    });

    const expected = new Date(Date.parse('2026-09-01')).toISOString();

    expect(result.sessions?.outsideWindow).toBe(1);
    expect(result.sessions?.read).toBe(0);
    expect(result.commits?.since).toBe(expected);
  });

  it('skips the session half entirely on --no-sessions', async () => {
    const tree = makeTree(['s1']);
    const commits = plantedCommits([commitRow('aaa')]);

    const result = await collectEffort({
      repoRoot: tree.root,
      logDir: join(tree.root, 'no-such-directory'),
      plansDir: tree.plansDir,
      collectSessions: false,
      readCommits: commits.read,
      log: () => undefined,
    });

    expect(result.sessions).toBeNull();
    expect(result.commits?.appended).toBe(1);
  });

  it('skips the commit half entirely on --no-git', async () => {
    const tree = makeTree(['s1']);
    const commits = plantedCommits([commitRow('aaa')]);

    const result = await collectEffort({
      repoRoot: tree.root,
      logDir: tree.logDir,
      plansDir: tree.plansDir,
      collectCommits: false,
      readCommits: commits.read,
      log: () => undefined,
    });

    expect(result.commits).toBeNull();
    expect(commits.calls).toEqual([]);
    expect(result.sessions?.appended).toBe(1);
  });

  it.skipIf(isRoot)('counts an unreadable log and goes on', async () => {
    const tree = makeTree(['good']);
    const commits = plantedCommits([]);
    const denied = taskLog(tree.logDir, 'denied', 'feat/x');
    chmodSync(denied, 0o000);
    const lines: string[] = [];

    const result = await collectEffort({
      repoRoot: tree.root,
      logDir: tree.logDir,
      plansDir: tree.plansDir,
      readCommits: commits.read,
      log: (line) => {
        lines.push(line);
      },
    });
    chmodSync(denied, 0o600);

    expect(result.sessions?.candidates).toBe(2);
    expect(result.sessions?.failed).toBe(1);
    expect(result.sessions?.read).toBe(1);
    expect(result.sessions?.appended).toBe(1);
    expect(lines.join('\n')).toContain('FAILED');
  });

  it('stays quiet unless verbose is asked for', async () => {
    const tree = makeTree(['s1']);
    const commits = plantedCommits([]);
    const quiet: string[] = [];
    const loud: string[] = [];
    const base = {
      repoRoot: tree.root,
      logDir: tree.logDir,
      plansDir: tree.plansDir,
      readCommits: commits.read,
    };

    await collectEffort({ ...base, log: (line) => quiet.push(line) });
    await collectEffort({
      ...base,
      verbose: true,
      log: (line) => loud.push(line),
    });

    expect(quiet).toEqual([]);
    expect(loud.length).toBeGreaterThan(0);
  });
});

describe('formatCollectSummary', () => {
  it('names both halves when both ran', async () => {
    const tree = makeTree(['s1']);
    const commits = plantedCommits([commitRow('aaa')]);
    const result = await collectEffort({
      repoRoot: tree.root,
      logDir: tree.logDir,
      plansDir: tree.plansDir,
      readCommits: commits.read,
      log: () => undefined,
    });

    const lines = formatCollectSummary(result).join('\n');

    expect(lines).toContain('sessions');
    expect(lines).toContain('commits');
    expect(lines).toContain('+1 rows');
  });

  it('says which half was switched off', () => {
    const lines = formatCollectSummary({
      repoRoot: '/repo',
      sessions: null,
      commits: null,
    });

    expect(lines.join('\n')).toContain('--no-sessions');
    expect(lines.join('\n')).toContain('--no-git');
  });
});
