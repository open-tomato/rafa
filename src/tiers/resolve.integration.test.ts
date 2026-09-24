/**
 * `resolveTiers` over a scratch repository read by `buildInventory`: the
 * same skill is planted in the project, rafa and user tiers on real
 * disk, and the resolver is handed the rows the inventory read. Holds
 * project → rafa → user, and that the user tier does not resolve under
 * `project,local`.
 */
import type { ClaudeSettingSource } from '../config-sections.js';
import type { TierRow, TierSettings } from './resolve.js';
import type { InventorySeams } from '../inventory/index.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { buildInventory } from '../inventory/index.js';

import { findTierItem, readItemBytes, resolveTiers } from './resolve.js';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-tiers-resolve-')));

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

const home = join(base, 'home');
const projectRoot = join(base, 'project');
const runtime = join(base, 'runtime');

const WITHOUT_USER: readonly ClaudeSettingSource[] = ['project', 'local'];
const WITH_USER: readonly ClaudeSettingSource[] = ['user', 'project', 'local'];

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A skill the checker passes; `body` makes two copies differ. */
function skill(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: Run the gates in order and read each exit code\ntags: [verification]\nstack: [agnostic]\n---\n\n# Body\n\n${body}\n`;
}

const projectPath = join(projectRoot, '.claude/skills');
const rafaPath = join(runtime, 'skills');
const userPath = join(home, '.claude/skills');

write(join(runtime, 'cli.js'), '');

/** Plants `name` in each named tier, with one body per tier. */
function plant(name: string, bodies: Readonly<Partial<Record<'project' | 'rafa' | 'user', string>>>): void {
  const roots = { project: projectPath, rafa: rafaPath, user: userPath };
  for (const tier of ['project', 'rafa', 'user'] as const) {
    const body = bodies[tier];
    if (body !== undefined) write(join(roots[tier], name, 'SKILL.md'), skill(name, body));
  }
}

// Byte-identical in all three: order alone decides.
plant('same-everywhere', { project: 'one', rafa: 'one', user: 'one' });
// Different in all three: a collision when all load.
plant('differs-everywhere', { project: 'p', rafa: 'r', user: 'u' });
// Different in rafa and user only.
plant('rafa-and-user', { rafa: 'r', user: 'u' });
// User only.
plant('user-only', { user: 'u' });

function rowsFor(settingSources: readonly ClaudeSettingSource[]): readonly TierRow[] {
  const seams: InventorySeams = {
    home,
    projectRoot,
    entry: join(runtime, 'cli.js'),
    pathDirs: [],
    settingSources,
    modules: [],
  };
  return buildInventory(seams).records;
}

function settings(settingSources: readonly ClaudeSettingSource[], pins: ReadonlyMap<string, string | false> = new Map()): TierSettings {
  return {
    settingSources,
    tiersRafa: 'on',
    tiersSkills: pins as TierSettings['tiersSkills'],
    tiersAgents: new Map(),
  };
}

describe('resolveTiers over a scratch repository', () => {
  it('serves the project copy first, then the rafa copy, then the user copy', () => {
    const rows = rowsFor(WITH_USER);
    const all = resolveTiers(rows, settings(WITH_USER), readItemBytes);
    const same = findTierItem(all, 'skill', 'same-everywhere');
    if (same?.state !== 'served') throw new Error('expected served');
    expect(same.winner.source).toBe('project');
    expect(same.decidedBy).toBe('order');
    expect(same.copies.map((row) => row.source)).toEqual(['rafa', 'user']);

    const noProject = resolveTiers(
      rows.filter((row) => row.source !== 'project'),
      settings(WITH_USER),
      readItemBytes,
    );
    const second = findTierItem(noProject, 'skill', 'same-everywhere');
    if (second?.state !== 'served') throw new Error('expected served');
    expect(second.winner.source).toBe('rafa');

    const userOnly = resolveTiers(
      rows.filter((row) => row.source === 'user'),
      settings(WITH_USER),
      readItemBytes,
    );
    const third = findTierItem(userOnly, 'skill', 'same-everywhere');
    if (third?.state !== 'served') throw new Error('expected served');
    expect(third.winner.source).toBe('user');
  });

  it('refuses differing copies in all three tiers, naming every path', () => {
    const all = resolveTiers(rowsFor(WITH_USER), settings(WITH_USER), readItemBytes);
    const item = findTierItem(all, 'skill', 'differs-everywhere');
    if (item?.state !== 'collision') throw new Error('expected collision');
    expect(item.collision.holders.map((row) => row.path)).toEqual([
      join(projectPath, 'differs-everywhere/SKILL.md'),
      join(rafaPath, 'differs-everywhere/SKILL.md'),
      join(userPath, 'differs-everywhere/SKILL.md'),
    ]);
    expect(item.collision.pinLine).toBe('tiers.skills: { differs-everywhere: project }');
  });

  it('does not resolve the user-tier skill under project,local', () => {
    const rows = rowsFor(WITHOUT_USER);
    const all = resolveTiers(rows, settings(WITHOUT_USER), readItemBytes);
    expect(all.loadedTiers).toEqual(['project', 'rafa']);

    const userOnly = findTierItem(all, 'skill', 'user-only');
    expect(userOnly?.state).toBe('unloaded');
    expect(userOnly?.holders.map((row) => row.source)).toEqual(['user']);

    // The user copy never wins and never collides: rafa serves.
    const pair = findTierItem(all, 'skill', 'rafa-and-user');
    if (pair?.state !== 'served') throw new Error('expected served');
    expect(pair.winner.source).toBe('rafa');
    expect(pair.loaded.map((row) => row.source)).toEqual(['rafa']);

    // Control: with `user` loaded the same rows collide.
    const withUser = resolveTiers(rowsFor(WITH_USER), settings(WITH_USER), readItemBytes);
    expect(findTierItem(withUser, 'skill', 'rafa-and-user')?.state).toBe('collision');
    expect(findTierItem(withUser, 'skill', 'user-only')?.state).toBe('served');
  });
});
