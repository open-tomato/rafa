/**
 * Tests for the Settings reading of `rafa doctor --deep`.
 *
 * One world is planted under this file's temporary directory and every
 * case reads it, under two `settingSources` so no "hidden" passes only
 * because everything reads hidden and no "not hidden" only because
 * nothing does. The world holds one item per hidden reason:
 *
 *   - `ts-symbols`, a user-only skill, and `reviewer`, a user agent:
 *     hidden while `user` is left out, shown once it is named;
 *   - `helper` from plugin `alpha`: hidden the same way;
 *   - skill `gate-order` in the project and the home: the home one is
 *     shadowed under either sources;
 *   - `switched`, a project skill `skillOverrides` sets `off`, and
 *     `quiet`, one whose frontmatter sets `disable-model-invocation`;
 *   - `rafa-only` beside the entry and `addon-only` in a loaded add-on,
 *     which the inventory reads as hidden and this section leaves out;
 *   - MCP servers: `proj-srv` (loads), `off-srv` (`disabledMcpServers`),
 *     `rejected-srv` (`disabledMcpjsonServers` in the project settings),
 *     `shared` in both `local` and `project` (the project one shadowed),
 *     and `user-srv` in the user scope.
 *
 * `project-only` and `proj-srv` are visible under both sources: the
 * control that a visible item is never a row.
 */
import type { DeepSettingsSeams, HiddenItem } from './doctor-deep-settings.js';
import type { ClaudeSettingSource } from '../config-sections.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CONFIG_FILE } from '../config.js';
import { buildInventory } from '../inventory/index.js';
import { INSTALLED_PLUGINS_PATH, PLUGINS_RECORD_VERSION } from '../inventory/plugins.js';

import { renderDeepSection } from './doctor-deep-row.js';
import { byGroup, readDeepSettings, SETTINGS_SECTION_TITLE, settingsSection } from './doctor-deep-settings.js';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-doctor-deep-settings-')));

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

const home = join(base, 'home');
const projectRoot = join(base, 'project');
const runtime = join(base, 'runtime');
const pluginDir = join(base, 'plugins-cache', 'alpha', '1.0.0');
const addonDir = join(base, 'modules', 'linear');

/** `loop.settingSources` without `user`: the config default. */
const WITHOUT_USER: readonly ClaudeSettingSource[] = ['project', 'local'];
const WITH_USER: readonly ClaudeSettingSource[] = ['user', 'project', 'local'];

/** Writes `text` at `path`, making its directories. */
function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A skill the checker passes, with `extra` frontmatter lines. */
function skill(name: string, extra = ''): string {
  return `---\nname: ${name}\ndescription: Run the gates in order and read each exit code\n${extra}---\n\n# Body\n\nRead each exit code.\n`;
}

/** An agent definition keyed by `name`. */
function agent(name: string): string {
  return `---\nname: ${name}\ndescription: Reviews one diff\n---\n\nReview the diff.\n`;
}

/** An MCP server entry; only its being a mapping is read. */
const SERVER = { command: 'true' };

// The project.
write(join(projectRoot, '.claude/skills/gate-order/SKILL.md'), skill('gate-order'));
write(join(projectRoot, '.claude/skills/project-only/SKILL.md'), skill('project-only'));
write(join(projectRoot, '.claude/skills/switched/SKILL.md'), skill('switched'));
write(join(projectRoot, '.claude/skills/quiet/SKILL.md'), skill('quiet', 'disable-model-invocation: true\n'));
write(join(projectRoot, '.claude/settings.json'), JSON.stringify({
  skillOverrides: { switched: 'off' },
  disabledMcpjsonServers: ['rejected-srv'],
}));
write(join(projectRoot, '.mcp.json'), JSON.stringify({
  mcpServers: { 'proj-srv': SERVER, 'off-srv': SERVER, 'rejected-srv': SERVER, shared: SERVER },
}));

// rafa, beside its entry.
write(join(runtime, 'cli.js'), '');
write(join(runtime, 'skills/rafa-only/SKILL.md'), skill('rafa-only'));

// The home.
write(join(home, '.claude/skills/gate-order/SKILL.md'), skill('gate-order'));
write(join(home, '.claude/skills/ts-symbols/SKILL.md'), skill('ts-symbols'));
write(join(home, '.claude/agents/reviewer.md'), agent('reviewer'));
write(join(home, '.claude.json'), JSON.stringify({
  mcpServers: { 'user-srv': SERVER },
  projects: { [projectRoot]: { mcpServers: { shared: SERVER }, disabledMcpServers: ['off-srv'] } },
}));

