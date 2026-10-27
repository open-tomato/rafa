/**
 * Tests for what `loop start` does with the doc task's report
 * (`start/stale-docs.ts`).
 *
 * Every root, store and issue directory is made under one temporary
 * directory this file creates and removes. The tracker is a real `local`
 * tracker under the case's root, handed over by a stubbed chain resolver
 * that counts its calls, and wrapped in a spy counting each tracker
 * call; the rows are read back off the store's `stale_docs` table
 * through `bun:sqlite`, and the operator's lines through a sink output
 * set for the case and unset after it. No case spawns `gh`.
 *
 * Each case that answers nothing sits beside a control that the same
 * reading can see the thing: a task that is not the doc task, or did not
 * end `done`, beside the doc task that did; an issue holding no secret
 * beside the entry that named one; a print that is empty beside the one
 * that holds the kept lines.
 */
import type { StaleDocsTaskInput, StartStaleDocsConfig, StartStaleDocsOptions } from './stale-docs.js';
import type { GitRunner } from '../pr/index.js';
import type { OpenIssue, Tracker } from '@open-tomato/rafa/ports';
import type { FindingOutcome } from '@open-tomato/rafa/store/findings';
import type { ResolveTrackerOptions, TrackerResolution } from '@open-tomato/rafa-board/adapters/tracker/resolve';

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import {
  afterAll,
  afterEach,
  describe,
  expect,
  it,
} from 'bun:test';

import { setActiveOutput } from '@open-tomato/rafa/core/output';
import { parsePlan , parseTaskDeclaration } from '@open-tomato/rafa/core/plan';
import { sqliteStorePath } from '@open-tomato/rafa/store/sqlite';
import { gitIdentityEnv } from '@open-tomato/rafa/tests/git-identity';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';
import { createLocalTracker, localIssuesDir } from '@open-tomato/rafa-board/adapters/tracker/local';
import {
  addStaleDocLine,
  NEXT_VERSION,
  NO_EDITABLE_TRACKER,
  STALE_DOCS_MARKER,
  staleDocsTitle,
} from '@open-tomato/rafa-release/docs/release-issue';

import { renderDocUpdatePlan } from '../commands/docs/plan.js';
import { createGitRunner } from '../pr/index.js';

import { createStartStaleDocs, readStaleDocsVersion } from './stale-docs.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-start-stale-docs-'));
let rootCount = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

afterEach(() => {
  setActiveOutput(null);
});

/** The clock the tracker stamps with. */
const CLOCK = (): string => '2026-10-14T09:00:00.000Z';

/** The version every case but the version cases titles the issue for. */
const VERSION = '1.4.0';

/** The doc task's line, as the tracker holds it. */
const DOC_TASK = 'Repair the docs of what this plan changed  {agent=doc-updater docs=repair}';

/** A code task's line. */
const CODE_TASK = 'Wire the loop  {agent=loop-implementer}';

const CONFIG: StartStaleDocsConfig = {
  trackerDefault: 'local',
  trackerFallback: [],
  prerequisitesRequired: [],
  prerequisitesOptional: [],
  prBase: null,
  releaseEnabled: false,
  releaseVersionFile: 'package.json',
  releaseChangelog: 'CHANGELOG.md',
  releaseFragments: '.changes',
  releaseStrategy: 'semver-by-level',
  releaseHeading: '## {version} — {date}, {title}',
};

/** One `stale_docs` entry: where the stale line is, and what no longer matches. */
type Entry = readonly [where: string | null, what: string];

const PAGE: Entry = ['context/triage.md:12', 'names three channels'];
const README: Entry = ['README.md', 'shows the old flag'];

/** A YAML scalar: a double-quoted string, or the bare word for null. */
function scalar(value: string | null): string {
  return value === null
    ? 'null'
    : JSON.stringify(value);
}

/** What a session prints: its report, `stale_docs` listing `entries`, or no such key for undefined. */
function sessionOutput(entries: readonly Entry[] | undefined): string {
  const staleDocs = entries === undefined
    ? []
    : [
      'stale_docs:',
      ...entries.flatMap(([where, what]) => [`  - where: ${scalar(where)}`, `    what: ${scalar(what)}`]),
    ];
  return [
    'Repaired the docs.',
    '',
    '```rafa:report',
    'status: done',
    'feedback: "repaired what it could"',
    'findings: []',
    'skills_used: []',
    'blockers: []',
    'out_of_scope_bugs: []',
    ...staleDocs,
    'changes: []',
    '```',
    '',
  ].join('\n');
}

