/**
 * Effort report through both store backends, from a real collect.
 *
 * `report.test.ts` plants rows directly — through `node:fs` for NDJSON,
 * through the SQLite backend's own `append` for SQLite — so it never
 * proves the COLLECTOR's own write and the report's own read agree on
 * where either backend's config points. This file collects the same two
 * session logs into a scratch git repository twice, once under
 * `store: sqlite` and once under `store: ndjson`, and rolls each up with
 * `buildReport`, which resolves its store through the same
 * `loadConfig` → `selectEffortStore` path `collectEffort` does. A path
 * that drifted between the two commands would read zero rows right
 * after a successful collect — the failure REVIEW-phase-0-store #3
 * named, and the reason `buildReport` no longer reads `./store.js`
 * directly.
 *
 * The SQLite repo is also read by a SPAWNED `rafa effort report --json`
 * process, since that is the one path with no store seam at all: the
 * command resolves its root through git and its store through
 * `.rafa/config.yaml`, exactly the two steps `buildReport({ repoRoot })`
 * exercises in-process above it. Reading the same two rows there closes
 * a gap the two in-process cases cannot: a resolver wired correctly for
 * a function call and wrong for the command's own argv-free entry would
 * still pass every case above it.
 */
import type { CollectOptions } from '../effort/collect.js';
import type { CommitLogOptions, CommitLogParseResult } from '../effort/commits.js';
import type { EffortReport } from '../effort/report.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'bun:test';

import { collectEffort } from '../effort/collect.js';
import { buildReport } from '../effort/report.js';

/** The command a spawned case executes. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** Temporary directories removed after every case. */
const scratch: string[] = [];

afterEach(() => {
  while (scratch.length > 0) {
    const dir = scratch.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/** A temporary directory this file's `afterEach` will remove. */
function makeScratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rafa-report-backends-'));
  scratch.push(dir);
  return dir;
}

/**
 * Runs git in a scratch repository. The `-c` settings keep this
 * machine's own git config out of a commit nothing here inspects, as
 * `store-version-guard.test.ts` does for the same reason.
 */
function git(dir: string, ...args: string[]): void {
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
  ], { cwd: dir });
  if (run.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')}: ${run.stderr.toString()}`);
  }
}

/** A scratch git repository, one commit deep, resolved to its real path. */
function makeRepo(): string {
  const root = realpathSync(makeScratch());
  git(root, 'init', '-q');
  git(root, 'commit', '-q', '--allow-empty', '--no-verify', '-m', 'init');
  return root;
}

/** Plants `.rafa/config.yaml` selecting one backend under a root. */
function writeStoreConfig(root: string, backend: 'sqlite' | 'ndjson'): void {
  mkdirSync(join(root, '.rafa'), { recursive: true });
  writeFileSync(join(root, '.rafa', 'config.yaml'), `store: ${backend}\n`, 'utf8');
}

/** One planted session: one enqueue record, one billable turn. */
interface PlantedSession {
  id: string;
  branch: string;
  taskText: string;
  stamp: string;
}

/** Two sessions on two distinct branches, so two distinct rows and two
 * distinct report groups are unambiguous — neither collapses into the
 * other if grouping or dedup drifts. */
const SESSIONS: readonly PlantedSession[] = [
  {
    id: 'report-backends-a',
    branch: 'feat/report-backends-a',
    taskText: 'Exercise the SQLite backend',
    stamp: '2026-09-08T10:00:00.000Z',
  },
  {
    id: 'report-backends-b',
    branch: 'feat/report-backends-b',
    taskText: 'Exercise the NDJSON backend',
    stamp: '2026-09-08T11:00:00.000Z',
  },
];

/** The enqueue record a session's prompt arrives on. */
function enqueueRecord(content: string): string {
  return JSON.stringify({
    type: 'queue-operation',
    operation: 'enqueue',
    content,
  });
}

/** One billable assistant turn for a planted session. */
function assistantRecord(session: PlantedSession): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: session.stamp,
    gitBranch: session.branch,
    entrypoint: 'sdk-cli',
    isSidechain: false,
    effort: 'xhigh',
    message: {
      model: 'claude-opus-5',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  });
}

/** Writes one planted session log into a log directory. */
function writeSessionLog(logDir: string, session: PlantedSession): void {
  const prompt = `Your scoped task is: ${session.taskText}`;
  const lines = [enqueueRecord(prompt), assistantRecord(session)];
  writeFileSync(join(logDir, `${session.id}.jsonl`), `${lines.join('\n')}\n`, 'utf8');
}

/** A commit reader seam answering no commits, so no case shells to git. */
function noCommits(): (options: CommitLogOptions) => CommitLogParseResult {
  return () => ({ rows: [], lineCount: 0, unparsedLineCount: 0 });
}

/** Collects the two planted sessions into a fresh repo under one backend. */
async function collectPlantedSessions(
  backend: 'sqlite' | 'ndjson',
): Promise<{ root: string; logDir: string }> {
  const root = makeRepo();
  const logDir = join(makeScratch(), 'logs');
  const plansDir = join(root, '.plans');
  mkdirSync(logDir, { recursive: true });
  writeStoreConfig(root, backend);
  for (const session of SESSIONS) writeSessionLog(logDir, session);

  const options: CollectOptions = {
    repoRoot: root,
    logDir,
    plansDir,
    readCommits: noCommits(),
    log: () => undefined,
  };
  const result = await collectEffort(options);
  if (result.sessions?.appended !== SESSIONS.length) {
    throw new Error(`planted ${result.sessions?.appended ?? 0} of ${SESSIONS.length} rows`);
  }
  return { root, logDir };
}

/** The two planted branches, sorted, as a report's group keys should read. */
const PLANTED_BRANCHES = [...SESSIONS.map((session) => session.branch)].sort();

describe('buildReport over a real collect, per backend', () => {
  it.each([
    ['sqlite'],
    ['ndjson'],
  ] as const)('answers both planted rows under store: %s', async (backend) => {
    const { root } = await collectPlantedSessions(backend);

    const report = buildReport({ repoRoot: root });

    expect(report.rowsRead).toBe(SESSIONS.length);
    expect(report.totals.sessions).toBe(SESSIONS.length);
    expect(report.groups.map((group) => group.key).sort())
      .toEqual(PLANTED_BRANCHES);
  });
});

/** What one run of the command did. */
interface CommandRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Runs `effort report --json` inside a repository, as the dispatcher would. */
function runReportJson(root: string): CommandRun {
  const run = Bun.spawnSync(
    [process.execPath, RAFA_ENTRY, 'effort', 'report', '--json'],
    { cwd: root },
  );
  return {
    exitCode: run.exitCode,
    stdout: run.stdout.toString(),
    stderr: run.stderr.toString(),
  };
}

describe('a spawned effort report over the SQLite store a collect wrote', () => {
  it('reads the same two rows buildReport reads in-process', async () => {
    const { root } = await collectPlantedSessions('sqlite');
    const inProcess = buildReport({ repoRoot: root });

    const run = runReportJson(root);

    expect(run.exitCode).toBe(0);
    const spawned = JSON.parse(run.stdout) as EffortReport;
    expect(spawned.rowsRead).toBe(SESSIONS.length);
    expect(spawned.groups.map((group) => group.key).sort())
      .toEqual(PLANTED_BRANCHES);
    // Byte-identical to the in-process read of the same SQLite store: the
    // spawned command and the direct call resolved to the same rows.
    expect(JSON.stringify(spawned)).toBe(JSON.stringify(inProcess));
  });
});
