/**
 * Tests for the search runner, over a stubbed spawner.
 *
 * Every case plants its own skill files under a temp directory, builds
 * the records from their frontmatter the way the tree readers do, and
 * hands `runSearch` a {@link CapturingSpawner} double. The double
 * records what it was spawned with and what its working directory held
 * WHILE it ran, writes a session log where Claude Code would file one
 * (under the planted home, at the real path of that directory), and
 * answers the stdout the case gives it. No case starts a real session.
 *
 * Each absence is paired with a control that shows it could have been
 * present: the file the scratch copy leaves out ranks for another
 * question, the agent the skill search leaves out ranks in an agent
 * search, and the log whose prompt the classifier reads as `other` is
 * shown to read as `other` before the runner stores it as `search`.
 */
import type { EffortStore, SessionEffortRow } from '../../effort/store/types.js';
import type { CapturedSession, CapturingSpawner } from '../../utils/claude.js';
import type { InventoryRecord } from '../record.js';

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { collectSessionRow, sessionLogDir } from '../../effort/collect.js';
import { openNdjsonStore } from '../../effort/store/ndjson.js';
import { openSqliteStore } from '../../effort/store/sqlite.js';
import { readInventoryText, summarize } from '../record.js';

import { SEARCH_PROMPT_PREFIX } from './prompt.js';
import { SCRATCH_PREFIX } from './scratch.js';

import { droppedLine, rankSearch, runSearch, SEARCH_TOOLS, UNANSWERABLE_TEXT } from './index.js';

/** The id every stubbed session runs under. */
const SESSION_ID = '5ea4c400-0000-4000-8000-0000000000aa';

/** The question most cases ask: it ranks documentation and changelog-notes. */
const QUESTION = 'who writes TSDoc comments for exported symbols';

/** The line the true quote sits on in the documentation file. */
const TRUE_LINE = 9;

const DOCUMENTATION = [
  '---',
  'name: documentation',
  'description: Owns TSDoc blocks and inline comment rules.',
  'tags:',
  '  - tsdoc',
  '---',
  '# Documentation',
  '',
  'Every exported symbol carries a TSDoc block.',
  'Inline comments say why, never what.',
  '',
].join('\n');

const CHANGELOG = [
  '---',
  'name: changelog-notes',
  'description: Writes the change notes a release renders.',
  '---',
  '# Changelog notes',
  '',
  'One line per change a user would notice.',
  '',
].join('\n');

const DOCKER = [
  '---',
  'name: docker-images',
  'description: Builds container images with a pinned base.',
  '---',
  '# Docker images',
  '',
  'Pin the base image by digest.',
  '',
].join('\n');

/** A user-level holder of `documentation`, shadowed by the project's. */
const SHADOWED = [
  '---',
  'name: documentation',
  'description: A user copy about TSDoc that the project copy shadows.',
  '---',
  'The shadowed copy.',
  '',
].join('\n');

/** An agent whose text answers the question as well as the skill does. */
const REVIEWER = [
  '---',
  'name: reviewer',
  'description: Reviews TSDoc comments on exported symbols.',
  '---',
  'Reviews code.',
  '',
].join('\n');

let base: string;
let home: string;
let scratchRoot: string;
let records: InventoryRecord[];
let store: EffortStore;

/** Writes `text` at `path`, making its directory. */
function plant(path: string, text: string): string {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
  return path;
}