let sessionCount = 0;

/** One task's input: its line, the entries its report lists, and its outcome. */
function taskInput(
  entries: readonly Entry[] | undefined,
  line = DOC_TASK,
  outcome: FindingOutcome = 'done',
): StaleDocsTaskInput {
  sessionCount += 1;
  const { text, declaration } = parseTaskDeclaration(line);
  return {
    planStub: 'rafa-1072-demo',
    dispatch: { sessionId: `session-${sessionCount}`, taskText: text, output: sessionOutput(entries), declaration },
    outcome,
  };
}

/** The lines the active output was handed, by level. */
interface Lines {
  readonly info: string[];
  readonly warn: string[];
}

/** Sets a sink output as the active output, answering the lines it takes. */
function captureLines(): Lines {
  const lines: Lines = { info: [], warn: [] };
  setActiveOutput(sinkOutput({
    info: (message) => {
      lines.info.push(message);
    },
    warn: (message) => {
      lines.warn.push(message);
    },
  }));
  return lines;
}

/** A tracker that counts each call it hands on. */
interface Spied {
  readonly tracker: Tracker;
  readonly calls: string[];
}

/** Wraps `inner`, counting every call by its method, with `overrides` in place of its members. */
function spy(inner: Tracker, overrides: Partial<Tracker> = {}): Spied {
  const calls: string[] = [];
  const counted = <A extends unknown[], R>(name: string, fn: ((...args: A) => R) | undefined) => fn === undefined
    ? undefined
    : (...args: A): R => {
      calls.push(name);
      return fn(...args);
    };
  const merged: Tracker = { ...inner, ...overrides };
  const tracker: Tracker = {
    kind: merged.kind,
    capabilities: merged.capabilities,
    preflight: merged.preflight,
    find: counted('find', merged.find),
    get: counted('get', merged.get),
    create: counted('create', merged.create),
    comment: counted('comment', merged.comment),
    transition: counted('transition', merged.transition),
    openIssues: counted('openIssues', merged.openIssues),
    edit: counted('edit', merged.edit),
  } as Tracker;
  return { tracker, calls };
}

/** One case's root and its spied `local` tracker. */
interface Fixture {
  readonly root: string;
  readonly spied: Spied;
  readonly resolveCalls: ResolveTrackerOptions[];
  readonly options: StartStaleDocsOptions;
}

/** A fresh root whose chain lands on its `local` tracker, `overrides` in place of its members. */
function fixture(overrides: Partial<Tracker> = {}, extra: Partial<StartStaleDocsOptions> = {}): Fixture {
  const root = join(tempBase, `root-${rootCount}`);
  rootCount += 1;
  mkdirSync(root, { recursive: true });
  const spied = spy(createLocalTracker({ issuesDir: localIssuesDir(root), fallbackReason: null, now: CLOCK }), overrides);
  const resolveCalls: ResolveTrackerOptions[] = [];
  const resolve = (options: ResolveTrackerOptions): Promise<TrackerResolution> => {
    resolveCalls.push(options);
    return Promise.resolve({
      tracker: spied.tracker,
      degraded: false,
      fallbackReason: null,
      attempts: [{ kind: spied.tracker.kind, ok: true, reason: null }],
    });
  };
  const options: StartStaleDocsOptions = {
    repoRoot: root,
    checkout: root,
    config: CONFIG,
    home: join(tempBase, 'home'),
    env: {},
    resolve,
    readVersion: () => VERSION,
    ...extra,
  };
  return { root, spied, resolveCalls, options };
}

/** One stored row: its kind, where and what. */
interface Row {
  readonly kind: string;
  readonly where_at: string | null;
  readonly what: string;
}

/** Every `stale_docs` row of the root's store, in append order; none when there is no store. */
function rowsOf(root: string): Row[] {
  const path = sqliteStorePath(root);
  if (!existsSync(path)) return [];
  const db = new Database(path, { readonly: true });
  try {
    return db.query<Row, []>('SELECT kind, where_at, what FROM stale_docs ORDER BY seq').all();
  } finally {
    db.close();
  }
}

