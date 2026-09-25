/**
 * Tests for `rafa instinct flag <id> <reason>`
 * (`src/commands/instinct/flag.ts`): the flag the `local` adapter
 * writes, the lesson it keeps out of the next bundle, and every refusal.
 *
 * Every dispatched case plants a project and a home of its own under a
 * temporary directory of this file's own, and dispatches the command
 * in-process with streams, an environment and a working directory of
 * its own (`src/tests/cli-capture.ts`), so nothing reads the real
 * `~/.rafa/instincts`.
 *
 * ## The controls
 *
 * The refusal of an unknown id runs in a tree holding a record the same
 * command flags with exit 0, so a command that refused everything could
 * not pass it. The user-scope refusal runs beside a project record it
 * flags in the same tree. That a flag keeps the lesson out of a bundle
 * is read off the same adapter's `pullBlessed` before the flag, where
 * the lesson is blessed, and after it, where it is not.
 */
import type { AnyAdapter } from '../../adapters/registry.js';
import type { BlessedBundle, Learning, MergeResult } from '../../ports/index.js';

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createLocalLearning, localInstinctsDir } from '../../adapters/learning/local.js';
import { CORE_ADAPTER_REGISTRY, PORT_VERSIONS } from '../../adapters/registry.js';
import { projectConfigText } from '../../project/scaffold.js';
import { ACTION_HEADING, CAUSE_HEADING } from '../../schema/instinct.js';
import { dispatchInProject, eventsOf, plantProjectConfig } from '../../tests/cli-capture.js';

import { blankReasonMessage, createInstinctFlagCommand, refusedFlagMessage } from './flag.js';

/** The subject the dispatched cases route through. */
const SUBJECTS = [{ name: 'instinct', summary: 'flag one record the project holds' }];

/** A temporary directory of this file's own, its path resolved through every link. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-instinct-flag-')));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A record the `local` adapter holds, at a confidence the default floor blesses. */
function recordText(id: string, scope: string, trigger: string): string {
  return [
    '---',
    `id: ${id}`,
    `trigger: ${trigger}`,
    'kind: gotcha',
    'domain: workflow',
    'confidence: 0.6',
    'usage_count: 1',
    'signal: loud',
    `scope: ${scope}`,
    'source: loop-observed',
    'created_at: 2026-09-11T10:00:00Z',
    'updated_at: 2026-09-11T10:00:00Z',
    '---',
    '',
    ACTION_HEADING,
    'Run `bun install` before the first test.',
    '',
    CAUSE_HEADING,
    'Worktree creation copies the tree and not its packages.',
    '',
  ].join('\n');
}

/** What one case plants: a project and a home. */
interface Planted {
  /** The project root, holding `.rafa/config.yaml`. */
  readonly root: string;
  /** The home the user scope resolves under. */
  readonly home: string;
}

