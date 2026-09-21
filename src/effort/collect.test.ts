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
 * No case reads the real session log directory or runs git over this
 * repo. The commit half is driven through
 * {@link CollectOptions.readCommits}, which is why that seam exists; a
 * case that shelled out to git here would be measuring this machine's
 * history rather than the collector. The two command cases are the one
 * exception: the command resolves its root through git and takes no
 * seam, so they run it as a subprocess inside a scratch repository
 * holding one empty commit.
 *
 * The end-to-end cases run once per backend with the store passed in,
 * because the collector is written against the store port and a run
 * green on one backend says nothing about the other. The cases that
 * pass no store read which backend the config selected off the disk.
 * The file names are spelled HERE rather than read off a backend, so a
 * run that opened the wrong one fails instead of agreeing with itself.
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
 * Twenty-three module mutations were driven against this file before
 * the collector was rewired onto the store port, and ALL TWENTY-THREE
 * reddened at least one case, with the restored module green either
 * side and byte-identical: dropping the `isFile` guard so a directory
 * named `*.jsonl` becomes a candidate, matching every file name
 * instead of only `.jsonl`, ordering newest first, reading a missing
 * log directory as an empty list, making the `--since` bound
 * exclusive, testing the store before the window so the two buckets
 * swap, skipping neither an already-stored session nor an
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
 * line from the summary. The rewire took those two key projections out
 * of this module: the projection is the port's now.
 *
 * Thirteen more were driven against the rewire, eleven in this module
 * and two in the port, with the restored files green either side and
 * byte-identical, and TWELVE reddened at least one case: the session
 * half reading the commit keys and the commit half the session keys,
 * each half appending under the other's kind, a passed store ignored
 * in favour of the config, the config read twice, the store resolved
 * lazily so the logs are listed before the config is read, each half's
 * store path spelled as its NDJSON file, the command without its
 * config-refusal catch, and each of the port's two key projections
 * perturbed away from the key the selection skips by. ONE stayed green
 * and is named rather than dropped: the command printing every error
 * it catches as a refusal, rather than rethrowing what is not a config
 * one. No case drives a fault that is not a refusal through the
 * command, because the command takes no seam to plant one through.
 *
 * Nine more were driven against the widened session row, seven in this
 * module and one in each backend's writer, with the unmutated tree
 * green before and after and every file restored byte-identical, and
 * ALL NINE reddened at least one case: the mode dropped from the row,
 * the mode written as `remote`, the issue identifier dropped, written
 * as the branch stub, as the whole branch name, as null throughout, and
 * re-read from the branch alone so the resolved plan lends it nothing,
 * the SQLite body serialised without the identifier, and the NDJSON
 * line without the mode. The two backend mutations are caught only by
 * the case that collects one tree through both backends, and the
 * branch-alone re-read only by the case whose resolved plan names an
 * issue its branch does not. Three were also run against `check-types`:
 * each field dropped fails with TS2741, and `remote` with TS2322, so
 * the mode is held at `local` by the compiler as well as by this suite.
 */
import type { CollectOptions, SessionLogCandidate } from './collect.js';
import type { CommitLogParseResult, CommitStats } from './commits.js';
import type { EffortStore } from './store/types.js';

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'bun:test';

import { ConfigError } from '../config.js';
import { stampPrompt } from '../utils/plan-stamp.js';

import { PROMPT_SHAPES } from './classify.js';
import {
  collectEffort,
  collectSessionRow,
  formatCollectSummary,
  listSessionLogs,
  parseCollectArgs,
  parseSinceInstant,
  projectLogDirName,
  readPlanStubs,
  selectCommits,
  selectSessionLogs,
  sessionLogDir,
} from './collect.js';
import { openNdjsonStore, openSqliteStore } from './store/index.js';

/** The task prompt's prefix, taken from the shape that declares it. */
const TASK_PREFIX = PROMPT_SHAPES
  .find((shape) => shape.kind === 'task')?.prefix ?? '';

/** The command dispatcher the command cases run as a subprocess. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

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

/** The planted commit reader, and a record of every call it took. */
interface PlantedCommits {
  read: () => CommitLogParseResult;
  calls: string[];
}

