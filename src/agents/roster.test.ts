/**
 * Tests for the agent roster.
 *
 * Every case plants its definitions under this file's own temporary
 * directory, one `repo` and one `home` per case, and the first case
 * asserts the paths it reads resolve there: in the loop the second root
 * is the real home, and a case that lost a root would read this
 * machine's `~/.claude/agents` and pass on whatever it happens to hold.
 * The one live reading is this repo's own `.claude/agents`, whose
 * definitions the roster has to answer for by the names they carry.
 *
 * Most claims about the setting sources are a scope NOT loaded, and a
 * roster holding nothing but the built-ins satisfies every one of
 * those. So each such case reads the SAME planted roots twice, once
 * under sources that load the scope and once under sources that do not,
 * and asserts the name is there in the first reading. A rule dropped in
 * the module reddens the leg that expects the name and a rule applied
 * to everything reddens the leg that expects it gone.
 *
 * The built-ins are a constant measured off the CLI rather than
 * computed, so nothing here can measure them again without spawning
 * `claude`, which no test does. What is measured here is that a roster
 * carries them, that a definition of a built-in name leaves one entry
 * rather than two, and that names are matched case-sensitively — the
 * three readings the module's note took off the CLI, held against the
 * module's own answer.
 */
import type { AgentRosterRoots } from './roster.js';
import type { ClaudeSettingSource } from '../config.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  BUILT_IN_AGENTS,
  BUILT_IN_AGENTS_CLI_VERSION,
  missingAgentLine,
  missingPlanAgents,
  planAgentUses,
  readAgentDefinitions,
  resolveAgentRoster,
  rosterResolves,
  vendorFixCommand,
  VENDOR_COMMAND,
} from './roster.js';

/** This repo's root, whose own definitions the live case reads. */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Sources naming the user scope, so the home is loaded. */
const WITH_USER: readonly ClaudeSettingSource[] = ['user', 'project', 'local'];

/** The sources a run with no config resolves to, leaving the user scope out. */
const WITHOUT_USER: readonly ClaudeSettingSource[] = ['project', 'local'];

/** Sources naming neither scope that holds definitions. */
const LOCAL_ONLY: readonly ClaudeSettingSource[] = ['local'];

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-agent-roster-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

let planted = 0;

/** A fresh pair of roots under this file's temporary directory. */
function freshRoots(): AgentRosterRoots {
  planted += 1;
  const base = join(tempBase, `case-${planted}`);
  return { repoRoot: join(base, 'repo'), home: join(base, 'home') };
}

/** A definition whose frontmatter holds `lines`, then a body. */
function definitionText(...lines: string[]): string {
  return ['---', ...lines, '---', 'The agent body.', ''].join('\n');
}

/** Writes `text` as `<root>/.claude/agents/<file>` and answers its path. */
function plant(root: string, file: string, text: string): string {
  const dir = join(root, '.claude', 'agents');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, file);
  writeFileSync(path, text, 'utf8');
  return path;
}

/** Plants `<name>.md` carrying `name`, and answers its path. */
function plantAgent(root: string, name: string): string {
  return plant(root, `${name}.md`, definitionText(`name: ${name}`));
}

/** The names of a roster, in the order it holds them. */
function namesOf(roots: AgentRosterRoots, sources: readonly ClaudeSettingSource[]): string[] {
  return resolveAgentRoster(roots, sources).agents.map((agent) => agent.name);
}