/** A record read from the file at `path`, as the tree readers build one. */
function recordOf(overrides: Pick<InventoryRecord, 'kind' | 'name' | 'source' | 'path'> & Partial<InventoryRecord>): InventoryRecord {
  const front = readInventoryText(readFileSync(overrides.path, 'utf8'));
  return {
    summary: summarize(front.description),
    whenToUse: front.whenToUse,
    prevents: front.prevents,
    stack: front.stack,
    tags: front.tags,
    check: 'pass',
    state: 'enabled',
    visibleToLoop: true,
    ...overrides,
  };
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'rafa-search-runner-'));
  home = join(base, 'home');
  scratchRoot = join(base, 'scratch');
  mkdirSync(home);
  mkdirSync(scratchRoot);
  const project = join(base, 'project', '.claude');
  records = [
    recordOf({ kind: 'skill', name: 'changelog-notes', source: 'project', path: plant(join(project, 'skills', 'changelog-notes', 'SKILL.md'), CHANGELOG) }),
    recordOf({ kind: 'skill', name: 'docker-images', source: 'project', path: plant(join(project, 'skills', 'docker-images', 'SKILL.md'), DOCKER) }),
    recordOf({ kind: 'skill', name: 'documentation', source: 'project', path: plant(join(project, 'skills', 'documentation', 'SKILL.md'), DOCUMENTATION) }),
    recordOf({
      kind: 'skill',
      name: 'documentation',
      source: 'user',
      state: 'shadowed-by:project',
      visibleToLoop: false,
      path: plant(join(home, '.claude', 'skills', 'documentation', 'SKILL.md'), SHADOWED),
    }),
    recordOf({ kind: 'agent', name: 'reviewer', source: 'project', path: plant(join(project, 'agents', 'reviewer.md'), REVIEWER) }),
  ];
  store = openNdjsonStore(join(base, 'repo'));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** One JSON record on one line. */
function logRecord(fields: Record<string, unknown>): string {
  return JSON.stringify(fields);
}

/** A session log whose prompt is `prompt`, with one haiku turn. */
function sessionLog(prompt: string): string {
  return [
    logRecord({ type: 'queue-operation', operation: 'enqueue', content: prompt }),
    logRecord({
      type: 'assistant',
      timestamp: '2026-09-24T09:00:00.000Z',
      gitBranch: 'main',
      entrypoint: 'sdk-cli',
      isSidechain: false,
      message: { model: 'claude-haiku-4-5', usage: { input_tokens: 900, output_tokens: 210 } },
    }),
    '',
  ].join('\n');
}

/** A `rafa:search` block as the session would end with one. */
function searchBlock(body: readonly string[]): string {
  return ['Here is what I found.', '', '```rafa:search', ...body, '```', ''].join('\n');
}

/** A block naming `documentation` with `quote` at `line`. */
function documentationMatch(quote: string, line: number = TRUE_LINE): readonly string[] {
  return [
    '  - name: documentation',
    '    why: "owns TSDoc blocks"',
    `    quote: "${quote}"`,
    `    line: ${line}`,
  ];
}

/** What one stubbed spawn was handed, and what its directory held. */
interface SpawnCall {
  readonly args: readonly string[];
  readonly prompt: string;
  readonly cwd: string | undefined;
  /** Every file under the working directory while the session ran. */
  readonly files: readonly string[];
}

/** How the stub behaves. */
interface StubOptions {
  /** What the session answers. */
  readonly answer: CapturedSession;
  /** The prompt the planted log records, or null to leave no log. */
  readonly logPrompt?: (prompt: string) => string | null;
}

/** Every file under `dir`, relative to it, sorted. */
function filesUnder(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((entry) => statSync(join(dir, entry)).isFile())
    .sort((a, b) => a.localeCompare(b));
}

/** A spawner double; see the module note. */
function stubSpawner(options: StubOptions): { spawn: CapturingSpawner; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const spawn: CapturingSpawner = (args, prompt, spawnOptions) => {
    const cwd = spawnOptions?.cwd;
    const files = cwd === undefined
      ? []
      : filesUnder(cwd);
    calls.push({ args, prompt, cwd, files });
    const logged = (options.logPrompt ?? ((given) => given))(prompt);
    if (cwd !== undefined && logged !== null) {
      const id = args[args.indexOf('--session-id') + 1] ?? 'missing';
      plant(join(sessionLogDir(realpathSync(cwd), home), `${id}.jsonl`), sessionLog(logged));
    }
    return Promise.resolve(options.answer);
  };
  return { spawn, calls };
}

/** A spawner that fails the case when it is hit. */
const refusingSpawner: CapturingSpawner = () => {
  throw new Error('the stub was spawned');
};