/** A reader seam answering planted rows and counting its calls. */
function plantedCommits(rows: readonly CommitStats[]): PlantedCommits {
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

  it('stamps the local mode on the row', async () => {
    const dir = makeScratch();
    taskLog(dir, 'sess-4', 'feat/opt-407-control-byte-gate');
    const found = listSessionLogs(dir);
    const entry = found[0];
    if (entry === undefined) throw new Error('no candidate');

    const row = await collectSessionRow(entry, []);

    expect(row.mode).toBe('local');
  });

  it('carries the issue the whole branch name holds', async () => {
    const dir = makeScratch();
    taskLog(dir, 'sess-5', 'feat/opt-407-control-byte-gate');
    const found = listSessionLogs(dir);
    const entry = found[0];
    if (entry === undefined) throw new Error('no candidate');

    const row = await collectSessionRow(entry, []);

    expect(row.branchStub).toBe('opt-407-control-byte-gate');
    expect(row.planStub).toBeNull();
    expect(row.issueIdentifier).toBe('OPT-407');
  });

  it('carries the issue the resolved plan names, and only once resolved', async () => {
    const dir = makeScratch();
    taskLog(dir, 'sess-6', 'feat/q21-harness');
    const found = listSessionLogs(dir);
    const entry = found[0];
    if (entry === undefined) throw new Error('no candidate');

    const resolved = await collectSessionRow(entry, ['q21-opt-363-harness']);
    const unresolved = await collectSessionRow(entry, []);

    expect(resolved.planStub).toBe('q21-opt-363-harness');
    expect(resolved.issueIdentifier).toBe('OPT-363');
    expect(unresolved.planStub).toBeNull();
    expect(unresolved.issueIdentifier).toBeNull();
  });

  it('answers no issue, rather than the branch stub, when none is named', async () => {
    const dir = makeScratch();
    taskLog(dir, 'sess-7', 'feat/q19-loop-economics');
    const found = listSessionLogs(dir);
    const entry = found[0];
    if (entry === undefined) throw new Error('no candidate');

    const row = await collectSessionRow(entry, ['q19-loop-economics']);

    expect(row.branchStub).toBe('q19-loop-economics');
    expect(row.planStub).toBe('q19-loop-economics');
    expect(row.issueIdentifier).toBeNull();
  });
});

/** A scratch repo root with a log tree and a plan roster. */
interface Tree {
  root: string;
  logDir: string;
  plansDir: string;
}

/** Builds a scratch repo root with a log tree and a plan roster. */
function makeTree(sessionIds: readonly string[]): Tree {
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

/**
 * A quiet run over a planted tree, reading the planted commits. It
 * passes no store, so the run selects one from the tree's config, under
 * a home of its own holding none.
 */
function optionsFor(tree: Tree, commits: PlantedCommits): CollectOptions {
  return {
    home: makeScratch(),
    repoRoot: tree.root,
    logDir: tree.logDir,
    plansDir: tree.plansDir,
    readCommits: commits.read,
    log: () => undefined,
  };
}

/** The store directory under a root, spelled here and not imported. */
function storeDir(root: string): string {
  return join(root, '.rafa', 'effort');
}

/** Plants `.rafa/config.yaml` under a root. */
function writeConfig(root: string, text: string): void {
  mkdirSync(join(root, '.rafa'), { recursive: true });
  writeFileSync(join(root, '.rafa', 'config.yaml'), text, 'utf8');
}

/** A store that records every call before passing it to a real one. */
function recordingStore(inner: EffortStore): {
  store: EffortStore;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    store: {
      keys: (kind) => {
        calls.push(`keys ${kind}`);
        return inner.keys(kind);
      },
      append: (kind, rows) => {
        calls.push(`append ${kind} ${rows.length}`);
        return inner.append(kind, rows);
      },
      read: (kind) => {
        calls.push(`read ${kind}`);
        return inner.read(kind);
      },
    },
  };
}

/** Each backend's opener, by the name the config selects it with. */
const BACKENDS: readonly (readonly [string, (root: string) => EffortStore])[] = [
  ['ndjson', openNdjsonStore],
  ['sqlite', openSqliteStore],
];

