/**
 * Tests for `rafa agent list` (`list.ts`): the rows a roster renders,
 * what the sources leave out of reach, both output modes and the
 * refusals.
 *
 * Every case plants its definitions under the project and the home of a
 * temporary project of its own, never under this machine's, and the
 * first case asserts both roots resolve under this file's own directory:
 * in the loop the home is the real one, and a case that lost it would
 * list this machine's 60-odd definitions and pass on whatever they
 * happen to be.
 *
 * The claims about `loop.settingSources` are a scope NOT loaded, which a
 * roster holding nothing but the built-ins satisfies too. So each reads
 * the SAME plantings twice, once under a config naming `user` and once
 * under the default, and asserts the name is listed in the first: a rule
 * dropped reddens the leg that expects the row and a rule applied to
 * everything reddens the leg that expects it gone.
 *
 * The built-ins are `agents/roster.ts`'s measured constant, so what is
 * read here is that they are listed as `built-in` with no file, not what
 * they are.
 */
import type { PlantedProject } from '../../tests/cli-capture.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { BUILT_IN_AGENTS, resolveAgentRoster } from '../../agents/roster.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import agentList, { agentRow, renderAgentList, unreachableUserAgents } from './list.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-agent-list-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the dispatched cases route under. */
const SUBJECTS = [{ name: 'agent', summary: 'agents' }];

/** A config bringing `~/.claude/agents` into reach. */
const WITH_USER = 'version: 1\nloop:\n  settingSources: user,project,local\n';

