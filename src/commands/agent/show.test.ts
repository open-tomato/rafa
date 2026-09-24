/**
 * Tests for `rafa agent show` (`src/commands/agent/show.ts`): which
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
 * the name is the frontmatter `name` and not the file name is held by
 * a project definition whose file is named otherwise. That `--full`
 * replaces the frontmatter and headings sections is held beside the
 * same agent shown without it, where both sections are there. That the
 * skill hint is conditional is held by a name no skill holds, whose
 * refusal carries no hint.
 */
import type { ShowView } from '../../inventory/show.js';
import type { Resolution } from '../../tiers/resolve.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '../../cli/command.js';
import { dispatchInProject, eventsOf, plantProjectConfig } from '../../tests/cli-capture.js';

import { agentShowView, createAgentShowCommand, unknownAgentMessage } from './show.js';

/** The subject the dispatched cases route through. */
const SUBJECTS = [{ name: 'agent', summary: 'show an agent' }];

/** A temporary directory of this file's own, its path resolved through every link. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-agent-show-')));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** An agent definition keyed by its frontmatter name, with two headings in its body. */
function agentText(name: string, description: string): string {
  return [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    'tools: Read, Grep',
    '---',
    '',
    `# ${name}`,
    '',
    '## Review steps',
    '',
    'Read the diff whole.',
    '',
  ].join('\n');
}

