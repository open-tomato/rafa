/**
 * Tests for `rafa agent list` (`src/commands/agent/list.ts`): the
 * filters a line is read as, the agent rows `buildInventory` gives and
 * how `--source`, `--state` and `--hidden-from-loop` narrow them, the
 * `--tier` alias, the text rows and the json result, the vendor hint,
 * and the refusals.
 *
 * Every dispatched case plants a project, a home and a runtime of its
 * own under a temporary directory of this file's own, and dispatches
 * the command in-process (`src/tests/cli-capture.ts`). The rafa tier is
 * measured from a planted `cli.js` handed in as the entry seam, so
 * nothing reads the real home or `~/.claude/agents`: in the loop the
 * home is the real one, and a case that lost it would list this
 * machine's definitions and pass on whatever they happen to be.
 *
 * ## The controls
 *
 * Each filter could read as working because it drops everything, so
 * every narrowing case holds the row it must KEEP. That a user agent is
 * hidden from the loop, and named by the vendor hint, is held beside
 * the same tree under a config whose `loop.settingSources` includes
 * `user`, where it is visible and the hint is gone: a command that
 * marked every user row hidden, or printed the hint always, would fail
 * that half.
 *
 * ## `-i`
 *
 * The browse runs over a recording terminal and scripted keys handed in
 * as the `terminal` and `keys` seams. The no-terminal refusal is held
 * beside the same line over a terminal that is one, which browses and
 * exits 0, so a command refusing `-i` always would fail that half.
 */
import type { AgentListSeams } from './list.js';
import type { Key, Terminal } from '../../cli/prompt/terminal.js';
import type { InventoryRecord } from '../../inventory/record.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '../../cli/command.js';
import { NO_TERMINAL_TEXT } from '../../cli/prompt/terminal.js';
import { dispatchInProject, eventsOf, plantProjectConfig } from '../../tests/cli-capture.js';

import {
  agentListHeading,
  createAgentListCommand,
  expectKnownAgentSource,
  readAgentFilters,
  renderAgentList,
  unreachableUserAgents,
  vendorHintLines,
} from './list.js';

/** The subject the dispatched cases route through. */
const SUBJECTS = [{ name: 'agent', summary: 'agents' }];