/** Writes `<root>/.claude/agents/<name>.md` carrying that name, and answers its path. */
function plantDefinition(root: string, name: string, body = `The ${name} body.`): string {
  const dir = join(root, '.claude', 'agents');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.md`);
  writeFileSync(path, `---\nname: ${name}\n---\n${body}\n`, 'utf8');
  return path;
}

/** A fresh project of this file's own, written with `config` when one is given. */
function plantScope(config?: string): PlantedProject {
  const scope = mkdtempSync(join(tempBase, 'scope-'));
  return config === undefined
    ? plantProject(scope)
    : plantProject(scope, config);
}

/** Dispatches `agent list` in `project`, with `words` added to the line. */
async function listIn(
  project: PlantedProject,
  words: readonly string[] = [],
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return dispatchInProject(['agent', 'list', ...words], SUBJECTS, [agentList], project);
}

/** The `data` of the one result event of a json-mode run. */
function resultOf(stdout: string): Record<string, unknown> {
  const events = eventsOf(stdout);
  const last = events[events.length - 1];
  if (last === undefined || last.type !== 'result') throw new Error(`no result event in ${stdout}`);
  return (last.data ?? {}) as Record<string, unknown>;
}

describe('the rows rafa agent list renders', () => {
  it('plants its home and its project under this file\'s own directory', () => {
    const project = plantScope();

    expect(project.root.startsWith(tempBase)).toBe(true);
    expect(project.home.startsWith(tempBase)).toBe(true);
  });

  it('names the scope and the file of a row, and the file a project row shadows', () => {
    expect(agentRow({ name: 'tdd-guide', scope: 'project', path: '/p/.claude/agents/tdd-guide.md', shadows: null }))
      .toBe('  tdd-guide: project /p/.claude/agents/tdd-guide.md');
    expect(agentRow({ name: 'tdd-guide', scope: 'project', path: '/p/a.md', shadows: '/h/a.md' }))
      .toBe('  tdd-guide: project /p/a.md (shadows /h/a.md)');
    expect(agentRow({ name: 'Explore', scope: 'built-in', path: null, shadows: null }))
      .toBe('  Explore: built-in');
  });

  it('opens with the sources and lists the built-ins with no file', async () => {
    const project = plantScope();

    const run = await listIn(project);
    const lines = run.stdout.split('\n').filter((line) => line !== '');

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(lines[0]).toBe('Agents a session resolves (loop.settingSources: project, local):');
    expect(lines.slice(1)).toEqual(BUILT_IN_AGENTS.map((name) => `  ${name}: built-in`));
  });

  it('lists a project definition ahead of the built-ins, under the name its frontmatter carries', async () => {
    const project = plantScope();
    const path = plantDefinition(project.root, 'renamed-agent');

    const run = await listIn(project);
    const lines = run.stdout.split('\n').filter((line) => line !== '');

    expect(lines[1]).toBe(`  renamed-agent: project ${path}`);
    expect(lines).toHaveLength(BUILT_IN_AGENTS.length + 2);
  });

  it('lists a home definition only under sources naming user, and says which file a project one shadows', async () => {
    const withUser = plantScope(WITH_USER);
    const withoutUser = plantScope();
    const paths = [withUser, withoutUser].map((project) => ({
      home: plantDefinition(project.home, 'home-only'),
      shadowed: plantDefinition(project.home, 'tdd-guide', 'The home body.'),
      project: plantDefinition(project.root, 'tdd-guide', 'The project body.'),
    }));

    const listed = await listIn(withUser);
    const hidden = await listIn(withoutUser);

    expect(listed.stdout).toContain(`  home-only: user ${paths[0]?.home ?? ''}`);
    expect(listed.stdout).toContain(`  tdd-guide: project ${paths[0]?.project ?? ''} (shadows ${paths[0]?.shadowed ?? ''})`);
    expect(hidden.stdout).not.toContain('  home-only: ');
    expect(hidden.stdout).toContain(`  tdd-guide: project ${paths[1]?.project ?? ''}\n`);
  });
});

describe('the home definitions rafa agent list cannot reach', () => {
  it('answers the home names no row resolves, sorted, the shadowed one left out', () => {
    const project = plantScope();
    plantDefinition(project.home, 'second');
    plantDefinition(project.home, 'first');
    plantDefinition(project.root, 'second');
    const roots = { repoRoot: project.root, home: project.home };

    expect(unreachableUserAgents(resolveAgentRoster(roots, ['project', 'local']))).toEqual(['first']);
    expect(unreachableUserAgents(resolveAgentRoster(roots, ['user', 'project', 'local']))).toEqual([]);
  });

  it('counts a home name the project shadows as reached, since the name resolves', () => {
    const project = plantScope();
    plantDefinition(project.home, 'tdd-guide');
    const shadowed = resolveAgentRoster({ repoRoot: project.root, home: project.home }, ['project', 'local']);
    plantDefinition(project.root, 'tdd-guide');
    const reached = resolveAgentRoster({ repoRoot: project.root, home: project.home }, ['project', 'local']);

    expect(unreachableUserAgents(shadowed)).toEqual(['tdd-guide']);
    expect(unreachableUserAgents(reached)).toEqual([]);
  });

  it('counts them and points at rafa agent vendor, and says nothing when there are none', async () => {
    const unreachable = plantScope();
    const reachable = plantScope(WITH_USER);
    for (const project of [unreachable, reachable]) plantDefinition(project.home, 'home-only');

    const counted = await listIn(unreachable);
    const none = await listIn(reachable);

    expect(counted.stdout).toContain('1 definition(s) under ~/.claude/agents resolve under none of these sources: home-only');
    expect(counted.stdout).toContain('Run `rafa agent vendor <name>` to copy one into this project.');
    expect(none.stdout).not.toContain('rafa agent vendor');
  });

  it('renders no unreachable block for an empty list', () => {
    const rendered = renderAgentList({ settingSources: ['project'], agents: [], unreachable: [] });

    expect(rendered).toEqual(['Agents a session resolves (loop.settingSources: project):']);
  });
});

describe('rafa agent list in json mode, and how it refuses', () => {
  it('gives the sources, the rows and the unreachable names as the data of the result event', async () => {
    const project = plantScope();
    const path = plantDefinition(project.root, 'tdd-guide');
    plantDefinition(project.home, 'home-only');

    const run = await listIn(project, ['--output=json']);
    const data = resultOf(run.stdout);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(eventsOf(run.stdout).map((event) => event.type)).toEqual(['start', 'result']);
    expect(data['settingSources']).toEqual(['project', 'local']);
    expect(data['unreachable']).toEqual(['home-only']);
    expect((data['agents'] as unknown[])[0]).toEqual({
      name: 'tdd-guide',
      scope: 'project',
      path,
      shadows: null,
    });
  });

  it('refuses a positional word with exit code 1, where the same line without it passes', async () => {
    const project = plantScope();

    const refused = await listIn(project, ['tdd-guide']);
    const passed = await listIn(project);

    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain('Expected no argument, got 1: tdd-guide');
    expect(refused.stderr).toContain('Usage: rafa agent list');
    expect([passed.exitCode, passed.stderr]).toEqual([0, '']);
  });

  it('refuses a config the loader refuses with exit code 1, where the same project passes under a usable one', async () => {
    const refusedConfig = plantScope('version: 1\nloop:\n  settingSources: nowhere\n');
    const usable = plantScope();

    const refused = await listIn(refusedConfig);
    const passed = await listIn(usable);

    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain('rafa agent list: the config cannot be used:');
    expect(passed.exitCode).toBe(0);
  });
});