/** `runSearch` over the planted skills with `spawn`. */
function search(spawn: CapturingSpawner, question: string = QUESTION): ReturnType<typeof runSearch> {
  return runSearch({
    kind: 'skill',
    question,
    records,
    settingSources: ['project', 'local'],
    store,
    home,
    spawn,
    scratchRoot,
    sessionId: () => SESSION_ID,
  });
}

/** An answer that exits 0 with `stdout`. */
function ok(stdout: string): CapturedSession {
  return { exitCode: 0, stdout };
}

describe('rankSearch', () => {
  test('ranks the first holder of each name, of the kind searched', () => {
    const ranked = rankSearch('skill', QUESTION, records);

    expect(ranked.map(({ record }) => `${record.name}@${record.source}`)).toEqual([
      'documentation@project',
      'changelog-notes@project',
    ]);
  });

  test('leaves out a file the question does not reach, which another question ranks', () => {
    expect(rankSearch('skill', QUESTION, records).map(({ record }) => record.name)).not.toContain('docker-images');
    expect(rankSearch('skill', 'pinned container images', records).map(({ record }) => record.name)).toEqual(['docker-images']);
  });

  test('leaves out the agent from a skill search, which an agent search ranks', () => {
    expect(rankSearch('skill', QUESTION, records).map(({ record }) => record.kind)).not.toContain('agent');
    expect(rankSearch('agent', QUESTION, records).map(({ record }) => record.name)).toEqual(['reviewer']);
  });
});

describe('runSearch, a session that answers', () => {
  test('keeps the true quote and counts the invented one as dropped', async () => {
    const block = searchBlock([
      'matches:',
      ...documentationMatch('Every exported symbol carries a TSDoc block.'),
      '  - name: changelog-notes',
      '    why: "writes notes"',
      '    quote: "Every change note is reviewed by two people."',
      '    line: 7',
      'unanswerable: false',
    ]);
    const { spawn } = stubSpawner({ answer: ok(block) });

    const outcome = await search(spawn);

    expect(outcome.status).toBe('answered');
    if (outcome.status !== 'answered') return;
    expect(outcome.matches.map((match) => [match.name, match.line, match.record.source])).toEqual([
      ['documentation', TRUE_LINE, 'project'],
    ]);
    expect(outcome.matches[0]?.record.path).toBe(records[2]?.path ?? '');
    expect(outcome.dropped).toBe(1);
    expect(droppedLine(outcome.dropped)).toBe('1 match dropped: its quote is not in the file');
    expect(outcome.issues).toEqual([]);
  });

  test('passes on the parser\'s issue for an entry naming no candidate', async () => {
    const block = searchBlock([
      'matches:',
      ...documentationMatch('Every exported symbol carries a TSDoc block.'),
      '  - name: docker-images',
      '    why: "not ranked"',
      '    quote: "Pin the base image by digest."',
      '    line: 7',
      'unanswerable: false',
    ]);
    const { spawn } = stubSpawner({ answer: ok(block) });

    const outcome = await search(spawn);

    expect(outcome.status).toBe('answered');
    if (outcome.status !== 'answered') return;
    expect(outcome.matches.map((match) => match.name)).toEqual(['documentation']);
    expect(outcome.dropped).toBe(0);
    expect(outcome.issues.map((issue) => issue.field)).toEqual(['matches[1]']);
  });

  test('answers unanswerable: true with its text', async () => {
    const { spawn } = stubSpawner({ answer: ok(searchBlock(['matches: []', 'unanswerable: true'])) });

    const outcome = await search(spawn);

    expect(outcome.status).toBe('unanswerable');
    if (outcome.status !== 'unanswerable') return;
    expect(outcome.text).toBe(UNANSWERABLE_TEXT);
    expect(outcome.text).toBe('not answerable from these files');
  });
});

