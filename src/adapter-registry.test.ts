/**
 * Tests for the composition root `src/adapter-registry.ts`: the adapters
 * core registers, read off `CORE_ADAPTER_REGISTRY` once this file has
 * imported the root, as every caller reads them.
 *
 * `packages/rafa/src/core/adapters/registry.test.ts` holds the registry's mechanics
 * over fixture adapters it builds itself, and imports no adapter. The
 * cases here are the ones that read core's own kinds: the order `kinds`
 * answers them in, what each adapter makes from its context, the
 * refusals each `create` makes, and the add-on cases that need a core
 * kind beside them. They lived in `registry.test.ts` while `registry.ts`
 * listed the adapters itself, and moved here unchanged with that list;
 * the case making every core kind from one shared context moved here
 * from `src/tests/adapter-registry.test.ts` with the list of kinds it
 * holds, which is the order the root registers them in.
 *
 * Every refusal is spelled here in full. The store cases read which
 * backend an adapter opened off the disk under a fresh temporary root,
 * never off the store it answered, with the file names spelled here. The
 * output cases read what an adapter wrote off a stream the case hands
 * it, or off a spy on `process.stdout.write` the case restores, and each
 * `text` reading spells a line the `json` adapter could not have
 * written. The `local` tracker case reads the issues that adapter wrote
 * off the disk under a fresh temporary root, and the reason each records
 * off its file. The `local` learning case reads the file and the
 * push-log line that adapter wrote off the disk under a fresh temporary
 * root, and the bundle a second adapter made over that root answers.
 * Every learning case names a scratch home, apart from one that spawns
 * a child `bun` with a scratch `HOME`, because bun's `homedir()` keeps
 * the `HOME` a process started with (measured on bun 1.3.14: setting
 * `process.env.HOME` in the process left `homedir()` unchanged); that
 * child imports the root before it reads the registry. The `github`
 * tracker cases hand that adapter the recorded fake as its `gh` runner
 * and read what it filed off the fake. No case runs the runner the
 * adapter makes when its context names none, which spawns the real
 * `gh`. The `claude` planner case hands that adapter a recording spawner
 * as its `claude` and reads the plan it answers off a fresh temporary
 * root. No case makes a planner without a spawner of its own, whose
 * default spawns the real `claude`; the refusals throw before one is
 * made.
 *
 * No case changes the active registry. An add-on is registered through
 * `register`, which answers a new registry, and a case holds core's
 * kinds unchanged afterwards.
 *
 * The mutations recorded in `registry.test.ts` before the move were
 * driven against these cases there, with the entries in `registry.ts`:
 * an entry removed reddened its kinds case and the cases making its
 * adapter, an entry registered under another kind reddened every case
 * of its kind, an entry making its adapter under the wrong directory
 * reddened its making case alone, and the store backends registered in
 * reverse reddened the order case and the refusals listing the store
 * kinds.
 *
 * Driven again on 2026-10-15 once the list moved here, one run each over
 * this file and `packages/rafa/src/core/adapters/registry.test.ts`, 85 pass unmutated,
 * with both modules restored and verified with `sha256sum -c`: the root
 * registering nothing reddened 32 cases, every case of this file.
 */
import type { DescribedInstinctRecord } from './adapters/learning/local.js';
import type { AdapterContext, AnyAdapter } from '@open-tomato/rafa/core/adapters';
import type { CapturingSpawner } from '@open-tomato/rafa/core/loop';
import type { OutputStream } from '@open-tomato/rafa/core/output';
import type { InstinctRecord, Sync } from '@open-tomato/rafa/ports';
import type { SessionEffortRow } from '@open-tomato/rafa/store';

import './config-registry.js';
import './adapter-registry.js';

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test';

import { CORE_ADAPTER_REGISTRY } from '@open-tomato/rafa/core/adapters';
import {
  EMPTY_CONFIG_REGISTRY,
  registerConfigSections,
  restoreConfigSections,
} from '@open-tomato/rafa/core/config';

