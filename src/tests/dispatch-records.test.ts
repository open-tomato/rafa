/**
 * Integration: one fixture task dispatched under `planner` and one under
 * `tag`, each stored through `storeTaskReport`, and each `dispatches` row
 * held to its resolver, the skills its prompt offered and the lesson ids
 * it offered.
 *
 * Only the session spawn is stubbed. The tiers are planted on disk and
 * read, the resolvers and `selectLessons` run for real, the blessed
 * bundle is pulled through a registered stub adapter, and the row is read
 * back from the SQLite store with a raw query.
 */
import type { TierPin } from '../config-sections.js';
import type { InstinctRecord } from '../learning/index.js';
import type { Learning } from '../ports/index.js';
import type { TaskSessionRunner } from '../start/dispatch.js';
import type { TaskHandout } from '../start/handout.js';
import type { SessionServing } from '../start/serving.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { createAdapterRegistry, PORT_VERSIONS } from '../adapters/registry.js';
import { sqliteStorePath } from '../effort/store/sqlite.js';
import { dispatchTask, storeTaskReport } from '../start/dispatch.js';

import { sinkOutput } from './output-sinks.js';

const FENCE = '```';
const REPORTED = [
  'Done.',
  '',
  `${FENCE}rafa:report`,
  'status: done',
  'feedback: "fine"',
  'findings: []',
  'skills_used: []',
  'blockers: []',
  'out_of_scope_bugs: []',
  FENCE,
  '',
].join('\n');

/** Declares `skills=bun-testing` though its text names pull requests. */
const PLANNER_TASK = 'Open the pull requests  {skills=bun-testing}';
/** Declares nothing; its text names pull requests. */
const TAG_TASK = 'Open the pull requests';

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-dispatch-records-'));
let planted = 0;

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

function plantFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function skillFile(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\nBody.\n`;
}

/** A fresh root with a rafa tier holding two skills. */
function plantedServing(): SessionServing {
  planted += 1;
  const root = join(tempRoot, `root-${planted}`);
  const runtime = `${root}-runtime`;
  plantFile(join(runtime, 'cli.js'), '');
  plantFile(join(runtime, 'bundled/skills/bun-testing/SKILL.md'), skillFile('bun-testing', 'Use when writing bun tests'));
  plantFile(join(runtime, 'bundled/skills/pr-workflow/SKILL.md'), skillFile('pr-workflow', 'Use when opening pull requests'));
  mkdirSync(root, { recursive: true });
  return {
    root,
    run: 'run-1',
    home: `${root}-home`,
    entry: join(runtime, 'cli.js'),
    settings: {
      settingSources: ['project', 'local'],
      tiersRafa: 'on',
      tiersSkills: new Map<string, TierPin>(),
      tiersAgents: new Map<string, TierPin>(),
    },
  };
}

function lesson(id: string, trigger: string): InstinctRecord {
  return {
    id,
    trigger,
    action: `act on ${id}`,
    action_hash: id,
    confidence: 0.8,
    usage_count: 1,
    signal: 'loud',
    status: 'active',
    created_at: '2026-09-25T00:00:00.000Z',
    updated_at: '2026-09-25T00:00:00.000Z',
  };
}

const BUNDLE = [
  lesson('pr-lesson', 'when opening pull requests'),
  lesson('kernel-lesson', 'when compiling kernels'),
];

const registry = createAdapterRegistry([{
  port: 'learning',
  kind: 'stub',
  portVersion: PORT_VERSIONS.learning,
  create: (): Learning => ({
    push: () => Promise.reject(new Error('no push expected')),
    pullBlessed: () => Promise.resolve({ version: 'stub', instincts: BUNDLE }),
    flag: () => Promise.resolve(),
  }),
}]);

function handout(resolver: TaskHandout['resolver']): TaskHandout {
  return {
    resolver,
    lessons: 'on',
    learning: { kind: 'stub', home: '/home/stand-in', blessMinConfidence: 0.6, registry },
  };
}

interface Row {
  readonly resolver: string | null;
  readonly skills_offered: string;
  readonly lessons_offered: string;
}

/** Dispatches `line` under `resolver`, stores it, and answers its `dispatches` row. */
async function dispatchAndRead(line: string, resolver: TaskHandout['resolver'], sessionId: string): Promise<Row[]> {
  const serving = plantedServing();
  const run: TaskSessionRunner = () => Promise.resolve({ exitCode: 0, stdout: REPORTED });
  const dispatch = await dispatchTask({
    taskInfo: { task: line, lineNum: 0, status: 'unchecked' },
    promptContent: 'The loop commits.',
    planContent: `- [ ] ${line}\n`,
    inject: 'full',
    repoRoot: serving.root,
    home: join(serving.root, 'home'),
    settingSources: ['project', 'local'],
    serving,
    handout: handout(resolver),
    run,
    newSessionId: () => sessionId,
  });
  const stored = await storeTaskReport({
    repoRoot: serving.root,
    planStub: 'demo',
    dispatch,
    outcome: 'done',
    learning: null,
  });
  expect(stored).toBe(true);

  const db = new Database(sqliteStorePath(serving.root), { readonly: true });
  try {
    return db
      .query<Row, [string]>('SELECT resolver, skills_offered, lessons_offered FROM dispatches WHERE session_id = ?')
      .all(sessionId);
  } finally {
    db.close();
  }
}

describe('dispatches rows after a dispatch under each resolver', () => {
  beforeEach(() => {
    setActiveOutput(sinkOutput({}));
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  it('records planner, the declared skill and the matching lesson', async () => {
    const rows = await dispatchAndRead(PLANNER_TASK, 'planner', 'planner-session');

    expect(rows).toHaveLength(1);
    expect(rows[0]?.resolver).toBe('planner');
    expect(JSON.parse(rows[0]?.skills_offered ?? '')).toEqual(['bun-testing']);
    expect(JSON.parse(rows[0]?.lessons_offered ?? '')).toEqual(['pr-lesson']);
  });

  it('records tag, the skill ranked against the text and the matching lesson', async () => {
    const rows = await dispatchAndRead(TAG_TASK, 'tag', 'tag-session');

    expect(rows).toHaveLength(1);
    expect(rows[0]?.resolver).toBe('tag');
    expect(JSON.parse(rows[0]?.skills_offered ?? '')).toEqual(['pr-workflow']);
    expect(JSON.parse(rows[0]?.lessons_offered ?? '')).toEqual(['pr-lesson']);
  });

  it('tells the two arms apart on the same text', async () => {
    const planner = await dispatchAndRead(PLANNER_TASK, 'planner', 'a');
    const tag = await dispatchAndRead(PLANNER_TASK, 'tag', 'b');

    expect(planner[0]?.skills_offered).toBe('["bun-testing"]');
    expect(tag[0]?.skills_offered).toBe('["pr-workflow"]');
  });
});
