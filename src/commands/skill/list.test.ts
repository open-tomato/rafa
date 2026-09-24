/**
 * Tests for `rafa skill list` (`src/commands/skill/list.ts`): the
 * filters a line is read as, the rows `buildInventory` gives and how
 * `--source`, `--state` and `--hidden-from-loop` narrow them, the
 * `--tier` alias, the text rows and the json result, the warnings, the
 * exit code a failing skill does NOT change, and the refusals.
 *
 * Every dispatched case plants a project, a home and a runtime of its
 * own under a temporary directory of this file's own, and dispatches
 * the command in-process with streams, an environment and a working
 * directory of its own (`src/tests/cli-capture.ts`). The rafa tier is
 * measured from a planted `cli.js` handed in as the entry seam, so
 * nothing reads the real home, `~/.claude/skills` or the directory the
 * test runner happens to sit in.
 *
 * ## The controls
 *
 * Each filter could read as working because it drops everything, so
 * every narrowing case also holds the row it must KEEP, and the tree
 * it narrows is listed whole first. That a user skill is hidden from
 * the loop is held beside the same tree under a config whose
 * `loop.settingSources` includes `user`, where it is visible: a
 * command that marked every user row hidden would fail that half. That
 * a failing skill leaves the exit code 0 is held beside its json row,
 * whose `check` says `fail`.
 *
 * ## `-i`
 *
 * The browse runs over a recording terminal and scripted keys handed in
 * as the `terminal` and `keys` seams. The no-terminal refusal is held
 * beside the same line over a terminal that is one, which browses and
 * exits 0, so a command refusing `-i` always would fail that half; and
 * the refusal is measured to come before any key is read and before the
 * config is loaded, by a key source that counts its openings and a
 * config that cannot be used.
 */
import type { SkillListSeams } from './list.js';
import type { Key, Terminal } from '../../cli/prompt/terminal.js';
import type { InventoryRecord } from '../../inventory/record.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '../../cli/command.js';
import { INTERRUPT_EXIT_CODE, NO_TERMINAL_TEXT } from '../../cli/prompt/terminal.js';
import { dispatchInProject, eventsOf, plantProjectConfig } from '../../tests/cli-capture.js';

import {
  browseListing,
  createSkillListCommand,
  expectKnownSource,
  interactiveFlag,
  interactiveInstead,
  interactiveTerminal,
  isSourceShape,
  knownSources,
  listHeading,
  matchesFilters,
  readFilters,
  readSourceFlag,
  readStateFlag,
  renderSkillList,
  skillRowLines,
} from './list.js';

/** The subject the dispatched cases route through. */
const SUBJECTS = [{ name: 'skill', summary: 'list every skill' }];

/** A temporary directory of this file's own, its path resolved through every link. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-skill-list-')));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A skill file whose frontmatter passes every check, under the name and description given. */
function skillText(name: string, description: string): string {
  return [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    'tags: [verification]',
    'stack: [typescript]',
    '---',
    '',
    `# ${name}`,
    '',
    'Read each exit code.',
    '',
  ].join('\n');
}

/** A skill file missing the two list fields the checker requires. */
function brokenSkillText(name: string): string {
  return `---\nname: ${name}\ndescription: Missing its list fields\n---\n\n# ${name}\n`;
}

/** The config text a case plants: `loop.settingSources` as given. */
function configText(settingSources: string): string {
  return `version: 1\nloop:\n  settingSources: ${settingSources}\n`;
}

/** What one case plants: a project, a home and a runtime. */
interface Planted {
  /** The project root, holding `.rafa/config.yaml`. */
  readonly root: string;
  /** The home the sources resolve `~/.claude` under. */
  readonly home: string;
  /** The entry the rafa tier is measured from. */
  readonly entry: string;
  /** The directory the three sit in. */
  readonly scope: string;
}

