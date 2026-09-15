/**
 * Tests for the degradation chain: the order it tries kinds in, what
 * counts as a failed attempt, what it logs, and the reason it hands the
 * tracker it lands on.
 *
 * Most cases resolve through a registry of stub tracker adapters, each
 * recording the kind and the `fallbackReason` of every context it was
 * made with. The reason handed over is read off that record rather than
 * off the resolution, so a chain answering the right reason while making
 * the tracker with another fails. Every reason and log line is spelled
 * here in full.
 *
 * Three cases go through `CORE_ADAPTER_REGISTRY`, which is used when no
 * registry is named. In the first, a `github` tracker failing its
 * preflight lands on `local`, and the reason is read off the issue file
 * `local` wrote under a fresh temporary root. In the third, a config
 * whose default is `local` must leave a file recording null: the control
 * showing the recorded reason is the one the chain handed over. Each
 * case hands `github` the recorded fake as its `gh` runner and holds the
 * fake's calls to the exact commands it was handed, none in the third,
 * and the adapter runs every `gh` command through that runner.
 *
 * The case with no `log` sets a `text` output over a stream of its own as
 * the active output, and puts the default back after, since bun runs
 * every test file in one process.
 *
 * Eighteen mutations of `resolve.ts` were driven against this file on
 * 2026-09-14, one run each, with the file at 19 pass before and after
 * and `resolve.ts` restored byte-identical (sha256). Every one reddened
 * at least one case. The reason handed over made null reddened six,
 * among them the core registry case reading the issue file. Eight
 * reddened one case alone: the context spread after the reason, a
 * repeated kind tried again, a rejecting preflight not caught, the
 * default log made silent, `degraded` always false, the resolution not
 * frozen, the refusal naming the last failure only, and a rejecting
 * preflight's reason left unprefixed.
 */
import type { PreflightResult, Tracker } from '../../ports/index.js';
import type { AnyAdapter } from '../registry.js';

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../output/active.js';
import { createTextOutput } from '../output/text.js';
import { createAdapterRegistry } from '../registry.js';

import { draftFixture } from './contract.js';
import { createFakeGh } from './github-fake.js';
import { parseLocalIssue } from './local.js';
import { resolveTracker } from './resolve.js';

/** What `gh auth status` writes with no hosts, as the fake records it. */
const NOT_LOGGED_IN = 'You are not logged into any GitHub hosts. To log in, run: gh auth login';

/** A preflight that answers ok. */
const OK: PreflightResult = { ok: true };

/** How a stub adapter behaves when it is made and preflighted. */
interface StubBehaviour {
  /** What the preflight answers, or an `Error` it rejects with. */
  readonly preflight?: PreflightResult | Error;
  /** When set, making the tracker throws this value instead. */
  readonly throws?: { readonly value: unknown };
}

/** One tracker a stub adapter made: its kind and the reason its context carried. */
interface Made {
  readonly kind: string;
  readonly fallbackReason: string | null | undefined;
}

/** A tracker of `kind` whose preflight behaves as named. Nothing but `preflight` is called. */
function stubTracker(kind: string, preflight: PreflightResult | Error): Tracker {
  return {
    kind,
    capabilities: () => ({ projects: false, customFields: false, issueTypes: false }),
    preflight: async () => {
      if (preflight instanceof Error) throw preflight;
      return preflight;
    },
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
}

/**
 * A registry of stub tracker adapters, one per entry, and the record of
 * every tracker they made, in the order made.
 */
function stubRegistry(behaviours: Readonly<Record<string, StubBehaviour>>): {
  registry: ReturnType<typeof createAdapterRegistry>;
  made: Made[];
} {
  const made: Made[] = [];
  const adapters = Object.entries(behaviours).map(([kind, behaviour]): AnyAdapter => ({
    port: 'tracker',
    kind,
    portVersion: 1,
    create: (context) => {
      made.push({ kind, fallbackReason: context.fallbackReason });
      if (behaviour.throws !== undefined) throw behaviour.throws.value;
      return stubTracker(kind, behaviour.preflight ?? OK);
    },
  }));
  return { registry: createAdapterRegistry(adapters), made };
}

/** A log that keeps every line handed to it. */
function recordingLog(): { log: (message: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { log: (message) => lines.push(message), lines };
}

let tempDir = '';
let planted = 0;

/** A repo root of its own, not yet on disk. */
function freshRoot(name: string): string {
  planted += 1;
  return join(tempDir, `${planted}-${name}`);
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'rafa-tracker-chain-'));
});