import { draftFixture } from './adapters/tracker/contract.js';
import { createFakeGh } from './adapters/tracker/github-fake.js';
import { parseLocalIssue } from './adapters/tracker/local.js';
import { parseSpecReview } from './board/spec-review.js';
import { actionHash } from './learning/index.js';
import { scratchHomeEnv } from './tests/scratch-home-env.js';

/** The module that registers the config defaults, as a child process imports it. */
const CONFIG_REGISTRY_ENTRY = fileURLToPath(new URL('./config-registry.ts', import.meta.url));

/** The composition root, as a child process imports it. */
const ROOT_ENTRY = fileURLToPath(new URL('./adapter-registry.ts', import.meta.url));

/** The adapters barrel, as a child process imports it. */
const BARREL_ENTRY = fileURLToPath(import.meta.resolve('@open-tomato/rafa/core/adapters'));

/** What the planner case's session writes to stdout: a review judging the spec ready. */
const PLANNER_SESSION_STDOUT = [
  'I read the spec first.',
  '',
  '```rafa:spec-review',
  'verdict: ready',
  'gaps: []',
  '```',
  '',
].join('\n');

/** Each store backend and the files it leaves once a session row is written. */
const STORE_LAYOUTS: readonly (readonly [string, readonly string[]])[] = [
  ['sqlite', ['effort.sqlite']],
  ['ndjson', ['sessions.ndjson']],
];

/** The record the learning case pushes, as the port carries it. */
const INSTINCT: InstinctRecord = {
  id: 'instinct-1',
  trigger: 'a test fails under the full suite and passes alone',
  action: 'find the file that runs before it and the state it leaves',
  action_hash: actionHash('find the file that runs before it and the state it leaves'),
  confidence: 0.5,
  usage_count: 1,
  signal: 'loud',
  status: 'active',
  created_at: '2026-09-14T10:00:00.000Z',
  updated_at: '2026-09-14T10:00:00.000Z',
};

/** {@link INSTINCT} with what its `.md` file says beside the merge fields. */
const DESCRIBED_INSTINCT: DescribedInstinctRecord = {
  ...INSTINCT,
  description: {
    kind: 'gotcha',
    domain: 'testing',
    scope: 'project',
    source: 'imported',
    evidence: [],
    cause: 'an earlier file leaves state behind',
    projectId: null,
  },
};

/** What a second terminal result from one json output is refused with. */
const SECOND_RESULT_REFUSAL
  = 'json output: refused a second terminal result event; a command emits exactly one';

/** A stream of its own, and the chunks written to it. */
function memoryStream(): { stream: { write: (chunk: string) => unknown }; chunks: string[] } {
  const chunks: string[] = [];
  return {
    stream: {
      write: (chunk) => {
        chunks.push(chunk);
        return true;
      },
    },
    chunks,
  };
}

/** A sync every fixture sync adapter answers. Never called. */
const FIXTURE_SYNC: Sync = {
  kind: 'git',
  push: async () => ({ status: 'nothing-to-sync' }),
  pull: async () => ({ status: 'nothing-to-sync' }),
};

/**
 * An add-on adapter as one hands it over, with any field replaced. The
 * cast is the plant: a refusal case hands the registry what an add-on's
 * JavaScript could.
 */
function addOn(fields: Record<string, unknown> = {}): AnyAdapter {
  return {
    port: 'sync',
    kind: 'git',
    portVersion: 1,
    create: () => FIXTURE_SYNC,
    ...fields,
  } as unknown as AnyAdapter;
}

/** A session row carrying its key and one counter. The cast is the plant. */
const SESSION = { sessionId: 'aaaa-1111', assistantRecordCount: 1 } as unknown as SessionEffortRow;

let tempDir = '';
let planted = 0;

/** A repo root of its own, not yet on disk. */
function freshRoot(name: string): string {
  planted += 1;
  return join(tempDir, `${planted}-${name}`);
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'rafa-adapter-root-'));
});