/** A temporary directory of this file's own, its path resolved through every link. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-agent-list-')));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** An agent definition carrying `name` in its frontmatter and the description given. */
function agentText(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\nThe ${name} body.\n`;
}

/** What one case plants: a project, a home and a runtime. */
interface Planted {
  readonly root: string;
  readonly home: string;
  readonly entry: string;
  readonly scope: string;
}

/** Plants one case's tree, each key a path under the case's directory. */
function plant(files: Readonly<Record<string, string>>, settingSources = 'project,local'): Planted {
  planted += 1;
  const scope = join(tempBase, `case-${String(planted)}`);
  const root = join(scope, 'project');
  const home = join(scope, 'home');
  const entry = join(scope, 'runtime', 'cli.js');
  plantProjectConfig(root, `version: 1\nloop:\n  settingSources: ${settingSources}\n`);
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

/**
 * The tree most cases list: a project agent shadowing a user agent of
 * the same name, a user-only agent, and a plugin agent.
 */
function standardTree(settingSources = 'project,local'): Planted {
  const scope = join(tempBase, `case-${String(planted + 1)}`);
  const record = {
    version: 2,
    plugins: { 'alpha@market': [{ scope: 'user', installPath: join(scope, 'plugins', 'alpha'), version: '1.0.0' }] },
  };
  return plant({
    'project/.claude/agents/tdd-guide.md': agentText('tdd-guide', 'Writes the test first'),
    'home/.claude/agents/tdd-guide.md': agentText('tdd-guide', 'The home copy'),
    'home/.claude/agents/home-only.md': agentText('home-only', 'Held by the home alone'),
    'home/.claude/plugins/installed_plugins.json': JSON.stringify(record),
    'plugins/alpha/agents/reviewer.md': agentText('reviewer', 'A plugin agent'),
  }, settingSources);
}

/** Dispatches `words` over the command, with the planted tree's seams and any `-i` seams given. */
async function run(words: readonly string[], tree: Planted, browsing: Pick<AgentListSeams, 'terminal' | 'keys'> = {}) {
  const command = createAgentListCommand({ entry: () => tree.entry, modules: {}, ...browsing });
  return dispatchInProject(words, SUBJECTS, [command], { root: tree.root, home: tree.home }, { PATH: '' });
}

/** The json result's data of a run. */
interface ResultData {
  readonly agents: readonly InventoryRecord[];
  readonly total: number;
  readonly trees: readonly { source: string; exists: boolean }[];
  readonly unreachable: readonly string[];
  readonly warnings: readonly string[];
  readonly settingSources: readonly string[];
}

/** The data of the result event a json run ends with. */
function resultData(stdout: string): ResultData {
  const result = eventsOf(stdout).find((event) => event.type === 'result') as unknown as { data: ResultData };
  return result.data;
}

/** Each row of a json run as `[name, source, state, visibleToLoop]`. */
function rowsOf(stdout: string): readonly (readonly [string, string, string, boolean])[] {
  return resultData(stdout).agents.map((row) => [row.name, row.source, row.state, row.visibleToLoop] as const);
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

/** One agent row, filled with values no case here reads unless it sets them. */
function record(fields: Partial<InventoryRecord>): InventoryRecord {
  return {
    kind: 'agent',
    name: 'a',
    source: 'project',
    path: '/p/.claude/agents/a.md',
    summary: '',
    whenToUse: null,
    prevents: null,
    stack: [],
    tags: [],
    check: null,
    state: 'enabled',
    visibleToLoop: true,
    ...fields,
  };
}

describe('the words an agent list line is read as', () => {
  it('reads the three filters, and nothing when each is left out', () => {
    expect(readAgentFilters({})).toEqual({ source: null, state: null, hiddenFromLoop: false });
    expect(readAgentFilters({ 'source': 'plugin:alpha', 'state': 'shadowed', 'hidden-from-loop': true }))
      .toEqual({ source: 'plugin:alpha', state: 'shadowed', hiddenFromLoop: true });
  });

  it('refuses a source written as none is, a state it cannot take and a flag with no value, naming its own usage', () => {
    const [sourceCode, source] = refusal(() => readAgentFilters({ source: 'users' }));
    const [stateCode, state] = refusal(() => readAgentFilters({ state: 'shadowed-by:project' }));

    expect(sourceCode).toBe(1);
    expect(source).toContain('--source is "users", expected one of: project, rafa, user, plugin:<name>, addon:<name>');
    expect(source).toContain('Usage: rafa agent list');
    expect(stateCode).toBe(1);
    expect(state).toContain('--state is "shadowed-by:project", expected one of: enabled, shadowed, disabled');
    expect(refusal(() => readAgentFilters({ source: true }))[1]).toContain('--source needs a value');
  });

  it('refuses a plugin source the inventory does not know, and takes one it does', () => {
    const inventory = { records: [record({ source: 'plugin:beta' })], trees: [], warnings: [], overrideWarnings: [] };

    expect(() => expectKnownAgentSource('plugin:beta', inventory)).not.toThrow();
    expect(() => expectKnownAgentSource(null, inventory)).not.toThrow();
    const [code, message] = refusal(() => expectKnownAgentSource('plugin:alpha', inventory));
    expect(code).toBe(1);
    expect(message).toContain('known sources: project, rafa, user, plugin:beta');
    expect(message).toContain('Usage: rafa agent list');
  });
});

describe('the home definitions a run cannot reach', () => {
  it('names the user rows no visible row answers, sorted, once each', () => {
    const agents = [
      record({ name: 'second', source: 'user', visibleToLoop: false }),
      record({ name: 'first', source: 'user', visibleToLoop: false }),
      record({ name: 'first', source: 'plugin:alpha', visibleToLoop: false }),
    ];

    expect(unreachableUserAgents(agents)).toEqual(['first', 'second']);
  });

  it('leaves out a home name a visible row answers, and a visible user row', () => {
    const agents = [
      record({ name: 'tdd-guide' }),
      record({ name: 'tdd-guide', source: 'user', state: 'shadowed-by:project', visibleToLoop: false }),
      record({ name: 'visible', source: 'user' }),
    ];

    expect(unreachableUserAgents(agents)).toEqual([]);
  });

  it('writes the count and the vendor command, and nothing for no name', () => {
    expect(vendorHintLines(['a', 'b'])).toEqual([
      '2 definition(s) under ~/.claude/agents resolve under none of these sources: a, b',
      'Run `rafa agent vendor <name>` to copy one into this project.',
    ]);
    expect(vendorHintLines([])).toEqual([]);
  });
});

describe('what text mode writes', () => {
  const base = {
    projectRoot: '/p',
    settingSources: ['project' as const, 'local' as const],
    total: 2,
    trees: [],
    warnings: [],
  };

  it('names each filter given in the heading, and none when none is', () => {
    const empty = { ...base, agents: [], unreachable: [] };

    expect(agentListHeading({ ...empty, filters: { source: null, state: null, hiddenFromLoop: false } }))
      .toBe('Agents (project: /p):');
    expect(agentListHeading({ ...empty, filters: { source: 'user', state: 'enabled', hiddenFromLoop: true } }))
      .toBe('Agents (project: /p; source user, state enabled, hidden from the loop):');
  });

  it('writes the rows, the counts, the legend and then the vendor hint', () => {
    const lines = renderAgentList({
      ...base,
      filters: { source: null, state: null, hiddenFromLoop: false },
      agents: [
        record({ name: 'tdd-guide', summary: 'Writes the test first' }),
        record({ name: 'home-only', source: 'user', visibleToLoop: false }),
      ],
      trees: [{ source: 'rafa', dir: '/install/agents', exists: false }],
      unreachable: ['home-only'],
    });

    expect(lines).toEqual([
      'Agents (project: /p):',
      '  ● tdd-guide  project  enabled  Writes the test first',
      '  ○ home-only  user     enabled',
      '  rafa  /install/agents  (no such directory)',
      '2 of 2 agent(s) listed, 1 visible to the loop (loop.settingSources: project, local)',
      '● a loop session resolves it, ○ it does not',
      '1 definition(s) under ~/.claude/agents resolve under none of these sources: home-only',
      'Run `rafa agent vendor <name>` to copy one into this project.',
    ]);
  });

  it('says so when no row matches', () => {
    const lines = renderAgentList({
      ...base,
      filters: { source: 'rafa', state: null, hiddenFromLoop: false },
      agents: [],
      unreachable: [],
    });

    expect(lines[1]).toBe('  (no agent matches)');
  });
});

describe('rafa agent list over planted sources', () => {
  it('plants its home and its project under this file\'s own directory', () => {
    const tree = standardTree();

    expect(tree.root.startsWith(tempBase)).toBe(true);
    expect(tree.home.startsWith(tempBase)).toBe(true);
  });

  it('lists every agent with its source, state and loop mark, then the vendor hint, and exits 0', async () => {
    const tree = standardTree();

    const answered = await run(['agent', 'list'], tree);

    expect([answered.exitCode, answered.stderr]).toEqual([0, '']);
    expect(answered.stdout.split('\n').filter((line) => line !== '')).toEqual([
      `Agents (project: ${tree.root}):`,
      '  ○ alpha:reviewer  plugin:alpha  enabled              A plugin agent',
      '  ○ home-only       user          enabled              Held by the home alone',
      '  ● tdd-guide       project       enabled              Writes the test first',
      '  ○ tdd-guide       user          shadowed-by:project  The home copy',
      `  rafa  ${join(dirname(tree.entry), 'agents')}  (no such directory)`,
      '4 of 4 agent(s) listed, 1 visible to the loop (loop.settingSources: project, local)',
      '● a loop session resolves it, ○ it does not',
      '1 definition(s) under ~/.claude/agents resolve under none of these sources: home-only',
      'Run `rafa agent vendor <name>` to copy one into this project.',
    ]);
  });

  it('marks the user agent visible and drops the vendor hint when loop.settingSources includes user', async () => {
    const tree = standardTree('project,local,user');

    const json = await run(['agent', 'list', '--output=json'], tree);
    const text = await run(['agent', 'list'], tree);

    expect(rowsOf(json.stdout)).toEqual([
      ['alpha:reviewer', 'plugin:alpha', 'enabled', true],
      ['home-only', 'user', 'enabled', true],
      ['tdd-guide', 'project', 'enabled', true],
      ['tdd-guide', 'user', 'shadowed-by:project', false],
    ]);
    expect(resultData(json.stdout).unreachable).toEqual([]);
    expect(text.exitCode).toBe(0);
    expect(text.stdout).not.toContain('rafa agent vendor');
  });

  it('gives every row, the trees and the vendor names as the json result', async () => {
    const tree = standardTree();

    const answered = await run(['agent', 'list', '--output=json'], tree);
    const data = resultData(answered.stdout);

    expect([answered.exitCode, answered.stderr]).toEqual([0, '']);
    expect(eventsOf(answered.stdout).map((event) => event.type)).toEqual(['start', 'result']);
    expect(data.agents.every((row) => row.kind === 'agent' && row.check === null)).toBe(true);
    expect(data.agents[2]?.path).toBe(join(tree.root, '.claude', 'agents', 'tdd-guide.md'));
    expect(data.total).toBe(4);
    expect(data.settingSources).toEqual(['project', 'local']);
    expect(data.unreachable).toEqual(['home-only']);
    expect(data.trees.map((listing) => [listing.source, listing.exists]))
      .toEqual([['project', true], ['rafa', false], ['user', true]]);
  });

  it('narrows to one source under --source, a plugin one included, and reads --tier as --source', async () => {
    const tree = standardTree();

    const user = await run(['agent', 'list', '--source=user', '--output=json'], tree);
    const plugin = await run(['agent', 'list', '--source=plugin:alpha', '--output=json'], tree);
    const tier = await run(['agent', 'list', '--tier=project', '--output=json'], tree);
    const source = await run(['agent', 'list', '--source=project', '--output=json'], tree);

    expect(rowsOf(user.stdout)).toEqual([
      ['home-only', 'user', 'enabled', false],
      ['tdd-guide', 'user', 'shadowed-by:project', false],
    ]);
    expect(resultData(user.stdout).unreachable).toEqual(['home-only']);
    expect(rowsOf(plugin.stdout)).toEqual([['alpha:reviewer', 'plugin:alpha', 'enabled', false]]);
    expect(tier.exitCode).toBe(0);
    expect(resultData(tier.stdout)).toEqual(resultData(source.stdout));
    expect(rowsOf(tier.stdout)).toEqual([['tdd-guide', 'project', 'enabled', true]]);
  });

  it('narrows on the state prefix under --state, and to the hidden rows under --hidden-from-loop', async () => {
    const tree = standardTree();

    const shadowed = await run(['agent', 'list', '--state=shadowed', '--output=json'], tree);
    const disabled = await run(['agent', 'list', '--state=disabled', '--output=json'], tree);
    const hidden = await run(['agent', 'list', '--hidden-from-loop', '--output=json'], tree);
    const both = await run(['agent', 'list', '--hidden-from-loop', '--source=user', '--state=enabled', '--output=json'], tree);

    expect(rowsOf(shadowed.stdout)).toEqual([['tdd-guide', 'user', 'shadowed-by:project', false]]);
    expect(rowsOf(disabled.stdout)).toEqual([]);
    expect(rowsOf(hidden.stdout).map(([name, source]) => `${source}/${name}`))
      .toEqual(['plugin:alpha/alpha:reviewer', 'user/home-only', 'user/tdd-guide']);
    expect(rowsOf(both.stdout)).toEqual([['home-only', 'user', 'enabled', false]]);
  });

  it('keeps the vendor hint in text mode whatever the filters keep', async () => {
    const tree = standardTree();

    const answered = await run(['agent', 'list', '--source=project'], tree);

    expect(answered.exitCode).toBe(0);
    expect(answered.stdout).toContain(`Agents (project: ${tree.root}; source project):`);
    expect(answered.stdout).not.toContain('home-only  user');
    expect(answered.stdout).toContain('resolve under none of these sources: home-only');
  });

  it('refuses a positional word, a source written as none is, an unknown plugin and a wrong state', async () => {
    const tree = standardTree();

    const worded = await run(['agent', 'list', 'tdd-guide'], tree);
    const shape = await run(['agent', 'list', '--source=users'], tree);
    const unknown = await run(['agent', 'list', '--source=plugin:beta'], tree);
    const state = await run(['agent', 'list', '--state=hidden'], tree);
    const passed = await run(['agent', 'list'], tree);

    expect(worded.exitCode).toBe(1);
    expect(worded.stderr).toContain('Expected no argument, got 1: tdd-guide');
    expect(shape.exitCode).toBe(1);
    expect(shape.stderr).toContain('expected one of: project, rafa, user, plugin:<name>, addon:<name>');
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain('known sources: project, rafa, user, plugin:alpha');
    expect(state.exitCode).toBe(1);
    expect(state.stderr).toContain('--state is "hidden", expected one of: enabled, shadowed, disabled');
    expect(passed.exitCode).toBe(0);
  });

  it('refuses a config that cannot be used', async () => {
    const tree = plant({});
    plantProjectConfig(tree.root, 'version: 1\nloop:\n  settingSources: nowhere\n');

    const answered = await run(['agent', 'list'], tree);

    expect(answered.exitCode).toBe(1);
    expect(answered.stderr).toContain('rafa agent list: the config cannot be used:');
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

describe('rafa agent list -i over planted sources', () => {
  it('refuses without a terminal, naming its own --output=json, before a key is read', async () => {
    const tree = standardTree();
    const script = scriptedKeys([char('q')]);

    const answered = await run(['agent', 'list', '-i'], tree, { terminal: () => recordingTerminal(false).terminal, keys: script.keys });

    expect(answered.exitCode).toBe(1);
    expect(answered.stderr).toContain(NO_TERMINAL_TEXT);
    expect(answered.stderr).toContain('Run `rafa agent list --output=json` to read the rows without one.');
    expect(script.opened()).toBe(0);
  });

  it('browses and exits 0 on the same line over a terminal, the control on the refusal', async () => {
    const tree = standardTree();
    const { terminal, written } = recordingTerminal();

    const answered = await run(['agent', 'list', '-i'], tree, { terminal: () => terminal, keys: scriptedKeys([char('q')]).keys });

    expect(answered.exitCode).toBe(0);
    expect(written()).toContain(`Agents (project: ${tree.root})`);
    expect(written()).toContain('tdd-guide');
  });

  it('shows a definition, opens its full context and quits, printing neither a row nor the vendor hint', async () => {
    const tree = standardTree();
    const keys: readonly Key[] = [{ name: 'down' }, { name: 'enter' }, char('f'), { name: 'escape' }, char('q')];
    const { terminal, written } = recordingTerminal();

    const text = await run(['agent', 'list'], tree);
    const answered = await run(['agent', 'list', '--interactive'], tree, { terminal: () => terminal, keys: scriptedKeys(keys).keys });

    expect(text.stdout).toContain('rafa agent vendor');
    expect(answered.exitCode).toBe(0);
    expect(answered.stdout).not.toContain('rafa agent vendor');
    expect(answered.stdout).not.toContain('home-only');
    expect(written()).toContain('[show] agent home-only (user)');
    expect(written()).toContain('[full context] agent home-only (user)');
    expect(written()).toContain('The home-only body.');
  });

  it('refuses -i beside --output=json', async () => {
    const tree = standardTree();

    const answered = await run(['agent', 'list', '-i', '--output=json'], tree, { terminal: () => recordingTerminal().terminal });

    expect(answered.exitCode).toBe(1);
    expect(answered.stdout).toContain('--output=json writes them as data');
    expect(answered.stdout).toContain('Usage: rafa agent list');
  });
});