/** A skill file whose frontmatter passes every check. */
function skillText(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;
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

/** The file a planted tree's project copy of `code-reviewer` sits in, named otherwise on purpose. */
function projectAgent(tree: Planted): string {
  return join(tree.root, '.claude', 'agents', 'reviewer.md');
}

/** The file a planted tree's home copy of `code-reviewer` sits in. */
function userAgent(tree: Planted): string {
  return join(tree.home, '.claude', 'agents', 'code-reviewer.md');
}

/**
 * The tree most cases show from: a project agent a user agent of the
 * same name is shadowed by, a user-only agent, and a project skill
 * named as no agent is.
 */
function standardTree(): Planted {
  return plant({
    'project/.claude/agents/reviewer.md': agentText('code-reviewer', 'Reviews a diff for the project'),
    'home/.claude/agents/code-reviewer.md': agentText('code-reviewer', 'The home copy of the reviewer'),
    'home/.claude/agents/planner.md': agentText('planner', 'Plans a feature'),
    'project/.claude/skills/verification-loop/SKILL.md': skillText('verification-loop', 'Run the gates in order'),
  });
}

/** Dispatches `words` over the command, with the planted tree's seams. */
async function run(words: readonly string[], tree: Planted) {
  const command = createAgentShowCommand({ entry: () => tree.entry, modules: {} });
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

describe('which agent a name shows', () => {
  it('shows the first agent holder of the name in the inventory\'s order, and lists the other', () => {
    const inventory = inventoryOf([
      record('skill', 'reviewer', 'project', '/p/skills/reviewer/SKILL.md'),
      record('agent', 'reviewer', 'project', '/p/reviewer.md'),
      record('agent', 'reviewer', 'user', '/h/reviewer.md'),
    ]);

    const view = agentShowView(inventory, 'reviewer', { full: false, read: () => '# reviewer\n' });

    expect(view.record.kind).toBe('agent');
    expect(view.record.path).toBe('/p/reviewer.md');
    expect(view.others.map((holder) => holder.path)).toEqual(['/h/reviewer.md']);
    expect(view.headings).toEqual([{ level: 1, text: 'reviewer', line: 1 }]);
    expect(view.text).toBeNull();
  });

  it('carries the file under full, and a file that does not read as the view\'s readError', () => {
    const inventory = inventoryOf([record('agent', 'reviewer', 'project', '/p/reviewer.md')]);

    const full = agentShowView(inventory, 'reviewer', { full: true, read: () => '# reviewer\n' });
    const gone = agentShowView(inventory, 'reviewer', {
      full: true,
      read: () => {
        throw new Error('ENOENT: no such file');
      },
    });

    expect(full.text).toBe('# reviewer\n');
    expect(full.readError).toBeNull();
    expect(gone.readError).toBe('ENOENT: no such file');
    expect(gone.text).toBeNull();
    expect(gone.record.path).toBe('/p/reviewer.md');
  });

  it('refuses a name only a skill holds with exit code 1, pointing at skill show', () => {
    const inventory = inventoryOf([record('skill', 'verification-loop', 'project', '/p/SKILL.md')]);

    const [code, message] = refusal(() => agentShowView(inventory, 'verification-loop', { full: false }));

    expect(code).toBe(1);
    expect(message).toContain('No agent is named "verification-loop".');
    expect(message).toContain('A skill is named "verification-loop" (project): rafa skill show verification-loop');
  });

  it('refuses a name nothing holds with no skill hint, the control on the hint', () => {
    const message = unknownAgentMessage('nothing-here', inventoryOf([record('skill', 'gates', 'project', '/p/SKILL.md')]));

    expect(message).toContain('No agent is named "nothing-here".');
    expect(message).not.toContain('rafa skill show');
    expect(message).toContain('Usage: rafa agent show <name> [--full]');
  });
});

describe('rafa agent show over planted sources', () => {
  it('shows the project holder under its frontmatter name, the user copy it shadows, its frontmatter and headings, and exits 0', async () => {
    const tree = standardTree();

    const answered = await run(['agent', 'show', 'code-reviewer'], tree);

    expect(answered.exitCode).toBe(0);
    expect(answered.stderr).toBe('');
    expect(linesOf(answered.stdout)).toEqual([
      'agent code-reviewer (project)',
      `  path     ${projectAgent(tree)}`,
      '  state    enabled',
      '  loop     resolved by a loop session',
      '  summary  Reviews a diff for the project',
      '  stack    (none)',
      '  tags     (none)',
      'Other holders of agent code-reviewer:',
      `  user  shadowed-by:project  ${userAgent(tree)}`,
      'Frontmatter:',
      '  name: code-reviewer',
      '  description: Reviews a diff for the project',
      '  tools: Read, Grep',
      'Headings:',
      '  # code-reviewer  (line 7)',
      '    ## Review steps  (line 9)',
    ]);
  });

  it('prints the whole file under --full in place of the frontmatter and headings', async () => {
    const tree = standardTree();

    const full = await run(['agent', 'show', 'code-reviewer', '--full'], tree);
    const lines = linesOf(full.stdout);

    expect(full.exitCode).toBe(0);
    expect(lines).toContain(`File ${projectAgent(tree)}:`);
    expect(lines).toContain('Read the diff whole.');
    expect(lines).toContain(`  user  shadowed-by:project  ${userAgent(tree)}`);
    expect(lines).not.toContain('Frontmatter:');
    expect(lines).not.toContain('Headings:');
  });

  it('gives every part of the view, where it was read and the warnings as the json result', async () => {
    const tree = standardTree();

    const plain = resultData((await run(['agent', 'show', 'code-reviewer', '--output=json'], tree)).stdout);
    const full = resultData((await run(['agent', 'show', 'code-reviewer', '--full', '--output=json'], tree)).stdout);

    expect(plain.projectRoot).toBe(tree.root);
    expect(plain.settingSources).toEqual(['project', 'local']);
    expect(plain.warnings).toEqual([]);
    expect([plain.record.kind, plain.record.source, plain.record.state, plain.record.visibleToLoop])
      .toEqual(['agent', 'project', 'enabled', true]);
    expect(plain.others).toEqual([
      { source: 'user', state: 'shadowed-by:project', path: userAgent(tree), visibleToLoop: false },
    ]);
    expect(plain.frontmatter).toEqual({
      name: 'code-reviewer',
      description: 'Reviews a diff for the project',
      tools: 'Read, Grep',
    });
    expect(plain.headings.map((heading) => [heading.level, heading.text, heading.line]))
      .toEqual([[1, 'code-reviewer', 7], [2, 'Review steps', 9]]);
    expect(plain.text).toBeNull();
    expect(plain.readError).toBeNull();
    expect(full.text).toBe(agentText('code-reviewer', 'Reviews a diff for the project'));
  });

  it('shows a user-only agent as not resolved by a loop session under project,local, and exits 0', async () => {
    const tree = standardTree();

    const answered = await run(['agent', 'show', 'planner'], tree);

    expect(answered.exitCode).toBe(0);
    expect(linesOf(answered.stdout)).toContain('agent planner (user)');
    expect(linesOf(answered.stdout)).toContain('  loop     not resolved by a loop session');
    expect(linesOf(answered.stdout)).toContain('  (no other agent of this name)');
  });

  it('warns about a plugin record that does not read, on stdout in text mode and in the json data', async () => {
    const tree = plant({
      'project/.claude/agents/reviewer.md': agentText('code-reviewer', 'Reviews a diff for the project'),
      'home/.claude/plugins/installed_plugins.json': '{ not json',
    });

    const text = await run(['agent', 'show', 'code-reviewer'], tree);
    const json = await run(['agent', 'show', 'code-reviewer', '--output=json'], tree);

    expect(text.exitCode).toBe(0);
    expect(text.stdout).toMatch(/^warn: plugins: .*installed_plugins\.json: /m);
    expect(text.stdout).toContain('agent code-reviewer (project)');
    expect(resultData(json.stdout).warnings).toHaveLength(1);
  });

  it('refuses an unknown name, a skill\'s name, a file name, no name, two names and --full typed ahead of the name', async () => {
    const tree = standardTree();

    const unknown = await run(['agent', 'show', 'nothing-here'], tree);
    const skill = await run(['agent', 'show', 'verification-loop'], tree);
    const fileName = await run(['agent', 'show', 'reviewer'], tree);
    const none = await run(['agent', 'show'], tree);
    const two = await run(['agent', 'show', 'code-reviewer', 'planner'], tree);
    const ahead = await run(['agent', 'show', '--full', 'code-reviewer'], tree);

    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain('No agent is named "nothing-here".');
    expect(skill.exitCode).toBe(1);
    expect(skill.stderr).toContain('rafa skill show verification-loop');
    expect(fileName.exitCode).toBe(1);
    expect(fileName.stderr).toContain('No agent is named "reviewer".');
    expect(none.exitCode).toBe(1);
    expect(none.stderr).toContain('Expected one argument, got none');
    expect(two.exitCode).toBe(1);
    expect(two.stderr).toContain('Expected one argument, got 2: code-reviewer planner');
    expect(ahead.exitCode).toBe(1);
    expect(ahead.stderr).toContain('--full takes no value, and read "code-reviewer" as one.');
  });

  it('refuses a config that cannot be used, naming this command', async () => {
    const tree = plant({});
    plantProjectConfig(tree.root, 'version: 1\nloop:\n  settingSources: nowhere\n');

    const answered = await run(['agent', 'show', 'code-reviewer'], tree);

    expect(answered.exitCode).toBe(1);
    expect(answered.stderr).toContain('rafa agent show: the config cannot be used:');
  });
});