afterAll(() => {
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

describe('every core port kind', () => {
  it('resolves and makes something real, from one shared context, across every port type', async () => {
    const root = freshRoot('every-kind');
    const chunks: string[] = [];
    const stream: OutputStream = {
      write: (chunk) => {
        chunks.push(chunk);
        return true;
      },
    };
    const claude: CapturingSpawner = async () => ({ exitCode: 0, stdout: '' });
    const context: AdapterContext = {
      repoRoot: root,
      stream,
      verbosity: 0,
      gh: createFakeGh().run,
      settingSources: ['project', 'local'],
      planPrompt: (specContent, stub) => `${stub}: ${specContent}`,
      planDir: '.rafa/plans',
      claude,
      store: 'sqlite',
    };

    expect({
      tracker: CORE_ADAPTER_REGISTRY.kinds('tracker'),
      store: CORE_ADAPTER_REGISTRY.kinds('store'),
      learning: CORE_ADAPTER_REGISTRY.kinds('learning'),
      output: CORE_ADAPTER_REGISTRY.kinds('output'),
      planner: CORE_ADAPTER_REGISTRY.kinds('planner'),
      sync: CORE_ADAPTER_REGISTRY.kinds('sync'),
      logger: CORE_ADAPTER_REGISTRY.kinds('logger'),
    }).toEqual({
      tracker: ['local', 'github'],
      store: ['sqlite', 'ndjson'],
      learning: ['local'],
      output: ['text', 'json', 'events'],
      planner: ['claude'],
      sync: ['local', 'file'],
      logger: ['console'],
    });

    const sqlite = CORE_ADAPTER_REGISTRY.resolve('store', 'sqlite').create(context);
    const ndjson = CORE_ADAPTER_REGISTRY.resolve('store', 'ndjson').create(context);
    const text = CORE_ADAPTER_REGISTRY.resolve('output', 'text').create(context);
    const json = CORE_ADAPTER_REGISTRY.resolve('output', 'json').create(context);
    const local = CORE_ADAPTER_REGISTRY.resolve('tracker', 'local').create(context);
    const github = CORE_ADAPTER_REGISTRY.resolve('tracker', 'github').create(context);
    const learning = CORE_ADAPTER_REGISTRY.resolve('learning', 'local').create(context);
    const planner = CORE_ADAPTER_REGISTRY.resolve('planner', 'claude').create(context);
    const sync = CORE_ADAPTER_REGISTRY.resolve('sync', 'local').create(context);
    const fileSync = CORE_ADAPTER_REGISTRY.resolve('sync', 'file').create(context);
    const logger = CORE_ADAPTER_REGISTRY.resolve('logger', 'console').create(context);

    expect(sqlite.path('sessions')).toContain(root);
    expect(ndjson.path('sessions')).toContain(root);
    expect(local.kind).toBe('local');
    expect(github.kind).toBe('github');
    expect(typeof learning.push).toBe('function');
    expect(typeof learning.pullBlessed).toBe('function');
    expect(typeof planner.create).toBe('function');
    expect(sync.kind).toBe('local');
    expect(await sync.push({ to: null })).toEqual({ status: 'nothing-to-sync' });
    expect(fileSync.kind).toBe('file');
    expect(logger.enabled('warn')).toBe(true);

    text.info('shared context smoke check');
    json.result('shared context smoke check');
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe('shared context smoke check\n');
    expect(JSON.parse(chunks[1] ?? '')).toMatchObject({
      type: 'result',
      ok: true,
      data: 'shared context smoke check',
    });

    // None of the twelve touched disk making the adapter alone.
    expect(existsSync(root)).toBe(false);
  });
});

describe('the core adapter registry', () => {
  it('registers both store backends, in the order the config names them', () => {
    expect(CORE_ADAPTER_REGISTRY.kinds('store')).toEqual(['sqlite', 'ndjson']);
  });

  it.each(STORE_LAYOUTS)('opens the %s backend under the root it is made with', (kind, files) => {
    const root = freshRoot(kind);
    const store = CORE_ADAPTER_REGISTRY.resolve('store', kind).create({ repoRoot: root });

    expect(existsSync(root)).toBe(false);
    store.append('sessions', [SESSION]);
    expect(readdirSync(join(root, '.rafa', 'effort')).sort()).toEqual([...files]);
    expect(store.read('sessions')).toEqual([SESSION]);
  });

  it('registers the three outputs, text, then json, then events', () => {
    expect(CORE_ADAPTER_REGISTRY.kinds('output')).toEqual(['text', 'json', 'events']);
  });

  it('makes the text output over the stream and verbosity its context names', () => {
    const { stream, chunks } = memoryStream();
    const adapter = CORE_ADAPTER_REGISTRY.resolve('output', 'text');

    const quiet = adapter.create({ repoRoot: '/nonexistent', stream });
    quiet.debug('hidden');
    quiet.info('loop line');
    adapter.create({ repoRoot: '/nonexistent', stream, verbosity: 2 }).debug('shown');

    expect(chunks).toEqual(['loop line\n', 'debug: shown\n']);
  });

  it('makes a new json output on each create, each writing one result of its own', () => {
    const { stream, chunks } = memoryStream();
    const adapter = CORE_ADAPTER_REGISTRY.resolve('output', 'json');

    const first = adapter.create({ repoRoot: '/nonexistent', stream });
    first.result('one');
    adapter.create({ repoRoot: '/nonexistent', stream }).result('two');

    expect(chunks.map((chunk) => JSON.parse(chunk) as unknown)).toMatchObject([
      { type: 'result', ok: true, data: 'one' },
      { type: 'result', ok: true, data: 'two' },
    ]);
    expect(() => first.result('three')).toThrow(SECOND_RESULT_REFUSAL);
    expect(chunks).toHaveLength(2);
  });

  it.each([
    ['text', 'warn: careful\n'],
    ['json', '"level":"warn","message":"careful"'],
  ])('makes the %s output over process.stdout when its context names no stream', (kind, line) => {
    const written: string[] = [];
    const spy = spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    try {
      CORE_ADAPTER_REGISTRY.resolve('output', kind)
        .create({ repoRoot: '/nonexistent' })
        .warn('careful');
    } finally {
      spy.mockRestore();
    }

    expect(written).toHaveLength(1);
    expect(written[0]).toContain(line);
  });

  it('registers both trackers, local before github', () => {
    expect(CORE_ADAPTER_REGISTRY.kinds('tracker')).toEqual(['local', 'github']);
  });

  it('makes the local tracker under .rafa/issues of its root, recording the reason its context names', async () => {
    const root = freshRoot('tracker');
    const issuesDir = join(root, '.rafa', 'issues');
    const adapter = CORE_ADAPTER_REGISTRY.resolve('tracker', 'local');

    const fellBack = adapter.create({ repoRoot: root, fallbackReason: 'github: gh auth status exited 1' });
    const chosenFirst = adapter.create({ repoRoot: root });
    expect(existsSync(root)).toBe(false);
    await fellBack.create(draftFixture());
    await chosenFirst.create(draftFixture());

    expect(root.startsWith(tempDir)).toBe(true);
    expect(readdirSync(issuesDir).sort()).toEqual(['1.md', '2.md']);
    expect(parseLocalIssue(readFileSync(join(issuesDir, '1.md'), 'utf8')).fallbackReason)
      .toBe('github: gh auth status exited 1');
    expect(parseLocalIssue(readFileSync(join(issuesDir, '2.md'), 'utf8')).fallbackReason).toBeNull();
  });

  it('makes the github tracker over the gh runner its context names, a new tracker on each create', async () => {
    const adapter = CORE_ADAPTER_REGISTRY.resolve('tracker', 'github');
    const fake = createFakeGh();

    const first = adapter.create({ repoRoot: '/nonexistent', gh: fake.run });
    const second = adapter.create({ repoRoot: '/nonexistent', gh: fake.run });
    const preflight = await first.preflight();
    await first.create(draftFixture());
    await second.create(draftFixture());

    expect(preflight).toEqual({ ok: true });
    expect(second).not.toBe(first);
    expect(fake.issueCount()).toBe(2);
    // Each tracker remembers the labels it made, so the second makes its three again.
    expect(fake.calls().filter((call) => call[0] === 'label')).toHaveLength(6);
  });

  it('makes the github tracker when its context names no runner', () => {
    const tracker = CORE_ADAPTER_REGISTRY.resolve('tracker', 'github').create({ repoRoot: '/nonexistent' });

    expect(tracker.kind).toBe('github');
    expect(tracker.capabilities()).toEqual({ projects: false, customFields: false, issueTypes: false });
  });

  it('registers the local learning adapter alone', () => {
    expect(CORE_ADAPTER_REGISTRY.kinds('learning')).toEqual(['local']);
  });

  it('makes the local learning adapter under .rafa/instincts of its root', async () => {
    const root = freshRoot('learning');
    const home = freshRoot('learning-home');
    const adapter = CORE_ADAPTER_REGISTRY.resolve('learning', 'local');

    const pushing = adapter.create({ repoRoot: root, home });
    const pulling = adapter.create({ repoRoot: root, home });
    expect(existsSync(root)).toBe(false);
    const result = await pushing.push({ source_id: 'session-1', instincts: [DESCRIBED_INSTINCT] });
    const bundle = await pulling.pullBlessed();

    expect(root.startsWith(tempDir)).toBe(true);
    expect(readdirSync(join(root, '.rafa', 'instincts')).sort()).toEqual(['instinct-1.md', 'instincts.ndjson']);
    expect(JSON.parse(readFileSync(join(root, '.rafa', 'instincts', 'instincts.ndjson'), 'utf8'))).toEqual({
      source_id: 'session-1',
      rule: 'new-trigger',
      incoming: DESCRIBED_INSTINCT,
      produced: ['instinct-1'],
      discarded: [],
    });
    expect(result.decisions.map((decision) => decision.rule)).toEqual(['new-trigger']);
    expect(bundle.instincts).toEqual([{ ...INSTINCT, sources: ['session-1'] }]);
  });

  it('makes the local learning adapter over the home and the floor its context names', async () => {
    const home = freshRoot('learning-user-home');
    const root = freshRoot('learning-user-root');
    const adapter = CORE_ADAPTER_REGISTRY.resolve('learning', 'local');
    // A push with the home as its root plants the user scope another root reads.
    await adapter.create({ repoRoot: home, home: freshRoot('learning-no-home') }).push({
      source_id: 'session-1',
      instincts: [{ ...DESCRIBED_INSTINCT, id: 'user-1', trigger: 'another trigger', confidence: 0.6 }],
    });

    const pull = async (context: Partial<AdapterContext>): Promise<string[]> => (
      await adapter.create({ repoRoot: root, home, ...context }).pullBlessed()
    ).instincts.map((record) => record.id);

    expect(await pull({})).toEqual(['user-1']);
    expect(await pull({ learningBlessMinConfidence: 0.7 })).toEqual([]);
    // Control: the floor the record meets answers it.
    expect(await pull({ learningBlessMinConfidence: 0.6 })).toEqual(['user-1']);
    expect(existsSync(root)).toBe(false);
  });

  it('refuses a local learning adapter with no floor when no section registered one, naming the registry', () => {
    const adapter = CORE_ADAPTER_REGISTRY.resolve('learning', 'local');
    const held = registerConfigSections([]);
    try {
      restoreConfigSections(EMPTY_CONFIG_REGISTRY);

      expect(() => adapter.create({ repoRoot: freshRoot('learning-unregistered') })).toThrow(
        'adapter registry: learning.bless.minConfidence has no registered default:'
          + ' import src/config-registry.ts before making the local learning adapter without one',
      );
      // Control: a floor the context names needs no registered default.
      expect(() => adapter.create({ repoRoot: freshRoot('learning-unregistered'), learningBlessMinConfidence: 0.5 }))
        .not.toThrow();
    } finally {
      restoreConfigSections(held);
    }
  });

  it('reads the user scope under the HOME the process started with when its context names no home', async () => {
    const home = freshRoot('learning-spawned-home');
    const emptyHome = freshRoot('learning-spawned-empty-home');
    const root = freshRoot('learning-spawned-root');
    const planting = CORE_ADAPTER_REGISTRY.resolve('learning', 'local').create({ repoRoot: home, home: emptyHome });
    await planting.push({
      source_id: 'session-1',
      instincts: [{ ...DESCRIBED_INSTINCT, id: 'user-1', trigger: 'another trigger' }],
    });
    // bun's homedir() keeps the HOME the process started with, so each reading is a child of its own.
    const script = [
      `await import(${JSON.stringify(CONFIG_REGISTRY_ENTRY)});`,
      `await import(${JSON.stringify(ROOT_ENTRY)});`,
      `const { CORE_ADAPTER_REGISTRY } = await import(${JSON.stringify(BARREL_ENTRY)});`,
      `const learning = CORE_ADAPTER_REGISTRY.resolve('learning', 'local').create({ repoRoot: ${JSON.stringify(root)} });`,
      'console.log(JSON.stringify((await learning.pullBlessed()).instincts.map((record) => record.id)));',
    ].join('\n');
    const pulled = (scratchHome: string): { exitCode: number; stdout: string } => {
      const child = Bun.spawnSync([process.execPath, '-e', script], { env: { TMPDIR: tmpdir(), ...process.env, ...scratchHomeEnv(scratchHome) } });
      return { exitCode: child.exitCode, stdout: child.stdout.toString() };
    };

    expect(pulled(home)).toEqual({ exitCode: 0, stdout: '["user-1"]\n' });
    // Control: a HOME with no user scope answers nothing, so the reading above came from the HOME.
    expect(pulled(emptyHome)).toEqual({ exitCode: 0, stdout: '[]\n' });
    expect(existsSync(emptyHome)).toBe(false);
  });

  it('registers the claude planner alone', () => {
    expect(CORE_ADAPTER_REGISTRY.kinds('planner')).toEqual(['claude']);
  });

  it('makes the claude planner over the sources, prompt, plans directory and spawner its context names', async () => {
    const root = freshRoot('planner');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'spec.md'), 'the spec\n', 'utf8');
    const sessions: string[][] = [];
    const claude: CapturingSpawner = async (args, prompt) => {
      sessions.push([...args, prompt]);
      writeFileSync(join(root, 'plans-here', 'PLAN-probe.md'), 'the plan\n', 'utf8');
      return { exitCode: 0, stdout: PLANNER_SESSION_STDOUT };
    };

    const planner = CORE_ADAPTER_REGISTRY.resolve('planner', 'claude').create({
      repoRoot: root,
      settingSources: ['local'],
      planPrompt: (specContent, stub) => `${stub}: ${specContent}`,
      planDir: 'plans-here',
      claude,
    });
    const generated = await planner.create({ specPath: 'spec.md', stub: 'probe' });

    expect(root.startsWith(tempDir)).toBe(true);
    expect(generated).toEqual({
      planPath: 'plans-here/PLAN-probe.md',
      prerequisitesPath: null,
      review: parseSpecReview(PLANNER_SESSION_STDOUT),
    });
    expect(generated.review?.answer).toBe('ready');
    expect(sessions).toEqual([
      ['-p', '--dangerously-skip-permissions', '--setting-sources', 'local', 'probe: the spec\n'],
    ]);
  });

  it.each([
    [
      'settingSources',
      { planPrompt: (): string => 'prompt', planDir: '.rafa/plans' },
      'settingSources undefined in its context, expected a list of setting sources',
    ],
    ['planPrompt', { settingSources: ['project', 'local'], planDir: '.rafa/plans' }, 'planPrompt undefined in its context, expected a function'],
    ['planDir', { settingSources: ['project', 'local'], planPrompt: (): string => 'prompt' }, 'planDir undefined in its context, expected a directory path'],
  ])('refuses to make the claude planner when its context names no %s', (_field, fields, named) => {
    const adapter = CORE_ADAPTER_REGISTRY.resolve('planner', 'claude');
    const attempt = (): unknown => adapter.create({ repoRoot: '/nonexistent', ...fields } as AdapterContext);

    expect(attempt).toThrow(TypeError);
    expect(attempt).toThrow(`adapter registry: planner/claude has ${named}`);
  });

  it('registers the local and file sync strategies, in that order', () => {
    expect(CORE_ADAPTER_REGISTRY.kinds('sync')).toEqual(['local', 'file']);
  });

  it('makes the local sync strategy, whose push and pull answer that there is nothing to sync', async () => {
    const root = freshRoot('sync');
    const sync = CORE_ADAPTER_REGISTRY.resolve('sync', 'local').create({ repoRoot: root });

    expect(sync.kind).toBe('local');
    expect(await sync.push({ to: join(root, 'copy') })).toEqual({ status: 'nothing-to-sync' });
    expect(await sync.pull({ from: join(root, 'effort.sqlite'), dryRun: false }))
      .toEqual({ status: 'nothing-to-sync' });
    expect(existsSync(root)).toBe(false);
  });

  it('registers the console logger', () => {
    expect(CORE_ADAPTER_REGISTRY.kinds('logger')).toEqual(['console']);
  });

  it('makes the console logger at the verbosity it is handed', () => {
    const quiet = CORE_ADAPTER_REGISTRY.resolve('logger', 'console').create({ repoRoot: freshRoot('logger') });
    const verbose = CORE_ADAPTER_REGISTRY.resolve('logger', 'console').create({ repoRoot: freshRoot('logger'), verbosity: 2 });

    expect(quiet.enabled('warn')).toBe(true);
    expect(quiet.enabled('debug')).toBe(false);
    expect(verbose.enabled('debug')).toBe(true);
  });

  it('is frozen, and so is every adapter it holds', () => {
    expect(Object.isFrozen(CORE_ADAPTER_REGISTRY)).toBe(true);
    for (const port of ['store', 'output', 'tracker', 'learning', 'planner', 'sync', 'logger'] as const) {
      expect(CORE_ADAPTER_REGISTRY.kinds(port)).not.toEqual([]);
      for (const kind of CORE_ADAPTER_REGISTRY.kinds(port)) {
        expect(Object.isFrozen(CORE_ADAPTER_REGISTRY.resolve(port, kind))).toBe(true);
      }
    }
  });
});

