/**
 * Tests for the adapter registry: the port versions it serves, what core
 * registers, what `register` accepts and refuses, and what a lookup
 * answers.
 *
 * `PORT_VERSIONS` is held to the literal types `src/ports/index.ts`
 * declares by reading them off the TypeScript compiler, under the
 * options the root tsconfig gives `check-types`, because bun runs this
 * file without checking a type. The same reader runs over a probe
 * written to a temporary directory outside the repository, declaring
 * one version drifted and one widened to `number`, and must report
 * both: the control that the comparison can fail.
 *
 * Every refusal is spelled here in full, and each sits beside a case the
 * registry accepts, so a registry refusing everything fails as surely as
 * one refusing nothing. The store cases read which backend an adapter
 * opened off the disk under a fresh temporary root, never off the store
 * it answered, with the file names spelled here. The output cases read
 * what an adapter wrote off a stream the case hands it, or off a spy on
 * `process.stdout.write` the case restores, and each `text` reading
 * spells a line the `json` adapter could not have written. The `local`
 * tracker case reads the issues that adapter wrote off the disk under a
 * fresh temporary root, and the reason each records off its file. The
 * `local` learning case reads the line that adapter stored off the disk
 * under a fresh temporary root, and the bundle a second adapter made
 * over that root answers. The `github` tracker cases hand that adapter
 * the recorded fake as its `gh` runner and read what it filed off the
 * fake. No case runs the runner the adapter makes when its context names
 * none, which spawns the real `gh`. The `claude` planner case hands that
 * adapter a recording spawner as its `claude` and reads the plan it
 * answers off a fresh temporary root. No case makes a planner without a
 * spawner of its own, whose default spawns the real `claude`; the
 * refusals throw before one is made.
 *
 * No case changes `CORE_ADAPTER_REGISTRY`. An add-on is registered on it
 * through `register`, which answers a new registry, and a case holds the
 * core registry unchanged afterwards.
 *
 * Twelve mutations were driven against this file on 2026-09-14, one run
 * each, with the unmutated modules at 52 pass before them and restored
 * byte-identical after, and every one reddened at least one case:
 *
 *   - The version check dropped reddened the seven version refusals, and
 *     so did the refusal naming the implemented version alone. The check
 *     made with `!=` reddened the `"1"` case alone.
 *   - `PORT_VERSIONS.tracker` set to 2 reddened thirteen cases, and
 *     `check-types` failed with TS2322 at the value. `TrackerPortVersion`
 *     widened to `number` passed `check-types` and reddened the literal
 *     case, the reason that case reads the compiler. `PortVersions`
 *     without `planner` reddened the literal case too.
 *   - A second adapter under a held key accepted reddened the duplicate
 *     case. The adapter held uncopied reddened the frozen-copy case and
 *     the frozen-registry case. `find` indexing an object reddened the
 *     three `Object.prototype` names and the list.
 *   - `register` changing the registry in place reddened five cases, the
 *     core registry left unchanged among them. `kinds` not refusing an
 *     unknown port reddened its refusal case. The store backends
 *     registered in reverse reddened the order case, and with it the
 *     store entry's refusals, which list the kinds in that order.
 *
 * Three more were driven the same way on 2026-09-14, once the outputs
 * were registered, with `src/adapters/` at 112 pass before and after. The
 * `json` output made once and shared across creates reddened the
 * fresh-output case and the `json` stdout case, whose line went to the
 * stream an earlier case had made the shared output with. The `text`
 * output made at verbosity 0 whatever its context reddened the stream
 * and verbosity case alone, and a default stream of `process.stderr` the
 * `text` stdout case alone.
 *
 * Three more were driven the same way on 2026-09-14, once the `local`
 * tracker was registered, with `src/adapters/` at 242 pass before and
 * after. The context's reason defaulting to a string, the context's
 * reason ignored, and the issues written at the repository root in place
 * of `.rafa/issues/` each reddened the tracker case alone.
 *
 * Two more were driven the same way on 2026-09-14, once the `github`
 * tracker was registered, with this file and `github.test.ts` at 168 pass
 * before and after and `registry.ts` restored byte-identical (sha256).
 * The context's runner ignored for one spawning `gh` in the context's
 * root, and one github tracker shared across creates, each reddened the
 * runner case alone. The first ran no `gh`: that case's root,
 * `/nonexistent`, was checked absent first, and `Bun.spawn` throws for a
 * missing `cwd` before it runs anything, as `github.ts` notes.
 *
 * Two more were driven the same way on 2026-09-14, once the `local`
 * learning stub was registered, over this file and
 * `src/adapters/learning/local.test.ts` at 101 pass before and after,
 * with `registry.ts` restored byte-identical (sha256). The entry removed
 * reddened four cases: the learning kinds case, the learning case, the
 * frozen-registry case and the refusal naming the kinds held. The entry
 * making the stub at the root in place of `.rafa/instincts/` reddened
 * the learning case alone.
 *
 * Five more were driven the same way on 2026-09-14, once the `claude`
 * planner was registered, over this file,
 * `src/adapters/planner/claude.test.ts` and `src/plan.test.ts` at 79 pass
 * before and after, with `registry.ts` restored byte-identical (sha256)
 * and a PATH on which no `claude` resolves. The entry registered under
 * another kind reddened the four planner cases. Each refusal dropped
 * reddened its own case alone. The context's spawner ignored, and the
 * context's sources ignored, each reddened the planner case alone.
 */
