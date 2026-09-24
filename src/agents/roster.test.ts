/**
 * Tests for the agent roster.
 *
 * Every case plants its definitions under this file's own temporary
 * directory: one `repo`, one `home` and one rafa entry per case, whose
 * `bundled/agents` is the rafa tier. The first roster case asserts the
 * paths it reads resolve there: in the loop the home is the real one and
 * the entry is `Bun.main`, and a case that lost a root would read this
 * machine's `~/.claude/agents` or this checkout's `src/bundled/agents`
 * and pass on whatever they happen to hold. The one live reading is this
 * repo's own `.claude/agents` beside its own rafa tier.
 *
 * Most claims about a tier are a name NOT resolving, and a roster
 * holding nothing but the built-ins satisfies every one of those. So
 * each such case reads the SAME planted roots twice, once under settings
 * that serve the name and once under settings that do not, differing in
 * one setting only, and asserts the name resolves in the first reading.
 * A rule dropped in the module reddens the leg that expects the name and
 * a rule applied to everything reddens the leg that expects it gone.
 *
 * The built-ins are a constant measured off the CLI rather than
 * computed, so nothing here can measure them again without spawning
 * `claude`, which no test does. What is measured here is that a roster
 * carries them, that a definition of a built-in name leaves one entry
 * rather than two, and that names are matched case-sensitively — the
 * three readings the module's note took off the CLI, held against the
 * module's own answer.
 */
import type { AgentRoster, AgentRosterRoots } from './roster.js';
import type { TierPin } from '../config-sections.js';
import type { ClaudeSettingSource } from '../config.js';
import type { TierSettings } from '../tiers/resolve.js';

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { withSourceHeader } from '../commands/agent/vendor.js';
import { CONFIG_DEFAULTS } from '../config.js';
import { findNextTask } from '../utils/tracker.js';

import {
  BUILT_IN_AGENTS,
  BUILT_IN_AGENTS_CLI_VERSION,
  collidingPlanSkills,
  missingAgent,
  missingAgentLine,
  missingPlanAgents,
  planAgentUses,
  planSkillUses,
  readAgentDefinitions,
  resolveAgentRoster,
  rosterResolves,
  skillCollisionLine,
  vendorFixCommand,
  VENDOR_COMMAND,
} from './roster.js';

/** This repo's root, whose own definitions the live case reads. */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** This checkout's entry, whose `bundled/agents` is the live rafa tier. */
const REPO_ENTRY = join(REPO_ROOT, 'src', 'rafa.ts');

/** Sources naming the user scope, so the user tier is loaded. */
const WITH_USER: readonly ClaudeSettingSource[] = ['user', 'project', 'local'];

/** The sources a run with no config resolves to, leaving the user tier out. */
const WITHOUT_USER: readonly ClaudeSettingSource[] = ['project', 'local'];

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-agent-roster-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

let planted = 0;

/** A fresh repo, home and rafa entry under this file's temporary directory. */
function freshRoots(): Required<AgentRosterRoots> {
  planted += 1;
  const base = join(tempBase, `case-${planted}`);
  return { repoRoot: join(base, 'repo'), home: join(base, 'home'), entry: join(base, 'dist', 'cli.js') };
}

/** The rafa tier of `roots`: `bundled/agents` beside its entry. */
function rafaTier(roots: Required<AgentRosterRoots>): string {
  return join(roots.entry, '..', 'bundled', 'agents');
}

/** The settings a run with no config resolves to, with `changes` over them. */
function settings(changes: Partial<TierSettings> = {}): TierSettings {
  return {
    settingSources: WITHOUT_USER,
    tiersRafa: CONFIG_DEFAULTS.tiersRafa,
    tiersSkills: CONFIG_DEFAULTS.tiersSkills,
    tiersAgents: CONFIG_DEFAULTS.tiersAgents,
    ...changes,
  };
}

/** `tiers.agents` holding one entry. */
function pins(name: string, pin: TierPin): Partial<TierSettings> {
  return { tiersAgents: new Map([[name, pin]]) };
}