describe('readAgentDefinitions', () => {
  it('keys a definition by its frontmatter name and not by its file name', () => {
    const roots = freshRoots();
    const path = plant(roots.repoRoot, 'weird-file.md', definitionText('name: renamed-agent'));

    expect(readAgentDefinitions(roots.repoRoot)).toEqual([{ name: 'renamed-agent', path }]);
    expect(path.startsWith(tempBase)).toBe(true);
  });

  it('answers nothing for a root with no agents directory', () => {
    const roots = freshRoots();

    expect(readAgentDefinitions(roots.repoRoot)).toEqual([]);

    plantAgent(roots.repoRoot, 'tdd-guide');
    expect(readAgentDefinitions(roots.repoRoot).map((file) => file.name)).toEqual(['tdd-guide']);
  });

  it('passes over a file with no frontmatter, no name, or an unusable one', () => {
    const roots = freshRoots();
    plant(roots.repoRoot, 'README.md', 'Agents live here.\n');
    plant(roots.repoRoot, 'no-name.md', definitionText('model: haiku'));
    plant(roots.repoRoot, 'empty-name.md', definitionText('name: ""'));
    plant(roots.repoRoot, 'listed-name.md', definitionText('name: [tdd-guide]'));
    plant(roots.repoRoot, 'unclosed.md', '---\nname: unclosed\n');
    const usable = plantAgent(roots.repoRoot, 'doc-updater');

    expect(readAgentDefinitions(roots.repoRoot)).toEqual([{ name: 'doc-updater', path: usable }]);
  });

  it('passes over a directory and a file that is not markdown', () => {
    const roots = freshRoots();
    const usable = plantAgent(roots.repoRoot, 'doc-updater');
    plant(roots.repoRoot, 'notes.txt', definitionText('name: notes'));
    mkdirSync(join(roots.repoRoot, '.claude', 'agents', 'nested.md'), { recursive: true });

    expect(readAgentDefinitions(roots.repoRoot)).toEqual([{ name: 'doc-updater', path: usable }]);
  });

  it('answers both files carrying one name, sorted by name', () => {
    const roots = freshRoots();
    const second = plant(roots.repoRoot, 'b-copy.md', definitionText('name: tdd-guide'));
    const first = plant(roots.repoRoot, 'a-copy.md', definitionText('name: tdd-guide'));
    const other = plantAgent(roots.repoRoot, 'code-reviewer');

    expect(readAgentDefinitions(roots.repoRoot)).toEqual([
      { name: 'code-reviewer', path: other },
      { name: 'tdd-guide', path: first },
      { name: 'tdd-guide', path: second },
    ]);
  });
});

describe('resolveAgentRoster', () => {
  it('holds the measured built-ins when no root defines anything', () => {
    const roots = freshRoots();
    const roster = resolveAgentRoster(roots, WITH_USER);

    expect(roster.agents).toEqual(BUILT_IN_AGENTS.map((name) => ({
      name,
      scope: 'built-in',
      path: null,
      shadows: null,
    })));
    expect(BUILT_IN_AGENTS_CLI_VERSION).toBe('2.1.268');
  });

  it('adds the project definitions only under sources naming project', () => {
    const roots = freshRoots();
    const path = plantAgent(roots.repoRoot, 'loop-implementer');

    expect(resolveAgentRoster(roots, WITHOUT_USER).agents).toContainEqual({
      name: 'loop-implementer',
      scope: 'project',
      path,
      shadows: null,
    });
    expect(namesOf(roots, LOCAL_ONLY)).not.toContain('loop-implementer');
  });

  it('adds the home definitions only under sources naming user', () => {
    const roots = freshRoots();
    const path = plantAgent(roots.home, 'refactor-cleaner');

    expect(resolveAgentRoster(roots, WITH_USER).agents).toContainEqual({
      name: 'refactor-cleaner',
      scope: 'user',
      path,
      shadows: null,
    });
    expect(namesOf(roots, WITHOUT_USER)).not.toContain('refactor-cleaner');
  });

  it('takes the project definition over the home one and names what it shadows', () => {
    const roots = freshRoots();
    const project = plantAgent(roots.repoRoot, 'doc-updater');
    const user = plantAgent(roots.home, 'doc-updater');

    const loaded = resolveAgentRoster(roots, WITH_USER).agents
      .filter((agent) => agent.name === 'doc-updater');

    expect(loaded).toEqual([{ name: 'doc-updater', scope: 'project', path: project, shadows: user }]);
    expect(resolveAgentRoster(roots, WITHOUT_USER).agents).toContainEqual({
      name: 'doc-updater',
      scope: 'project',
      path: project,
      shadows: null,
    });
  });

  it('holds a definition of a built-in name once, as the CLI lists it once', () => {
    const roots = freshRoots();
    const path = plantAgent(roots.repoRoot, 'Explore');

    const names = namesOf(roots, WITHOUT_USER);

    expect(names.filter((name) => name === 'Explore')).toEqual(['Explore']);
    expect(resolveAgentRoster(roots, WITHOUT_USER).agents).toContainEqual({
      name: 'Explore',
      scope: 'project',
      path,
      shadows: null,
    });
    expect(names).toContain('general-purpose');
  });

  it('orders the roster project first, then user, then the built-ins', () => {
    const roots = freshRoots();
    plantAgent(roots.repoRoot, 'zzz-project');
    plantAgent(roots.home, 'aaa-user');

    expect(namesOf(roots, WITH_USER)).toEqual([
      'zzz-project',
      'aaa-user',
      ...BUILT_IN_AGENTS,
    ]);
  });

  it('reads the home whatever the sources say, for the fix command alone', () => {
    const roots = freshRoots();
    const path = plantAgent(roots.home, 'tdd-guide');

    for (const sources of [WITH_USER, WITHOUT_USER, LOCAL_ONLY]) {
      expect(resolveAgentRoster(roots, sources).userDefinitions.get('tdd-guide')).toBe(path);
    }
    expect(namesOf(roots, WITHOUT_USER)).not.toContain('tdd-guide');
  });

  it('answers the sources it was resolved under', () => {
    const roots = freshRoots();

    expect(resolveAgentRoster(roots, WITHOUT_USER).settingSources).toEqual(WITHOUT_USER);
  });
});