describe.each(BACKENDS)('collectEffort through the %s store', (_name, open) => {
  /** A quiet run over a tree, through this backend under its root. */
  function runOn(tree: Tree, commits: PlantedCommits): CollectOptions {
    return { ...optionsFor(tree, commits), store: open(tree.root) };
  }

  it('appends one row per log on a first run', async () => {
    const tree = makeTree(['s1', 's2']);
    const commits = plantedCommits([commitRow('aaa')]);

    const result = await collectEffort(runOn(tree, commits));

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
    const options = runOn(tree, commits);
    await collectEffort(options);

    const second = await collectEffort(options);

    expect(second.sessions?.candidates).toBe(2);
    expect(second.sessions?.alreadyCollected).toBe(2);
    expect(second.sessions?.read).toBe(0);
    expect(second.sessions?.appended).toBe(0);
    expect(second.commits?.alreadyCollected).toBe(1);
    expect(second.commits?.appended).toBe(0);
  });

  it('leaves the store exactly as long', async () => {
    const tree = makeTree(['s1', 's2']);
    const commits = plantedCommits([commitRow('aaa'), commitRow('bbb')]);
    const options = runOn(tree, commits);
    await collectEffort(options);
    await collectEffort(options);

    const store = open(tree.root);

    expect(store.read('sessions')).toHaveLength(2);
    expect(store.read('commits')).toHaveLength(2);
  });

  it('reads only the log a second run has not seen', async () => {
    const tree = makeTree(['s1']);
    const commits = plantedCommits([]);
    const options = runOn(tree, commits);
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
    const options = runOn(tree, commits);
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
      ...runOn(tree, commits),
      sinceEpochMs: Date.parse('2026-09-01'),
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
      ...runOn(tree, commits),
      logDir: join(tree.root, 'no-such-directory'),
      collectSessions: false,
    });

    expect(result.sessions).toBeNull();
    expect(result.commits?.appended).toBe(1);
  });

  it('skips the commit half entirely on --no-git', async () => {
    const tree = makeTree(['s1']);
    const commits = plantedCommits([commitRow('aaa')]);

    const result = await collectEffort({
      ...runOn(tree, commits),
      collectCommits: false,
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
      ...runOn(tree, commits),
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
    const base = runOn(tree, commits);

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

describe('the session row both backends store', () => {
  it('holds the reconciled row byte for byte, including a stamped plan stub and a null issue', async () => {
    const tree = makeTree([]);
    // A second plan the branch below does not name, so a row resolving
    // to it can only have gotten there through the prompt stamp.
    writeFileSync(join(tree.plansDir, 'PLAN-q21-alt-target.md'), '# x\n');
    taskLog(tree.logDir, 's-opt', 'feat/opt-407-control-byte-gate');
    taskLog(tree.logDir, 's-q19', 'feat/q19-loop-economics');
    // The branch alone resolves to 'q19-loop-economics' (an EXACT
    // match, and a real plan in the roster), so a row landing on
    // 'q21-alt-target' with match 'stamped' proves the stamp outranked
    // the branch rather than merely being the only candidate.
    writeLog(tree.logDir, 's-stamped', [
      enqueue(stampPrompt(
        'q21-alt-target',
        `${TASK_PREFIX}Add the alt thing\nMore boilerplate here.`,
      )),
      assistantTurn('feat/q19-loop-economics', '2026-09-08T10:00:00.000Z'),
    ]);
    const commits = plantedCommits([]);

    const stored: string[] = [];
    for (const [, open] of BACKENDS) {
      const store = open(tree.root);
      await collectEffort({
        ...optionsFor(tree, commits),
        store,
        collectCommits: false,
      });
      stored.push(JSON.stringify(store.read('sessions')));
    }
    const fields = [...openNdjsonStore(tree.root).read('sessions')]
      .sort((a, b) => a.sessionId.localeCompare(b.sessionId))
      .map((row) => [
        row.sessionId,
        row.issueIdentifier,
        row.mode,
        row.planStub,
        row.planStubMatch,
      ]);

    expect(stored).toHaveLength(2);
    expect(stored[1]).toBe(stored[0]);
    expect(fields).toEqual([
      ['s-opt', 'OPT-407', 'local', null, 'none'],
      ['s-q19', null, 'local', 'q19-loop-economics', 'exact'],
      ['s-stamped', null, 'local', 'q21-alt-target', 'stamped'],
    ]);
  });
});

/**
 * Each config a run can find, and the file each half should land in
 * under it: the label, the config text or null for no file, then the
 * session file and the commit file.
 */
const CONFIGURED: readonly (readonly [string, string | null, string, string])[] = [
  ['no config', null, 'effort.sqlite', 'effort.sqlite'],
  ['store: sqlite', 'store: sqlite\n', 'effort.sqlite', 'effort.sqlite'],
  ['store: ndjson', 'store: ndjson\n', 'sessions.ndjson', 'commits.ndjson'],
];

describe.each(CONFIGURED)('a run finding %s', (
  _label,
  config,
  sessionsFile,
  commitsFile,
) => {
  /** A tree carrying this case's config, when it has one. */
  function configuredTree(): Tree {
    const tree = makeTree(['s1']);
    if (config !== null) writeConfig(tree.root, config);
    return tree;
  }

  it('lands both halves in the backend the config selects', async () => {
    const tree = configuredTree();
    const commits = plantedCommits([commitRow('aaa')]);

    const result = await collectEffort(optionsFor(tree, commits));
    const files = [...new Set([sessionsFile, commitsFile])].sort();

    expect(result.sessions?.appended).toBe(1);
    expect(result.commits?.appended).toBe(1);
    expect(result.sessions?.storePath)
      .toBe(join(storeDir(tree.root), sessionsFile));
    expect(result.commits?.storePath)
      .toBe(join(storeDir(tree.root), commitsFile));
    expect(readdirSync(storeDir(tree.root)).sort()).toEqual(files);
  });

  it('skips on a second run what the first run stored', async () => {
    const tree = configuredTree();
    const commits = plantedCommits([commitRow('aaa')]);
    await collectEffort(optionsFor(tree, commits));

    const second = await collectEffort(optionsFor(tree, commits));

    expect(second.sessions?.alreadyCollected).toBe(1);
    expect(second.sessions?.appended).toBe(0);
    expect(second.sessions?.skippedOnAppend).toBe(0);
    expect(second.commits?.alreadyCollected).toBe(1);
    expect(second.commits?.appended).toBe(0);
  });
});

describe('the store a run goes through', () => {
  it('serves both halves their keys and their appends', async () => {
    const tree = makeTree(['s1', 's2']);
    const commits = plantedCommits([commitRow('aaa')]);
    const recorded = recordingStore(openNdjsonStore(tree.root));

    await collectEffort({ ...optionsFor(tree, commits), store: recorded.store });

    expect(recorded.calls).toEqual([
      'keys sessions',
      'append sessions 2',
      'keys commits',
      'append commits 1',
    ]);
  });

  it('skips by the keys it reads, before the append sees a row', async () => {
    const tree = makeTree(['s1', 's2']);
    const commits = plantedCommits([commitRow('aaa')]);
    const inner = openSqliteStore(tree.root);
    await collectEffort({ ...optionsFor(tree, commits), store: inner });
    const recorded = recordingStore(inner);

    await collectEffort({ ...optionsFor(tree, commits), store: recorded.store });

    expect(recorded.calls).toEqual([
      'keys sessions',
      'append sessions 0',
      'keys commits',
      'append commits 0',
    ]);
  });

  it('never reads the config when a store and a plans directory are passed', async () => {
    // The config names a store no backend opens, so a run that read it
    // at all would refuse; the run below writes NDJSON instead.
    const tree = makeTree(['s1']);
    writeConfig(tree.root, 'store: postgres\n');
    const commits = plantedCommits([commitRow('aaa')]);

    const result = await collectEffort({
      ...optionsFor(tree, commits),
      store: openNdjsonStore(tree.root),
    });

    expect(result.sessions?.appended).toBe(1);
    expect(readdirSync(storeDir(tree.root)).sort())
      .toEqual(['commits.ndjson', 'sessions.ndjson']);
  });

  it('reads the config for plan.dir when a store is passed without a plans directory', async () => {
    // The control of the case above: the same unusable config, the same
    // store passed, and only the plans directory left out.
    const tree = makeTree(['s1']);
    writeConfig(tree.root, 'store: postgres\n');
    const commits = plantedCommits([commitRow('aaa')]);

    const refusal = await collectEffort({
      home: makeScratch(),
      repoRoot: tree.root,
      logDir: tree.logDir,
      readCommits: commits.read,
      log: () => undefined,
      store: openNdjsonStore(tree.root),
    }).then(() => null, (error: unknown) => error);

    expect(refusal).toBeInstanceOf(ConfigError);
    expect(commits.calls).toEqual([]);
  });

  it('attributes by the roster in plan.dir when no plans directory is passed', async () => {
    // The tree's own roster names q19 alone. plan.dir names a directory
    // holding q19 and a second stub, so a count of two can only come from
    // the directory the config names.
    const tree = makeTree(['s1']);
    writeConfig(tree.root, 'store: ndjson\nplan:\n  dir: rosters\n');
    mkdirSync(join(tree.root, 'rosters'));
    for (const stub of ['q19-loop-economics', 'q21-alt-target']) {
      writeFileSync(join(tree.root, 'rosters', `PLAN-${stub}.md`), '# x\n');
    }

    const result = await collectEffort({
      home: makeScratch(),
      repoRoot: tree.root,
      logDir: tree.logDir,
      readCommits: plantedCommits([]).read,
      collectCommits: false,
      log: () => undefined,
    });

    expect(result.sessions?.planStubCount).toBe(2);
    expect(openNdjsonStore(tree.root).read('sessions')
      .map((row) => row.planStub)).toEqual(['q19-loop-economics']);
  });

  it('reads the roster in .rafa/plans and not the one in .plans when plan.dir is left at its default', async () => {
    // Deliberate custom-directory fixture: plants `.plans/` to verify it is ignored when `plan.dir` defaults to `.rafa/plans`.
    const tree = makeTree(['s1']);
    writeConfig(tree.root, 'store: ndjson\n');
    mkdirSync(join(tree.root, '.plans'));
    writeFileSync(join(tree.root, '.plans', 'PLAN-q19-loop-economics.md'), '# x\n');
    mkdirSync(join(tree.root, '.rafa', 'plans'));
    writeFileSync(join(tree.root, '.rafa', 'plans', 'PLAN-q21-alt-target.md'), '# x\n');

    const result = await collectEffort({
      home: makeScratch(),
      repoRoot: tree.root,
      logDir: tree.logDir,
      readCommits: plantedCommits([]).read,
      collectCommits: false,
      log: () => undefined,
    });

    expect(result.sessions?.planStubCount).toBe(1);
    expect(openNdjsonStore(tree.root).read('sessions')
      .map((row) => row.planStub)).toEqual([null]);
  });

  it('refuses a config it cannot run on before reading anything', async () => {
    // The log directory is missing too. A run that reached the session
    // half first would reject on that instead of on the config.
    const tree = makeTree(['s1']);
    writeConfig(tree.root, 'store: postgres\n');
    const commits = plantedCommits([commitRow('aaa')]);

    const refusal = await collectEffort({
      ...optionsFor(tree, commits),
      logDir: join(tree.root, 'no-such-directory'),
    }).then(() => null, (error: unknown) => error);

    expect(refusal).toBeInstanceOf(ConfigError);
    expect(commits.calls).toEqual([]);
    expect(existsSync(storeDir(tree.root))).toBe(false);
  });

  it('warns once, through the log sink, about an unknown key', async () => {
    const tree = makeTree(['s1']);
    writeConfig(tree.root, 'store: ndjson\nnonesuch: linear\n');
    const commits = plantedCommits([commitRow('aaa')]);
    const lines: string[] = [];

    const result = await collectEffort({
      ...optionsFor(tree, commits),
      log: (line) => lines.push(line),
    });

    expect(lines.filter((line) => line.includes('"nonesuch"'))).toHaveLength(1);
    expect(result.commits?.appended).toBe(1);
  });
});

describe('formatCollectSummary', () => {
  it('names both halves when both ran', async () => {
    const tree = makeTree(['s1']);
    const commits = plantedCommits([commitRow('aaa')]);
    const result = await collectEffort({
      home: makeScratch(),
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

/** What one run of the command printed, and how it exited. */
interface CommandRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * A scratch git repository holding one empty commit and a config. The
 * `-c` settings keep this machine's own git config (a signing key, a
 * hook directory) out of a commit nothing here inspects.
 */
function makeRepo(config: string): string {
  const root = makeScratch();
  const git = (...args: string[]): void => {
    const run = Bun.spawnSync([
      'git',
      '-c',
      'user.name=rafa',
      '-c',
      'user.email=rafa@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      ...args,
    ], { cwd: root });
    if (run.exitCode !== 0) {
      throw new Error(`git ${args.join(' ')}: ${run.stderr.toString()}`);
    }
  };
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '--no-verify', '-m', 'init');
  writeConfig(root, config);
  return root;
}

/** Runs `effort collect` inside a repository, as the dispatcher would. */
function runCollect(root: string, args: readonly string[]): CommandRun {
  const run = Bun.spawnSync(
    [process.execPath, RAFA_ENTRY, 'effort', 'collect', ...args],
    { cwd: root, env: { ...process.env, HOME: makeScratch() } },
  );
  return {
    exitCode: run.exitCode,
    stdout: run.stdout.toString(),
    stderr: run.stderr.toString(),
  };
}

describe('the collect command', () => {
  it('collects into the store the config selects', () => {
    const root = makeRepo('store: ndjson\n');

    const run = runCollect(root, ['--no-sessions']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('+1 rows');
    expect(readdirSync(storeDir(root))).toEqual(['commits.ndjson']);
  });

  it('prints a config it cannot run on as a refusal', () => {
    const root = makeRepo('store: postgres\n');

    const run = runCollect(root, ['--no-sessions']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr.trimEnd().split('\n')).toEqual([
      expect.stringMatching(/^rafa effort collect: .*store is "postgres"/),
    ]);
    expect(run.stdout).toBe('');
    expect(existsSync(storeDir(root))).toBe(false);
  });
});