/** Every open stale-docs issue the root's `local` tracker holds. */
async function markedIssues(root: string): Promise<OpenIssue[]> {
  const tracker = createLocalTracker({ issuesDir: localIssuesDir(root), fallbackReason: null, now: CLOCK });
  const open = await tracker.openIssues?.('chore') ?? [];
  return open.filter((issue) => issue.body.includes(STALE_DOCS_MARKER));
}

describe('which report is handled', () => {
  it('handles the doc task ended done: unsettled rows, one issue holding each line', async () => {
    captureLines();
    const { root, options, resolveCalls } = fixture();
    const handler = createStartStaleDocs(options);

    const handled = await handler.afterTask(taskInput([PAGE, README]));

    expect(handled?.lines.map((line) => line.action)).toEqual(['created', 'appended']);
    expect(handled?.stored?.appended).toBe(2);
    expect(rowsOf(root)).toEqual([
      { kind: 'unsettled', where_at: PAGE[0], what: PAGE[1] },
      { kind: 'unsettled', where_at: README[0], what: README[1] },
    ]);
    const issues = await markedIssues(root);
    expect(issues.map((issue) => issue.title)).toEqual([staleDocsTitle(VERSION)]);
    expect(issues[0]?.body).toContain(`- [ ] ${PAGE[0]}: ${PAGE[1]}\n- [ ] ${README[0]}: ${README[1]}`);
    expect(resolveCalls).toHaveLength(1);
  });

  it('leaves a code task\'s entries alone: no row, no resolution, no issue', async () => {
    const { root, options, resolveCalls } = fixture();
    const handler = createStartStaleDocs(options);

    expect(await handler.afterTask(taskInput([PAGE], CODE_TASK))).toBeNull();

    expect(rowsOf(root)).toEqual([]);
    expect(resolveCalls).toHaveLength(0);
    expect(await markedIssues(root)).toEqual([]);
  });

  it.each(['blocked', 'failed'] as const)('leaves a doc task that ended %s alone', async (outcome) => {
    const { root, options, resolveCalls } = fixture();
    const handler = createStartStaleDocs(options);

    expect(await handler.afterTask(taskInput([PAGE], DOC_TASK, outcome))).toBeNull();

    expect(rowsOf(root)).toEqual([]);
    expect(resolveCalls).toHaveLength(0);
  });

  it('resolves nothing for a doc task that left no entry, or wrote no `stale_docs` key', async () => {
    const readVersion = (): string => {
      throw new Error('the version was read for a report with no entry');
    };
    const { root, options, resolveCalls } = fixture({}, { readVersion });
    const handler = createStartStaleDocs(options);

    expect(await handler.afterTask(taskInput([]))).toBeNull();
    expect(await handler.afterTask(taskInput(undefined))).toBeNull();

    expect(resolveCalls).toHaveLength(0);
    expect(rowsOf(root)).toEqual([]);
  });
});

describe('across a run', () => {
  it('resolves the chain and reads the version once, and a later report reaches the same issue', async () => {
    captureLines();
    let versionReads = 0;
    const readVersion = (): string => {
      versionReads += 1;
      return VERSION;
    };
    const { root, options, resolveCalls } = fixture({}, { readVersion });
    const handler = createStartStaleDocs(options);

    await handler.afterTask(taskInput([PAGE]));
    const second = await handler.afterTask(taskInput([README, PAGE]));

    expect(second?.lines.map((line) => line.action)).toEqual(['appended', 'held']);
    expect(resolveCalls).toHaveLength(1);
    expect(versionReads).toBe(1);
    const issues = await markedIssues(root);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.body.match(/- \[ \] /g)).toHaveLength(2);
    expect(handler.atRunEnd()).toEqual([]);
  });
});