describe('rosterResolves', () => {
  it('matches a name case-sensitively, as the CLI refused a lowercased built-in', () => {
    const roots = freshRoots();
    const roster = resolveAgentRoster(roots, WITHOUT_USER);

    expect(rosterResolves(roster, 'Explore')).toBe(true);
    expect(rosterResolves(roster, 'explore')).toBe(false);
  });

  it('answers false for a name no scope the sources load defines', () => {
    const roots = freshRoots();
    plantAgent(roots.home, 'tdd-guide');

    expect(rosterResolves(resolveAgentRoster(roots, WITHOUT_USER), 'tdd-guide')).toBe(false);
    expect(rosterResolves(resolveAgentRoster(roots, WITH_USER), 'tdd-guide')).toBe(true);
  });
});

describe('vendorFixCommand', () => {
  it('names the vendor command for a name the home defines', () => {
    const roots = freshRoots();
    plantAgent(roots.home, 'tdd-guide');
    const roster = resolveAgentRoster(roots, WITHOUT_USER);

    expect(vendorFixCommand(roster, 'tdd-guide')).toBe(`${VENDOR_COMMAND} tdd-guide`);
    expect(vendorFixCommand(roster, 'tdd-guide')).toBe('rafa agent vendor tdd-guide');
  });

  it('answers null for a name no user definition carries', () => {
    const roots = freshRoots();
    plantAgent(roots.home, 'tdd-guide');
    const roster = resolveAgentRoster(roots, WITHOUT_USER);

    expect(vendorFixCommand(roster, 'never-written')).toBeNull();
    expect(vendorFixCommand(roster, 'tdd-guide')).not.toBeNull();
  });
});

describe('planAgentUses', () => {
  it('answers the agents of open and blocked lines, by line, counting from one', () => {
    const markdown = [
      '# Stage: one',
      '',
      '- [ ] Write the module  {agent=loop-implementer effort=high}',
      '- [BLOCKED] Repair the gate  {agent=build-error-resolver}',
      '- [ ] Update the page  {agent=doc-updater}',
      '',
    ].join('\n');

    expect(planAgentUses(markdown)).toEqual([
      { name: 'loop-implementer', lines: [3] },
      { name: 'build-error-resolver', lines: [4] },
      { name: 'doc-updater', lines: [5] },
    ]);
  });

  it('skips a ticked line, whose dispatch is behind the run', () => {
    const markdown = [
      '- [x] Write the module  {agent=already-ran}',
      '- [ ] Update the page  {agent=doc-updater}',
      '',
    ].join('\n');

    expect(planAgentUses(markdown).map((use) => use.name)).toEqual(['doc-updater']);
  });

  it('skips a line with no declaration and one declaring no agent', () => {
    const markdown = [
      '- [ ] Write the module',
      '- [ ] Update the page  {effort=low budget=2}',
      '- [ ] Repair the gate  {agent=build-error-resolver}',
      '',
    ].join('\n');

    expect(planAgentUses(markdown)).toEqual([{ name: 'build-error-resolver', lines: [3] }]);
  });

  it('gathers every line that named one agent, in first-named order', () => {
    const markdown = [
      '- [ ] Write the module  {agent=doc-updater}',
      '- [ ] Repair the gate  {agent=build-error-resolver}',
      '- [BLOCKED] Update the page  {agent=doc-updater}',
      '',
    ].join('\n');

    expect(planAgentUses(markdown)).toEqual([
      { name: 'doc-updater', lines: [1, 3] },
      { name: 'build-error-resolver', lines: [2] },
    ]);
  });

  it('answers nothing for a document with no task line at all', () => {
    expect(planAgentUses('# Plan: nothing to do\n')).toEqual([]);
  });
});

