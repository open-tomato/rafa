/**
 * Tests for the plugin and add-on source readers.
 *
 * Every case plants a home, a project root, a plugins record and a
 * module directory of its own under this file's temporary directory and
 * hands them as seams, so nothing reads the real home or the real
 * `installed_plugins.json`. The first case asserts every path a reading
 * returns sits under the planted base: a reader that lost its seam
 * would read this machine's plugins and pass on whatever they hold.
 *
 * The warning claims come in pairs. A reader that warned about
 * everything would pass "an unreadable source is one warning row", so
 * each such case reads the same world once whole — rows and no warning
 * — and once with one thing broken. The absent-record case is the other
 * side: no plugins, and no warning either.
 */
import type { AddonModule, PluginSeams } from './plugins.js';

import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  INSTALLED_PLUGINS_PATH,
  pluginName,
  PLUGINS_CLI_VERSION,
  PLUGINS_RECORD_VERSION,
  readAddons,
  readInstalledPlugins,
  readPlugins,
} from './plugins.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-inventory-plugins-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

let planted = 0;

/** A fresh world: a home and a project root, none of them written yet. */
function freshSeams(): PluginSeams {
  planted += 1;
  const base = join(tempBase, `case-${planted}`);
  return {
    home: join(base, 'home'),
    projectRoot: join(base, 'project'),
    entry: join(base, 'runtime', 'cli.js'),
    pathDirs: [],
  };
}

/** The planted world's base directory. */
function baseOf(seams: PluginSeams): string {
  return dirname(seams.home);
}

/** Writes `text` at `path`, making its directories. */
function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A markdown file whose frontmatter holds `lines`. */
function definition(lines: readonly string[]): string {
  return `---\n${lines.join('\n')}\n---\n\n# Body\n\nRead each exit code.\n`;
}

/** A skill the checker passes. */
function cleanSkill(name: string, description = 'Run the gates in order and read each exit code'): string {
  return definition([`name: ${name}`, `description: ${description}`, 'tags: [verification]', 'stack: [agnostic]']);
}

/** Writes `installed_plugins.json` under the planted home. */
function writeRecord(seams: PluginSeams, record: unknown): string {
  const path = join(seams.home, INSTALLED_PLUGINS_PATH);
  write(path, typeof record === 'string'
    ? record
    : JSON.stringify(record, null, 2));
  return path;
}

/** Plants a plugin install with one skill and one agent, and answers its directory. */
function plantPlugin(seams: PluginSeams, name: string): string {
  const dir = join(baseOf(seams), 'plugins-cache', name, '1.0.0');
  write(join(dir, 'skills', 'gate-order', 'SKILL.md'), cleanSkill('gate-order'));
  write(join(dir, 'agents', 'reviewer.md'), definition(['name: reviewer', 'description: Reviews one diff']));
  return dir;
}

/** A version-2 record holding each install under `<name>@market`, user scope. */
function userRecord(installs: Readonly<Record<string, string>>): unknown {
  const plugins = Object.fromEntries(Object.entries(installs)
    .map(([name, installPath]) => [`${name}@market`, [{ scope: 'user', installPath, version: '1.0.0' }]]));
  return { version: PLUGINS_RECORD_VERSION, plugins };
}

describe('the readers stay under the planted seams', () => {
  it('reads the record and the installs from the base it was handed', () => {
    const seams = freshSeams();
    writeRecord(seams, userRecord({ alpha: plantPlugin(seams, 'alpha') }));

    const reading = readPlugins(seams);

    expect(readInstalledPlugins(seams).path).toBe(join(seams.home, '.claude/plugins/installed_plugins.json'));
    // Control: rows were read, so the loop below is not vacuous.
    expect(reading.items.length).toBe(2);
    for (const item of reading.items) expect(item.path.startsWith(baseOf(seams))).toBe(true);
  });
});

