/**
 * The adapter registry, read the way a caller outside `src/adapters/`
 * reads it: through `registry.js`'s public exports alone, one example
 * apiece of the four claims the registry stands on.
 *
 * `src/adapters/registry.test.ts` and `src/adapters/tracker/resolve.test.ts`
 * carry the mutation-driven grid behind each of those claims, one case
 * per kind, each made with a context built just for that kind. Repeating
 * that grid here would add nothing the size of this file could earn
 * back. What this file adds instead is the single running example the
 * mutation grid never assembles: every one of the eight kinds core
 * registers, made from ONE shared context, so a kind whose `create`
 * reaches for a field none of the others need cannot pass silently by
 * only ever being exercised alongside a context tailored to it.
 *
 * The four claims:
 *
 *   - Every core port kind resolves and makes something real, from a
 *     context wide enough to satisfy every one of the eight at once,
 *     across all five port types.
 *   - A fixture add-on adapter registers under a name of its own and is
 *     found beside the core kinds, without changing the registry it
 *     extended.
 *   - A port version core does not serve is refused, naming both
 *     numbers, beside the same shape accepted at the version core does
 *     serve.
 *   - The tracker degradation chain, resolved through the core registry
 *     with a `github` fake failing its preflight, lands on `local` and
 *     hands it the reason the attempt before it failed with, which
 *     `local` then writes into the issue it captures on disk.
 */
import type { OutputStream } from '../adapters/output/stream.js';
import type { AdapterContext, AnyAdapter } from '../adapters/registry.js';
import type { Tracker } from '../ports/index.js';
import type { ClaudeSpawner } from '../utils/claude.js';

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { CORE_ADAPTER_REGISTRY, PORT_VERSIONS } from '../adapters/registry.js';
import { draftFixture } from '../adapters/tracker/contract.js';
import { createFakeGh } from '../adapters/tracker/github-fake.js';
import { parseLocalIssue } from '../adapters/tracker/local.js';
import { resolveTracker } from '../adapters/tracker/resolve.js';

/** What `gh auth status` writes with no hosts, as the fake records it. */
const NOT_LOGGED_IN = 'You are not logged into any GitHub hosts. To log in, run: gh auth login';

/** The kind a fixture add-on registers under, never a core kind. */
const FIXTURE_KIND = 'obsidian';

/** A tracker every fixture add-on answers with. Never called. */
const FIXTURE_TRACKER: Tracker = {
  kind: FIXTURE_KIND,
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

/** A tracker add-on registered under {@link FIXTURE_KIND}, at the port version given. */
function fixtureAddOn(portVersion: number): AnyAdapter {
  return {
    port: 'tracker',
    kind: FIXTURE_KIND,
    portVersion,
    create: () => FIXTURE_TRACKER,
  };
}

let tempDir = '';
let planted = 0;

/** A repo root of its own, not yet on disk. */
function freshRoot(name: string): string {
  planted += 1;
  return join(tempDir, `${planted}-${name}`);
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'rafa-adapter-registry-'));
});