describe('runSearch, the one session', () => {
  test('spawns once with haiku, the session id, the setting sources and the three tools last', async () => {
    const { spawn, calls } = stubSpawner({ answer: ok(searchBlock(['matches: []', 'unanswerable: true'])) });

    await search(spawn);

    expect(calls.map((call) => call.args)).toEqual([[
      '-p',
      '--dangerously-skip-permissions',
      '--setting-sources',
      'project,local',
      '--session-id',
      SESSION_ID,
      '--model',
      'haiku',
      '--tools',
      'Read,Grep,Glob',
    ]]);
    expect([...SEARCH_TOOLS]).toEqual(['Read', 'Grep', 'Glob']);
  });

  test('runs in a scratch copy of the ranked files alone, removed afterwards', async () => {
    const { spawn, calls } = stubSpawner({ answer: ok(searchBlock(['matches: []', 'unanswerable: true'])) });

    await search(spawn);

    const cwd = calls[0]?.cwd ?? '';
    expect(relative(scratchRoot, cwd).startsWith(SCRATCH_PREFIX)).toBe(true);
    expect(calls[0]?.files).toEqual(['changelog-notes/SKILL.md', 'documentation/SKILL.md']);
    expect(existsSync(cwd)).toBe(false);
    expect(readdirSync(scratchRoot)).toEqual([]);
  });

  test('copies the nearest holder of a shadowed name, not the shadowed one', async () => {
    let copied = '';
    const { spawn: inner } = stubSpawner({ answer: ok(searchBlock(['matches: []', 'unanswerable: true'])) });
    const spawn: CapturingSpawner = (args, prompt, options) => {
      copied = readFileSync(join(options?.cwd ?? '', 'documentation', 'SKILL.md'), 'utf8');
      return inner(args, prompt, options);
    };

    await search(spawn);

    expect(copied).toBe(DOCUMENTATION);
    expect(copied).not.toBe(SHADOWED);
  });

  test('hands over the template, each candidate at its copy\'s relative path', async () => {
    const { spawn, calls } = stubSpawner({ answer: ok(searchBlock(['matches: []', 'unanswerable: true'])) });

    await search(spawn);

    const prompt = calls[0]?.prompt ?? '';
    expect(prompt.split('\n')[0]).toBe(SEARCH_PROMPT_PREFIX);
    expect(prompt).toContain('- documentation: `documentation/SKILL.md`\n- changelog-notes: `changelog-notes/SKILL.md`\n');
    expect(prompt).toContain(`\`\`\`text\n${QUESTION}\n\`\`\``);
  });

  test('starts no session when nothing ranks', async () => {
    const outcome = await search(refusingSpawner, 'zzzz qqqq');

    expect(outcome).toEqual({ status: 'no-candidates', ranking: [] });
    expect(readdirSync(scratchRoot)).toEqual([]);
  });

  test('rejects with the spawner\'s error, having removed the copy and stored nothing', async () => {
    const failure = new Error('spawn failed');
    const spawn: CapturingSpawner = () => Promise.reject(failure);

    await expect(search(spawn)).rejects.toBe(failure);

    expect(readdirSync(scratchRoot)).toEqual([]);
    expect(store.read('sessions')).toEqual([]);
  });
});

describe('runSearch, the fallback to the ranking', () => {
  test('falls back with a notice when the output holds no block', async () => {
    const { spawn, calls } = stubSpawner({ answer: ok('I could not decide.\n') });

    const outcome = await search(spawn);

    expect(outcome.status).toBe('fallback');
    if (outcome.status !== 'fallback') return;
    expect(outcome.notice).toBe('the session output holds no rafa:search block; showing the keyword ranking instead');
    expect(outcome.ranking.map(({ record }) => record.name)).toEqual(['documentation', 'changelog-notes']);
    expect(existsSync(calls[0]?.cwd ?? '')).toBe(false);
    expect(outcome.effort.written).toBe(true);
  });

  test('falls back with a notice when the block is malformed', async () => {
    const { spawn, calls } = stubSpawner({ answer: ok(searchBlock(['matches: []', 'unanswerable: maybe'])) });

    const outcome = await search(spawn);

    expect(outcome.status).toBe('fallback');
    if (outcome.status !== 'fallback') return;
    expect(outcome.notice).toStartWith('rafa:search block at line 3 has unanswerable "maybe", not true or false');
    expect(outcome.notice).toEndWith('; showing the keyword ranking instead');
    expect(existsSync(calls[0]?.cwd ?? '')).toBe(false);
  });

  test('falls back on a non-zero exit even with a readable block', async () => {
    const block = searchBlock(['matches:', ...documentationMatch('Every exported symbol carries a TSDoc block.'), 'unanswerable: false']);
    const { spawn } = stubSpawner({ answer: { exitCode: 1, stdout: block } });

    const outcome = await search(spawn);

    expect(outcome.status).toBe('fallback');
    if (outcome.status !== 'fallback') return;
    expect(outcome.notice).toBe('the search session exited 1; showing the keyword ranking instead');
  });
});

