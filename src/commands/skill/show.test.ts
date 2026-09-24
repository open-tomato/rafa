/**
 * Tests for `rafa skill show` (`src/commands/skill/show.ts`): which
 * holder a name shows, the text view with and without `--full`, the
 * json result, a file that no longer reads, the warnings, and the
 * refusals.
 *
 * Every dispatched case plants a project, a home and a runtime of its
 * own under a temporary directory of this file's own and dispatches
 * the command in-process (`src/tests/cli-capture.ts`), with the rafa
 * tier measured from a planted `cli.js` handed in as the entry seam, so
 * nothing reads the real home.
 *
 * ## The controls
 *
 * That the name shows its NEAREST holder is held over a tree where the
 * home holds the same name with a different description, so a command
 * showing the user copy would print the wrong summary and path. That
 * `--full` replaces the frontmatter and headings sections is held
 * beside the same skill shown without it, where both sections are
 * there. That the agent hint is conditional is held by a name no agent
 * holds, whose refusal carries no hint.
 */
import type { ShowView } from '../../inventory/show.js';
import type { Resolution } from '../../tiers/resolve.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '../../cli/command.js';
import { dispatchInProject, eventsOf, plantProjectConfig } from '../../tests/cli-capture.js';

import { createSkillShowCommand, skillShowView, unknownSkillMessage } from './show.js';

/** The subject the dispatched cases route through. */
const SUBJECTS = [{ name: 'skill', summary: 'show a skill' }];

/** A temporary directory of this file's own, its path resolved through every link. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-skill-show-')));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A skill file whose frontmatter passes every check, with two headings in its body. */
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
    '## Steps',
    '',
    'Read each exit code.',
    '',
  ].join('\n');
}