afterAll(() => {
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

afterEach(() => {
  setActiveOutput(null);
});

describe('resolveTracker', () => {
  it('lands on tracker.default when its preflight succeeds, handing it no reason and logging nothing', async () => {
    const { registry, made } = stubRegistry({ github: {}, local: {} });
    const { log, lines } = recordingLog();

    const resolution = await resolveTracker({
      config: { trackerDefault: 'github', trackerFallback: ['local'] },
      context: { repoRoot: '/nonexistent' },
      registry,
      log,
    });

    expect(resolution.tracker.kind).toBe('github');
    expect(resolution.degraded).toBe(false);
    expect(resolution.fallbackReason).toBeNull();
    expect(resolution.attempts).toEqual([{ kind: 'github', ok: true, reason: null }]);
    expect(made).toEqual([{ kind: 'github', fallbackReason: null }]);
    expect(lines).toEqual([]);
  });

  it('falls through to the next kind when tracker.default fails preflight, logging the failure', async () => {
    const { registry, made } = stubRegistry({
      github: { preflight: { ok: false, reason: 'gh auth status: not logged in' } },
      local: {},
    });
    const { log, lines } = recordingLog();

    const resolution = await resolveTracker({
      config: { trackerDefault: 'github', trackerFallback: ['local'] },
      context: { repoRoot: '/nonexistent' },
      registry,
      log,
    });

    expect(resolution.tracker.kind).toBe('local');
    expect(resolution.degraded).toBe(true);
    expect(resolution.fallbackReason).toBe('github: gh auth status: not logged in');
    expect(lines).toEqual(['tracker chain: github unavailable: gh auth status: not logged in']);
    expect(made).toEqual([
      { kind: 'github', fallbackReason: null },
      { kind: 'local', fallbackReason: 'github: gh auth status: not logged in' },
    ]);
  });

  it('joins every failure in order and hands each tracker the failures before it', async () => {
    const { registry, made } = stubRegistry({
      github: { preflight: { ok: false, reason: 'network unreachable' } },
      linear: { preflight: { ok: false, reason: 'LINEAR_API_KEY is not set' } },
      local: {},
    });
    const { log, lines } = recordingLog();

    const resolution = await resolveTracker({
      config: { trackerDefault: 'github', trackerFallback: ['linear', 'local'] },
      context: { repoRoot: '/nonexistent' },
      registry,
      log,
    });

    const joined = 'github: network unreachable; linear: LINEAR_API_KEY is not set';
    expect(resolution.tracker.kind).toBe('local');
    expect(resolution.fallbackReason).toBe(joined);
    expect(made).toEqual([
      { kind: 'github', fallbackReason: null },
      { kind: 'linear', fallbackReason: 'github: network unreachable' },
      { kind: 'local', fallbackReason: joined },
    ]);
    expect(resolution.attempts).toEqual([
      { kind: 'github', ok: false, reason: 'network unreachable' },
      { kind: 'linear', ok: false, reason: 'LINEAR_API_KEY is not set' },
      { kind: 'local', ok: true, reason: null },
    ]);
    expect(lines).toEqual([
      'tracker chain: github unavailable: network unreachable',
      'tracker chain: linear unavailable: LINEAR_API_KEY is not set',
    ]);
  });

  it('tries tracker.fallback kinds in the order written, making none after the one it lands on', async () => {
    const { registry, made } = stubRegistry({
      local: {},
      github: {},
      linear: {},
      obsidian: { preflight: { ok: false, reason: 'vault missing' } },
    });

    const resolution = await resolveTracker({
      config: { trackerDefault: 'obsidian', trackerFallback: ['linear', 'local', 'github'] },
      context: { repoRoot: '/nonexistent' },
      registry,
      log: () => {},
    });

    expect(resolution.tracker.kind).toBe('linear');
    expect(made.map((entry) => entry.kind)).toEqual(['obsidian', 'linear']);
  });

  it('counts a kind no adapter is registered for as a failed attempt, naming the kinds that are', async () => {
    const { registry } = stubRegistry({ local: {}, github: {} });
    const { log, lines } = recordingLog();

    const resolution = await resolveTracker({
      config: { trackerDefault: 'linear', trackerFallback: ['constructor', 'local'] },
      context: { repoRoot: '/nonexistent' },
      registry,
      log,
    });

    const linear = 'adapter registry: no tracker adapter is registered as "linear"; registered: local, github';
    const named = 'adapter registry: no tracker adapter is registered as "constructor"; registered: local, github';
    expect(resolution.tracker.kind).toBe('local');
    expect(resolution.fallbackReason).toBe(`linear: ${linear}; constructor: ${named}`);
    expect(lines).toEqual([
      `tracker chain: linear unavailable: ${linear}`,
      `tracker chain: constructor unavailable: ${named}`,
    ]);
  });

  const thrownValues: readonly (readonly [string, unknown, string])[] = [
    ['an Error', new Error('client construction blew up'), 'client construction blew up'],
    ['a string', 'boom', 'boom'],
    ['null', null, 'null'],
  ];
  for (const [title, value, reason] of thrownValues) {
    it(`counts a tracker whose making throws ${title} as a failed attempt`, async () => {
      const { registry, made } = stubRegistry({ github: { throws: { value } }, local: {} });
      const { log, lines } = recordingLog();

      const resolution = await resolveTracker({
        config: { trackerDefault: 'github', trackerFallback: ['local'] },
        context: { repoRoot: '/nonexistent' },
        registry,
        log,
      });

      expect(resolution.tracker.kind).toBe('local');
      expect(resolution.attempts[0]).toEqual({ kind: 'github', ok: false, reason });
      expect(resolution.fallbackReason).toBe(`github: ${reason}`);
      expect(lines).toEqual([`tracker chain: github unavailable: ${reason}`]);
      expect(made.at(-1)).toEqual({ kind: 'local', fallbackReason: `github: ${reason}` });
    });
  }

  it('counts a preflight that rejects as a failed attempt, though the port says it never does', async () => {
    const { registry } = stubRegistry({
      obsidian: { preflight: new Error('socket hang up') },
      local: {},
    });
    const { log, lines } = recordingLog();

    const resolution = await resolveTracker({
      config: { trackerDefault: 'obsidian', trackerFallback: ['local'] },
      context: { repoRoot: '/nonexistent' },
      registry,
      log,
    });

    expect(resolution.tracker.kind).toBe('local');
    expect(resolution.fallbackReason).toBe('obsidian: preflight rejected: socket hang up');
    expect(lines).toEqual(['tracker chain: obsidian unavailable: preflight rejected: socket hang up']);
  });

  it('tries a kind named twice once, at the first place it is named', async () => {
    const { registry, made } = stubRegistry({
      github: { preflight: { ok: false, reason: 'down' } },
      local: {},
    });
    const { log, lines } = recordingLog();

    const resolution = await resolveTracker({
      config: { trackerDefault: 'github', trackerFallback: ['github', 'local', 'github'] },
      context: { repoRoot: '/nonexistent' },
      registry,
      log,
    });

    expect(made.map((entry) => entry.kind)).toEqual(['github', 'local']);
    expect(resolution.fallbackReason).toBe('github: down');
    expect(lines).toEqual(['tracker chain: github unavailable: down']);
  });

  it('lands on tracker.default when tracker.fallback repeats it, as the config default does for local', async () => {
    const { registry, made } = stubRegistry({ local: {} });

    const resolution = await resolveTracker({
      config: { trackerDefault: 'local', trackerFallback: ['local'] },
      context: { repoRoot: '/nonexistent' },
      registry,
      log: () => {},
    });

    expect(resolution.degraded).toBe(false);
    expect(made).toEqual([{ kind: 'local', fallbackReason: null }]);
  });

  it('rejects naming every failure when no kind lands, after logging each', async () => {
    const { registry } = stubRegistry({
      github: { preflight: { ok: false, reason: 'a' } },
      local: { preflight: { ok: false, reason: 'b' } },
    });
    const { log, lines } = recordingLog();

    const resolving = resolveTracker({
      config: { trackerDefault: 'github', trackerFallback: ['local'] },
      context: { repoRoot: '/nonexistent' },
      registry,
      log,
    });

    await expect(resolving).rejects.toThrow('tracker chain: no tracker available; tried github: a; local: b');
    expect(lines).toEqual([
      'tracker chain: github unavailable: a',
      'tracker chain: local unavailable: b',
    ]);
  });

  it('rejects when tracker.fallback is empty and tracker.default fails', async () => {
    const { registry, made } = stubRegistry({ github: { preflight: { ok: false, reason: 'down' } }, local: {} });

    const resolving = resolveTracker({
      config: { trackerDefault: 'github', trackerFallback: [] },
      context: { repoRoot: '/nonexistent' },
      registry,
      log: () => {},
    });

    await expect(resolving).rejects.toThrow('tracker chain: no tracker available; tried github: down');
    expect(made.map((entry) => entry.kind)).toEqual(['github']);
  });

  it('reports through the active output when no log is named', async () => {
    const { registry } = stubRegistry({ github: { preflight: { ok: false, reason: 'down' } }, local: {} });
    const chunks: string[] = [];
    setActiveOutput(createTextOutput({
      verbosity: 0,
      stream: {
        write: (chunk) => {
          chunks.push(chunk);
          return true;
        },
      },
    }));

    await resolveTracker({
      config: { trackerDefault: 'github', trackerFallback: ['local'] },
      context: { repoRoot: '/nonexistent' },
      registry,
    });

    expect(chunks.join('')).toBe('warn: tracker chain: github unavailable: down\n');
  });

  it('answers a frozen resolution with frozen attempts', async () => {
    const { registry } = stubRegistry({ github: { preflight: { ok: false, reason: 'down' } }, local: {} });

    const resolution = await resolveTracker({
      config: { trackerDefault: 'github', trackerFallback: ['local'] },
      context: { repoRoot: '/nonexistent' },
      registry,
      log: () => {},
    });

    expect(Object.isFrozen(resolution)).toBe(true);
    expect(Object.isFrozen(resolution.attempts)).toBe(true);
    expect(resolution.attempts.every((entry) => Object.isFrozen(entry))).toBe(true);
  });

  it('keeps a reason the context names from reaching any tracker', async () => {
    const { registry, made } = stubRegistry({ local: {} });
    const context = { repoRoot: '/nonexistent', fallbackReason: 'planted' };

    await resolveTracker({
      config: { trackerDefault: 'local', trackerFallback: [] },
      context,
      registry,
      log: () => {},
    });

    expect(made).toEqual([{ kind: 'local', fallbackReason: null }]);
  });
});

describe('resolveTracker through the core registry', () => {
  it('lands a github failing preflight on local, whose issue records the reason', async () => {
    const root = freshRoot('fell-back');
    const fake = createFakeGh({ authOk: false });
    const { log, lines } = recordingLog();

    const resolution = await resolveTracker({
      config: { trackerDefault: 'github', trackerFallback: ['local'] },
      context: { repoRoot: root, gh: fake.run },
      log,
    });
    await resolution.tracker.create(draftFixture());

    const reason = `github: gh auth status: ${NOT_LOGGED_IN}`;
    const issuesDir = join(root, '.rafa', 'issues');
    expect(fake.calls()).toEqual([['auth', 'status']]);
    expect(resolution.tracker.kind).toBe('local');
    expect(resolution.fallbackReason).toBe(reason);
    expect(lines).toEqual([`tracker chain: github unavailable: gh auth status: ${NOT_LOGGED_IN}`]);
    expect(issuesDir.startsWith(tempDir)).toBe(true);
    expect(readdirSync(issuesDir)).toEqual(['1.md']);
    expect(parseLocalIssue(readFileSync(join(issuesDir, '1.md'), 'utf8')).fallbackReason).toBe(reason);
  });

  it('lands on github when its preflight succeeds, making no local tracker and writing nothing', async () => {
    const root = freshRoot('landed-first');
    const fake = createFakeGh();

    const resolution = await resolveTracker({
      config: { trackerDefault: 'github', trackerFallback: ['local'] },
      context: { repoRoot: root, gh: fake.run },
      log: () => {},
    });

    expect(resolution.tracker.kind).toBe('github');
    expect(resolution.fallbackReason).toBeNull();
    expect(fake.calls()).toEqual([['auth', 'status'], ['repo', 'view', '--json', 'nameWithOwner']]);
    expect(existsSync(root)).toBe(false);
  });

  it('records a null reason on an issue when local is tracker.default, the control for the case above', async () => {
    const root = freshRoot('local-first');
    const fake = createFakeGh({ authOk: false });

    const resolution = await resolveTracker({
      config: { trackerDefault: 'local', trackerFallback: ['github'] },
      context: { repoRoot: root, gh: fake.run },
      log: () => {},
    });
    await resolution.tracker.create(draftFixture());

    const issuesDir = join(root, '.rafa', 'issues');
    expect(resolution.tracker.kind).toBe('local');
    expect(fake.calls()).toEqual([]);
    expect(parseLocalIssue(readFileSync(join(issuesDir, '1.md'), 'utf8')).fallbackReason).toBeNull();
  });
});