/** Plants one case's tree, each key a path under the case's directory. */
function plant(files: Readonly<Record<string, string>>, settingSources = 'project,local'): Planted {
  planted += 1;
  const scope = join(tempBase, `case-${String(planted)}`);
  const root = join(scope, 'project');
  const home = join(scope, 'home');
  const entry = join(scope, 'runtime', 'cli.js');
  plantProjectConfig(root, configText(settingSources));
  mkdirSync(home, { recursive: true });
  mkdirSync(dirname(entry), { recursive: true });
  writeFileSync(entry, '// the runtime\n', 'utf8');
  for (const [name, text] of Object.entries(files)) {
    const path = join(scope, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
  }
  return { root, home, entry, scope };
}

/** A plugin record naming each plugin given as installed in the user scope. */
function pluginRecord(plugins: Readonly<Record<string, string>>): string {
  const entries = Object.entries(plugins).map(([name, installPath]) => [
    `${name}@market`,
    [{ scope: 'user', installPath, version: '1.0.0' }],
  ]);
  return JSON.stringify({ version: 2, plugins: Object.fromEntries(entries) });
}

/**
 * The tree most cases list: a project skill a user skill of the same
 * name is shadowed by, a user-only skill, a project skill switched off
 * in `.claude/settings.json`, and a plugin skill.
 */
function standardTree(settingSources = 'project,local'): Planted {
  const scope = join(tempBase, `case-${String(planted + 1)}`);
  return plant({
    'project/.claude/skills/verification-loop/SKILL.md': skillText('verification-loop', 'Run the gates in order'),
    'project/.claude/skills/switched-off/SKILL.md': skillText('switched-off', 'Turned off by the settings'),
    'project/.claude/settings.json': JSON.stringify({ skillOverrides: { 'switched-off': 'off' } }),
    'home/.claude/skills/verification-loop/SKILL.md': skillText('verification-loop', 'The home copy of the gates'),
    'home/.claude/skills/user-only/SKILL.md': skillText('user-only', 'Held by the home alone'),
    'home/.claude/plugins/installed_plugins.json': pluginRecord({ alpha: join(scope, 'plugins', 'alpha') }),
    'plugins/alpha/skills/brainstorm/SKILL.md': skillText('brainstorm', 'A plugin skill'),
  }, settingSources);
}

/** Dispatches `words` over the command, with the planted tree's seams and any `-i` seams given. */
async function run(words: readonly string[], tree: Planted, browsing: Pick<SkillListSeams, 'terminal' | 'keys'> = {}) {
  const command = createSkillListCommand({ entry: () => tree.entry, modules: {}, ...browsing });
  return dispatchInProject(words, SUBJECTS, [command], { root: tree.root, home: tree.home }, { PATH: '' });
}

/** The json result's data of a run. */
interface ResultData {
  readonly skills: readonly InventoryRecord[];
  readonly total: number;
  readonly trees: readonly { source: string; exists: boolean }[];
  readonly warnings: readonly string[];
  readonly filters: unknown;
  readonly settingSources: readonly string[];
}

/** The data of the result event a json run ends with. */
function resultData(stdout: string): ResultData {
  const result = eventsOf(stdout).find((event) => event.type === 'result') as unknown as { data: ResultData };
  return result.data;
}

/** Each row of a json run as `[name, source, state, visibleToLoop]`. */
function rowsOf(stdout: string): readonly (readonly [string, string, string, boolean])[] {
  return resultData(stdout).skills.map((row) => [row.name, row.source, row.state, row.visibleToLoop] as const);
}

/** The exit code and the message a call refused with. */
function refusal(call: () => unknown): [number, string] {
  try {
    call();
  } catch (error) {
    if (error instanceof CommandExit) return [error.exitCode, error.message];
    throw error;
  }
  throw new Error('expected a CommandExit, and the call returned');
}

/** One inventory row, filled with values no case here reads unless it sets them. */
function record(fields: Partial<InventoryRecord>): InventoryRecord {
  return {
    kind: 'skill',
    name: 'a',
    source: 'project',
    path: '/p/.claude/skills/a/SKILL.md',
    summary: '',
    whenToUse: null,
    prevents: null,
    stack: [],
    tags: [],
    check: 'pass',
    state: 'enabled',
    visibleToLoop: true,
    ...fields,
  };
}

/** An inventory holding the rows and warnings given, and nothing else. */
function inventoryOf(records: readonly InventoryRecord[], warningSources: readonly string[] = []) {
  return {
    records,
    trees: [],
    warnings: warningSources.map((source) => ({ source: source as `plugin:${string}`, path: '/x', reason: 'unreadable' })),
    overrideWarnings: [],
  };
}

describe('the words a skill list line is read as', () => {
  it('reads each source shape and nothing when --source is left out', () => {
    expect(readSourceFlag(undefined)).toBeNull();
    expect(readSourceFlag(false)).toBeNull();
    expect(readSourceFlag('project')).toBe('project');
    expect(readSourceFlag('rafa')).toBe('rafa');
    expect(readSourceFlag('user')).toBe('user');
    expect(readSourceFlag('plugin:alpha')).toBe('plugin:alpha');
    expect(readSourceFlag('addon:linear')).toBe('addon:linear');
  });

  it('refuses a source no source is written as, and a --source with no value', () => {
    const [code, message] = refusal(() => readSourceFlag('users'));

    expect(code).toBe(1);
    expect(message).toContain('--source is "users", expected one of: project, rafa, user, plugin:<name>, addon:<name>');
    expect(isSourceShape('plugin:')).toBe(false);
    expect(isSourceShape('addon:x')).toBe(true);
    expect(refusal(() => readSourceFlag(true))[1]).toContain('--source needs a value');
  });

  it('reads the three state words and refuses any other', () => {
    expect(readStateFlag(undefined)).toBeNull();
    expect(readStateFlag('enabled')).toBe('enabled');
    expect(readStateFlag('shadowed')).toBe('shadowed');
    expect(readStateFlag('disabled')).toBe('disabled');

    const [code, message] = refusal(() => readStateFlag('shadowed-by:project'));
    expect(code).toBe(1);
    expect(message).toContain('--state is "shadowed-by:project", expected one of: enabled, shadowed, disabled');
  });

  it('reads the three filters together, --hidden-from-loop as a switch', () => {
    expect(readFilters({})).toEqual({ source: null, state: null, hiddenFromLoop: false });
    expect(readFilters({ 'source': 'user', 'state': 'shadowed', 'hidden-from-loop': true }))
      .toEqual({ source: 'user', state: 'shadowed', hiddenFromLoop: true });
  });
});

describe('which rows a filter keeps', () => {
  const shadowed = record({ name: 'b', source: 'user', state: 'shadowed-by:project', visibleToLoop: false });
  const disabled = record({ name: 'c', state: 'disabled:skillOverrides', visibleToLoop: false });
  const enabled = record({ name: 'a' });
  const none = { source: null, state: null, hiddenFromLoop: false };

  it('keeps every row with no filter, and the whole source string alone under --source', () => {
    const rows = [enabled, shadowed, disabled];

    expect(rows.filter((row) => matchesFilters(row, none))).toEqual(rows);
    expect(rows.filter((row) => matchesFilters(row, { ...none, source: 'user' }))).toEqual([shadowed]);
    expect(matchesFilters(record({ source: 'plugin:alpha' }), { ...none, source: 'plugin:alph' })).toBe(false);
  });

  it('matches --state on the prefix of the state, and --hidden-from-loop on visibleToLoop', () => {
    const rows = [enabled, shadowed, disabled];

    expect(rows.filter((row) => matchesFilters(row, { ...none, state: 'shadowed' }))).toEqual([shadowed]);
    expect(rows.filter((row) => matchesFilters(row, { ...none, state: 'disabled' }))).toEqual([disabled]);
    expect(rows.filter((row) => matchesFilters(row, { ...none, state: 'enabled' }))).toEqual([enabled]);
    expect(rows.filter((row) => matchesFilters(row, { ...none, hiddenFromLoop: true }))).toEqual([shadowed, disabled]);
  });

  it('knows the tiers, then each named source a row or a warning names, and refuses any other', () => {
    const inventory = inventoryOf(
      [record({ source: 'plugin:beta' }), record({ kind: 'agent', source: 'addon:linear' })],
      ['plugin:gone'],
    );

    expect(knownSources(inventory)).toEqual(['project', 'rafa', 'user', 'addon:linear', 'plugin:beta', 'plugin:gone']);
    expect(() => expectKnownSource('plugin:gone', inventory)).not.toThrow();
    expect(() => expectKnownSource('rafa', inventory)).not.toThrow();
    expect(() => expectKnownSource(null, inventory)).not.toThrow();

    const [code, message] = refusal(() => expectKnownSource('plugin:alpha', inventory));
    expect(code).toBe(1);
    expect(message).toContain('--source is "plugin:alpha", which no skill, agent or warning here comes from');
    expect(message).toContain('known sources: project, rafa, user, addon:linear, plugin:beta, plugin:gone');
  });
});

describe('what text mode writes', () => {
  it('pads every column but the summary to its widest cell, the mark first', () => {
    const lines = skillRowLines([
      record({ name: 'verification-loop', summary: 'Run the gates' }),
      record({ name: 'b', source: 'user', state: 'shadowed-by:project', visibleToLoop: false, summary: '' }),
    ]);

    expect(lines).toEqual([
      '  ● verification-loop  project  enabled              Run the gates',
      '  ○ b                  user     shadowed-by:project',
    ]);
  });

  it('names each filter given in the heading, and none when none is', () => {
    const base = {
      projectRoot: '/p',
      settingSources: ['project' as const],
      skills: [],
      total: 0,
      trees: [],
      warnings: [],
    };

    expect(listHeading({ ...base, filters: { source: null, state: null, hiddenFromLoop: false } }))
      .toBe('Skills (project: /p):');
    expect(listHeading({ ...base, filters: { source: 'user', state: 'shadowed', hiddenFromLoop: true } }))
      .toBe('Skills (project: /p; source user, state shadowed, hidden from the loop):');
  });

  it('says so when no row matches, lists an absent tree, and closes with the counts and the legend', () => {
    const lines = renderSkillList({
      projectRoot: '/p',
      settingSources: ['project', 'local'],
      filters: { source: 'rafa', state: null, hiddenFromLoop: false },
      skills: [],
      total: 4,
      trees: [{ source: 'rafa', dir: '/install/skills', exists: false }],
      warnings: [],
    });

    expect(lines).toEqual([
      'Skills (project: /p; source rafa):',
      '  (no skill matches)',
      '  rafa  /install/skills  (no such directory)',
      '0 of 4 skill(s) listed, 0 visible to the loop (loop.settingSources: project, local)',
      '● a loop session resolves it, ○ it does not',
    ]);
  });
});

describe('rafa skill list over planted sources', () => {
  it('lists every skill with its source, state and loop mark, and exits 0', async () => {
    const tree = standardTree();

    const answered = await run(['skill', 'list'], tree);

    expect(answered.exitCode).toBe(0);
    expect(answered.stderr).toBe('');
    expect(answered.stdout.split('\n').filter((line) => line !== '')).toEqual([
      `Skills (project: ${tree.root}):`,
      '  ○ alpha:brainstorm   plugin:alpha  enabled                  A plugin skill',
      '  ○ switched-off       project       disabled:skillOverrides  Turned off by the settings',
      '  ○ user-only          user          enabled                  Held by the home alone',
      '  ● verification-loop  project       enabled                  Run the gates in order',
      '  ○ verification-loop  user          shadowed-by:project      The home copy of the gates',
      `  rafa  ${join(dirname(tree.entry), 'skills')}  (no such directory)`,
      '5 of 5 skill(s) listed, 1 visible to the loop (loop.settingSources: project, local)',
      '● a loop session resolves it, ○ it does not',
    ]);
  });

  it('gives every row, its check and the trees as the json result', async () => {
    const tree = standardTree();

    const answered = await run(['skill', 'list', '--output=json'], tree);
    const data = resultData(answered.stdout);

    expect(answered.exitCode).toBe(0);
    expect(rowsOf(answered.stdout)).toEqual([
      ['alpha:brainstorm', 'plugin:alpha', 'enabled', false],
      ['switched-off', 'project', 'disabled:skillOverrides', false],
      ['user-only', 'user', 'enabled', false],
      ['verification-loop', 'project', 'enabled', true],
      ['verification-loop', 'user', 'shadowed-by:project', false],
    ]);
    expect(data.total).toBe(5);
    expect(data.settingSources).toEqual(['project', 'local']);
    expect(data.filters).toEqual({ source: null, state: null, hiddenFromLoop: false });
    expect(data.skills.every((row) => row.kind === 'skill' && row.check === 'pass')).toBe(true);
    expect(data.trees.map((listing) => [listing.source, listing.exists]))
      .toEqual([['project', true], ['rafa', false], ['user', true]]);
  });

  it('marks a user skill visible when loop.settingSources includes user, the control on the hidden mark', async () => {
    const tree = standardTree('project,local,user');

    const answered = await run(['skill', 'list', '--output=json'], tree);

    expect(answered.exitCode).toBe(0);
    expect(rowsOf(answered.stdout)).toEqual([
      ['alpha:brainstorm', 'plugin:alpha', 'enabled', true],
      ['switched-off', 'project', 'disabled:skillOverrides', false],
      ['user-only', 'user', 'enabled', true],
      ['verification-loop', 'project', 'enabled', true],
      ['verification-loop', 'user', 'shadowed-by:project', false],
    ]);
  });

  it('narrows to one source under --source, a plugin one included', async () => {
    const tree = standardTree();

    const user = await run(['skill', 'list', '--source=user', '--output=json'], tree);
    const plugin = await run(['skill', 'list', '--source=plugin:alpha', '--output=json'], tree);

    expect(user.exitCode).toBe(0);
    expect(rowsOf(user.stdout)).toEqual([
      ['user-only', 'user', 'enabled', false],
      ['verification-loop', 'user', 'shadowed-by:project', false],
    ]);
    expect(resultData(user.stdout).total).toBe(5);
    expect(resultData(user.stdout).trees.map((listing) => listing.source)).toEqual(['user']);
    expect(plugin.exitCode).toBe(0);
    expect(rowsOf(plugin.stdout)).toEqual([['alpha:brainstorm', 'plugin:alpha', 'enabled', false]]);
    expect(resultData(plugin.stdout).trees).toEqual([]);
  });

  it('reads --tier as --source, row for row', async () => {
    const tree = standardTree();

    const tier = await run(['skill', 'list', '--tier=project', '--output=json'], tree);
    const source = await run(['skill', 'list', '--source=project', '--output=json'], tree);

    expect(tier.exitCode).toBe(0);
    expect(resultData(tier.stdout)).toEqual(resultData(source.stdout));
    expect(rowsOf(tier.stdout).map(([name]) => name)).toEqual(['switched-off', 'verification-loop']);
  });

  it('narrows on the state prefix under --state, and to the hidden rows under --hidden-from-loop', async () => {
    const tree = standardTree();

    const shadowed = await run(['skill', 'list', '--state=shadowed', '--output=json'], tree);
    const disabled = await run(['skill', 'list', '--state=disabled', '--output=json'], tree);
    const hidden = await run(['skill', 'list', '--hidden-from-loop', '--output=json'], tree);
    const both = await run(['skill', 'list', '--hidden-from-loop', '--state=enabled', '--source=user', '--output=json'], tree);

    expect(rowsOf(shadowed.stdout)).toEqual([['verification-loop', 'user', 'shadowed-by:project', false]]);
    expect(rowsOf(disabled.stdout)).toEqual([['switched-off', 'project', 'disabled:skillOverrides', false]]);
    expect(rowsOf(hidden.stdout).map(([name, source]) => `${source}/${name}`)).toEqual([
      'plugin:alpha/alpha:brainstorm',
      'project/switched-off',
      'user/user-only',
      'user/verification-loop',
    ]);
    expect(rowsOf(both.stdout)).toEqual([['user-only', 'user', 'enabled', false]]);
  });

  it('names the filters in the text heading and counts the rows they kept', async () => {
    const tree = standardTree();

    const answered = await run(['skill', 'list', '--source=user', '--state=shadowed'], tree);

    expect(answered.exitCode).toBe(0);
    expect(answered.stdout).toContain(`Skills (project: ${tree.root}; source user, state shadowed):`);
    expect(answered.stdout).toContain('  ○ verification-loop  user  shadowed-by:project  The home copy of the gates');
    expect(answered.stdout).not.toContain('user-only');
    expect(answered.stdout).toContain('1 of 5 skill(s) listed, 0 visible to the loop');
  });

  it('exits 0 over a failing skill, whose row says fail', async () => {
    const tree = plant({ 'project/.claude/skills/half-written/SKILL.md': brokenSkillText('half-written') });

    const answered = await run(['skill', 'list', '--output=json'], tree);

    expect(answered.exitCode).toBe(0);
    expect(resultData(answered.stdout).skills.map((row) => [row.name, row.check])).toEqual([['half-written', 'fail']]);
  });

  it('warns about a plugin record that does not read, on stdout in text mode and in the json data', async () => {
    const tree = plant({
      'project/.claude/skills/verification-loop/SKILL.md': skillText('verification-loop', 'Run the gates in order'),
      'home/.claude/plugins/installed_plugins.json': '{ not json',
    });

    const text = await run(['skill', 'list'], tree);
    const json = await run(['skill', 'list', '--output=json'], tree);

    expect(text.exitCode).toBe(0);
    expect(text.stdout).toMatch(/^warn: plugins: .*installed_plugins\.json: /m);
    expect(text.stdout).toContain('  ● verification-loop  project  enabled  Run the gates in order');
    expect(resultData(json.stdout).warnings).toHaveLength(1);
    expect(resultData(json.stdout).warnings[0]).toStartWith('plugins: ');
  });

  it('refuses a positional word, a source written as none is, an unknown plugin and a wrong state', async () => {
    const tree = standardTree();

    const worded = await run(['skill', 'list', 'user'], tree);
    const shape = await run(['skill', 'list', '--source=users'], tree);
    const unknown = await run(['skill', 'list', '--source=plugin:beta'], tree);
    const state = await run(['skill', 'list', '--state=hidden'], tree);

    expect(worded.exitCode).toBe(1);
    expect(worded.stderr).toContain('Expected no argument, got 1: user');
    expect(shape.exitCode).toBe(1);
    expect(shape.stderr).toContain('expected one of: project, rafa, user, plugin:<name>, addon:<name>');
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain('known sources: project, rafa, user, plugin:alpha');
    expect(state.exitCode).toBe(1);
    expect(state.stderr).toContain('--state is "hidden", expected one of: enabled, shadowed, disabled');
  });

  it('refuses a config that cannot be used', async () => {
    const tree = plant({});
    plantProjectConfig(tree.root, 'version: 1\nloop:\n  settingSources: nowhere\n');

    const answered = await run(['skill', 'list'], tree);

    expect(answered.exitCode).toBe(1);
    expect(answered.stderr).toContain('rafa skill list: the config cannot be used:');
  });
});

/** A terminal recording what the browse writes; a terminal only when `isTTY`. */
function recordingTerminal(isTTY = true): { readonly terminal: Terminal; readonly written: () => string } {
  const writes: string[] = [];
  const terminal: Terminal = {
    isTTY,
    setRawMode: () => undefined,
    write: (text) => {
      writes.push(text);
    },
    onInterrupt: () => () => undefined,
    exit: () => undefined,
  };
  return { terminal, written: () => writes.join('') };
}

/** A key source yielding `keys` then ending, counting how often it is opened. */
function scriptedKeys(keys: readonly Key[]): { readonly keys: () => AsyncIterable<Key>; readonly opened: () => number } {
  let opened = 0;
  return {
    keys: () => {
      opened += 1;
      return (async function* yieldKeys() {
        yield* keys;
      })();
    },
    opened: () => opened,
  };
}

/** The key for typing `typed`. */
function char(typed: string): Key {
  return { name: 'char', char: typed };
}

const DOWN: Key = { name: 'down' };
const ENTER: Key = { name: 'enter' };
const ESCAPE: Key = { name: 'escape' };

describe('the -i helpers', () => {
  it('declares -i as the one-letter alias of a boolean --interactive', () => {
    expect(interactiveFlag()).toMatchObject({ name: 'interactive', type: 'boolean', aliases: ['i'] });
  });

  it('answers null without -i, and never asks for a terminal', () => {
    let asked = 0;
    const seams = {
      terminal: () => {
        asked += 1;
        return recordingTerminal(false).terminal;
      },
    };

    expect(interactiveTerminal({ flags: {}, outputMode: 'text' }, seams, 'rafa skill list', 'usage')).toBeNull();
    expect(asked).toBe(0);
  });

  it('answers the terminal under -i when it is one, and refuses one that is not, naming --output=json', () => {
    const tty = recordingTerminal(true).terminal;
    const pipe = recordingTerminal(false).terminal;
    const context = { flags: { interactive: true }, outputMode: 'text' as const };

    expect(interactiveTerminal(context, { terminal: () => tty }, 'rafa skill list', 'usage')).toBe(tty);
    const [code, message] = refusal(() => interactiveTerminal(context, { terminal: () => pipe }, 'rafa skill list', 'usage'));
    expect(code).toBe(1);
    expect(message).toContain(NO_TERMINAL_TEXT);
    expect(message).toContain('Run `rafa skill list --output=json` to read the rows without one.');
    expect(interactiveInstead('rafa agent list')).toContain('rafa agent list --output=json');
  });

  it('refuses -i beside --output=json, even on a terminal', () => {
    const tty = recordingTerminal(true).terminal;

    const [code, message] = refusal(() => interactiveTerminal(
      { flags: { interactive: true }, outputMode: 'json' },
      { terminal: () => tty },
      'rafa skill list',
      'the usage line',
    ));

    expect(code).toBe(1);
    expect(message).toContain('-i browses the rows in a terminal and --output=json writes them as data');
    expect(message).toContain('Usage: the usage line');
  });

  it('browses nothing and opens no key source when no row is listed', async () => {
    const script = scriptedKeys([char('q')]);
    const { terminal, written } = recordingTerminal();
    const listing = { commandName: 'rafa skill list', message: 'Skills', records: [] };

    expect(await browseListing(terminal, { keys: script.keys }, { ...listing, rows: [] })).toBe(false);
    expect(script.opened()).toBe(0);
    expect(written()).toBe('');
    expect(await browseListing(terminal, { keys: script.keys }, { ...listing, rows: [record({ name: 'kept' })] })).toBe(true);
    expect(script.opened()).toBe(1);
    expect(written()).toContain('kept');
  });
});

describe('rafa skill list -i over planted sources', () => {
  it('refuses without a terminal, naming --output=json, before a key is read', async () => {
    const tree = standardTree();
    const script = scriptedKeys([char('q')]);

    const answered = await run(['skill', 'list', '-i'], tree, { terminal: () => recordingTerminal(false).terminal, keys: script.keys });

    expect(answered.exitCode).toBe(1);
    expect(answered.stderr).toContain(NO_TERMINAL_TEXT);
    expect(answered.stderr).toContain('rafa skill list --output=json');
    expect(answered.stdout).not.toContain('verification-loop');
    expect(script.opened()).toBe(0);
  });

  it('browses and exits 0 on the same line over a terminal, the control on the refusal', async () => {
    const tree = standardTree();
    const script = scriptedKeys([char('q')]);
    const { terminal, written } = recordingTerminal();

    const answered = await run(['skill', 'list', '-i'], tree, { terminal: () => terminal, keys: script.keys });

    expect(answered.exitCode).toBe(0);
    expect(script.opened()).toBe(1);
    expect(written()).toContain(`Skills (project: ${tree.root})`);
    expect(written()).toContain('verification-loop');
  });

  it('refuses without a terminal before the config is read', async () => {
    const tree = plant({});
    plantProjectConfig(tree.root, 'version: 1\nloop:\n  settingSources: nowhere\n');

    const refused = await run(['skill', 'list', '-i'], tree, { terminal: () => recordingTerminal(false).terminal });
    const listed = await run(['skill', 'list'], tree);

    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain(NO_TERMINAL_TEXT);
    expect(refused.stderr).not.toContain('the config cannot be used');
    expect(listed.stderr).toContain('the config cannot be used');
  });

  it('refuses -i beside --output=json', async () => {
    const tree = standardTree();

    const answered = await run(['skill', 'list', '-i', '--output=json'], tree, { terminal: () => recordingTerminal().terminal });

    expect(answered.exitCode).toBe(1);
    expect(answered.stdout).toContain('--output=json writes them as data');
  });

  it('moves down twice, shows the row, opens its full context, goes back and quits, printing no row', async () => {
    const tree = standardTree();
    const script = scriptedKeys([DOWN, DOWN, ENTER, char('f'), ESCAPE, char('q')]);
    const { terminal, written } = recordingTerminal();

    const answered = await run(['skill', 'list', '--interactive'], tree, { terminal: () => terminal, keys: script.keys });

    expect(answered.exitCode).toBe(0);
    expect(answered.stderr).toBe('');
    expect(answered.stdout).not.toContain('user-only');
    expect(written()).toContain('[show] skill user-only (user)');
    expect(written()).toContain('[full context] skill user-only (user)');
    expect(written()).toContain('\ndescription: Held by the home alone\n');
    expect(written()).not.toContain('[show] skill verification-loop');
  });

  it('browses the rows the filters keep, and no other', async () => {
    const tree = standardTree();
    const { terminal, written } = recordingTerminal();

    const answered = await run(['skill', 'list', '-i', '--source=user'], tree, {
      terminal: () => terminal,
      keys: scriptedKeys([ENTER, char('q')]).keys,
    });

    expect(answered.exitCode).toBe(0);
    expect(written()).toContain(`Skills (project: ${tree.root}; source user)`);
    expect(written()).toContain('user-only');
    expect(written()).not.toContain('alpha:brainstorm');
    expect(written()).toContain('[show] skill user-only (user)');
  });

  it('prints the text listing and reads no key when the filters keep no row', async () => {
    const tree = standardTree();
    const script = scriptedKeys([char('q')]);
    const { terminal, written } = recordingTerminal();

    const answered = await run(['skill', 'list', '-i', '--source=rafa'], tree, { terminal: () => terminal, keys: script.keys });

    expect(answered.exitCode).toBe(0);
    expect(answered.stdout).toContain('  (no skill matches)');
    expect(script.opened()).toBe(0);
    expect(written()).toBe('');
  });

  it('still writes the warnings to stdout ahead of the browse', async () => {
    const tree = plant({
      'project/.claude/skills/verification-loop/SKILL.md': skillText('verification-loop', 'Run the gates in order'),
      'home/.claude/plugins/installed_plugins.json': '{ not json',
    });

    const answered = await run(['skill', 'list', '-i'], tree, {
      terminal: () => recordingTerminal().terminal,
      keys: scriptedKeys([char('q')]).keys,
    });

    expect(answered.exitCode).toBe(0);
    expect(answered.stdout).toMatch(/^warn: plugins: /m);
    expect(answered.stdout).not.toContain('Run the gates in order');
  });

  it('exits 130 on ctrl-c', async () => {
    const tree = standardTree();

    const answered = await run(['skill', 'list', '-i'], tree, {
      terminal: () => recordingTerminal().terminal,
      keys: scriptedKeys([DOWN, { name: 'ctrl-c' }]).keys,
    });

    expect(answered.exitCode).toBe(INTERRUPT_EXIT_CODE);
  });
});