describe('an add-on beside core\'s kinds', () => {
  it('answers a new registry holding an add-on sync kind after core\'s local and file', () => {
    const extended = CORE_ADAPTER_REGISTRY.register(addOn());

    expect(extended.kinds('sync')).toEqual(['local', 'file', 'git']);
    expect(extended.resolve('sync', 'git').create({ repoRoot: '/nonexistent' })).toBe(FIXTURE_SYNC);
    expect(CORE_ADAPTER_REGISTRY.kinds('sync')).toEqual(['local', 'file']);
  });

  it('refuses a sync add-on taking core\'s local kind over', () => {
    const local = addOn({ kind: 'local' });

    expect(() => CORE_ADAPTER_REGISTRY.register(local)).toThrow('adapter registry: sync/local is already registered');
  });

  it('refuses a second adapter under a core store kind, and takes the same name under another port type', () => {
    const again = addOn({ port: 'store', kind: 'sqlite' });

    expect(() => CORE_ADAPTER_REGISTRY.register(again))
      .toThrow('adapter registry: store/sqlite is already registered');
    expect(CORE_ADAPTER_REGISTRY.register(addOn({ kind: 'sqlite' })).kinds('sync'))
      .toEqual(['local', 'file', 'sqlite']);
  });

  it('resolves nothing under a kind core does not register, naming the kinds it does', () => {
    expect(() => CORE_ADAPTER_REGISTRY.resolve('store', 'postgres')).toThrow(
      'adapter registry: no store adapter is registered as "postgres"; registered: sqlite, ndjson',
    );
    expect(() => CORE_ADAPTER_REGISTRY.resolve('tracker', 'linear')).toThrow(
      'adapter registry: no tracker adapter is registered as "linear"; registered: local, github',
    );
    expect(() => CORE_ADAPTER_REGISTRY.resolve('learning', 'remote')).toThrow(
      'adapter registry: no learning adapter is registered as "remote"; registered: local',
    );
    expect(() => CORE_ADAPTER_REGISTRY.resolve('planner', 'webhook')).toThrow(
      'adapter registry: no planner adapter is registered as "webhook"; registered: claude',
    );
    expect(() => CORE_ADAPTER_REGISTRY.resolve('sync', 'git')).toThrow(
      'adapter registry: no sync adapter is registered as "git"; registered: local, file',
    );
  });
});