/** A definition whose frontmatter holds `lines`, then a body. */
function definitionText(...lines: string[]): string {
  return ['---', ...lines, '---', 'The agent body.', ''].join('\n');
}

/** A definition of `name` the served directory would admit: a description and a body. */
function servableText(name: string, body = 'The agent body.'): string {
  return ['---', `name: ${name}`, `description: ${name}, planted.`, '---', body, ''].join('\n');
}

/** Writes `text` as `<dir>/<file>` and answers its path. */
function plantIn(dir: string, file: string, text: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, file);
  writeFileSync(path, text, 'utf8');
  return path;
}

/** Writes `text` as `<root>/.claude/agents/<file>` and answers its path. */
function plant(root: string, file: string, text: string): string {
  return plantIn(join(root, '.claude', 'agents'), file, text);
}

/** Plants `<name>.md` carrying `name` under a root's `.claude/agents`, and answers its path. */
function plantAgent(root: string, name: string, text = servableText(name)): string {
  return plant(root, `${name}.md`, text);
}

/** Plants `<name>.md` in the rafa tier of `roots`, and answers its path. */
function plantRafa(roots: Required<AgentRosterRoots>, name: string, text = servableText(name)): string {
  return plantIn(rafaTier(roots), `${name}.md`, text);
}

/** A `SKILL.md` for `name`: a description, then `body`. */
function skillText(name: string, body = 'The skill body.'): string {
  return ['---', `name: ${name}`, `description: ${name}, planted.`, '---', body, ''].join('\n');
}

/** Plants `<dir>/<name>/SKILL.md`, and answers its path. */
function plantSkillIn(dir: string, name: string, text = skillText(name)): string {
  return plantIn(join(dir, name), 'SKILL.md', text);
}

/** The project tier's skills directory of `roots`. */
function projectSkills(roots: Required<AgentRosterRoots>): string {
  return join(roots.repoRoot, '.claude', 'skills');
}

/** The rafa tier's skills directory of `roots`: `bundled/skills` beside its entry. */
function rafaSkills(roots: Required<AgentRosterRoots>): string {
  return join(roots.entry, '..', 'bundled', 'skills');
}

/** The names of a roster, in the order it holds them. */
function namesOf(roster: AgentRoster): string[] {
  return roster.agents.map((agent) => agent.name);
}