/** Plants one case's tree, the project config written with `config`. */
function plant(files: Readonly<Record<string, string>>, config: string = projectConfigText()): Planted {
  planted += 1;
  const scope = join(tempBase, `case-${String(planted)}`);
  const root = join(scope, 'project');
  const home = join(scope, 'home');
  plantProjectConfig(root, config);
  mkdirSync(home, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    const path = join(scope, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
  }
  return { root, home };
}

/** Dispatches `words` over the command made with `adapters` registered, with the planted tree's seams. */
async function run(words: readonly string[], tree: Planted, adapters: readonly AnyAdapter[] = []) {
  const registry = adapters.reduce((held, adapter) => held.register(adapter), CORE_ADAPTER_REGISTRY);
  const command = createInstinctFlagCommand({ registry });
  return dispatchInProject(words, SUBJECTS, [command], { root: tree.root, home: tree.home }, { PATH: '' });
}

/** The project's flags file. */
function flagsPath(tree: Planted): string {
  return join(localInstinctsDir(tree.root), 'flags.ndjson');
}

/** Every line of the project's flags file, parsed. */
function flagLines(tree: Planted): Record<string, unknown>[] {
  return readFileSync(flagsPath(tree), 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** The ids the project's `local` adapter blesses now. */
async function blessedIds(tree: Planted): Promise<string[]> {
  const learning = createLocalLearning({ instinctsDir: localInstinctsDir(tree.root), home: tree.home, minConfidence: 0.5 });
  const bundle = await learning.pullBlessed();
  return bundle.instincts.map((record) => record.id);
}

/** A learning adapter under `kind` recording every flag it is handed. */
function recordingAdapter(kind: string, calls: [string, string][]): AnyAdapter {
  const learning: Learning = {
    push: (): Promise<MergeResult> => Promise.reject(new Error('push is not called')),
    pullBlessed: (): Promise<BlessedBundle> => Promise.reject(new Error('pullBlessed is not called')),
    flag: (id, reason) => {
      calls.push([id, reason]);
      return Promise.resolve();
    },
  };
  return { port: 'learning', kind, portVersion: PORT_VERSIONS.learning, create: () => learning };
}

describe('a flag the local adapter writes', () => {
  it('appends one line naming the id and the reason, and leaves the record file as it was', async () => {
    const tree = plant({ 'project/.rafa/instincts/bun-install.md': recordText('bun-install', 'project', 'when testing') });
    const record = join(localInstinctsDir(tree.root), 'bun-install.md');
    const before = readFileSync(record, 'utf8');

    const answered = await run(['instinct', 'flag', 'bun-install', 'bun install runs on fork now'], tree);

    expect(answered.exitCode).toBe(0);
    expect(answered.stderr).toBe('');
    expect(answered.stdout).toContain('🚩 Flagged bun-install: bun install runs on fork now');
    expect(answered.stdout).toContain('The `local` learning adapter leaves it out of every later bundle.');
    expect(flagLines(tree)).toEqual([
      { id: 'bun-install', reason: 'bun install runs on fork now', flagged_at: expect.any(String) as unknown },
    ]);
    expect(readFileSync(record, 'utf8')).toBe(before);
  });

  it('keeps the flagged lesson out of the next bundle, which blessed it before the flag', async () => {
    const tree = plant({
      'project/.rafa/instincts/bun-install.md': recordText('bun-install', 'project', 'when testing'),
      'project/.rafa/instincts/gate-order.md': recordText('gate-order', 'project', 'when verifying'),
    });
    const before = await blessedIds(tree);

    const answered = await run(['instinct', 'flag', 'bun-install', 'stale'], tree);

    expect(before.sort()).toEqual(['bun-install', 'gate-order']);
    expect(answered.exitCode).toBe(0);
    expect(await blessedIds(tree)).toEqual(['gate-order']);
  });

  it('gives the id, the reason and the adapter kind as the data of the terminal result event', async () => {
    const tree = plant({ 'project/.rafa/instincts/bun-install.md': recordText('bun-install', 'project', 'when testing') });

    const answered = await run(['instinct', 'flag', 'bun-install', 'stale', '--output=json'], tree);
    const result = eventsOf(answered.stdout).find((event) => event.type === 'result');

    expect(answered.exitCode).toBe(0);
    expect(result?.data).toEqual({ id: 'bun-install', reason: 'stale', adapter: 'local' });
  });
});

describe('the adapter learning.adapter names', () => {
  it('hands the id and the reason to the kind the project config selects', async () => {
    const calls: [string, string][] = [];
    const tree = plant({}, `${projectConfigText()}\nlearning:\n  adapter: recording\n`);

    const answered = await run(['instinct', 'flag', 'any-id', 'wrong'], tree, [recordingAdapter('recording', calls)]);

    expect(answered.exitCode).toBe(0);
    expect(answered.stdout).toContain('The `recording` learning adapter leaves it out of every later bundle.');
    expect(calls).toEqual([['any-id', 'wrong']]);
    expect(existsSync(flagsPath(tree))).toBe(false);
  });

  it('refuses a kind no registry holds, naming it, and writes nothing', async () => {
    const tree = plant(
      { 'project/.rafa/instincts/bun-install.md': recordText('bun-install', 'project', 'when testing') },
      `${projectConfigText()}\nlearning:\n  adapter: remote\n`,
    );

    const answered = await run(['instinct', 'flag', 'bun-install', 'stale'], tree);

    expect(answered.exitCode).toBe(1);
    expect(answered.stderr).toContain('the `remote` learning adapter cannot be made');
    expect(existsSync(flagsPath(tree))).toBe(false);
  });
});

describe('the refusals', () => {
  it('refuses an id no held record carries, beside a held id it flags, and writes no line for it', async () => {
    const tree = plant({ 'project/.rafa/instincts/bun-install.md': recordText('bun-install', 'project', 'when testing') });

    const refused = await run(['instinct', 'flag', 'gate-order', 'stale'], tree);
    const flagged = await run(['instinct', 'flag', 'bun-install', 'stale'], tree);

    expect(refused.exitCode).toBe(1);
    expect(refused.stdout).toBe('');
    expect(refused.stderr).toContain('the `local` learning adapter did not flag "gate-order"');
    expect(refused.stderr).toContain('no instinct "gate-order" is held under');
    expect(refused.stderr).toContain('Run `rafa instinct list` to see the ids the project holds.');
    expect(flagged.exitCode).toBe(0);
    expect(flagLines(tree).map((line) => line['id'])).toEqual(['bun-install']);
  });

  it('refuses an id only the user scope holds, and writes nothing under either scope', async () => {
    const tree = plant({
      'project/.rafa/instincts/bun-install.md': recordText('bun-install', 'project', 'when testing'),
      'home/.rafa/instincts/user-only.md': recordText('user-only', 'user', 'when releasing'),
    });

    const answered = await run(['instinct', 'flag', 'user-only', 'stale'], tree);

    expect(answered.exitCode).toBe(1);
    expect(answered.stderr).toContain('did not flag "user-only"');
    expect(existsSync(flagsPath(tree))).toBe(false);
    expect(readdirSync(join(tree.home, '.rafa', 'instincts'))).toEqual(['user-only.md']);
  });

  it('refuses a blank reason before any adapter is made', async () => {
    const calls: [string, string][] = [];
    const tree = plant({}, `${projectConfigText()}\nlearning:\n  adapter: recording\n`);

    const answered = await run(['instinct', 'flag', 'bun-install', '  '], tree, [recordingAdapter('recording', calls)]);

    expect(answered.exitCode).toBe(1);
    expect(answered.stderr).toContain(blankReasonMessage('bun-install'));
    expect(calls).toEqual([]);
  });

  it('refuses a line naming one word and one naming three, with the usage', async () => {
    const tree = plant({});

    const one = await run(['instinct', 'flag', 'bun-install'], tree);
    const three = await run(['instinct', 'flag', 'bun-install', 'too', 'many'], tree);

    expect(one.exitCode).toBe(1);
    expect(one.stderr).toContain('Expected two arguments, got 1: bun-install');
    expect(one.stderr).toContain('Usage: rafa instinct flag <id> <reason>');
    expect(three.exitCode).toBe(1);
    expect(three.stderr).toContain('Expected two arguments, got 3');
  });

  it('writes the adapter\'s refusal after the id and the kind', () => {
    expect(refusedFlagMessage('x', 'local', 'no instinct "x" is held'))
      .toBe('❌ rafa instinct flag: the `local` learning adapter did not flag "x": no instinct "x" is held\n'
        + 'Run `rafa instinct list` to see the ids the project holds.');
  });
});
