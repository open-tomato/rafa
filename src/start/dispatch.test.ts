/**
 * Tests for `storeTaskReport` (`start/dispatch.ts`) storing a session's
 * dispatch ahead of its report: one `dispatches` row holding what the task
 * declared and the flags its session was spawned with, whatever became of
 * the task, and no report at all when that row is refused.
 *
 * Also for `storeTaskReport` pushing a stored report's lessons to a
 * stubbed Learning adapter, registered in a registry of its own under the
 * kind `stub`: what the push is handed, the adapter's context, a report
 * with no lesson and a null `learning` making no adapter, and a refused
 * push or an unknown kind warned about without failing the store.
 *
 * Also for `dispatchTask` serving its session: the flags `serveSession`
 * answered reach the runner and the record, a winner left out is warned
 * about, and a null `serving` serves nothing. Those cases plant a rafa
 * tier beside a stand-in entry under this file's temporary directory.
 *
 * Also for `dispatchTask` handing its task out (`start/handout.ts`): the
 * run's resolver choosing from the tiers the session is served, the
 * lessons pulled from a stubbed adapter, both rendered into the prompt
 * and carried on the record with the resolver's name, which the prompt
 * never holds; a null handout, a null serving and a refused pull each
 * against the case that hands both sections out.
 *
 * Also for `buildTaskPrompt` placing the rendered skills and lessons
 * sections (`task/sections.ts`): after the blocker line and before
 * `PROMPT.md`, skills first, each alone or both, and the prompt unchanged
 * when both are empty or blank, each unchanged case paired with a
 * rendered section that changes it.
 *
 * The rest of the module is driven elsewhere: the prompt and the flags in
 * `tests/declaration-dispatch.test.ts`, the session id and the report rows
 * in `tests/task-report.test.ts`. Every store here sits under a fresh root
 * in this file's temporary directory and is read back through `bun:sqlite`
 * directly. The lines the loop prints go to a sink output set for each
 * case and unset after it.
 */
import type { TaskLearning, TaskReportStoreOptions, TaskSessionRunner } from './dispatch.js';
import type { TaskHandout } from './handout.js';
import type { SessionServing } from './serving.js';
import type { AdapterContext } from '../adapters/registry.js';
import type { TierPin } from '../config-sections.js';
import type { InstinctRecord } from '../learning/index.js';
import type { Learning, SyncPayload } from '../ports/index.js';

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { createAdapterRegistry, PORT_VERSIONS } from '../adapters/registry.js';
import { sqliteStorePath } from '../effort/store/sqlite.js';
import { renderLessonsSection, renderSkillsSection } from '../task/sections.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { parseTaskDeclaration, resolveDeclarationFlags } from '../utils/declaration.js';

import { buildTaskPrompt, dispatchTask, NO_TASK_SECTIONS, storeTaskReport } from './dispatch.js';

/** A fence, kept out of the template literals. */
const FENCE = '```';

/** A session output ending with a clean `done` report. */
const REPORTED = [
  'Done.',
  '',
  `${FENCE}rafa:report`,
  'status: done',
  'feedback: "it went fine"',
  'findings: []',
  'skills_used: []',
  'blockers: []',
  'out_of_scope_bugs: []',
  FENCE,
  '',
].join('\n');

/** The task line every case dispatches, its budget declared beside an agent. */
const LINE = 'Add the module  {agent=loop-implementer budget=0.5}';

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-start-dispatch-'));
let planted = 0;

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** A new repo root under {@link tempRoot}, not yet created. */
function freshRoot(): string {
  planted += 1;
  return join(tempRoot, `root-${planted}`);
}

/** Every row a query answers over the store under `root`, opened read-only. */
function rawQuery<T>(root: string, sql: string): T[] {
  const db = new Database(sqliteStorePath(root), { readonly: true });
  try {
    return db.query<T, []>(sql).all();
  } finally {
    db.close();
  }
}

/** What `start()` hands `storeTaskReport` for session `sessionId` on {@link LINE}. */
function storeOptions(
  root: string,
  sessionId: string,
  output: string,
  outcome: TaskReportStoreOptions['outcome'],
): TaskReportStoreOptions {
  const { text, declaration } = parseTaskDeclaration(LINE);
  return {
    repoRoot: root,
    planStub: 'demo',
    dispatch: {
      sessionId,
      taskText: text,
      output,
      declaration,
      flags: resolveDeclarationFlags(declaration, () => false).args,
    },
    outcome,
    learning: null,
  };
}