/** The one-line plan routing one open task to `name`. */
function routedTo(name: string): string {
  return `- [ ] Do the work  {agent=${name}}\n`;
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

  it('follows a link to a definition and passes over a dangling one', () => {
    const roots = freshRoots();
    const target = join(roots.repoRoot, 'bundled', 'linked-agent.md');
    mkdirSync(join(roots.repoRoot, 'bundled'), { recursive: true });
    writeFileSync(target, definitionText('name: linked-agent'), 'utf8');
    const dir = join(roots.repoRoot, '.claude', 'agents');
    mkdirSync(dir, { recursive: true });
    const linked = join(dir, 'linked-agent.md');
    symlinkSync('../../bundled/linked-agent.md', linked);
    symlinkSync('../../bundled/absent.md', join(dir, 'dangling.md'));

    expect(readAgentDefinitions(roots.repoRoot)).toEqual([{ name: 'linked-agent', path: linked }]);
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
  it('holds the measured built-ins when no tier holds anything', () => {
    const roots = freshRoots();
    const roster = resolveAgentRoster(roots, settings({ settingSources: WITH_USER }));

    expect(roster.agents).toEqual(BUILT_IN_AGENTS.map((name) => ({ name, scope: 'built-in', path: null })));
    expect(BUILT_IN_AGENTS_CLI_VERSION).toBe('2.1.268');
    expect([roots.repoRoot, roots.home, rafaTier(roots)].every((path) => path.startsWith(tempBase))).toBe(true);
  });

  it('serves a project definition, whatever the sources say', () => {
    const roots = freshRoots();
    const path = plantAgent(roots.repoRoot, 'loop-implementer');

    for (const sources of [WITHOUT_USER, WITH_USER, ['local'] as const]) {
      expect(resolveAgentRoster(roots, settings({ settingSources: sources })).agents)
        .toContainEqual({ name: 'loop-implementer', scope: 'project', path });
    }
  });

  it('serves a rafa-tier definition unless tiers.rafa is off', () => {
    const roots = freshRoots();
    const path = plantRafa(roots, 'tdd-guide');

    expect(resolveAgentRoster(roots, settings()).agents).toContainEqual({ name: 'tdd-guide', scope: 'rafa', path });
    expect(namesOf(resolveAgentRoster(roots, settings({ tiersRafa: 'off' })))).not.toContain('tdd-guide');
  });

  it('serves a user-tier definition only under sources naming user', () => {
    const roots = freshRoots();
    const path = plantAgent(roots.home, 'refactor-cleaner');

    expect(resolveAgentRoster(roots, settings({ settingSources: WITH_USER })).agents)
      .toContainEqual({ name: 'refactor-cleaner', scope: 'user', path });
    expect(namesOf(resolveAgentRoster(roots, settings()))).not.toContain('refactor-cleaner');
  });

  it('serves the nearer of two byte-identical holders once, a vendored copy included', () => {
    const roots = freshRoots();
    const rafa = plantRafa(roots, 'doc-updater');
    const vendored = withSourceHeader(servableText('doc-updater'), rafa, new Date('2026-09-24T12:00:00Z'));
    const project = plantAgent(roots.repoRoot, 'doc-updater', vendored);

    const roster = resolveAgentRoster(roots, settings());

    expect(roster.agents.filter((agent) => agent.name === 'doc-updater'))
      .toEqual([{ name: 'doc-updater', scope: 'project', path: project }]);
    expect(roster.resolution.collisions).toEqual([]);
    // The control: the header is what the comparison drops, so the copy differs from its source.
    expect(vendored).not.toBe(servableText('doc-updater'));
  });

  it('serves neither of two loaded holders whose contents differ, until a pin chooses one', () => {
    const roots = freshRoots();
    plantAgent(roots.repoRoot, 'tdd-guide', servableText('tdd-guide', 'The project body.'));
    const rafa = plantRafa(roots, 'tdd-guide');

    const collided = resolveAgentRoster(roots, settings());
    const pinned = resolveAgentRoster(roots, settings(pins('tdd-guide', 'rafa')));

    expect(namesOf(collided)).not.toContain('tdd-guide');
    expect(collided.resolution.collisions.map((collision) => collision.name)).toEqual(['tdd-guide']);
    expect(pinned.agents).toContainEqual({ name: 'tdd-guide', scope: 'rafa', path: rafa });
  });

  it('holds a definition of a built-in name once, as the CLI lists it once', () => {
    const roots = freshRoots();
    const path = plantAgent(roots.repoRoot, 'Explore');

    const roster = resolveAgentRoster(roots, settings());

    expect(namesOf(roster).filter((name) => name === 'Explore')).toEqual(['Explore']);
    expect(roster.agents).toContainEqual({ name: 'Explore', scope: 'project', path });
    expect(namesOf(roster)).toContain('general-purpose');
  });

  it('lets the built-in answer a name only an unloaded tier holds', () => {
    const roots = freshRoots();
    const path = plantAgent(roots.home, 'Explore');

    expect(resolveAgentRoster(roots, settings()).agents)
      .toContainEqual({ name: 'Explore', scope: 'built-in', path: null });
    expect(resolveAgentRoster(roots, settings({ settingSources: WITH_USER })).agents)
      .toContainEqual({ name: 'Explore', scope: 'user', path });
  });

  it('orders the roster by tier, project then rafa then user, then the built-ins', () => {
    const roots = freshRoots();
    plantAgent(roots.repoRoot, 'zzz-project');
    plantRafa(roots, 'mmm-rafa');
    plantAgent(roots.home, 'aaa-user');

    expect(namesOf(resolveAgentRoster(roots, settings({ settingSources: WITH_USER })))).toEqual([
      'zzz-project',
      'mmm-rafa',
      'aaa-user',
      ...BUILT_IN_AGENTS,
    ]);
  });

  it('leaves out a rafa winner the served directory would refuse, and says why', () => {
    const roots = freshRoots();
    plantRafa(roots, 'no-description', definitionText('name: no-description'));
    plantRafa(roots, 'servable');

    const roster = resolveAgentRoster(roots, settings());

    expect(namesOf(roster)).not.toContain('no-description');
    expect(namesOf(roster)).toContain('servable');
    expect(roster.unserved.get('no-description')).toContain('description');
    expect(roster.unserved.has('servable')).toBe(false);
  });

  it('reads the user tier whatever the sources say, for the vendor command alone', () => {
    const roots = freshRoots();
    const path = plantAgent(roots.home, 'tdd-guide');

    for (const sources of [WITH_USER, WITHOUT_USER, ['local'] as const]) {
      expect(resolveAgentRoster(roots, settings({ settingSources: sources })).userDefinitions.get('tdd-guide')).toBe(path);
    }
    expect(namesOf(resolveAgentRoster(roots, settings()))).not.toContain('tdd-guide');
  });

  it('answers the settings it was resolved under', () => {
    const roots = freshRoots();
    const used = settings({ tiersRafa: 'off' });

    expect(resolveAgentRoster(roots, used).settings).toBe(used);
  });
});

describe('rosterResolves', () => {
  it('matches a name case-sensitively, as the CLI refused a lowercased built-in', () => {
    const roster = resolveAgentRoster(freshRoots(), settings());

    expect(rosterResolves(roster, 'Explore')).toBe(true);
    expect(rosterResolves(roster, 'explore')).toBe(false);
  });

  it('answers false for a name no loaded tier serves', () => {
    const roots = freshRoots();
    plantAgent(roots.home, 'tdd-guide');

    expect(rosterResolves(resolveAgentRoster(roots, settings()), 'tdd-guide')).toBe(false);
    expect(rosterResolves(resolveAgentRoster(roots, settings({ settingSources: WITH_USER })), 'tdd-guide')).toBe(true);
  });
});

describe('vendorFixCommand', () => {
  it('names the vendor command for a name the user tier holds, and null for one it does not', () => {
    const roots = freshRoots();
    plantAgent(roots.home, 'tdd-guide');
    const roster = resolveAgentRoster(roots, settings());

    expect(vendorFixCommand(roster, 'tdd-guide')).toBe(`${VENDOR_COMMAND} tdd-guide`);
    expect(vendorFixCommand(roster, 'tdd-guide')).toBe('rafa agent vendor tdd-guide');
    expect(vendorFixCommand(roster, 'never-written')).toBeNull();
  });
});

describe('missingAgent', () => {
  it('refuses a name no tier holds as unheld, with no fix', () => {
    const roots = freshRoots();
    plantAgent(roots.repoRoot, 'written');
    const roster = resolveAgentRoster(roots, settings());

    expect(missingAgent(roster, { name: 'never-written', lines: [3] })).toEqual({
      name: 'never-written',
      lines: [3],
      reason: 'unheld',
      message: 'agent never-written is held by no tier: no project, rafa or user definition carries it,'
        + ' and it is no built-in agent',
      fix: null,
    });
    expect(missingAgent(roster, { name: 'written', lines: [3] })).toBeNull();
  });

  it('refuses a name only the unloaded user tier holds, naming the tier, the setting and the vendor command', () => {
    const roots = freshRoots();
    const path = plantAgent(roots.home, 'tdd-guide');
    const use = { name: 'tdd-guide', lines: [2] };

    expect(missingAgent(resolveAgentRoster(roots, settings()), use)).toEqual({
      ...use,
      reason: 'unloaded',
      message: `agent tdd-guide is held only by the user tier (${path}),`
        + ' which loop.settingSources (project, local) leaves out:'
        + ' add user to loop.settingSources, or run `rafa agent vendor tdd-guide`',
      fix: 'rafa agent vendor tdd-guide',
    });
    expect(missingAgent(resolveAgentRoster(roots, settings({ settingSources: WITH_USER })), use)).toBeNull();
  });

  it('refuses a name only the switched-off rafa tier holds, naming the tier and the switch, with no vendor fix', () => {
    const roots = freshRoots();
    const path = plantRafa(roots, 'tdd-guide');
    const use = { name: 'tdd-guide', lines: [2] };

    expect(missingAgent(resolveAgentRoster(roots, settings({ tiersRafa: 'off' })), use)).toEqual({
      ...use,
      reason: 'unloaded',
      message: `agent tdd-guide is held only by the rafa tier (${path}), which tiers.rafa: off unloads: set tiers.rafa: on`,
      fix: null,
    });
    expect(missingAgent(resolveAgentRoster(roots, settings()), use)).toBeNull();
  });

  it('refuses a name tiers.agents turns off, naming that line and the pin that would serve it', () => {
    const roots = freshRoots();
    plantRafa(roots, 'tdd-guide');
    const use = { name: 'tdd-guide', lines: [4] };

    expect(missingAgent(resolveAgentRoster(roots, settings(pins('tdd-guide', false))), use)).toEqual({
      ...use,
      reason: 'off',
      message: 'agent tdd-guide is switched off by tiers.agents: { tdd-guide: false };'
        + ' pin the tier that serves it instead: tiers.agents: { tdd-guide: rafa }',
      fix: null,
    });
    expect(missingAgent(resolveAgentRoster(roots, settings()), use)).toBeNull();
  });

  it('refuses a name turned off that no loaded tier holds, saying to drop the entry', () => {
    const roots = freshRoots();
    plantAgent(roots.home, 'tdd-guide');

    const missing = missingAgent(resolveAgentRoster(roots, settings(pins('tdd-guide', false))), { name: 'tdd-guide', lines: [1] });

    expect(missing?.reason).toBe('off');
    expect(missing?.message).toBe('agent tdd-guide is switched off by tiers.agents: { tdd-guide: false }; drop that entry to serve it');
    // Turned off, the name is not offered the vendor command a merely unloaded one is.
    expect(missing?.fix).toBeNull();
  });

  it('refuses a collision naming both paths and the pin line, and resolves it once pinned', () => {
    const roots = freshRoots();
    const project = plantAgent(roots.repoRoot, 'tdd-guide', servableText('tdd-guide', 'The project body.'));
    const rafa = plantRafa(roots, 'tdd-guide');
    const use = { name: 'tdd-guide', lines: [5] };

    expect(missingAgent(resolveAgentRoster(roots, settings()), use)).toEqual({
      ...use,
      reason: 'collision',
      message: 'agent tdd-guide is held by 2 loaded tiers with different contents:'
        + ` project ${project} and rafa ${rafa}; pin the tier that serves it: tiers.agents: { tdd-guide: project }`,
      fix: null,
    });
    expect(missingAgent(resolveAgentRoster(roots, settings(pins('tdd-guide', 'project'))), use)).toBeNull();
    expect(missingAgent(resolveAgentRoster(roots, settings(pins('tdd-guide', 'rafa'))), use)).toBeNull();
  });

  it('refuses a rafa winner the served directory would refuse, naming why and the file', () => {
    const roots = freshRoots();
    const path = plantRafa(roots, 'tdd-guide', definitionText('name: tdd-guide'));
    const use = { name: 'tdd-guide', lines: [1] };

    const missing = missingAgent(resolveAgentRoster(roots, settings()), use);

    expect(missing?.reason).toBe('not-served');
    expect(missing?.message.startsWith('agent tdd-guide is held by the rafa tier but not served: ')).toBe(true);
    expect(missing?.message.endsWith(`(${path})`)).toBe(true);

    plantRafa(roots, 'tdd-guide');
    expect(missingAgent(resolveAgentRoster(roots, settings()), use)).toBeNull();
  });

  it('lets a built-in answer a name turned off that no tier holds', () => {
    const roster = resolveAgentRoster(freshRoots(), settings(pins('Explore', false)));

    expect(missingAgent(roster, { name: 'Explore', lines: [1] })).toBeNull();
    expect(missingAgent(roster, { name: 'explore', lines: [1] })?.reason).toBe('unheld');
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

  it('reads the lines a rafa:* block never closed hides, as the dispatcher reads them', () => {
    const markdown = [
      '- [ ] Write the module  {agent=loop-implementer}',
      '```rafa:context',
      'Context prose the fence never closes.',
      '',
      '- [ ] Write the tests  {agent=tdd-guide}',
      '- [BLOCKED] Repair the gate  {agent=build-error-resolver}',
      '',
    ].join('\n');

    expect(planAgentUses(markdown)).toEqual([
      { name: 'loop-implementer', lines: [1] },
      { name: 'tdd-guide', lines: [5] },
      { name: 'build-error-resolver', lines: [6] },
    ]);
    // The dispatcher over the same document: the blocked line the fence hides, at line 6.
    expect(findNextTask(markdown)).toMatchObject({ task: 'Repair the gate  {agent=build-error-resolver}', lineNum: 5 });
  });

  it('leaves a line a CLOSED block holds out, the near miss the dispatcher also skips', () => {
    const markdown = [
      '- [ ] Write the module  {agent=loop-implementer}',
      '```rafa:context',
      'Context prose the fence closes.',
      '',
      '- [ ] Write the tests  {agent=tdd-guide}',
      '```',
      '',
    ].join('\n');

    expect(planAgentUses(markdown)).toEqual([{ name: 'loop-implementer', lines: [1] }]);
    expect(findNextTask(markdown)).toMatchObject({ task: 'Write the module  {agent=loop-implementer}', lineNum: 0 });
  });

  it('answers nothing for a document with no task line at all', () => {
    expect(planAgentUses('# Plan: nothing to do\n')).toEqual([]);
  });
});

describe('missingPlanAgents', () => {
  it('names only the agents the roster does not resolve, each with why', () => {
    const roots = freshRoots();
    plantAgent(roots.repoRoot, 'loop-implementer');
    plantRafa(roots, 'doc-updater');
    plantAgent(roots.home, 'tdd-guide');
    const roster = resolveAgentRoster(roots, settings());
    const markdown = [
      '- [ ] Write the module  {agent=loop-implementer}',
      '- [ ] Update the page  {agent=doc-updater}',
      '- [ ] Write the tests  {agent=tdd-guide}',
      '- [ ] Ask the void  {agent=no-such-agent}',
      '',
    ].join('\n');

    expect(missingPlanAgents(markdown, roster).map(({ name, lines, reason, fix }) => ({ name, lines, reason, fix }))).toEqual([
      { name: 'tdd-guide', lines: [3], reason: 'unloaded', fix: 'rafa agent vendor tdd-guide' },
      { name: 'no-such-agent', lines: [4], reason: 'unheld', fix: null },
    ]);
  });

  it('answers nothing when every open task routes somewhere the run reaches', () => {
    const roots = freshRoots();
    plantAgent(roots.repoRoot, 'loop-implementer');
    plantRafa(roots, 'doc-updater');
    const markdown = [
      '- [ ] Write the module  {agent=loop-implementer}',
      '- [ ] Update the page  {agent=doc-updater}',
      '- [ ] Explore the tree  {agent=Explore}',
      '',
    ].join('\n');

    expect(missingPlanAgents(markdown, resolveAgentRoster(roots, settings()))).toEqual([]);
    // The control: with the rafa tier off, the one name only it serves is refused.
    expect(missingPlanAgents(markdown, resolveAgentRoster(roots, settings({ tiersRafa: 'off' }))).map((missing) => missing.name))
      .toEqual(['doc-updater']);
  });

  it('names an agent only a line behind a never-closed fence asks for, with that line', () => {
    const roots = freshRoots();
    plantAgent(roots.home, 'tdd-guide');
    const hidden = [
      '- [ ] Write the module  {agent=Explore}',
      '```rafa:context',
      'Context prose the fence never closes.',
      '',
      '- [ ] Write the tests  {agent=tdd-guide}',
      '',
    ].join('\n');
    const closed = hidden.replace('Context prose the fence never closes.', 'Context prose that closes.\n```');
    const roster = resolveAgentRoster(roots, settings());

    expect(missingPlanAgents(hidden, roster).map(({ name, lines }) => ({ name, lines }))).toEqual([{ name: 'tdd-guide', lines: [5] }]);
    // The same line one line lower, outside the block the fence now closes: named there too.
    expect(missingPlanAgents(closed, roster).map(({ name, lines }) => ({ name, lines }))).toEqual([{ name: 'tdd-guide', lines: [6] }]);
  });

  it('refuses a plan routing to an agent tiers.agents turns off, and not the same plan without the entry', () => {
    const roots = freshRoots();
    plantRafa(roots, 'tdd-guide');

    const off = missingPlanAgents(routedTo('tdd-guide'), resolveAgentRoster(roots, settings(pins('tdd-guide', false))));

    expect(off.map((missing) => missing.reason)).toEqual(['off']);
    expect(missingPlanAgents(routedTo('tdd-guide'), resolveAgentRoster(roots, settings()))).toEqual([]);
  });
});

describe('missingAgentLine', () => {
  it('names one line, the agent and the sentence saying why', () => {
    const line = missingAgentLine({
      name: 'tdd-guide',
      lines: [12],
      reason: 'off',
      message: 'agent tdd-guide is switched off by tiers.agents: { tdd-guide: false }; drop that entry to serve it',
      fix: null,
    });

    expect(line).toBe('agent "tdd-guide" (line 12) cannot be dispatched: agent tdd-guide is switched off by'
      + ' tiers.agents: { tdd-guide: false }; drop that entry to serve it');
  });

  it('names every line that asked', () => {
    const line = missingAgentLine({ name: 'no-such-agent', lines: [3, 9], reason: 'unheld', message: 'why', fix: null });

    expect(line).toBe('agent "no-such-agent" (lines 3, 9) cannot be dispatched: why');
  });
});

describe('planSkillUses', () => {
  it('reads every skills= name of the open and blocked lines, with each line that named it, and skips a ticked one', () => {
    const plan = [
      '- [ ] Write it  {skills=documentation,bun-testing}',
      '- [x] Already ran  {skills=ticked-only}',
      '- [BLOCKED] Retry it  {agent=tdd-guide skills=documentation}',
      '- [ ] No declaration at all',
      '',
    ].join('\n');

    expect(planSkillUses(plan)).toEqual([
      { name: 'documentation', lines: [1, 3] },
      { name: 'bun-testing', lines: [1] },
    ]);
    // The agent= of the same lines is read apart, so neither list borrows the other's names.
    expect(planAgentUses(plan)).toEqual([{ name: 'tdd-guide', lines: [3] }]);
  });

  it('reads a line a never-closed fence hides, as the dispatcher reaches it', () => {
    const hidden = ['```rafa:context', 'Never closed.', '', '- [ ] Write it  {skills=documentation}', ''].join('\n');

    expect(planSkillUses(hidden)).toEqual([{ name: 'documentation', lines: [4] }]);
  });
});

describe('collidingPlanSkills', () => {
  it('names a skill the project and rafa tiers hold with different contents, with both paths and the pin line', () => {
    const roots = freshRoots();
    const project = plantSkillIn(projectSkills(roots), 'documentation', skillText('documentation', 'The project body.'));
    const rafa = plantSkillIn(rafaSkills(roots), 'documentation');
    const plan = '- [ ] Write it  {skills=documentation}\n- [ ] Again  {skills=documentation}\n';

    const [colliding, ...rest] = collidingPlanSkills(plan, resolveAgentRoster(roots, settings()));

    expect(rest).toEqual([]);
    expect(colliding?.lines).toEqual([1, 2]);
    expect(colliding?.collision.holders.map((holder) => holder.path)).toEqual([project, rafa]);
    expect(colliding === undefined
      ? null
      : skillCollisionLine(colliding)).toBe('skill "documentation" (lines 1, 2) cannot be served: skill documentation is held by'
      + ` 2 loaded tiers with different contents: project ${project} and rafa ${rafa};`
      + ' pin the tier that serves it: tiers.skills: { documentation: project }');
    expect([project, rafa].every((path) => path.startsWith(tempBase))).toBe(true);
  });

  it('names nothing once a pin chooses, the copies are byte-identical, the rafa tier is off, or no tier holds the name', () => {
    const roots = freshRoots();
    plantSkillIn(projectSkills(roots), 'documentation', skillText('documentation', 'The project body.'));
    plantSkillIn(rafaSkills(roots), 'documentation');
    const identical = freshRoots();
    plantSkillIn(projectSkills(identical), 'documentation');
    plantSkillIn(rafaSkills(identical), 'documentation');
    const plan = '- [ ] Write it  {skills=documentation,held-by-nobody}\n';

    const pinned = settings({ tiersSkills: new Map([['documentation', 'rafa']]) });

    expect(collidingPlanSkills(plan, resolveAgentRoster(roots, pinned))).toEqual([]);
    expect(collidingPlanSkills(plan, resolveAgentRoster(identical, settings()))).toEqual([]);
    expect(collidingPlanSkills(plan, resolveAgentRoster(roots, settings({ tiersRafa: 'off' })))).toEqual([]);
    // The control: the same roots and plan under no pin do collide, so the readings above are not vacuous.
    expect(collidingPlanSkills(plan, resolveAgentRoster(roots, settings())).map((skill) => skill.name))
      .toEqual(['documentation']);
  });

  it('keeps a skill out of the agents, so a skill named like an agent resolves no agent= of that name', () => {
    const roots = freshRoots();
    plantSkillIn(rafaSkills(roots), 'tdd-guide');

    const roster = resolveAgentRoster(roots, settings());

    expect(namesOf(roster)).not.toContain('tdd-guide');
    expect(missingAgent(roster, { name: 'tdd-guide', lines: [1] })?.reason).toBe('unheld');
    // The control: the skill was read, since the resolution holds it as a served skill.
    expect(roster.resolution.items.map((item) => [item.kind, item.name, item.state]))
      .toEqual([['skill', 'tdd-guide', 'served']]);
  });
});

describe('the definitions under this repo', () => {
  it('each routed agent is served by the project, its rafa-tier link target a byte-identical copy', () => {
    const roots = { repoRoot: REPO_ROOT, home: join(tempBase, 'empty-home'), entry: REPO_ENTRY };
    const roster = resolveAgentRoster(roots, settings());

    for (const routed of ['doc-updater', 'tdd-guide', 'build-error-resolver', 'code-reviewer', 'loop-implementer']) {
      expect(rosterResolves(roster, routed)).toBe(true);
      expect(roster.agents.find((agent) => agent.name === routed)?.scope).toBe('project');
    }
    expect(roster.resolution.collisions).toEqual([]);
    expect(roster.userDefinitions.size).toBe(0);
    expect(missingAgent(roster, { name: 'refactor-cleaner', lines: [1] })?.reason).toBe('unheld');
  });

  it('serves the routed agents from the rafa tier alone, in a project holding none of them', () => {
    const roots = { repoRoot: freshRoots().repoRoot, home: join(tempBase, 'empty-home'), entry: REPO_ENTRY };
    const roster = resolveAgentRoster(roots, settings());

    for (const routed of ['doc-updater', 'tdd-guide', 'build-error-resolver', 'code-reviewer', 'loop-implementer']) {
      expect(roster.agents.find((agent) => agent.name === routed)?.scope).toBe('rafa');
    }
    expect(roster.unserved).toEqual(new Map());
  });
});