describe('missingPlanAgents', () => {
  it('names only the agents the roster does not resolve, each with its fix', () => {
    const roots = freshRoots();
    plantAgent(roots.repoRoot, 'loop-implementer');
    plantAgent(roots.home, 'tdd-guide');
    const roster = resolveAgentRoster(roots, WITHOUT_USER);
    const markdown = [
      '- [ ] Write the module  {agent=loop-implementer}',
      '- [ ] Write the tests  {agent=tdd-guide}',
      '- [ ] Ask the void  {agent=no-such-agent}',
      '',
    ].join('\n');

    expect(missingPlanAgents(markdown, roster)).toEqual([
      { name: 'tdd-guide', lines: [2], fix: 'rafa agent vendor tdd-guide' },
      { name: 'no-such-agent', lines: [3], fix: null },
    ]);
  });

  it('answers nothing when every open task routes somewhere the run reaches', () => {
    const roots = freshRoots();
    plantAgent(roots.repoRoot, 'loop-implementer');
    const markdown = [
      '- [ ] Write the module  {agent=loop-implementer}',
      '- [ ] Explore the tree  {agent=Explore}',
      '',
    ].join('\n');

    expect(missingPlanAgents(markdown, resolveAgentRoster(roots, WITHOUT_USER))).toEqual([]);
  });

  it('stops naming an agent the sources bring into reach', () => {
    const roots = freshRoots();
    plantAgent(roots.home, 'tdd-guide');
    const markdown = '- [ ] Write the tests  {agent=tdd-guide}\n';

    expect(missingPlanAgents(markdown, resolveAgentRoster(roots, WITHOUT_USER)).length).toBe(1);
    expect(missingPlanAgents(markdown, resolveAgentRoster(roots, WITH_USER))).toEqual([]);
  });
});

describe('missingAgentLine', () => {
  it('names one line, the agent and the command to run', () => {
    const line = missingAgentLine({
      name: 'tdd-guide',
      lines: [12],
      fix: 'rafa agent vendor tdd-guide',
    });

    expect(line).toContain('"tdd-guide"');
    expect(line).toContain('line 12');
    expect(line).toContain('`rafa agent vendor tdd-guide`');
  });

  it('names every line that asked, and says so when there is no fix', () => {
    const line = missingAgentLine({ name: 'no-such-agent', lines: [3, 9], fix: null });

    expect(line).toContain('lines 3, 9');
    expect(line).toContain('~/.claude/agents');
    expect(line).not.toContain(VENDOR_COMMAND);
  });
});

describe('the definitions under this repo', () => {
  it('each resolves under project sources, with an empty home', () => {
    const roots = { repoRoot: REPO_ROOT, home: join(tempBase, 'empty-home') };
    const roster = resolveAgentRoster(roots, WITHOUT_USER);

    for (const routed of ['doc-updater', 'tdd-guide', 'build-error-resolver', 'code-reviewer', 'loop-implementer']) {
      expect(rosterResolves(roster, routed)).toBe(true);
      expect(roster.agents.find((agent) => agent.name === routed)?.scope).toBe('project');
    }
    expect(roster.userDefinitions.size).toBe(0);
    expect(rosterResolves(roster, 'refactor-cleaner')).toBe(false);
  });
});