describe('storeTaskReport, storing the dispatch', () => {
  let seen: string[] = [];

  beforeEach(() => {
    seen = [];
    setActiveOutput(sinkOutput({ error: (message) => seen.push(`error:${message}`) }));
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  it('stores the dispatch beside the report, under the same session id', async () => {
    const root = freshRoot();

    expect(await storeTaskReport(storeOptions(root, 's-1', REPORTED, 'done'))).toBe(true);

    expect(rawQuery(root, 'SELECT session_id, plan_stub, task_line, agent, budget_usd, flags FROM dispatches')).toEqual([{
      session_id: 's-1',
      plan_stub: 'demo',
      task_line: 'Add the module',
      agent: 'loop-implementer',
      budget_usd: 0.5,
      flags: '["--agent","loop-implementer","--max-budget-usd","0.5"]',
    }]);
    expect(rawQuery(root, 'SELECT session_id, status, outcome FROM task_reports')).toEqual([
      { session_id: 's-1', status: 'done', outcome: 'done' },
    ]);
    expect(seen).toEqual([]);
  });

  it('stores the dispatch of a session that ended on its budget and left no report', async () => {
    const root = freshRoot();

    expect(await storeTaskReport(storeOptions(root, 's-2', 'Error: Exceeded USD budget (0.5)', 'blocked'))).toBe(true);

    expect(rawQuery(root, 'SELECT session_id, budget_usd FROM dispatches')).toEqual([{ session_id: 's-2', budget_usd: 0.5 }]);
    expect(rawQuery(root, 'SELECT session_id, outcome FROM report_absences')).toEqual([{ session_id: 's-2', outcome: 'blocked' }]);
    expect(rawQuery(root, 'SELECT session_id FROM task_reports')).toEqual([]);
  });

  it('stores no report when the dispatch row is refused, and answers false', async () => {
    const root = freshRoot();
    const options = storeOptions(root, 's-3', REPORTED, 'done');
    const { declaration } = options.dispatch;
    if (declaration === null) throw new Error('the fixture line parsed to no declaration');
    const refused = { ...options, dispatch: { ...options.dispatch, declaration: { ...declaration, budget: 0 } } };

    expect(await storeTaskReport(refused)).toBe(false);

    expect(existsSync(root)).toBe(false);
    expect(seen).toEqual([
      'error:\n❌ The report of session s-3 was not stored: effort store: dispatch write has budget 0, not null or a finite number above zero; nothing written',
      'error:   The session printed it above as it ran.',
    ]);
  });
});

/** Writes `text` at `path`, its directories made first. */
function plantFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/**
 * A fresh root and a rafa tier beside a stand-in entry: one skill, one
 * agent, and one unreviewed third-party agent. Answers the serving
 * `start()` would build over them.
 */
function plantedServing(): SessionServing {
  const root = freshRoot();
  const runtime = `${root}-runtime`;
  plantFile(join(runtime, 'cli.js'), '');
  plantFile(join(runtime, 'bundled/skills/tier-skill/SKILL.md'), '---\nname: tier-skill\ndescription: A served skill\n---\n\nBody.\n');
  plantFile(join(runtime, 'bundled/agents/tier-agent.md'), '---\nname: tier-agent\ndescription: A served agent\n---\n\nYou work.\n');
  plantFile(
    join(runtime, 'bundled/agents/borrowed.md'),
    '---\nname: borrowed\ndescription: Borrowed\nprovenance:\n  origin: https://example.com/x\n  license: MIT\n---\n\nYou work.\n',
  );
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

describe('dispatchTask, serving its session', () => {
  let warned: string[] = [];
  let handed: (readonly string[])[] = [];

  const run: TaskSessionRunner = (_prompt, _flags, _sessionId, _sources, served) => {
    handed.push(served);
    return Promise.resolve({ exitCode: 0, stdout: '' });
  };

  /** Dispatches {@link LINE} under `serving` through {@link run}. */
  function dispatchUnder(serving: SessionServing | null, repoRoot: string): ReturnType<typeof dispatchTask> {
    return dispatchTask({
      taskInfo: { task: LINE, lineNum: 0, status: 'unchecked' },
      promptContent: 'The loop commits.',
      planContent: `- [ ] ${LINE}\n`,
      inject: 'full',
      repoRoot,
      home: join(repoRoot, 'home'),
      settingSources: ['project', 'local'],
      serving,
      handout: null,
      run,
      newSessionId: () => 'session-under-test',
    });
  }

  beforeEach(() => {
    warned = [];
    handed = [];
    setActiveOutput(sinkOutput({ warn: (message) => warned.push(message) }));
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  it('hands the runner the served flags and records them beside the declaration\'s', async () => {
    const serving = plantedServing();
    const served = join(serving.root, '.rafa/runs/run-1/served');

    const dispatch = await dispatchUnder(serving, serving.root);

    expect(handed).toEqual([dispatch.served]);
    expect(dispatch.served.slice(0, 3)).toEqual(['--add-dir', served, '--agents']);
    expect(Object.keys(JSON.parse(dispatch.served[3] ?? '{}') as object)).toEqual(['tier-agent']);
    expect(existsSync(join(served, '.claude/skills/tier-skill/SKILL.md'))).toBe(true);
    // The declaration's flags stay its own: the dispatch row stores them.
    expect(dispatch.flags).not.toContain('--add-dir');
  });

  it('warns once per rafa-tier winner left out', async () => {
    const serving = plantedServing();

    await dispatchUnder(serving, serving.root);

    expect(warned).toHaveLength(1);
    expect(warned[0]).toStartWith('   rafa-tier agent borrowed is not served: it is third-party from https://example.com/x');
  });

  it('serves nothing and hands no flag for a null serving', async () => {
    // The control for the cases above: the same dispatch without a
    // serving hands an empty list and writes no served directory.
    const root = freshRoot();
    mkdirSync(root, { recursive: true });

    const dispatch = await dispatchUnder(null, root);

    expect(handed).toEqual([[]]);
    expect(dispatch.served).toEqual([]);
    expect(warned).toEqual([]);
    expect(existsSync(join(root, '.rafa'))).toBe(false);
  });
});

describe('dispatchTask, handing its task out', () => {
  /** A task naming the planted rafa-tier skill in its `skills=`. */
  const SKILLED = 'Add the served skill  {skills=tier-skill}';

  /** A blessed lesson whose trigger names the task's words, and one naming none. */
  const BLESSED: InstinctRecord[] = [
    {
      id: 'lesson-served',
      trigger: 'when adding a served skill',
      action: 'serve it before the spawn',
      action_hash: 'hash-served',
      confidence: 0.7,
      usage_count: 2,
      signal: 'loud',
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    },
    {
      id: 'lesson-kernel',
      trigger: 'when compiling kernels',
      action: 'pin the toolchain',
      action_hash: 'hash-kernel',
      confidence: 0.9,
      usage_count: 4,
      signal: 'loud',
      status: 'active',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    },
  ];

  let warned: string[] = [];
  let prompts: string[] = [];
  let refusal: Error | null = null;

  const registry = createAdapterRegistry([{
    port: 'learning',
    kind: 'stub',
    portVersion: PORT_VERSIONS.learning,
    create: (): Learning => ({
      push: () => Promise.reject(new Error('no push expected')),
      pullBlessed: () => refusal === null
        ? Promise.resolve({ version: 'stub', instincts: BLESSED })
        : Promise.reject(refusal),
      flag: () => Promise.resolve(),
    }),
  }]);

  /** The run's `task.*` keys at `planner` and `on`, lessons from the stub. */
  const HANDOUT: TaskHandout = {
    resolver: 'planner',
    lessons: 'on',
    learning: { kind: 'stub', home: '/home/stand-in', blessMinConfidence: 0.6, registry },
  };

  const run: TaskSessionRunner = (prompt) => {
    prompts.push(prompt);
    return Promise.resolve({ exitCode: 0, stdout: '' });
  };

  /** Dispatches {@link SKILLED} under `serving` and `handout` through {@link run}. */
  function dispatchHanded(
    serving: SessionServing | null,
    handout: TaskHandout | null,
    repoRoot: string,
  ): ReturnType<typeof dispatchTask> {
    return dispatchTask({
      taskInfo: { task: SKILLED, lineNum: 0, status: 'unchecked' },
      promptContent: 'The loop commits.',
      planContent: `- [ ] ${SKILLED}\n`,
      inject: 'full',
      repoRoot,
      home: join(repoRoot, 'home'),
      settingSources: ['project', 'local'],
      serving,
      handout,
      run,
      newSessionId: () => 'session-under-test',
    });
  }

  /** The warnings other than the planted third-party agent's. */
  const ownWarnings = (): string[] => warned.filter((line) => !line.includes('agent borrowed'));

  beforeEach(() => {
    warned = [];
    prompts = [];
    refusal = null;
    setActiveOutput(sinkOutput({ warn: (message) => warned.push(message) }));
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  it('renders the served skill and the matching lesson into the prompt and carries them on the record', async () => {
    const serving = plantedServing();

    const dispatch = await dispatchHanded(serving, HANDOUT, serving.root);

    expect(dispatch.resolver).toBe('planner');
    expect(dispatch.skillsOffered.map((skill) => [skill.name, skill.source])).toEqual([['tier-skill', 'rafa']]);
    expect(dispatch.lessonsOffered.map((lesson) => lesson.id)).toEqual(['lesson-served']);
    expect(prompts).toEqual([dispatch.prompt]);
    expect(dispatch.prompt).toContain([
      '## Skills for this task',
      'Invoke each with the Skill tool before you change anything it covers.',
      '- `tier-skill`: A served skill',
      '',
      '## Lessons from earlier tasks',
      '- When adding a served skill: serve it before the spawn (confidence 0.70, from 2 tasks, lesson lesson-served)',
      '',
      'The loop commits.',
    ].join('\n'));
    expect(dispatch.prompt.startsWith('Your scoped task is: Add the served skill\n')).toBe(true);
    // The resolver's name is on the record and nowhere in the prompt.
    expect(dispatch.prompt).not.toContain('planner');
    // The skill offered is one the session was served, from the same reading.
    expect(existsSync(join(serving.root, '.rafa/runs/run-1/served/.claude/skills/tier-skill/SKILL.md'))).toBe(true);
    expect(ownWarnings()).toEqual([]);
  });

  it('hands out nothing and names no resolver for a null handout', async () => {
    // The control is the case above: the same dispatch with a handout
    // renders both sections.
    const serving = plantedServing();

    const dispatch = await dispatchHanded(serving, null, serving.root);

    expect(dispatch.resolver).toBeNull();
    expect(dispatch.skillsOffered).toEqual([]);
    expect(dispatch.lessonsOffered).toEqual([]);
    expect(dispatch.prompt).not.toContain('## Skills for this task');
    expect(dispatch.prompt).not.toContain('## Lessons from earlier tasks');
    expect(dispatch.prompt).toContain('Focus only on the scoped task.\n\nThe loop commits.');
  });

  it('offers no skill under a null serving, which reads no tier, and still hands out the lessons', async () => {
    const root = freshRoot();
    mkdirSync(root, { recursive: true });

    const dispatch = await dispatchHanded(null, HANDOUT, root);

    expect(dispatch.resolver).toBe('planner');
    expect(dispatch.skillsOffered).toEqual([]);
    expect(dispatch.prompt).not.toContain('## Skills for this task');
    expect(dispatch.lessonsOffered.map((lesson) => lesson.id)).toEqual(['lesson-served']);
  });

  it('warns about a refused lessons pull and dispatches the task with its skills and no lessons section', async () => {
    const serving = plantedServing();
    refusal = new Error('the store is locked');

    const dispatch = await dispatchHanded(serving, HANDOUT, serving.root);

    expect(dispatch.exitCode).toBe(0);
    expect(prompts).toHaveLength(1);
    expect(dispatch.lessonsOffered).toEqual([]);
    expect(dispatch.prompt).toContain('## Skills for this task');
    expect(dispatch.prompt).not.toContain('## Lessons from earlier tasks');
    expect(ownWarnings()).toEqual([
      '   Lessons: none handed to this task: the `stub` learning adapter answered no blessed set: the store is locked',
      '   The task is not failed for it: it is dispatched without a lessons section.',
    ]);
  });
});

describe('dispatchTask, one fixture task under each resolver', () => {
  const FIXTURE = 'Add the served skill  {skills=tier-skill}';
  const SECTION_FORMAT = [
    '## Skills for this task',
    'Invoke each with the Skill tool before you change anything it covers.',
    '- `tier-skill`: A served skill',
    '',
    'The loop commits.',
  ].join('\n');

  let prompts: string[] = [];
  const run: TaskSessionRunner = (prompt) => {
    prompts.push(prompt);
    return Promise.resolve({ exitCode: 0, stdout: '' });
  };

  const emptyRegistry = createAdapterRegistry([{
    port: 'learning',
    kind: 'stub',
    portVersion: PORT_VERSIONS.learning,
    create: (): Learning => ({
      push: () => Promise.reject(new Error('no push expected')),
      pullBlessed: () => Promise.resolve({ version: 'stub', instincts: [] }),
      flag: () => Promise.resolve(),
    }),
  }]);

  function handout(resolver: TaskHandout['resolver']): TaskHandout {
    return {
      resolver,
      lessons: 'on',
      learning: { kind: 'stub', home: '/home/stand-in', blessMinConfidence: 0.6, registry: emptyRegistry },
    };
  }

  function dispatchUnder(serving: SessionServing, given: TaskHandout | null): ReturnType<typeof dispatchTask> {
    return dispatchTask({
      taskInfo: { task: FIXTURE, lineNum: 0, status: 'unchecked' },
      promptContent: 'The loop commits.',
      planContent: `- [ ] ${FIXTURE}\n`,
      inject: 'full',
      repoRoot: serving.root,
      home: join(serving.root, 'home'),
      settingSources: ['project', 'local'],
      serving,
      handout: given,
      run,
      newSessionId: () => 'session-under-test',
    });
  }

  beforeEach(() => {
    prompts = [];
    setActiveOutput(sinkOutput({}));
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  for (const resolver of ['planner', 'tag'] as const) {
    it(`holds the ${resolver} prompt to the documented format, the task line first and no resolver name`, async () => {
      const serving = plantedServing();

      const dispatch = await dispatchUnder(serving, handout(resolver));

      expect(dispatch.resolver).toBe(resolver);
      expect(dispatch.prompt.startsWith('Your scoped task is: Add the served skill\n')).toBe(true);
      expect(dispatch.prompt).toContain(SECTION_FORMAT);
      expect(dispatch.prompt).not.toContain('## Lessons from earlier tasks');
      expect(dispatch.prompt).not.toContain(resolver);
    });
  }

  it('gives a none task with no lesson the prompt a null handout gives', async () => {
    const serving = plantedServing();

    const bare = await dispatchUnder(serving, null);
    const none = await dispatchUnder(serving, handout('none'));

    expect(none.resolver).toBe('none');
    expect(none.skillsOffered).toEqual([]);
    expect(none.prompt).toBe(bare.prompt);
    expect(none.prompt).not.toContain('## Skills for this task');
    expect(none.prompt).not.toContain('none');
  });
});

describe('dispatchTask, lessons matched by artifact path', () => {
  const TASK_TEXT = 'Fix the guard in src/start/dispatch.ts';
  const STAMP = '2026-09-01T00:00:00Z';

  const lesson = (id: string, trigger: string, artifact: string): InstinctRecord => ({
    id,
    trigger,
    action: `act ${id}`,
    action_hash: `hash-${id}`,
    confidence: 0.8,
    usage_count: 3,
    signal: 'loud',
    status: 'active',
    artifact,
    created_at: STAMP,
    updated_at: STAMP,
  });

  const BLESSED: InstinctRecord[] = [
    lesson('by-path', 'when zebras migrate', 'src/start/dispatch.ts'),
    lesson('unrelated', 'when compiling kernels', 'src/other/elsewhere.ts'),
  ];

  const registry = createAdapterRegistry([{
    port: 'learning',
    kind: 'stub',
    portVersion: PORT_VERSIONS.learning,
    create: (): Learning => ({
      push: () => Promise.reject(new Error('no push expected')),
      pullBlessed: () => Promise.resolve({ version: 'stub', instincts: BLESSED }),
      flag: () => Promise.resolve(),
    }),
  }]);

  function handout(lessons: TaskHandout['lessons']): TaskHandout {
    return {
      resolver: 'none',
      lessons,
      learning: { kind: 'stub', home: '/home/stand-in', blessMinConfidence: 0.6, registry },
    };
  }

  function dispatchWith(given: TaskHandout): ReturnType<typeof dispatchTask> {
    const root = freshRoot();
    mkdirSync(root, { recursive: true });
    return dispatchTask({
      taskInfo: { task: TASK_TEXT, lineNum: 0, status: 'unchecked' },
      promptContent: 'The loop commits.',
      planContent: `- [ ] ${TASK_TEXT}\n`,
      inject: 'full',
      repoRoot: root,
      home: join(root, 'home'),
      settingSources: ['project', 'local'],
      serving: null,
      handout: given,
      run: () => Promise.resolve({ exitCode: 0, stdout: '' }),
      newSessionId: () => 'session-under-test',
    });
  }

  beforeEach(() => {
    setActiveOutput(sinkOutput({}));
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  it('holds the lesson whose artifact path the task names inside the section, and only it', async () => {
    const dispatch = await dispatchWith(handout('on'));

    expect(dispatch.lessonsOffered.map((offered) => offered.id)).toEqual(['by-path']);
    const start = dispatch.prompt.indexOf('## Lessons from earlier tasks');
    expect(start).toBeGreaterThan(-1);
    const section = dispatch.prompt.slice(start, dispatch.prompt.indexOf('The loop commits.'));
    expect(section).toContain('lesson by-path)');
    expect(dispatch.prompt).not.toContain('lesson unrelated');
    expect(dispatch.prompt).not.toContain('when compiling kernels');
  });

  it('leaves the section absent under task.lessons off', async () => {
    const dispatch = await dispatchWith(handout('off'));

    expect(dispatch.lessonsOffered).toEqual([]);
    expect(dispatch.prompt).not.toContain('## Lessons from earlier tasks');
    expect(dispatch.prompt).not.toContain('lesson by-path');
  });
});

/** A session output whose report holds one finding carrying a `resolution`. */
const LESSONED = [
  'Done.',
  '',
  `${FENCE}rafa:report`,
  'status: done',
  'feedback: "it went fine"',
  'findings:',
  '  - trigger: "when running bun test under a fresh worktree"',
  '    kind: gotcha',
  '    what: "node_modules is absent after fork"',
  '    cause: "worktree creation does not run bun install"',
  '    resolution: "run bun install before the first test"',
  '    artifact: "Cannot find package"',
  '    signal: loud',
  'skills_used: []',
  'blockers: []',
  'out_of_scope_bugs: []',
  FENCE,
  '',
].join('\n');

/** The clock every lesson case stamps its lessons from. */
const NOW = new Date('2026-09-25T12:00:00.000Z');

describe('storeTaskReport, pushing the report\'s lessons', () => {
  let infos: string[] = [];
  let warned: string[] = [];
  let pushed: SyncPayload[] = [];
  let made: AdapterContext[] = [];
  let refusal: Error | null = null;

  /** A Learning adapter recording each push, or refusing it when {@link refusal} is set. */
  const stub: Learning = {
    push: (payload) => {
      if (refusal !== null) return Promise.reject(refusal);
      pushed.push(payload);
      return Promise.resolve({
        decisions: payload.instincts.map((incoming) => ({ incoming, rule: 'new-trigger' as const, produced: [incoming] })),
        discarded: [],
      });
    },
    pullBlessed: () => Promise.resolve({ version: 'stub', instincts: [] }),
    flag: () => Promise.resolve(),
  };

  /** A registry holding the stub under the kind `stub`, recording each context it is made with. */
  const registry = createAdapterRegistry([{
    port: 'learning',
    kind: 'stub',
    portVersion: PORT_VERSIONS.learning,
    create: (context) => {
      made.push(context);
      return stub;
    },
  }]);

  /** The run's learning settings, naming `kind` in the stub registry. */
  function learningOf(kind = 'stub'): TaskLearning {
    return { kind, home: '/home/stand-in', blessMinConfidence: 0.6, registry };
  }

  /** {@link storeOptions} with `learning` and the fixed clock. */
  function lessonOptions(
    root: string,
    sessionId: string,
    output: string,
    outcome: TaskReportStoreOptions['outcome'],
    learning: TaskLearning | null = learningOf(),
  ): TaskReportStoreOptions {
    return { ...storeOptions(root, sessionId, output, outcome), learning, now: () => NOW };
  }

  beforeEach(() => {
    infos = [];
    warned = [];
    pushed = [];
    made = [];
    refusal = null;
    setActiveOutput(sinkOutput({
      info: (message) => infos.push(message),
      warn: (message) => warned.push(message),
    }));
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  it('pushes a finding carrying a resolution to the adapter the kind resolves to, once the report is stored', async () => {
    const root = freshRoot();

    expect(await storeTaskReport(lessonOptions(root, 'l-1', LESSONED, 'done'))).toBe(true);

    expect(made).toEqual([{ repoRoot: root, home: '/home/stand-in', learningBlessMinConfidence: 0.6 }]);
    expect(pushed).toHaveLength(1);
    const [payload] = pushed;
    expect(payload?.source_id).toBe('l-1');
    expect(payload?.instincts.map((lesson) => [lesson.action, lesson.confidence, lesson.sources, lesson.created_at]))
      .toEqual([['run bun install before the first test', 0.5, ['l-1'], NOW.toISOString()]]);
    // Pushed after the store took the report, which is already readable.
    expect(rawQuery(root, 'SELECT session_id FROM task_reports')).toEqual([{ session_id: 'l-1' }]);
    expect(infos.at(-1)).toBe('   Pushed 1 lesson(s) to the `stub` learning adapter: new-trigger.');
    expect(warned).toEqual([]);
  });

  it('pushes a blocked task\'s lesson at the blocked confidence', async () => {
    await storeTaskReport(lessonOptions(freshRoot(), 'l-2', LESSONED, 'blocked'));

    expect(pushed.flatMap((payload) => payload.instincts.map((lesson) => lesson.confidence))).toEqual([0.4]);
  });

  it('makes no adapter and pushes nothing for a report whose findings carry no resolution', async () => {
    // The control is the first case: the same store with a resolution
    // makes the adapter once and pushes once.
    const unresolved = LESSONED.replace('    resolution: "run bun install before the first test"\n', '');
    expect(unresolved).not.toContain('resolution:');

    expect(await storeTaskReport(lessonOptions(freshRoot(), 'l-3', unresolved, 'done'))).toBe(true);

    expect(made).toEqual([]);
    expect(pushed).toEqual([]);
    expect(warned).toEqual([]);
  });

  it('makes no adapter and pushes nothing under a null learning', async () => {
    expect(await storeTaskReport(lessonOptions(freshRoot(), 'l-4', LESSONED, 'done', null))).toBe(true);

    expect(made).toEqual([]);
    expect(pushed).toEqual([]);
  });

  it('warns about a refused push and still answers true, the report stored', async () => {
    const root = freshRoot();
    refusal = new Error('local learning: refused to store a push');

    expect(await storeTaskReport(lessonOptions(root, 'l-5', LESSONED, 'done'))).toBe(true);

    expect(warned).toEqual([
      '   1 lesson(s) of session l-5 were not pushed to the `stub` learning adapter: local learning: refused to store a push',
      '   The task is not failed for it: its report is stored, findings and all.',
    ]);
    expect(rawQuery(root, 'SELECT session_id, outcome FROM task_reports')).toEqual([{ session_id: 'l-5', outcome: 'done' }]);
    expect(infos.some((line) => line.startsWith('   Pushed'))).toBe(false);
  });

  it('warns about a kind the registry does not hold and still answers true', async () => {
    expect(await storeTaskReport(lessonOptions(freshRoot(), 'l-6', LESSONED, 'done', learningOf('absent')))).toBe(true);

    expect(made).toEqual([]);
    expect(warned[0]).toStartWith('   1 lesson(s) of session l-6 were not pushed to the `absent` learning adapter: ');
    expect(warned[0]).toContain('registered: stub');
  });

  it('pushes nothing when the store refuses the report', async () => {
    const options = lessonOptions(freshRoot(), 'l-7', LESSONED, 'done');
    const { declaration } = options.dispatch;
    if (declaration === null) throw new Error('the fixture line parsed to no declaration');
    const refused = { ...options, dispatch: { ...options.dispatch, declaration: { ...declaration, budget: 0 } } };

    expect(await storeTaskReport(refused)).toBe(false);

    expect(made).toEqual([]);
    expect(pushed).toEqual([]);
  });
});

describe('buildTaskPrompt, placing the task\'s sections', () => {
  const TASK = 'Make the widget round';
  const PROMPT_MD = '# PROMPT.md\nDo the task.';
  const PLAN = '# Plan\n- [ ] Make the widget round';
  const HEAD = [
    `Your scoped task is: ${TASK}`,
    'Consider tasks listed above this one in the plan checklist as completed. Do not re-evaluate or re-do them. Focus only on the scoped task.',
  ];
  const SKILLS = renderSkillsSection([{
    name: 'git-workflow',
    source: 'project',
    path: '/project/skills/git-workflow/SKILL.md',
    description: 'Use when pushing a branch',
  }], 'add-dir');
  const LESSON: InstinctRecord = {
    id: 'lesson-1',
    trigger: 'when running bun test under a fresh worktree',
    action: 'run bun install before the first test',
    action_hash: 'hash-lesson-1',
    confidence: 0.7,
    usage_count: 3,
    signal: 'loud',
    status: 'active',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  };
  const LESSONS = renderLessonsSection([LESSON]);
  const BEFORE = buildTaskPrompt(TASK, PROMPT_MD, PLAN);

  it('holds the prompt unchanged when both sections are empty or blank', () => {
    expect(buildTaskPrompt(TASK, PROMPT_MD, PLAN, [], null, NO_TASK_SECTIONS)).toBe(BEFORE);
    expect(buildTaskPrompt(TASK, PROMPT_MD, PLAN, [], null, { skills: '', lessons: '' })).toBe(BEFORE);
    expect(buildTaskPrompt(TASK, PROMPT_MD, PLAN, [], null, { skills: ' \n', lessons: '\t' })).toBe(BEFORE);
    expect(buildTaskPrompt(TASK, PROMPT_MD, PLAN, [], null, { skills: SKILLS, lessons: '' })).not.toBe(BEFORE);
    expect(buildTaskPrompt(TASK, PROMPT_MD, PLAN, [], null, { skills: '', lessons: LESSONS })).not.toBe(BEFORE);
  });

  it('holds the prompt built before sections existed', () => {
    expect(BEFORE).toBe([...HEAD, '', PROMPT_MD, PLAN].join('\n'));
  });

  it('places both sections after the head and before PROMPT.md, skills first', () => {
    const prompt = buildTaskPrompt(TASK, PROMPT_MD, PLAN, [], null, { skills: SKILLS, lessons: LESSONS });

    expect(prompt).toBe([...HEAD, '', SKILLS, '', LESSONS, '', PROMPT_MD, PLAN].join('\n'));
    expect(prompt.startsWith(`Your scoped task is: ${TASK}\n`)).toBe(true);
  });

  it('places a lone section where it would go beside the other', () => {
    expect(buildTaskPrompt(TASK, PROMPT_MD, PLAN, [], null, { skills: SKILLS, lessons: '' }))
      .toBe([...HEAD, '', SKILLS, '', PROMPT_MD, PLAN].join('\n'));
    expect(buildTaskPrompt(TASK, PROMPT_MD, PLAN, [], null, { skills: '', lessons: LESSONS }))
      .toBe([...HEAD, '', LESSONS, '', PROMPT_MD, PLAN].join('\n'));
  });

  it('places the sections after the blocker line', () => {
    const prompt = buildTaskPrompt(TASK, PROMPT_MD, PLAN, [], 'hook refused', { skills: SKILLS, lessons: LESSONS });
    const lines = prompt.split('\n');
    const blockerAt = lines.findIndex((line) => line.startsWith('An earlier run of this task left it blocked on: '));

    expect(blockerAt).toBe(2);
    expect(lines.indexOf('## Skills for this task')).toBe(blockerAt + 2);
    expect(prompt.indexOf('## Lessons from earlier tasks')).toBeLessThan(prompt.indexOf(PROMPT_MD));
  });

  it('keeps the known-missing notice after the plan text', () => {
    const prompt = buildTaskPrompt(TASK, PROMPT_MD, PLAN, ['known-missing: skill foo'], null, { skills: SKILLS, lessons: '' });

    expect(prompt.indexOf(SKILLS)).toBeLessThan(prompt.indexOf(PLAN));
    expect(prompt.indexOf(PLAN)).toBeLessThan(prompt.indexOf('known-missing: skill foo'));
  });
});
