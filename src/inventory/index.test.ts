/**
 * Tests for `buildInventory`.
 *
 * One world is planted under this file's temporary directory and every
 * case reads it: a project, a rafa entry, a home, a plugins record with
 * one readable plugin and one whose install is gone, and one loaded
 * add-on. It holds
 *
 *   - a shadowed item: skill `gate-order` in the project and the home,
 *     and agent `reviewer` in rafa and the home;
 *   - a user-only item: skill `user-only`, and the add-on's `addon-only`
 *     beside it;
 *   - an item switched `off`: project skill `switched`, turned off by
 *     `skillOverrides` in the project settings, with a home skill of the
 *     same name behind it;
 *   - an unreadable source: plugin `gone`, whose `installPath` is not
 *     there.
 *
 * Visibility is read under two `settingSources` from the same world,
 * one with `user` and one without, so no `visibleToLoop: false` passes
 * only because everything reads false, and no `true` only because
 * everything reads true.
 */
import type { OverrideReading } from './disabled.js';
import type { InventorySeams } from './index.js';
import type { InventoryRecord } from './record.js';
import type { ClaudeSettingSource } from '../config-sections.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { INSTALLED_PLUGINS_PATH, PLUGINS_RECORD_VERSION } from './plugins.js';

import { applyPrecedence, buildInventory, SOURCE_ORDER, sourceRank, sourceVisibleToLoop } from './index.js';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-inventory-index-')));

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

const home = join(base, 'home');
const projectRoot = join(base, 'project');
const runtime = join(base, 'runtime');
const pluginDir = join(base, 'plugins-cache', 'alpha', '1.0.0');
const gonePluginDir = join(base, 'plugins-cache', 'gone', '1.0.0');
const addonDir = join(base, 'modules', 'linear');

/** `loop.settingSources` without `user`: the config default. */
const WITHOUT_USER: readonly ClaudeSettingSource[] = ['project', 'local'];
const WITH_USER: readonly ClaudeSettingSource[] = ['user', 'project', 'local'];

/** Writes `text` at `path`, making its directories. */
function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A skill the checker passes. */
function skill(name: string): string {
  return `---\nname: ${name}\ndescription: Run the gates in order and read each exit code\ntags: [verification]\nstack: [agnostic]\n---\n\n# Body\n\nRead each exit code.\n`;
}

/** An agent definition keyed by `name`. */
function agent(name: string): string {
  return `---\nname: ${name}\ndescription: Reviews one diff\n---\n\nReview the diff.\n`;
}

// The project.
write(join(projectRoot, '.claude/skills/gate-order/SKILL.md'), skill('gate-order'));
write(join(projectRoot, '.claude/skills/switched/SKILL.md'), skill('switched'));
write(join(projectRoot, '.claude/skills/project-only/SKILL.md'), skill('project-only'));
write(join(projectRoot, '.claude/settings.json'), JSON.stringify({ skillOverrides: { switched: 'off' } }));

// rafa, beside its entry.
write(join(runtime, 'cli.js'), '');
write(join(runtime, 'bundled/skills/rafa-only/SKILL.md'), skill('rafa-only'));
write(join(runtime, 'bundled/agents/reviewer.md'), agent('reviewer'));

// The home.
write(join(home, '.claude/skills/gate-order/SKILL.md'), skill('gate-order'));
write(join(home, '.claude/skills/switched/SKILL.md'), skill('switched'));
write(join(home, '.claude/skills/user-only/SKILL.md'), skill('user-only'));
write(join(home, '.claude/agents/reviewer.md'), agent('reviewer'));

// One plugin that reads, one whose install is gone.
write(join(pluginDir, 'skills/helper/SKILL.md'), skill('helper'));
write(join(home, INSTALLED_PLUGINS_PATH), JSON.stringify({
  version: PLUGINS_RECORD_VERSION,
  plugins: {
    'alpha@market': [{ scope: 'user', installPath: pluginDir, version: '1.0.0' }],
    'gone@market': [{ scope: 'user', installPath: gonePluginDir, version: '1.0.0' }],
  },
}));

// One loaded add-on.
write(join(addonDir, 'package.json'), JSON.stringify({
  name: 'linear',
  version: '1.0.0',
  rafa: {
    manifestVersion: 1,
    types: ['skills'],
    provides: { skills: './skills' },
    requires: { rafa: '>=0.0.1', ports: {} },
  },
}));
write(join(addonDir, 'skills/user-only/SKILL.md'), skill('user-only'));
write(join(addonDir, 'skills/addon-only/SKILL.md'), skill('addon-only'));

/** The planted world's seams under `settingSources`. */
function seams(settingSources: readonly ClaudeSettingSource[]): InventorySeams {
  return {
    home,
    projectRoot,
    entry: join(runtime, 'cli.js'),
    pathDirs: [],
    settingSources,
    modules: [{ name: 'linear', directory: addonDir, state: 'loaded' }],
  };
}