/** Both openers, named as `.rafa/config.yaml`'s `store` key names them. */
const BACKENDS: readonly (readonly [string, (root: string) => EffortStore])[] = [
  ['sqlite', openSqliteStore],
  ['ndjson', openNdjsonStore],
];

describe.each(BACKENDS)('%s: the search effort row', (name, open) => {
  test('stores one row of kind search, read from the session\'s log', async () => {
    store = open(join(base, `${name}-repo`));
    const { spawn } = stubSpawner({ answer: ok(searchBlock(['matches: []', 'unanswerable: true'])) });

    const outcome = await search(spawn);

    expect(outcome.status).toBe('unanswerable');
    if (outcome.status === 'no-candidates') return;
    expect(outcome.effort.written).toBe(true);
    const rows = store.read('sessions') as SessionEffortRow[];
    expect(rows.map((row) => [row.sessionId, row.kind, row.modelCounts])).toEqual([
      [SESSION_ID, 'search', { 'claude-haiku-4-5': 1 }],
    ]);
  });

  test('stores the row as search when the log\'s prompt classifies as other', async () => {
    store = open(join(base, `${name}-repo`));
    let logPath = '';
    const { spawn: inner } = stubSpawner({
      answer: ok(searchBlock(['matches: []', 'unanswerable: true'])),
      logPrompt: () => 'Reply with exactly the word: ok',
    });
    const spawn: CapturingSpawner = async (args, prompt, options) => {
      const session = await inner(args, prompt, options);
      logPath = join(sessionLogDir(realpathSync(options?.cwd ?? ''), home), `${SESSION_ID}.jsonl`);
      return session;
    };

    await search(spawn);

    const stats = statSync(logPath);
    const plain = await collectSessionRow({ path: logPath, sessionId: SESSION_ID, sizeBytes: stats.size, modifiedAtMs: stats.mtimeMs }, []);
    expect(plain.kind).toBe('other');
    expect((store.read('sessions') as SessionEffortRow[]).map((row) => row.kind)).toEqual(['search']);
  });
});

describe('runSearch, a session that left no log', () => {
  test('answers as usual and says the row was not written', async () => {
    const block = searchBlock(['matches:', ...documentationMatch('Every exported symbol carries a TSDoc block.'), 'unanswerable: false']);
    const { spawn } = stubSpawner({ answer: ok(block), logPrompt: () => null });

    const outcome = await search(spawn);

    expect(outcome.status).toBe('answered');
    if (outcome.status !== 'answered') return;
    expect(outcome.matches).toHaveLength(1);
    expect(outcome.effort.written).toBe(false);
    if (outcome.effort.written) return;
    expect(outcome.effort.reason).toStartWith('no session log at ');
    expect(outcome.effort.reason).toEndWith(`${SESSION_ID}.jsonl`);
    expect(store.read('sessions')).toEqual([]);
  });
});

describe('droppedLine', () => {
  test('says nothing for zero, and the plural past one', () => {
    expect(droppedLine(0)).toBe('');
    expect(droppedLine(2)).toBe('2 matches dropped: their quotes are not in their files');
  });
});