describe('a run with no tracker that can hold the issue', () => {
  it('keeps the lines, creates nothing, and prints them once after the last task', async () => {
    const lines = captureLines();
    const { root, options, spied } = fixture({ edit: undefined });
    const handler = createStartStaleDocs(options);

    const handled = await handler.afterTask(taskInput([PAGE, README, PAGE]));

    expect(handled?.lines.map((line) => line.action)).toEqual(['kept', 'kept', 'kept']);
    expect(spied.calls).toEqual([]);
    expect(rowsOf(root).map((row) => row.kind)).toEqual(['unsettled', 'unsettled']);
    expect(lines.info.every((line) => !line.startsWith('📝'))).toBe(true);

    const printed = handler.atRunEnd();

    expect(printed).toEqual([
      `📝 Stale documentation the doc task could not settle, with no tracker to hold "${staleDocsTitle(VERSION)}":`,
      `   - [ ] ${PAGE[0]}: ${PAGE[1]}`,
      `   - [ ] ${README[0]}: ${README[1]}`,
    ]);
    expect(lines.info.slice(-3)).toEqual([...printed]);
    expect(handler.atRunEnd()).toEqual([]);
    expect(await markedIssues(root)).toEqual([]);
  });

  it('keeps the lines when the chain lands nowhere, warning once', async () => {
    const lines = captureLines();
    let calls = 0;
    const resolve = (): Promise<TrackerResolution> => {
      calls += 1;
      return Promise.reject(new Error('no tracker kind is available'));
    };
    const { options } = fixture({}, { resolve });
    const handler = createStartStaleDocs(options);

    await handler.afterTask(taskInput([PAGE]));
    await handler.afterTask(taskInput([README]));

    expect(calls).toBe(1);
    expect(lines.warn.filter((line) => line.includes('no tracker kind is available'))).toHaveLength(1);
    expect(handler.atRunEnd().slice(1)).toEqual([`   - [ ] ${PAGE[0]}: ${PAGE[1]}`, `   - [ ] ${README[0]}: ${README[1]}`]);
  });

  it('names why a line was kept in its note', async () => {
    const lines = captureLines();
    const { options } = fixture({ openIssues: undefined });

    await createStartStaleDocs(options).afterTask(taskInput([PAGE]));

    expect(lines.info).toEqual([`   Stale docs: kept for the print after the last task (${NO_EDITABLE_TRACKER}): ${PAGE[0]}: ${PAGE[1]}`]);
  });
});

describe('what reaches the issue', () => {
  it('redacts a named secret and the checkout\'s path from the line, and stores the row as reported', async () => {
    captureLines();
    const secret = 'tok-3f9a1c77e2';
    const config: StartStaleDocsConfig = {
      ...CONFIG,
      prerequisitesRequired: [{ kind: 'env', name: 'DEMO_TOKEN', probe: null }],
    };
    const { root, options } = fixture({}, { config, env: { DEMO_TOKEN: secret } });
    const where = `${root}/docs/setup.md:4`;
    const what = `still shows ${secret} as the example`;

    await createStartStaleDocs(options).afterTask(taskInput([[where, what]]));

    const body = (await markedIssues(root))[0]?.body ?? '';
    expect(body).toContain('docs/setup.md:4');
    expect(body).not.toContain(root);
    expect(body).not.toContain(secret);
    expect(rowsOf(root)).toEqual([{ kind: 'unsettled', where_at: where, what }]);
  });

  it('writes an entry naming no place as its `what` alone', async () => {
    captureLines();
    const { root, options } = fixture();

    await createStartStaleDocs(options).afterTask(taskInput([[null, 'the glossary trails the code']]));

    expect((await markedIssues(root))[0]?.body).toContain('\n- [ ] the glossary trails the code\n');
  });
});

describe('a failure never stops the run', () => {
  it('warns about a tracker call that rejects, keeping nothing for the print', async () => {
    const lines = captureLines();
    const { options } = fixture({ create: () => Promise.reject(new Error('the disk is full')) });
    const handler = createStartStaleDocs(options);

    const handled = await handler.afterTask(taskInput([PAGE]));

    expect(handled?.lines.map((line) => line.action)).toEqual(['failed']);
    expect(lines.warn).toEqual([
      `   Stale docs: not added to ${staleDocsTitle(VERSION)}: creating the stale-docs issue failed: the disk is full`,
    ]);
    expect(handler.atRunEnd()).toEqual([]);
  });

  it('warns about a store that throws, and still adds the lines', async () => {
    const lines = captureLines();
    const { root, options } = fixture({}, { seams: { newId: () => 'one-id' } });

    const handled = await createStartStaleDocs(options).afterTask(taskInput([PAGE, README]));

    expect(handled?.stored).toBeNull();
    expect(lines.warn).toHaveLength(1);
    expect(lines.warn[0]).toContain('the unsettled rows were not stored');
    expect(rowsOf(root)).toEqual([]);
    expect(handled?.lines.map((line) => line.action)).toEqual(['created', 'appended']);
  });

  it('warns and answers null when anything else throws', async () => {
    const lines = captureLines();
    const readVersion = (): string => {
      throw new Error('the version file is a directory');
    };
    const { options } = fixture({}, { readVersion });

    expect(await createStartStaleDocs(options).afterTask(taskInput([PAGE]))).toBeNull();
    expect(lines.warn).toEqual([
      '   Stale docs: nothing more was done with the doc task\'s report: the version file is a directory',
    ]);
  });
});