// One plugin.
write(join(pluginDir, 'skills/helper/SKILL.md'), skill('helper'));
write(join(home, INSTALLED_PLUGINS_PATH), JSON.stringify({
  version: PLUGINS_RECORD_VERSION,
  plugins: { 'alpha@market': [{ scope: 'user', installPath: pluginDir, version: '1.0.0' }] },
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
write(join(addonDir, 'skills/addon-only/SKILL.md'), skill('addon-only'));

/** The planted world's seams under `settingSources`. */
function seams(settingSources: readonly ClaudeSettingSource[]): DeepSettingsSeams {
  return {
    home,
    projectRoot,
    entry: join(runtime, 'cli.js'),
    pathDirs: [],
    settingSources,
    modules: [{ name: 'linear', directory: addonDir, state: 'loaded' }],
  };
}

/** A hidden item as `source kind name`, the way its row names it. */
function label(item: HiddenItem): string {
  return `${item.source} ${item.kind} ${item.name}`;
}

/** The hidden item labelled `wanted` under `settingSources`; fails the case when absent. */
function hiddenItem(settingSources: readonly ClaudeSettingSource[], wanted: string): HiddenItem {
  const found = readDeepSettings(seams(settingSources)).hidden.find((item) => label(item) === wanted);
  if (found === undefined) throw new Error(`no hidden item ${wanted}`);
  return found;
}

describe('readDeepSettings: which items are hidden', () => {
  it('lists every hidden item of the default sources, grouped by source', () => {
    expect(readDeepSettings(seams(WITHOUT_USER)).hidden.map(label)).toEqual([
      'project skill quiet',
      'project skill switched',
      'project mcp server off-srv',
      'project mcp server rejected-srv',
      'project mcp server shared',
      'user skill gate-order',
      'user skill ts-symbols',
      'user agent reviewer',
      'user mcp server user-srv',
      'plugin:alpha skill alpha:helper',
    ]);
  });

  it('drops the items `user` hid once the sources name it, and keeps the rest', () => {
    expect(readDeepSettings(seams(WITH_USER)).hidden.map(label)).toEqual([
      'project skill quiet',
      'project skill switched',
      'project mcp server off-srv',
      'project mcp server rejected-srv',
      'project mcp server shared',
      'user skill gate-order',
    ]);
  });

  it('leaves out rafa and add-on rows the inventory itself reads as hidden', () => {
    const inventoryHidden = buildInventory(seams(WITH_USER)).records
      .filter((record) => !record.visibleToLoop)
      .map((record) => record.source);
    expect(inventoryHidden).toContain('rafa');
    expect(inventoryHidden).toContain('addon:linear');

    const sources = readDeepSettings(seams(WITH_USER)).hidden.map((item) => item.source);
    expect(sources).not.toContain('rafa');
    expect(sources).not.toContain('addon:linear');
  });

  it('carries the file that declares each item', () => {
    expect(hiddenItem(WITHOUT_USER, 'user skill ts-symbols').path)
      .toBe(join(home, '.claude/skills/ts-symbols/SKILL.md'));
    expect(hiddenItem(WITHOUT_USER, 'user mcp server user-srv').path).toBe(join(home, '.claude.json'));
  });

  it('warns of nothing over a world whose files all read', () => {
    expect(readDeepSettings(seams(WITH_USER)).warnings).toEqual([]);
  });
});

describe('readDeepSettings: why and the fix', () => {
  it('names the left-out source and the config key to add it to', () => {
    const item = hiddenItem(WITHOUT_USER, 'user skill ts-symbols');
    expect(item.why).toBe('loop.settingSources (project, local) leaves out user');
    expect(item.fix).toBe(`add user to loop.settingSources in ${CONFIG_FILE}`);
    expect(hiddenItem(WITHOUT_USER, 'plugin:alpha skill alpha:helper').fix).toBe(item.fix);
  });

  it('names the holder of a shadowed item', () => {
    const item = hiddenItem(WITH_USER, 'user skill gate-order');
    expect(item.why).toBe('shadowed by the project skill of the same name');
    expect(item.fix).toBe('rename it, or remove the project skill gate-order');
  });

  it('names the settings file whose skillOverrides switched a skill off', () => {
    const file = join(projectRoot, '.claude/settings.json');
    const item = hiddenItem(WITH_USER, 'project skill switched');
    expect(item.why).toBe(`skillOverrides sets it off in ${file}`);
    expect(item.fix).toBe(`remove "switched" from skillOverrides in ${file}`);
  });

  it('names the frontmatter key that took a skill from the model', () => {
    const item = hiddenItem(WITH_USER, 'project skill quiet');
    expect(item.why).toBe('its frontmatter sets disable-model-invocation');
    expect(item.fix).toBe(`remove disable-model-invocation from ${join(projectRoot, '.claude/skills/quiet/SKILL.md')}`);
  });

  it('names the project entry whose disabledMcpServers turned a server off', () => {
    const file = join(home, '.claude.json');
    const item = hiddenItem(WITH_USER, 'project mcp server off-srv');
    expect(item.why).toBe(`disabledMcpServers names it in ${file}`);
    expect(item.fix).toBe(`remove "off-srv" from disabledMcpServers under projects["${projectRoot}"] in ${file}`);
  });

  it('names the loaded settings file whose disabledMcpjsonServers rejects a server', () => {
    const file = join(projectRoot, '.claude/settings.json');
    const item = hiddenItem(WITH_USER, 'project mcp server rejected-srv');
    expect(item.why).toBe(`disabledMcpjsonServers names it in ${file}`);
    expect(item.fix).toBe(`remove "rejected-srv" from disabledMcpjsonServers in ${file}`);
  });

  it('names the nearer scope that holds a shadowed server\'s name', () => {
    const item = hiddenItem(WITH_USER, 'project mcp server shared');
    expect(item.why).toBe('shadowed by the local mcp server of the same name');
    expect(item.fix).toBe('rename it, or remove the local mcp server shared');
  });

  it('gives the source first when the server\'s own source is off', () => {
    const item = hiddenItem(['project'], 'local mcp server shared');
    expect(item.fix).toBe(`add local to loop.settingSources in ${CONFIG_FILE}`);
  });
});

describe('readDeepSettings: unreadable files', () => {
  it('warns of a .mcp.json that is not JSON, naming the file', () => {
    const root = join(base, 'broken-project');
    write(join(root, '.mcp.json'), '{ not json');
    const reading = readDeepSettings({ ...seams(WITHOUT_USER), projectRoot: root });
    expect(reading.warnings.map((warning) => warning.path)).toEqual([join(root, '.mcp.json')]);
    expect(reading.warnings[0]?.reason).toStartWith('is not JSON');
  });
});

describe('byGroup', () => {
  /** A hidden item of `source`, `kind` and `name`; the other fields are not sorted on. */
  function item(source: string, kind: HiddenItem['kind'], name: string): HiddenItem {
    return { source, kind, name, path: '', why: '', fix: '' };
  }

  it('orders local, project, user, then the plugins by name; kinds and names inside each', () => {
    const sorted = byGroup([
      item('plugin:beta', 'skill', 'b'),
      item('user', 'mcp server', 'a'),
      item('plugin:alpha', 'skill', 'z'),
      item('user', 'skill', 'b'),
      item('local', 'mcp server', 'x'),
      item('user', 'agent', 'a'),
      item('project', 'skill', 'c'),
      item('user', 'skill', 'a'),
    ]);
    expect(sorted.map(label)).toEqual([
      'local mcp server x',
      'project skill c',
      'user skill a',
      'user skill b',
      'user agent a',
      'user mcp server a',
      'plugin:alpha skill z',
      'plugin:beta skill b',
    ]);
  });
});

describe('settingsSection', () => {
  it('renders the sources, then each hidden item as a note with its fix', () => {
    const lines = renderDeepSection(settingsSection(readDeepSettings(seams(WITHOUT_USER))));
    expect(lines.slice(0, 4)).toEqual([
      `${SETTINGS_SECTION_TITLE}:`,
      '  ok    setting source local: loaded by every loop session',
      '  ok    setting source project: loaded by every loop session',
      '  note  setting source user: not loaded: loop.settingSources is project, local',
    ]);
    const at = lines.indexOf('  note  user skill ts-symbols: hidden from sessions: loop.settingSources (project, local) leaves out user');
    expect(at).toBeGreaterThan(0);
    expect(lines[at + 1]).toBe(`        fix: add user to loop.settingSources in ${CONFIG_FILE}`);
  });

  it('reads every source as ok and every hidden row as note, whatever the sources', () => {
    const section = settingsSection(readDeepSettings(seams(WITH_USER)));
    const sourceRows = section.rows.filter((row) => row.name.startsWith('setting source '));
    expect(sourceRows.map((row) => row.status)).toEqual(['ok', 'ok', 'ok']);
    const hiddenRows = section.rows.filter((row) => !row.name.startsWith('setting source '));
    expect(hiddenRows.length).toBe(6);
    expect(hiddenRows.every((row) => row.status === 'note' && row.fix !== undefined)).toBe(true);
  });

  it('renders a warning as a warn row naming the file', () => {
    const section = settingsSection({
      settingSources: WITHOUT_USER,
      hidden: [],
      warnings: [{ path: '/p/.mcp.json', reason: 'is not JSON: bad' }],
    });
    expect(section.rows.at(-1)).toEqual({ status: 'warn', name: '/p/.mcp.json', detail: 'is not JSON: bad' });
  });
});