/** A record as `[kind, name, source, state, visibleToLoop]`, the fields this file decides. */
function decided(record: InventoryRecord): readonly [string, string, string, string, boolean] {
  return [record.kind, record.name, record.source, record.state, record.visibleToLoop];
}

describe('buildInventory over the planted world', () => {
  it('reads nothing outside the base it was handed', () => {
    const inventory = buildInventory(seams(WITH_USER));

    // Control: rows were read, so the loop below is not vacuous.
    expect(inventory.records.length).toBe(12);
    for (const record of inventory.records) expect(record.path.startsWith(base)).toBe(true);
  });

  it('decides every row\'s state and visibility, with user in settingSources', () => {
    const inventory = buildInventory(seams(WITH_USER));

    expect(inventory.records.map(decided)).toEqual([
      ['skill', 'addon-only', 'addon:linear', 'enabled', false],
      ['skill', 'alpha:helper', 'plugin:alpha', 'enabled', true],
      ['skill', 'gate-order', 'project', 'enabled', true],
      ['skill', 'gate-order', 'user', 'shadowed-by:project', false],
      ['skill', 'project-only', 'project', 'enabled', true],
      ['skill', 'rafa-only', 'rafa', 'enabled', false],
      ['skill', 'switched', 'project', 'disabled:skillOverrides', false],
      ['skill', 'switched', 'user', 'shadowed-by:project', false],
      ['skill', 'user-only', 'user', 'enabled', true],
      ['skill', 'user-only', 'addon:linear', 'shadowed-by:user', false],
      ['agent', 'reviewer', 'rafa', 'enabled', false],
      // The plan's rule: shadowed is never visible, although a session,
      // which never sees the rafa tier, would load this one.
      ['agent', 'reviewer', 'user', 'shadowed-by:rafa', false],
    ]);
  });

  it('hides user and plugin rows from the loop without user in settingSources', () => {
    const records = buildInventory(seams(WITHOUT_USER)).records;
    const visible = records.filter((record) => record.visibleToLoop).map((record) => record.name);

    // Control: project rows stay visible, so this is not a world that reads all false.
    expect(visible).toEqual(['gate-order', 'project-only']);
    // The states do not move with settingSources; only visibility does.
    expect(records.map((record) => record.state))
      .toEqual(buildInventory(seams(WITH_USER)).records.map((record) => record.state));
  });

  it('reads the switched skill as the enabled holder once its override is gone', () => {
    const switched = buildInventory(seams(WITH_USER)).records.filter((record) => record.name === 'switched');
    const noOverrides: OverrideReading = { scopes: [], warnings: [] };

    // Control for the `off` row above: the same two rows, no settings, read enabled and shadowed.
    expect(applyPrecedence(switched, noOverrides, WITH_USER).map(decided)).toEqual([
      ['skill', 'switched', 'project', 'enabled', true],
      ['skill', 'switched', 'user', 'shadowed-by:project', false],
    ]);
  });

  it('keeps an unreadable plugin as one warning row beside the plugin that reads', () => {
    const inventory = buildInventory(seams(WITH_USER));

    expect(inventory.warnings).toEqual([
      { source: 'plugin:gone', path: gonePluginDir, reason: 'installPath is not a directory' },
    ]);
    // Control: the readable plugin's row is still there.
    expect(inventory.records.filter((record) => record.source.startsWith('plugin:')).map((record) => record.name))
      .toEqual(['alpha:helper']);
    expect(inventory.overrideWarnings).toEqual([]);
  });

  it('keeps every tier listing, absent ones included', () => {
    const listings = buildInventory(seams(WITH_USER)).trees
      .map((listing) => [listing.kind, listing.source, listing.exists]);

    expect(listings).toEqual([
      ['skill', 'project', true],
      ['skill', 'rafa', true],
      ['skill', 'user', true],
      ['agent', 'project', false],
      ['agent', 'rafa', true],
      ['agent', 'user', true],
    ]);
  });
});

describe('precedence and visibility, rule by rule', () => {
  it('ranks project, rafa, user, add-ons, then plugins', () => {
    expect(SOURCE_ORDER).toEqual(['project', 'rafa', 'user', 'addon', 'plugin']);
    expect(['plugin:a', 'addon:z', 'user', 'rafa', 'project'].map((source) => sourceRank(source as never)))
      .toEqual([4, 3, 2, 1, 0]);
  });

  it('shows the loop project rows always, user and plugin rows only under user, rafa and add-ons never', () => {
    const sources = ['project', 'user', 'plugin:alpha', 'rafa', 'addon:linear'] as const;

    expect(sources.map((source) => sourceVisibleToLoop(source, WITH_USER))).toEqual([true, true, true, false, false]);
    expect(sources.map((source) => sourceVisibleToLoop(source, WITHOUT_USER))).toEqual([true, false, false, false, false]);
  });
});