describe('ticking a doc-update plan\'s line', () => {
  const PAGE_LINE = `${PAGE[0]}: ${PAGE[1]}`;
  const README_LINE = `${README[0]}: ${README[1]}`;

  /** A root whose issue holds both lines, its doc-update plan written from them, and the plan's tasks. */
  async function docUpdateRun(extra: Partial<StartStaleDocsOptions> = {}): Promise<{
    readonly root: string;
    readonly options: StartStaleDocsOptions;
    readonly tasks: readonly StaleDocsTaskInput['dispatch'][];
  }> {
    const { root, options: base } = fixture();
    const tracker = createLocalTracker({ issuesDir: localIssuesDir(root), fallbackReason: null, now: CLOCK });
    const created = await addStaleDocLine({ tracker, version: VERSION, entry: { where: PAGE[0], what: PAGE[1] } });
    await addStaleDocLine({ tracker, version: VERSION, entry: { where: README[0], what: README[1] } });
    if (created.action !== 'created') throw new Error(`seeding answered ${created.action}`);
    const markdown = renderDocUpdatePlan({ issue: created.ref.externalId, lines: [PAGE_LINE, README_LINE] });
    const planPath = join(root, 'PLAN-doc-update.md');
    writeFileSync(planPath, markdown, 'utf8');
    const tasks = parsePlan(markdown).tasks.map((task, index) => ({
      sessionId: `doc-update-${index}`,
      taskText: task.text,
      output: sessionOutput(undefined),
      declaration: task.declaration,
    }));
    return { root, options: { ...base, planPath, ...extra }, tasks };
  }

  /** The one marked issue's body. */
  async function bodyOf(root: string): Promise<string> {
    const issues = await markedIssues(root);
    expect(issues).toHaveLength(1);
    return issues[0]?.body ?? '';
  }

  it('ticks a done task\'s line in the issue the plan names, the other line left open', async () => {
    const lines = captureLines();
    const { root, options, tasks } = await docUpdateRun();

    const handled = await createStartStaleDocs(options).afterTask({ planStub: 'rafa-1-doc-update', dispatch: tasks[0]!, outcome: 'done' });

    expect(handled?.ticked?.action).toBe('ticked');
    expect(handled?.lines).toEqual([]);
    const body = await bodyOf(root);
    expect(body).toContain(`- [x] ${PAGE_LINE}`);
    expect(body).toContain(`- [ ] ${README_LINE}`);
    expect(lines.info.some((line) => line.includes('ticked in local issue') && line.endsWith(PAGE_LINE))).toBe(true);
    expect(lines.warn).toEqual([]);
  });

  it.each(['blocked', 'failed'] as const)('leaves the line of a task that ended %s open', async (outcome) => {
    const { root, options, tasks } = await docUpdateRun();
    const before = await bodyOf(root);

    expect(await createStartStaleDocs(options).afterTask({ planStub: 'rafa-1-doc-update', dispatch: tasks[0]!, outcome })).toBeNull();

    expect(await bodyOf(root)).toBe(before);
    expect(before).toContain(`- [ ] ${PAGE_LINE}`);
  });

  it('answers absent and writes nothing for a line no longer in the body', async () => {
    const lines = captureLines();
    const { root, options, tasks } = await docUpdateRun();
    const issuesDir = localIssuesDir(root);
    const tracker = createLocalTracker({ issuesDir, fallbackReason: null, now: CLOCK });
    const [issue] = await markedIssues(root);
    if (issue === undefined) throw new Error('no issue was seeded');
    await tracker.edit?.(issue.ref, { body: issue.body.replace(`- [ ] ${PAGE_LINE}\n`, '') });
    const before = await bodyOf(root);

    const handled = await createStartStaleDocs(options).afterTask({ planStub: 'rafa-1-doc-update', dispatch: tasks[0]!, outcome: 'done' });

    expect(handled?.ticked?.action).toBe('absent');
    expect(await bodyOf(root)).toBe(before);
    expect(before).not.toContain(PAGE_LINE);
    expect(lines.warn).toEqual([]);
    expect(lines.info.some((line) => line.includes('no longer holds the line unticked'))).toBe(true);
  });

  it('ticks nothing for a plan of any other title, the same task done', async () => {
    const { root, options, tasks } = await docUpdateRun();
    const other = join(root, 'PLAN-other.md');
    writeFileSync(other, '# Plan: feat(other)\n\n```rafa:plan\nissue: "1"\n```\n\n- [ ] Wire it\n', 'utf8');
    const before = await bodyOf(root);

    const handler = createStartStaleDocs({ ...options, planPath: other });

    expect(await handler.afterTask({ planStub: 'rafa-1-other', dispatch: tasks[0]!, outcome: 'done' })).toBeNull();
    expect(await bodyOf(root)).toBe(before);
  });
});