import type { AdapterContext, AnyAdapter } from './registry.js';
import type { SessionEffortRow } from '../effort/store/types.js';
import type { InstinctRecord, Tracker } from '../ports/index.js';
import type { ClaudeSpawner } from '../utils/claude.js';

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
import ts from 'typescript';

import {
  CORE_ADAPTER_REGISTRY,
  createAdapterRegistry,
  PORT_VERSIONS,
} from './registry.js';
import { draftFixture } from './tracker/contract.js';
import { createFakeGh } from './tracker/github-fake.js';
import { parseLocalIssue } from './tracker/local.js';

/** The repository root, whose tsconfig the compiler reads under. */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The ports entry, whose literal version types the value is held to. */
const PORTS_ENTRY = fileURLToPath(new URL('../ports/index.ts', import.meta.url));

/** The port types, in the order a refusal lists them. */
const PORT_TYPES = 'tracker, store, learning, output, planner';

/** A probe declaring one version drifted and one widened. */
const DRIFTED_PROBE = [
  'export interface PortVersions {',
  '  tracker: 2;',
  '  store: 1;',
  '  learning: 1;',
  '  output: 1;',
  '  planner: number;',
  '}',
  '',
].join('\n');

/** What the reader must report for the drifted probe. */
const DRIFTED_READING = { tracker: 2, store: 1, learning: 1, output: 1, planner: 'number' };

/** Each store backend and the files it leaves once a session row is written. */
const STORE_LAYOUTS: readonly (readonly [string, readonly string[]])[] = [
  ['sqlite', ['effort.sqlite']],
  ['ndjson', ['sessions.ndjson']],
];

