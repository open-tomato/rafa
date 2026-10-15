/**
 * The adapter registry, read the way a caller outside `src/adapters/`
 * reads it: through the adapters barrel's public exports alone, with
 * core's adapters registered by importing the composition root
 * `src/adapter-registry.ts`, one example apiece of three claims the
 * registry stands on.
 *
 * `src/core/adapters/registry.test.ts` and
 * `src/adapters/tracker/resolve.test.ts`
 * carry the mutation-driven grid behind each of those claims. The
 * running example that makes every one of core's kinds from ONE shared
 * context, with the list of kinds it holds, moved to
 * `src/adapter-registry.test.ts`, beside the root that registers them.
 *
 * The three claims:
 *
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
import type { AnyAdapter } from '../core/adapters/index.js';
import type { Tracker } from '../ports/index.js';

import '../adapter-registry.js';

import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { draftFixture } from '../adapters/tracker/contract.js';
import { createFakeGh } from '../adapters/tracker/github-fake.js';
import { parseLocalIssue } from '../adapters/tracker/local.js';
import { resolveTracker } from '../adapters/tracker/resolve.js';
import { CORE_ADAPTER_REGISTRY, PORT_VERSIONS } from '../core/adapters/index.js';

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