/** A git runner that fails the case on any call. */
const NO_GIT: GitRunner = (args) => {
  throw new Error(`git was run: ${args.join(' ')}`);
};

/** A git runner answering every call as failed, as a checkout with no `origin` does. */
const FAILING_GIT: GitRunner = () => ({ ok: false, stdout: '', stderr: 'fatal: no such ref' });

/** A fresh directory holding `files`. */
function directoryWith(files: Readonly<Record<string, string>>): string {
  const root = join(tempBase, `version-${rootCount}`);
  rootCount += 1;
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text, 'utf8');
  }
  mkdirSync(root, { recursive: true });
  return root;
}

describe('readStaleDocsVersion', () => {
  it('answers `next` with release off, reading no git', () => {
    const root = directoryWith({ 'package.json': '{"version":"1.2.3"}\n', 'CHANGELOG.md': '# Changes\n' });

    expect(readStaleDocsVersion({ repoRoot: root, checkout: root, config: CONFIG }, NO_GIT)).toBe(NEXT_VERSION);
  });

  it('answers the patch bump of the checkout\'s version file when no forecast is read', () => {
    const root = directoryWith({ 'package.json': '{"version":"1.2.3"}\n', 'CHANGELOG.md': '# Changes\n' });
    const config: StartStaleDocsConfig = { ...CONFIG, releaseEnabled: 'auto' };

    expect(readStaleDocsVersion({ repoRoot: root, checkout: root, config }, FAILING_GIT)).toBe('1.2.4');
  });

  it('answers `next` with release on and no version file', () => {
    const root = directoryWith({});
    const config: StartStaleDocsConfig = { ...CONFIG, releaseEnabled: true };

    expect(readStaleDocsVersion({ repoRoot: root, checkout: root, config }, FAILING_GIT)).toBe(NEXT_VERSION);
  });

  it('answers the version the fragments waiting on origin/main settle to', () => {
    const root = directoryWith({
      'package.json': '{"version":"1.2.3"}\n',
      'CHANGELOG.md': '# Changes\n',
      '.changes/rafa-1.md': '---\nplan: rafa-1\ntitle: A minor change\nlevel: minor\n---\n\n- a note\n',
    });
    const home = join(root, '.home');
    mkdirSync(home);
    const env = {
      PATH: process.env['PATH'] ?? '',
      HOME: home,
      GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      ...gitIdentityEnv(),
      LC_ALL: 'C',
    };
    const git = (args: readonly string[]): void => {
      execFileSync('git', [...args], { cwd: root, env, stdio: 'ignore' });
    };
    git(['init', '-q', '--initial-branch=main', '.']);
    git(['add', 'package.json', 'CHANGELOG.md', '.changes']);
    git(['commit', '-q', '-m', 'first']);
    git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    const config: StartStaleDocsConfig = { ...CONFIG, releaseEnabled: 'auto' };

    expect(readStaleDocsVersion({ repoRoot: root, checkout: root, config }, createGitRunner(root))).toBe('1.3.0');
    // The control: the same repository with no `origin/main` reads the patch bump.
    git(['update-ref', '-d', 'refs/remotes/origin/main']);
    expect(readStaleDocsVersion({ repoRoot: root, checkout: root, config }, createGitRunner(root))).toBe('1.2.4');
  });
});