/** The record the learning case pushes. */
const INSTINCT: InstinctRecord = {
  id: 'instinct-1',
  trigger: 'a test fails under the full suite and passes alone',
  action: 'find the file that runs before it and the state it leaves',
  action_hash: 'a'.repeat(64),
  confidence: 0.5,
  usage_count: 1,
  signal: 'loud',
  status: 'active',
  created_at: '2026-09-14T10:00:00.000Z',
  updated_at: '2026-09-14T10:00:00.000Z',
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

/** A tracker every fixture adapter answers. Never called. */
const FIXTURE_TRACKER: Tracker = {
  kind: 'obsidian',
  capabilities: () => ({ projects: false, customFields: false, issueTypes: false }),
  preflight: async () => ({ ok: true }),
  find: async () => [],
  get: async () => {
    throw new Error('unused');
  },
  create: async () => {
    throw new Error('unused');
  },
  comment: async () => {},
  transition: async () => ({}),
};

/**
 * A tracker adapter as an add-on hands one over, with any field replaced.
 * The cast is the plant: a refusal case hands the registry what an
 * add-on's JavaScript could.
 */
function addOn(fields: Record<string, unknown> = {}): AnyAdapter {
  return {
    port: 'tracker',
    kind: 'obsidian',
    portVersion: 1,
    create: () => FIXTURE_TRACKER,
    ...fields,
  } as unknown as AnyAdapter;
}

/** A session row carrying its key and one counter. The cast is the plant. */
const SESSION = { sessionId: 'aaaa-1111', assistantRecordCount: 1 } as unknown as SessionEffortRow;

let tempDir = '';
let program: ts.Program | null = null;
let planted = 0;

/** A repo root of its own, not yet on disk. */
function freshRoot(name: string): string {
  planted += 1;
  return join(tempDir, `${planted}-${name}`);
}

/**
 * The `PortVersions` a file declares, read off the compiler: each
 * member's number when its type is a number literal, and the type as
 * the checker prints it when not.
 */
function declaredVersions(file: string): Record<string, number | string> {
  if (program === null) throw new Error('the program was never compiled');
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  if (source === undefined) throw new Error(`the program holds no ${file}`);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (moduleSymbol === undefined) throw new Error(`the compiler holds no symbol for ${file}`);
  const declaration = checker.getExportsOfModule(moduleSymbol)
    .find((exported) => exported.name === 'PortVersions');
  if (declaration === undefined) throw new Error(`${file} exports no PortVersions`);

  const members = checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(declaration));
  return Object.fromEntries(members.map((member) => {
    const type = checker.getTypeOfSymbol(member);
    return [member.name, type.isNumberLiteral()
      ? type.value
      : checker.typeToString(type)];
  }));
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'rafa-registry-'));
  const probe = join(tempDir, 'drifted.ts');
  writeFileSync(probe, DRIFTED_PROBE);

  const configPath = join(REPO_ROOT, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    REPO_ROOT,
    undefined,
    configPath,
  );
  program = ts.createProgram({ rootNames: [PORTS_ENTRY, probe], options: parsed.options });
}, 30_000);