describe('the version the plugin reader was written against', () => {
  it('records the Claude Code version and the record version', () => {
    expect(PLUGINS_CLI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(PLUGINS_RECORD_VERSION).toBe(2);
  });

  it('turns a record under another version into one warning naming both', () => {
    const seams = freshSeams();
    const installs = { alpha: plantPlugin(seams, 'alpha') };
    const path = writeRecord(seams, { ...(userRecord(installs) as object), version: 3 });

    const reading = readPlugins(seams);

    expect(reading.items).toEqual([]);
    expect(reading.warnings).toEqual([{
      source: 'plugins',
      path,
      reason: `has version 3; this reader was written against version 2 (Claude Code ${PLUGINS_CLI_VERSION})`,
    }]);
    // Control: the same install under version 2 reads whole.
    writeRecord(seams, userRecord(installs));
    expect(readPlugins(seams).warnings).toEqual([]);
  });
});

describe('plugin rows', () => {
  it('names each row <plugin>:<name> under source plugin:<plugin>, with its frontmatter', () => {
    const seams = freshSeams();
    const dir = plantPlugin(seams, 'alpha');
    writeRecord(seams, userRecord({ alpha: dir }));

    const reading = readPlugins(seams);

    expect(reading.warnings).toEqual([]);
    expect(reading.items.map((item) => [item.kind, item.name, item.source, item.path])).toEqual([
      ['skill', 'alpha:gate-order', 'plugin:alpha', join(dir, 'skills/gate-order/SKILL.md')],
      ['agent', 'alpha:reviewer', 'plugin:alpha', join(dir, 'agents/reviewer.md')],
    ]);
    const skill = reading.items.find((item) => item.kind === 'skill');
    expect(skill?.summary).toBe('Run the gates in order and read each exit code');
    expect(skill?.tags).toEqual(['verification']);
    expect(skill?.check).toBe('pass');
    expect(reading.items.find((item) => item.kind === 'agent')?.check).toBeNull();
  });

  it('gives the skill checker\'s verdict on a plugin skill', () => {
    const seams = freshSeams();
    const dir = plantPlugin(seams, 'alpha');
    write(join(dir, 'skills', 'no-description', 'SKILL.md'), definition(['name: no-description']));
    writeRecord(seams, userRecord({ alpha: dir }));

    const checks = Object.fromEntries(readPlugins(seams).items.map((item) => [item.name, item.check]));

    expect(checks['alpha:no-description']).toBe('fail');
    // Control: the clean skill beside it passes.
    expect(checks['alpha:gate-order']).toBe('pass');
  });

  it('reads a plugin holding neither skills nor agents as no rows and no warning', () => {
    const seams = freshSeams();
    const lsp = join(baseOf(seams), 'plugins-cache', 'lsp', '1.0.0');
    write(join(lsp, '.claude-plugin', 'plugin.json'), '{"name":"lsp"}');
    writeRecord(seams, userRecord({ lsp, alpha: plantPlugin(seams, 'alpha') }));

    const reading = readPlugins(seams);

    expect(reading.warnings).toEqual([]);
    expect(reading.items.every((item) => item.source === 'plugin:alpha')).toBe(true);
    expect(readInstalledPlugins(seams).plugins.map((plugin) => plugin.name)).toEqual(['alpha', 'lsp']);
  });

  it('takes the plugin name from before the last @ of its key', () => {
    expect(pluginName('superpowers@claude-plugins-official')).toBe('superpowers');
    expect(pluginName('@scope/tool@market')).toBe('@scope/tool');
    expect(pluginName('bare')).toBe('bare');
  });
});

describe('which installs apply here', () => {
  it('reads user installs and project installs for this project, and skips another project\'s', () => {
    const seams = freshSeams();
    const record = {
      version: PLUGINS_RECORD_VERSION,
      plugins: {
        'mine@market': [{ scope: 'project', projectPath: seams.projectRoot, installPath: plantPlugin(seams, 'mine') }],
        'theirs@market': [{ scope: 'local', projectPath: join(baseOf(seams), 'elsewhere'), installPath: plantPlugin(seams, 'theirs') }],
        'home@market': [{ scope: 'user', installPath: plantPlugin(seams, 'home') }],
      },
    };
    writeRecord(seams, record);

    const installed = readInstalledPlugins(seams);

    expect(installed.warnings).toEqual([]);
    expect(installed.plugins.map((plugin) => [plugin.name, plugin.scope])).toEqual([['home', 'user'], ['mine', 'project']]);
  });

  it('reads the first install of a key that applies here', () => {
    const seams = freshSeams();
    const first = plantPlugin(seams, 'first');
    writeRecord(seams, {
      version: PLUGINS_RECORD_VERSION,
      plugins: {
        'alpha@market': [
          { scope: 'local', projectPath: join(baseOf(seams), 'elsewhere'), installPath: plantPlugin(seams, 'skipped') },
          { scope: 'user', installPath: first, version: '1.2.3' },
        ],
      },
    });

    expect(readInstalledPlugins(seams).plugins).toEqual([
      { key: 'alpha@market', name: 'alpha', scope: 'user', installPath: first, version: '1.2.3' },
    ]);
  });
});

describe('an absent record', () => {
  it('reads as no plugins and no warning', () => {
    const seams = freshSeams();

    expect(readPlugins(seams)).toEqual({ items: [], warnings: [] });
    expect(readInstalledPlugins(seams).plugins).toEqual([]);
  });
});

describe('an unreadable source is one warning row', () => {
  it('turns a record that is not JSON into one plugins warning', () => {
    const seams = freshSeams();
    const path = writeRecord(seams, '{ not json');

    const reading = readPlugins(seams);

    expect(reading.items).toEqual([]);
    expect(reading.warnings.length).toBe(1);
    expect(reading.warnings[0]?.source).toBe('plugins');
    expect(reading.warnings[0]?.path).toBe(path);
    expect(reading.warnings[0]?.reason).toStartWith('is not JSON: ');
  });

  it('turns a record that is not a mapping, or has no plugins mapping, into one plugins warning', () => {
    const seams = freshSeams();
    writeRecord(seams, '[]');
    expect(readPlugins(seams).warnings.map((warning) => warning.reason)).toEqual(['is a list, expected a mapping']);

    writeRecord(seams, { version: PLUGINS_RECORD_VERSION, plugins: [] });
    expect(readPlugins(seams).warnings.map((warning) => warning.source)).toEqual(['plugins']);
  });

  it('turns an installPath that is not there into one row for that plugin, keeping the others', () => {
    const seams = freshSeams();
    const gone = join(baseOf(seams), 'plugins-cache', 'gone', '1.0.0');
    writeRecord(seams, userRecord({ gone, alpha: plantPlugin(seams, 'alpha') }));

    const reading = readPlugins(seams);

    expect(reading.warnings).toEqual([{ source: 'plugin:gone', path: gone, reason: 'installPath is not a directory' }]);
    // Control: the readable plugin beside it keeps both its rows.
    expect(reading.items.map((item) => item.name)).toEqual(['alpha:gate-order', 'alpha:reviewer']);
  });

  it('turns an install entry with no installPath, or not a list, into one row for that plugin', () => {
    const seams = freshSeams();
    const path = writeRecord(seams, {
      version: PLUGINS_RECORD_VERSION,
      plugins: { 'nopath@market': [{ scope: 'user' }], 'odd@market': 'yes' },
    });

    expect(readPlugins(seams).warnings).toEqual([
      { source: 'plugin:nopath', path, reason: 'record entry "nopath@market" names no absolute installPath' },
      { source: 'plugin:odd', path, reason: 'record entry "odd@market" is "yes", expected a list of installs' },
    ]);
  });

  it('turns a record it may not read into one plugins warning', () => {
    const seams = freshSeams();
    const path = writeRecord(seams, userRecord({}));
    chmodSync(path, 0o000);
    try {
      const reading = readPlugins(seams);
      // Root reads a mode-000 file anyway; the case measures nothing there.
      if (process.getuid?.() === 0) return;
      expect(reading.warnings.map((warning) => [warning.source, warning.path])).toEqual([['plugins', path]]);
      expect(reading.warnings[0]?.reason).toStartWith('does not read: ');
    } finally {
      chmodSync(path, 0o644);
    }
    // Control: the same record readable is no warning.
    expect(readPlugins(seams).warnings).toEqual([]);
  });
});

/** Plants a module directory with a manifest providing `provides`, and answers its directory. */
function plantModule(seams: PluginSeams, name: string, provides: Readonly<Record<string, string>>): string {
  const dir = join(baseOf(seams), 'modules', name);
  const manifest = {
    manifestVersion: 1,
    types: Object.keys(provides),
    provides,
    requires: { rafa: '>=0.0.1', ports: {} },
  };
  write(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', rafa: manifest }));
  write(join(dir, 'skills', 'addon-skill', 'SKILL.md'), cleanSkill('addon-skill'));
  write(join(dir, 'agents', 'addon-agent.md'), definition(['name: addon-agent']));
  return dir;
}

/** A configured module in `state`. */
function module(name: string, directory: string | null, state: AddonModule['state'] = 'loaded'): AddonModule {
  return { name, directory, state };
}

describe('add-on rows', () => {
  it('reads a loaded module\'s provided skills and agents under addon:<name>, names bare', () => {
    const seams = freshSeams();
    const dir = plantModule(seams, 'linear', { skills: './skills', agents: './agents' });

    const reading = readAddons([module('linear', dir)], seams);

    expect(reading.warnings).toEqual([]);
    expect(reading.items.map((item) => [item.kind, item.name, item.source, item.path])).toEqual([
      ['agent', 'addon-agent', 'addon:linear', join(dir, 'agents/addon-agent.md')],
      ['skill', 'addon-skill', 'addon:linear', join(dir, 'skills/addon-skill/SKILL.md')],
    ]);
    expect(reading.items.find((item) => item.kind === 'skill')?.check).toBe('pass');
  });

  it('reads only what the manifest provides', () => {
    const seams = freshSeams();
    const dir = plantModule(seams, 'skills-only', { skills: './skills' });

    const reading = readAddons([module('skills-only', dir)], seams);

    // The agents/ directory is planted too; the manifest does not name it.
    expect(reading.items.map((item) => item.kind)).toEqual(['skill']);
  });

  it('passes over a refused or disabled module', () => {
    const seams = freshSeams();
    const dir = plantModule(seams, 'linear', { skills: './skills' });

    expect(readAddons([module('linear', dir, 'refused'), module('linear', dir, 'disabled')], seams))
      .toEqual({ items: [], warnings: [] });
    // Control: the same module loaded is read.
    expect(readAddons([module('linear', dir)], seams).items.length).toBe(1);
  });
});

describe('an unreadable add-on is one warning row', () => {
  it('turns a manifest that no longer validates into one row for that module', () => {
    const seams = freshSeams();
    const dir = plantModule(seams, 'broken', { skills: './skills' });
    write(join(dir, 'package.json'), JSON.stringify({ name: 'broken', rafa: { manifestVersion: 9 } }));
    const good = plantModule(seams, 'good', { skills: './skills' });

    const reading = readAddons([module('broken', dir), module('good', good)], seams);

    expect(reading.warnings.map((warning) => [warning.source, warning.path])).toEqual([['addon:broken', join(dir, 'package.json')]]);
    expect(reading.warnings[0]?.reason).toStartWith('manifest does not validate: ');
    // Control: the module beside it keeps its row.
    expect(reading.items.map((item) => item.source)).toEqual(['addon:good']);
  });

  it('turns a package.json that is not JSON into one row', () => {
    const seams = freshSeams();
    const dir = plantModule(seams, 'broken', { skills: './skills' });
    write(join(dir, 'package.json'), '{');

    const reading = readAddons([module('broken', dir)], seams);

    expect(reading.items).toEqual([]);
    expect(reading.warnings.length).toBe(1);
    expect(reading.warnings[0]?.reason).toStartWith('package.json does not read: ');
  });

  it('turns a provided directory that is missing, or outside the module, into one row', () => {
    const seams = freshSeams();
    const missing = plantModule(seams, 'missing', { agents: './no-agents' });
    const outside = plantModule(seams, 'outside', { skills: '../missing/skills' });

    const reading = readAddons([module('missing', missing), module('outside', outside)], seams);

    expect(reading.items).toEqual([]);
    expect(reading.warnings).toEqual([
      { source: 'addon:missing', path: missing, reason: 'manifest agents "./no-agents" is not a directory in the module' },
      { source: 'addon:outside', path: outside, reason: 'manifest skills "../missing/skills" resolves outside the module directory' },
    ]);
  });

  it('turns a loaded module with no directory into one row', () => {
    const seams = freshSeams();

    expect(readAddons([module('ghost', null)], seams).warnings).toEqual([
      { source: 'addon:ghost', path: 'ghost', reason: 'the module has no directory to read' },
    ]);
  });
});