afterAll(() => {
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

describe('every core port kind', () => {
  it('resolves and makes something real, from one shared context, across every port type', () => {
    const root = freshRoot('every-kind');
    const chunks: string[] = [];
    const stream: OutputStream = {
      write: (chunk) => {
        chunks.push(chunk);
        return true;
      },
    };
    const claude: ClaudeSpawner = async () => 0;
    const context: AdapterContext = {
      repoRoot: root,
      stream,
      verbosity: 0,
      gh: createFakeGh().run,
      settingSources: ['project', 'local'],
      planPrompt: (specContent, stub) => `${stub}: ${specContent}`,
      claude,
    };

    expect({
      tracker: CORE_ADAPTER_REGISTRY.kinds('tracker'),
      store: CORE_ADAPTER_REGISTRY.kinds('store'),
      learning: CORE_ADAPTER_REGISTRY.kinds('learning'),
      output: CORE_ADAPTER_REGISTRY.kinds('output'),
      planner: CORE_ADAPTER_REGISTRY.kinds('planner'),
    }).toEqual({
      tracker: ['local', 'github'],
      store: ['sqlite', 'ndjson'],
      learning: ['local'],
      output: ['text', 'json'],
      planner: ['claude'],
    });

    const sqlite = CORE_ADAPTER_REGISTRY.resolve('store', 'sqlite').create(context);
    const ndjson = CORE_ADAPTER_REGISTRY.resolve('store', 'ndjson').create(context);
    const text = CORE_ADAPTER_REGISTRY.resolve('output', 'text').create(context);
    const json = CORE_ADAPTER_REGISTRY.resolve('output', 'json').create(context);
    const local = CORE_ADAPTER_REGISTRY.resolve('tracker', 'local').create(context);
    const github = CORE_ADAPTER_REGISTRY.resolve('tracker', 'github').create(context);
    const learning = CORE_ADAPTER_REGISTRY.resolve('learning', 'local').create(context);
    const planner = CORE_ADAPTER_REGISTRY.resolve('planner', 'claude').create(context);

    expect(sqlite.path('sessions')).toContain(root);
    expect(ndjson.path('sessions')).toContain(root);
    expect(local.kind).toBe('local');
    expect(github.kind).toBe('github');
    expect(typeof learning.push).toBe('function');
    expect(typeof learning.pullBlessed).toBe('function');
    expect(typeof planner.create).toBe('function');

    text.info('shared context smoke check');
    json.result('shared context smoke check');
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe('shared context smoke check\n');
    expect(JSON.parse(chunks[1] ?? '')).toMatchObject({
      type: 'result',
      ok: true,
      data: 'shared context smoke check',
    });

    // None of the eight touched disk making the adapter alone.
    expect(existsSync(root)).toBe(false);
  });
});

describe('a fixture add-on adapter', () => {
  it('registers under a name of its own, found beside the core kinds it left unchanged', () => {
    const extended = CORE_ADAPTER_REGISTRY.register(fixtureAddOn(PORT_VERSIONS.tracker));

    expect(extended.kinds('tracker')).toEqual(['local', 'github', FIXTURE_KIND]);
    expect(extended.resolve('tracker', FIXTURE_KIND).create({ repoRoot: '/nonexistent' }))
      .toBe(FIXTURE_TRACKER);
    expect(CORE_ADAPTER_REGISTRY.kinds('tracker')).toEqual(['local', 'github']);
    expect(CORE_ADAPTER_REGISTRY.find('tracker', FIXTURE_KIND)).toBeUndefined();
  });
});

describe('a port version core does not serve', () => {
  it('is refused, naming both numbers, beside the same shape accepted at the version core serves', () => {
    const refused = (): unknown => CORE_ADAPTER_REGISTRY.register(fixtureAddOn(2));

    expect(refused).toThrow(
      `adapter registry: tracker/${FIXTURE_KIND} implements tracker port version 2,`
        + ' and core serves tracker port version 1',
    );

    const accepted = CORE_ADAPTER_REGISTRY.register(fixtureAddOn(PORT_VERSIONS.tracker));
    expect(accepted.resolve('tracker', FIXTURE_KIND).create({ repoRoot: '/nonexistent' }))
      .toBe(FIXTURE_TRACKER);
  });
});

describe('the tracker degradation chain', () => {
  it('lands a github fake failing preflight on local, whose captured issue records the fallback reason', async () => {
    const root = freshRoot('chain');
    const fake = createFakeGh({ authOk: false });

    const resolution = await resolveTracker({
      config: { trackerDefault: 'github', trackerFallback: ['local'] },
      context: { repoRoot: root, gh: fake.run },
      log: () => {},
    });
    await resolution.tracker.create(draftFixture());

    const reason = `github: gh auth status: ${NOT_LOGGED_IN}`;
    const capturedPath = join(root, '.rafa', 'issues', '1.md');
    const captured = parseLocalIssue(readFileSync(capturedPath, 'utf8'));

    expect(resolution.tracker.kind).toBe('local');
    expect(resolution.degraded).toBe(true);
    expect(resolution.fallbackReason).toBe(reason);
    expect(captured.fallbackReason).toBe(resolution.fallbackReason);
  });
});