afterAll(() => {
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

describe('PORT_VERSIONS', () => {
  it('holds each port type at the number literal the ports entry declares', () => {
    expect(declaredVersions(PORTS_ENTRY)).toEqual({ ...PORT_VERSIONS });
  });

  it('is told apart from a declaration with a version drifted and one widened', () => {
    const reading = declaredVersions(join(tempDir, 'drifted.ts'));

    expect(reading).toEqual(DRIFTED_READING);
    expect(reading).not.toEqual({ ...PORT_VERSIONS });
  });

  it('lists the port types in the order refusals name them', () => {
    expect(Object.keys(PORT_VERSIONS).join(', ')).toBe(PORT_TYPES);
  });

  it('refuses a caller moving a version', () => {
    const versions = PORT_VERSIONS as { tracker: number };

    expect(() => {
      versions.tracker = 2;
    }).toThrow(TypeError);
    expect(PORT_VERSIONS.tracker).toBe(1);
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
    expect(readdirSync(join(root, '.ralph', 'effort')).sort()).toEqual([...files]);
    expect(store.read('sessions')).toEqual([SESSION]);
  });

  it('registers both outputs, text before json', () => {
    expect(CORE_ADAPTER_REGISTRY.kinds('output')).toEqual(['text', 'json']);
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

  it('registers the local learning stub alone', () => {
    expect(CORE_ADAPTER_REGISTRY.kinds('learning')).toEqual(['local']);
  });

  it('makes the local learning stub under .rafa/instincts of its root', async () => {
    const root = freshRoot('learning');
    const adapter = CORE_ADAPTER_REGISTRY.resolve('learning', 'local');

    const pushing = adapter.create({ repoRoot: root });
    const pulling = adapter.create({ repoRoot: root });
    expect(existsSync(root)).toBe(false);
    const result = await pushing.push({ source_id: 'session-1', instincts: [INSTINCT] });
    const bundle = await pulling.pullBlessed();

    expect(root.startsWith(tempDir)).toBe(true);
    expect(readdirSync(join(root, '.rafa', 'instincts'))).toEqual(['instincts.ndjson']);
    expect(JSON.parse(readFileSync(join(root, '.rafa', 'instincts', 'instincts.ndjson'), 'utf8')))
      .toEqual({ source_id: 'session-1', instinct: INSTINCT });
    expect(result.decisions.map((decision) => decision.rule)).toEqual(['new-trigger']);
    expect(bundle.instincts).toEqual([INSTINCT]);
  });

  it('registers the claude planner alone', () => {
    expect(CORE_ADAPTER_REGISTRY.kinds('planner')).toEqual(['claude']);
  });

  it('makes the claude planner over the sources, prompt and spawner its context names', async () => {
    const root = freshRoot('planner');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'spec.md'), 'the spec\n', 'utf8');
    const sessions: string[][] = [];
    const claude: ClaudeSpawner = async (args, prompt) => {
      sessions.push([...args, prompt]);
      writeFileSync(join(root, '.plans', 'PLAN-probe.md'), 'the plan\n', 'utf8');
      return 0;
    };

    const planner = CORE_ADAPTER_REGISTRY.resolve('planner', 'claude').create({
      repoRoot: root,
      settingSources: ['local'],
      planPrompt: (specContent, stub) => `${stub}: ${specContent}`,
      claude,
    });
    const generated = await planner.create({ specPath: 'spec.md', stub: 'probe' });

    expect(root.startsWith(tempDir)).toBe(true);
    expect(generated).toEqual({ planPath: '.plans/PLAN-probe.md', prerequisitesPath: null });
    expect(sessions).toEqual([
      ['-p', '--dangerously-skip-permissions', '--setting-sources', 'local', 'probe: the spec\n'],
    ]);
  });

  it.each([
    ['settingSources', { planPrompt: () => 'prompt' }, 'settingSources undefined in its context, expected a list of setting sources'],
    ['planPrompt', { settingSources: ['project', 'local'] }, 'planPrompt undefined in its context, expected a function'],
  ])('refuses to make the claude planner when its context names no %s', (_field, fields, named) => {
    const adapter = CORE_ADAPTER_REGISTRY.resolve('planner', 'claude');
    const attempt = (): unknown => adapter.create({ repoRoot: '/nonexistent', ...fields } as AdapterContext);

    expect(attempt).toThrow(TypeError);
    expect(attempt).toThrow(`adapter registry: planner/claude has ${named}`);
  });

  it('is frozen, and so is every adapter it holds', () => {
    expect(Object.isFrozen(CORE_ADAPTER_REGISTRY)).toBe(true);
    for (const port of ['store', 'output', 'tracker', 'learning', 'planner'] as const) {
      expect(CORE_ADAPTER_REGISTRY.kinds(port)).not.toEqual([]);
      for (const kind of CORE_ADAPTER_REGISTRY.kinds(port)) {
        expect(Object.isFrozen(CORE_ADAPTER_REGISTRY.resolve(port, kind))).toBe(true);
      }
    }
  });
});

describe('registering an adapter', () => {
  it('answers a new registry holding an add-on kind, leaving the one it extended unchanged', () => {
    const extended = CORE_ADAPTER_REGISTRY.register(addOn());

    expect(extended).not.toBe(CORE_ADAPTER_REGISTRY);
    expect(extended.kinds('tracker')).toEqual(['local', 'github', 'obsidian']);
    expect(extended.kinds('store')).toEqual(['sqlite', 'ndjson']);
    expect(extended.resolve('tracker', 'obsidian').create({ repoRoot: '/nonexistent' }))
      .toBe(FIXTURE_TRACKER);
    expect(CORE_ADAPTER_REGISTRY.kinds('tracker')).toEqual(['local', 'github']);
    expect(CORE_ADAPTER_REGISTRY.find('tracker', 'obsidian')).toBeUndefined();
  });

  it('never calls create when it registers or resolves an adapter', () => {
    const contexts: unknown[] = [];
    const extended = CORE_ADAPTER_REGISTRY.register(addOn({
      create: (context: unknown) => {
        contexts.push(context);
        return FIXTURE_TRACKER;
      },
    }));
    const adapter = extended.resolve('tracker', 'obsidian');

    expect(contexts).toEqual([]);
    adapter.create({ repoRoot: '/repo' });
    expect(contexts).toEqual([{ repoRoot: '/repo' }]);
  });

  it('holds a frozen copy, so changing the adapter handed over changes nothing held', () => {
    const handed = addOn() as { kind: string; portVersion: number };
    const extended = CORE_ADAPTER_REGISTRY.register(handed as unknown as AnyAdapter);
    handed.portVersion = 2;
    handed.kind = 'moved';

    const held = extended.resolve('tracker', 'obsidian');
    expect(held.portVersion).toBe(1);
    expect(held.kind).toBe('obsidian');
    expect(Object.isFrozen(held)).toBe(true);
    expect(extended.find('tracker', 'moved')).toBeUndefined();
  });

  it('accepts an add-on at the port version core serves', () => {
    expect(createAdapterRegistry([addOn({ portVersion: 1 })]).kinds('tracker'))
      .toEqual(['obsidian']);
  });

  it.each([
    [2, '2'],
    [0, '0'],
    ['1', '"1"'],
    [1.5, '1.5'],
    [undefined, 'undefined'],
  ])('refuses an add-on implementing port version %p, naming both numbers', (version, quoted) => {
    expect(() => CORE_ADAPTER_REGISTRY.register(addOn({ portVersion: version }))).toThrow(
      `adapter registry: tracker/obsidian implements tracker port version ${quoted},`
        + ' and core serves tracker port version 1',
    );
  });

  it('names the port a refused version belongs to', () => {
    const store = addOn({ port: 'store', kind: 'homelab', portVersion: 2 });

    expect(() => CORE_ADAPTER_REGISTRY.register(store)).toThrow(
      'adapter registry: store/homelab implements store port version 2,'
        + ' and core serves store port version 1',
    );
  });

  it('refuses a second adapter under a port type and kind already held', () => {
    const again = addOn({ port: 'store', kind: 'sqlite' });

    expect(() => CORE_ADAPTER_REGISTRY.register(again))
      .toThrow('adapter registry: store/sqlite is already registered');
    expect(CORE_ADAPTER_REGISTRY.register(addOn({ kind: 'sqlite' })).kinds('tracker'))
      .toEqual(['local', 'github', 'sqlite']);
  });

  it.each([
    ['a port type nothing declares', 'storage', '"storage"'],
    ['a port type in another case', 'Store', '"Store"'],
    ['the name of Object.prototype.constructor', 'constructor', '"constructor"'],
    ['the name of Object.prototype.toString', 'toString', '"toString"'],
    ['the prototype accessor', '__proto__', '"__proto__"'],
    ['a list naming a port type', ['store'], 'a list'],
    ['no port at all', undefined, 'undefined'],
  ])('refuses an adapter whose port is %s', (_label, port, quoted) => {
    const attempt = (): unknown => CORE_ADAPTER_REGISTRY.register(addOn({ port }));

    expect(attempt).toThrow(TypeError);
    expect(attempt).toThrow(`adapter registry: port is ${quoted}, expected one of: ${PORT_TYPES}`);
  });

  it.each([
    ['', '""'],
    [42, '42'],
    [undefined, 'undefined'],
  ])('refuses an adapter whose kind is %p', (kind, quoted) => {
    const attempt = (): unknown => CORE_ADAPTER_REGISTRY.register(addOn({ kind }));

    expect(attempt).toThrow(TypeError);
    expect(attempt).toThrow(
      `adapter registry: a tracker adapter has kind ${quoted}, expected a non-empty name`,
    );
  });

  it('refuses an adapter with no create function', () => {
    const attempt = (): unknown => CORE_ADAPTER_REGISTRY.register(addOn({ create: undefined }));

    expect(attempt).toThrow(TypeError);
    expect(attempt).toThrow(
      'adapter registry: tracker/obsidian has create undefined, expected a function',
    );
  });

  it.each([
    [null, 'null'],
    ['tracker', '"tracker"'],
  ])('refuses %p in place of an adapter', (value, quoted) => {
    const attempt = (): unknown => CORE_ADAPTER_REGISTRY.register(value as unknown as AnyAdapter);

    expect(attempt).toThrow(TypeError);
    expect(attempt).toThrow(`adapter registry: an adapter is ${quoted}, expected a mapping`);
  });

  it('refuses through createAdapterRegistry as register does, on the first refused adapter', () => {
    const attempt = (): unknown => createAdapterRegistry([
      addOn(),
      addOn({ kind: 'linear', portVersion: 3 }),
      addOn({ kind: 'linear', portVersion: 4 }),
    ]);

    expect(attempt).toThrow(
      'adapter registry: tracker/linear implements tracker port version 3,'
        + ' and core serves tracker port version 1',
    );
  });
});

describe('looking an adapter up', () => {
  it('finds a core store backend by its kind', () => {
    expect(CORE_ADAPTER_REGISTRY.find('store', 'sqlite')).toMatchObject({
      port: 'store',
      kind: 'sqlite',
      portVersion: 1,
    });
  });

  it.each([
    ['a kind nothing registers', 'postgres'],
    ['a kind in another case', 'SQLite'],
    ['the name of Object.prototype.constructor', 'constructor'],
    ['the name of Object.prototype.toString', 'toString'],
    ['the prototype accessor', '__proto__'],
    ['a list naming a kind', ['sqlite']],
    ['a number', 42],
    ['undefined', undefined],
  ])('finds nothing under %s', (_label, kind) => {
    expect(CORE_ADAPTER_REGISTRY.find('store', kind as unknown as string)).toBeUndefined();
  });

  it.each(['storage', 'constructor', '__proto__'])('finds nothing under the port %p, throwing nothing', (port) => {
    const find = CORE_ADAPTER_REGISTRY.find as (port: unknown, kind: string) => unknown;

    expect(find(port, 'sqlite')).toBeUndefined();
  });

  it('resolves nothing under a kind not held, naming the kinds that are', () => {
    expect(() => CORE_ADAPTER_REGISTRY.resolve('store', 'postgres')).toThrow(
      'adapter registry: no store adapter is registered as "postgres"; registered: sqlite, ndjson',
    );
    expect(() => CORE_ADAPTER_REGISTRY.resolve('store', 'constructor')).toThrow(
      'adapter registry: no store adapter is registered as "constructor"; registered: sqlite, ndjson',
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
  });

  it('refuses a port type it does not declare, in resolve and in kinds', () => {
    const resolve = CORE_ADAPTER_REGISTRY.resolve as (port: unknown, kind: string) => unknown;
    const kinds = CORE_ADAPTER_REGISTRY.kinds as (port: unknown) => unknown;
    const refusal = `adapter registry: port is "storage", expected one of: ${PORT_TYPES}`;

    expect(() => resolve('storage', 'sqlite')).toThrow(TypeError);
    expect(() => resolve('storage', 'sqlite')).toThrow(refusal);
    expect(() => kinds('storage')).toThrow(TypeError);
    expect(() => kinds('storage')).toThrow(refusal);
  });

  it('answers kinds a caller can change without changing the registry', () => {
    const kinds = CORE_ADAPTER_REGISTRY.kinds('store') as string[];
    kinds.push('postgres');

    expect(CORE_ADAPTER_REGISTRY.kinds('store')).toEqual(['sqlite', 'ndjson']);
  });
});