/** An agent definition keyed by its frontmatter name. */
function agentText(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\nThe ${name} body.\n`;
}

/** What one case plants: a project, a home and a runtime. */
interface Planted {
  readonly root: string;
  readonly home: string;
  readonly entry: string;
}

/** Plants one case's tree, each key a path under the case's directory. */
function plant(files: Readonly<Record<string, string>>): Planted {
  planted += 1;
  const scope = join(tempBase, `case-${String(planted)}`);
  const root = join(scope, 'project');
  const home = join(scope, 'home');
  const entry = join(scope, 'runtime', 'cli.js');
  plantProjectConfig(root, 'version: 1\nloop:\n  settingSources: project,local\n');
  mkdirSync(home, { recursive: true });
  mkdirSync(dirname(entry), { recursive: true });
  writeFileSync(entry, '// the runtime\n', 'utf8');
  for (const [name, text] of Object.entries(files)) {
    const path = join(scope, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
  }
  return { root, home, entry };
}

/** The file a planted tree's project copy of `verification-loop` sits in. */
function projectSkill(tree: Planted): string {
  return join(tree.root, '.claude', 'skills', 'verification-loop', 'SKILL.md');
}

/** The file a planted tree's home copy of `verification-loop` sits in. */
function userSkill(tree: Planted): string {
  return join(tree.home, '.claude', 'skills', 'verification-loop', 'SKILL.md');
}

/**
 * The tree most cases show from: a project skill a user skill of the
 * same name is shadowed by, a project skill switched off in
 * `.claude/settings.json`, and a user agent named as no skill is.
 */
function standardTree(): Planted {
  return plant({
    'project/.claude/skills/verification-loop/SKILL.md': skillText('verification-loop', 'Run the gates in order'),
    'project/.claude/skills/switched-off/SKILL.md': skillText('switched-off', 'Turned off by the settings'),
    'project/.claude/settings.json': JSON.stringify({ skillOverrides: { 'switched-off': 'off' } }),
    'home/.claude/skills/verification-loop/SKILL.md': skillText('verification-loop', 'The home copy of the gates'),
    'home/.claude/agents/code-reviewer.md': agentText('code-reviewer', 'Reviews a diff'),
  });
}

/** Dispatches `words` over the command, with the planted tree's seams. */
async function run(words: readonly string[], tree: Planted) {
  const command = createSkillShowCommand({ entry: () => tree.entry, modules: {} });
  return dispatchInProject(words, SUBJECTS, [command], { root: tree.root, home: tree.home }, { PATH: '' });
}

/** The json result's data of a run. */
interface ResultData extends ShowView {
  readonly projectRoot: string;
  readonly settingSources: readonly string[];
  readonly warnings: readonly string[];
}

/** The data of the result event a json run ends with. */
function resultData(stdout: string): ResultData {
  const result = eventsOf(stdout).find((event) => event.type === 'result') as unknown as { data: ResultData };
  return result.data;
}

/** The non-empty lines a run wrote to stdout. */
function linesOf(stdout: string): readonly string[] {
  return stdout.split('\n').filter((line) => line !== '');
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

/** An inventory record of the kind, name and source given, filled with values no case here reads. */
function record(kind: 'skill' | 'agent', name: string, source: 'project' | 'user', path: string) {
  return {
    kind,
    name,
    source,
    path,
    summary: '',
    whenToUse: null,
    prevents: null,
    stack: [],
    tags: [],
    check: null,
    state: 'enabled',
    visibleToLoop: true,
  } as const;
}

/** A resolution of no tier rows, for an inventory built by hand. */
const NO_RESOLUTION: Resolution = { loadedTiers: [], items: [], collisions: [] };

/** An inventory holding the rows given, and nothing else. */
function inventoryOf(records: ReturnType<typeof record>[]) {
  return { records, trees: [], resolution: NO_RESOLUTION, warnings: [], overrideWarnings: [] };
}

describe('which skill a name shows', () => {
  it('shows the first holder of the name in the inventory\'s order, and lists the other', () => {
    const inventory = inventoryOf([
      record('skill', 'gates', 'project', '/p/gates.md'),
      record('skill', 'gates', 'user', '/h/gates.md'),
    ]);

    const view = skillShowView(inventory, 'gates', { full: false, read: () => '# gates\n' });

    expect(view.record.path).toBe('/p/gates.md');
    expect(view.others.map((holder) => holder.path)).toEqual(['/h/gates.md']);
    expect(view.headings).toEqual([{ level: 1, text: 'gates', line: 1 }]);
    expect(view.text).toBeNull();
  });

  it('carries the file under full, and a file that does not read as the view\'s readError', () => {
    const inventory = inventoryOf([record('skill', 'gates', 'project', '/p/gates.md')]);

    const full = skillShowView(inventory, 'gates', { full: true, read: () => '# gates\n' });
    const gone = skillShowView(inventory, 'gates', {
      full: true,
      read: () => {
        throw new Error('ENOENT: no such file');
      },
    });

    expect(full.text).toBe('# gates\n');
    expect(full.readError).toBeNull();
    expect(gone.readError).toBe('ENOENT: no such file');
    expect(gone.text).toBeNull();
    expect(gone.record.path).toBe('/p/gates.md');
  });

  it('refuses a name only an agent holds with exit code 1, pointing at agent show', () => {
    const inventory = inventoryOf([record('agent', 'code-reviewer', 'user', '/h/code-reviewer.md')]);

    const [code, message] = refusal(() => skillShowView(inventory, 'code-reviewer', { full: false }));

    expect(code).toBe(1);
    expect(message).toContain('No skill is named "code-reviewer".');
    expect(message).toContain('An agent is named "code-reviewer" (user): rafa agent show code-reviewer');
  });

  it('refuses a name nothing holds with no agent hint, the control on the hint', () => {
    const message = unknownSkillMessage('nothing-here', inventoryOf([record('agent', 'code-reviewer', 'user', '/h/c.md')]));

    expect(message).toContain('No skill is named "nothing-here".');
    expect(message).not.toContain('rafa agent show');
    expect(message).toContain('Usage: rafa skill show <name> [--full]');
  });
});

describe('rafa skill show over planted sources', () => {
  it('shows the project holder, the user copy it shadows, its frontmatter and its headings, and exits 0', async () => {
    const tree = standardTree();

    const answered = await run(['skill', 'show', 'verification-loop'], tree);

    expect(answered.exitCode).toBe(0);
    expect(answered.stderr).toBe('');
    expect(linesOf(answered.stdout)).toEqual([
      'skill verification-loop (project)',
      `  path     ${projectSkill(tree)}`,
      '  state    enabled',
      '  loop     resolved by a loop session',
      '  check    pass',
      '  summary  Run the gates in order',
      '  stack    typescript',
      '  tags     verification',
      'Other holders of skill verification-loop:',
      `  user  shadowed-by:project  ${userSkill(tree)}`,
      'Frontmatter:',
      '  name: verification-loop',
      '  description: Run the gates in order',
      '  tags: [verification]',
      '  stack: [typescript]',
      'Headings:',
      '  # verification-loop  (line 8)',
      '    ## Steps  (line 10)',
    ]);
  });

  it('prints the whole file under --full in place of the frontmatter and headings', async () => {
    const tree = standardTree();

    const full = await run(['skill', 'show', 'verification-loop', '--full'], tree);
    const lines = linesOf(full.stdout);

    expect(full.exitCode).toBe(0);
    expect(lines).toContain(`File ${projectSkill(tree)}:`);
    expect(lines).toContain('Read each exit code.');
    expect(lines).toContain(`  user  shadowed-by:project  ${userSkill(tree)}`);
    expect(lines).not.toContain('Frontmatter:');
    expect(lines).not.toContain('Headings:');
  });

  it('gives every part of the view, where it was read and the warnings as the json result', async () => {
    const tree = standardTree();

    const plain = resultData((await run(['skill', 'show', 'verification-loop', '--output=json'], tree)).stdout);
    const full = resultData((await run(['skill', 'show', 'verification-loop', '--full', '--output=json'], tree)).stdout);

    expect(plain.projectRoot).toBe(tree.root);
    expect(plain.settingSources).toEqual(['project', 'local']);
    expect(plain.warnings).toEqual([]);
    expect([plain.record.source, plain.record.state, plain.record.visibleToLoop]).toEqual(['project', 'enabled', true]);
    expect(plain.others).toEqual([
      { source: 'user', state: 'shadowed-by:project', path: userSkill(tree), visibleToLoop: false },
    ]);
    expect(plain.frontmatter).toEqual({
      name: 'verification-loop',
      description: 'Run the gates in order',
      tags: ['verification'],
      stack: ['typescript'],
    });
    expect(plain.headings.map((heading) => [heading.level, heading.text, heading.line]))
      .toEqual([[1, 'verification-loop', 8], [2, 'Steps', 10]]);
    expect(plain.text).toBeNull();
    expect(plain.readError).toBeNull();
    expect(full.text).toBe(skillText('verification-loop', 'Run the gates in order'));
  });

  it('shows a skill switched off in the settings with its disabled state, and exits 0', async () => {
    const tree = standardTree();

    const answered = await run(['skill', 'show', 'switched-off'], tree);

    expect(answered.exitCode).toBe(0);
    expect(linesOf(answered.stdout)).toContain('  state    disabled:skillOverrides');
    expect(linesOf(answered.stdout)).toContain('  loop     not resolved by a loop session');
    expect(linesOf(answered.stdout)).toContain('  (no other skill of this name)');
  });

  it('warns about a plugin record that does not read, on stdout in text mode and in the json data', async () => {
    const tree = plant({
      'project/.claude/skills/verification-loop/SKILL.md': skillText('verification-loop', 'Run the gates in order'),
      'home/.claude/plugins/installed_plugins.json': '{ not json',
    });

    const text = await run(['skill', 'show', 'verification-loop'], tree);
    const json = await run(['skill', 'show', 'verification-loop', '--output=json'], tree);

    expect(text.exitCode).toBe(0);
    expect(text.stdout).toMatch(/^warn: plugins: .*installed_plugins\.json: /m);
    expect(text.stdout).toContain('skill verification-loop (project)');
    expect(resultData(json.stdout).warnings).toHaveLength(1);
  });

  it('refuses an unknown name, an agent\'s name, no name, two names and --full typed ahead of the name', async () => {
    const tree = standardTree();

    const unknown = await run(['skill', 'show', 'nothing-here'], tree);
    const agent = await run(['skill', 'show', 'code-reviewer'], tree);
    const none = await run(['skill', 'show'], tree);
    const two = await run(['skill', 'show', 'verification-loop', 'switched-off'], tree);
    const ahead = await run(['skill', 'show', '--full', 'verification-loop'], tree);

    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain('No skill is named "nothing-here".');
    expect(agent.exitCode).toBe(1);
    expect(agent.stderr).toContain('rafa agent show code-reviewer');
    expect(none.exitCode).toBe(1);
    expect(none.stderr).toContain('Expected one argument, got none');
    expect(two.exitCode).toBe(1);
    expect(two.stderr).toContain('Expected one argument, got 2: verification-loop switched-off');
    expect(ahead.exitCode).toBe(1);
    expect(ahead.stderr).toContain('--full takes no value, and read "verification-loop" as one.');
  });

  it('refuses a config that cannot be used, naming this command', async () => {
    const tree = plant({});
    plantProjectConfig(tree.root, 'version: 1\nloop:\n  settingSources: nowhere\n');

    const answered = await run(['skill', 'show', 'verification-loop'], tree);

    expect(answered.exitCode).toBe(1);
    expect(answered.stderr).toContain('rafa skill show: the config cannot be used:');
  });
});
