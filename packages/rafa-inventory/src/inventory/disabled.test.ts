/**
 * Tests for the disabled readings.
 *
 * Every case plants a home and a project root of its own under this
 * file's temporary directory, so nothing reads the real home. A reader
 * that answered "not disabled" for everything would pass every negative
 * here, so each negative sits beside a control that reads the same
 * world, changed in one place, as disabled: the plugin exemption beside
 * the same name and value on a user row, a nearer `on` beside the same
 * `off` with no nearer file, and so on.
 */
import type { DisabledSubject, OverrideSeams } from './disabled.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  disabledState,
  OVERRIDE_DISABLED,
  overrideFor,
  overrideSettingsPath,
  readFileSwitches,
  readSkillOverrides,
  readSwitch,
  readSwitches,
} from './disabled.js';
import { readSkillTree } from './trees.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-inventory-disabled-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

let planted = 0;

/** A fresh world: a home and a project root, neither written yet. */
function freshSeams(): { readonly home: string; readonly projectRoot: string } {
  planted += 1;
  const base = join(tempBase, `case-${planted}`);
  return { home: join(base, 'home'), projectRoot: join(base, 'project') };
}

/** Writes `text` at `path`, making its directories. */
function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** The three settings files of a world. */
function settingsFiles(seams: { readonly home: string; readonly projectRoot: string }) {
  return {
    local: join(seams.projectRoot, '.claude/settings.local.json'),
    project: join(seams.projectRoot, '.claude/settings.json'),
    user: join(seams.home, '.claude/settings.json'),
  };
}

/** Writes a settings file holding `overrides` as its `skillOverrides`. */
function plantOverrides(path: string, overrides: Readonly<Record<string, unknown>>): void {
  write(path, JSON.stringify({ skillOverrides: overrides }));
}

/** A skill file whose frontmatter holds `lines`. */
function plantSkill(path: string, lines: readonly string[]): string {
  write(path, `---\n${lines.join('\n')}\n---\n\n# Body\n`);
  return path;
}

/** A skill row at `path` from `source`. */
function skill(name: string, path: string, source: DisabledSubject['source'] = 'project'): DisabledSubject {
  return { kind: 'skill', name, source, path };
}

describe('where the settings files sit', () => {
  it('reads local and project under the root and user under the home', () => {
    const seams = freshSeams();
    const files = settingsFiles(seams);

    expect(overrideSettingsPath('local', seams)).toBe(files.local);
    expect(overrideSettingsPath('project', seams)).toBe(files.project);
    expect(overrideSettingsPath('user', seams)).toBe(files.user);
  });

  it('drops the project scopes with no project root and keeps the user one', () => {
    const seams: OverrideSeams = { ...freshSeams(), projectRoot: null };

    expect(overrideSettingsPath('local', seams)).toBeNull();
    expect(readSkillOverrides(seams).scopes.map((scope) => scope.scope)).toEqual(['user']);
  });
});

describe('skillOverrides across the three files', () => {
  it('reads every file, nearest first, with all four values', () => {
    const seams = freshSeams();
    const files = settingsFiles(seams);
    plantOverrides(files.local, { a: 'on' });
    plantOverrides(files.project, { b: 'name-only' });
    plantOverrides(files.user, { c: 'user-invocable-only', d: 'off' });

    const reading = readSkillOverrides(seams);

    expect(reading.warnings).toEqual([]);
    expect(reading.scopes.map((scope) => [scope.scope, [...scope.overrides]])).toEqual([
      ['local', [['a', 'on']]],
      ['project', [['b', 'name-only']]],
      ['user', [['c', 'user-invocable-only'], ['d', 'off']]],
    ]);
  });

  it('lets the nearest file holding a name decide', () => {
    const seams = freshSeams();
    const files = settingsFiles(seams);
    plantOverrides(files.user, { gate: 'off' });

    // Control: the user file alone switches it off.
    expect(overrideFor(readSkillOverrides(seams), 'gate')).toEqual({ value: 'off', scope: 'user', path: files.user });

    plantOverrides(files.project, { gate: 'name-only' });
    expect(overrideFor(readSkillOverrides(seams), 'gate')?.scope).toBe('project');

    plantOverrides(files.local, { gate: 'on' });
    expect(overrideFor(readSkillOverrides(seams), 'gate')).toEqual({ value: 'on', scope: 'local', path: files.local });
  });

  it('reads absent files and a file without the key as nothing and no warning', () => {
    const seams = freshSeams();
    write(settingsFiles(seams).project, JSON.stringify({ model: 'opus' }));

    const reading = readSkillOverrides(seams);

    expect(reading.warnings).toEqual([]);
    expect(reading.scopes.every((scope) => scope.overrides.size === 0)).toBe(true);
    expect(overrideFor(reading, 'anything')).toBeNull();
  });

  it('turns an unreadable file into one warning and keeps the other files', () => {
    const seams = freshSeams();
    const files = settingsFiles(seams);
    write(files.local, '{ not json');
    write(files.project, '[1, 2]');
    plantOverrides(files.user, { gate: 'off' });

    const reading = readSkillOverrides(seams);

    expect(reading.warnings.map((warning) => [warning.scope, warning.path])).toEqual([
      ['local', files.local],
      ['project', files.project],
    ]);
    expect(reading.warnings[0]?.reason).toStartWith('is not JSON');
    expect(reading.warnings[1]?.reason).toContain('expected a mapping');
    expect(overrideFor(reading, 'gate')?.value).toBe('off');
  });

  it('warns on a skillOverrides that is not a mapping', () => {
    const seams = freshSeams();
    write(settingsFiles(seams).project, JSON.stringify({ skillOverrides: ['gate'] }));

    const reading = readSkillOverrides(seams);

    expect(reading.warnings).toHaveLength(1);
    expect(reading.warnings[0]?.reason).toContain('skillOverrides');
  });

  it('warns on one unknown value and keeps the file\'s other entries', () => {
    const seams = freshSeams();
    plantOverrides(settingsFiles(seams).project, { gate: 'disabled', other: 'off' });

    const reading = readSkillOverrides(seams);

    expect(reading.warnings).toHaveLength(1);
    expect(reading.warnings[0]?.reason).toContain('"gate"');
    expect(overrideFor(reading, 'gate')).toBeNull();
    expect(overrideFor(reading, 'other')?.value).toBe('off');
  });
});

describe('the frontmatter switches', () => {
  it('parses a switch the way Claude Code does', () => {
    expect(readSwitch(true)).toBe(true);
    expect(readSwitch('Yes')).toBe(true);
    expect(readSwitch(1)).toBe(true);
    expect(readSwitch(' off ')).toBe(false);
    expect(readSwitch('0')).toBe(false);
    expect(readSwitch('maybe')).toBeNull();
    expect(readSwitch(null)).toBeNull();
  });

  it('reads the defaults when neither key is set', () => {
    expect(readSwitches(null)).toEqual({ disableModelInvocation: false, userInvocable: true });
    expect(readSwitches({ name: 'x' })).toEqual({ disableModelInvocation: false, userInvocable: true });
  });

  it('reads an unparseable present value as false for both keys', () => {
    const switches = readSwitches({ 'user-invocable': 'maybe', 'disable-model-invocation': 'maybe' });
    expect(switches).toEqual({ disableModelInvocation: false, userInvocable: false });
  });

  it('reads a file with no readable block as the defaults', () => {
    const seams = freshSeams();
    const path = join(seams.projectRoot, 'loose.md');
    write(path, '# No frontmatter\n');

    expect(readFileSwitches(path)).toEqual({ disableModelInvocation: false, userInvocable: true });
    expect(readFileSwitches(join(seams.projectRoot, 'missing.md')).userInvocable).toBe(true);
  });
});

describe('disabledState', () => {
  it('reads an item switched off, planted in a real tree, as disabled:skillOverrides', () => {
    const seams = freshSeams();
    const skills = join(seams.projectRoot, '.claude/skills');
    plantSkill(join(skills, 'gate/SKILL.md'), ['name: gate', 'description: Run the gates']);
    plantSkill(join(skills, 'other/SKILL.md'), ['name: other', 'description: Something else']);
    plantOverrides(settingsFiles(seams).project, { gate: 'off' });

    const reading = readSkillOverrides(seams);
    const tree = readSkillTree('project', { ...seams, pathDirs: [] });
    const states = tree.items.map((item) => [item.name, disabledState(item, reading)]);

    // Control: the unnamed skill in the same tree and world stays enabled.
    expect(states).toEqual([['gate', OVERRIDE_DISABLED], ['other', null]]);
  });

  it('reads the other three values as not disabled', () => {
    const seams = freshSeams();
    const path = plantSkill(join(seams.projectRoot, '.claude/skills/gate/SKILL.md'), ['name: gate']);
    const file = settingsFiles(seams).user;

    for (const value of ['on', 'name-only', 'user-invocable-only']) {
      plantOverrides(file, { gate: value });
      expect(disabledState(skill('gate', path), readSkillOverrides(seams))).toBeNull();
    }
    plantOverrides(file, { gate: 'off' });
    expect(disabledState(skill('gate', path), readSkillOverrides(seams))).toBe(OVERRIDE_DISABLED);
  });

  it('lets a nearer on re-enable a farther off', () => {
    const seams = freshSeams();
    const path = plantSkill(join(seams.projectRoot, '.claude/skills/gate/SKILL.md'), ['name: gate']);
    const files = settingsFiles(seams);
    plantOverrides(files.user, { gate: 'off' });
    expect(disabledState(skill('gate', path), readSkillOverrides(seams))).toBe(OVERRIDE_DISABLED);

    plantOverrides(files.local, { gate: 'on' });
    expect(disabledState(skill('gate', path), readSkillOverrides(seams))).toBeNull();
  });

  it('exempts a plugin skill from skillOverrides', () => {
    const seams = freshSeams();
    const path = plantSkill(join(seams.home, 'plugin/skills/gate/SKILL.md'), ['name: gate']);
    plantOverrides(settingsFiles(seams).user, { 'superpowers:gate': 'off' });
    const reading = readSkillOverrides(seams);

    expect(disabledState(skill('superpowers:gate', path, 'plugin:superpowers'), reading)).toBeNull();
    // Control: the same name, value and file switch a user row off.
    expect(disabledState(skill('superpowers:gate', path, 'user'), reading)).toBe(OVERRIDE_DISABLED);
  });

  it('reads disable-model-invocation as disabled, a plugin skill included', () => {
    const seams = freshSeams();
    const skills = join(seams.projectRoot, '.claude/skills');
    const switched = plantSkill(join(skills, 'manual/SKILL.md'), ['name: manual', 'disable-model-invocation: true']);
    const plain = plantSkill(join(skills, 'plain/SKILL.md'), ['name: plain']);
    const reading = readSkillOverrides(seams);

    expect(disabledState(skill('manual', switched), reading)).toBe('disabled:disable-model-invocation');
    expect(disabledState(skill('p:manual', switched, 'plugin:p'), reading)).toBe('disabled:disable-model-invocation');
    expect(disabledState(skill('plain', plain), reading)).toBeNull();
  });

  it('does not read user-invocable false as disabled', () => {
    const seams = freshSeams();
    const path = plantSkill(join(seams.projectRoot, '.claude/skills/hidden/SKILL.md'), ['name: hidden', 'user-invocable: false']);

    expect(readFileSwitches(path).userInvocable).toBe(false);
    expect(disabledState(skill('hidden', path), readSkillOverrides(seams))).toBeNull();
  });

  it('prefers an off override over the frontmatter switch', () => {
    const seams = freshSeams();
    const path = plantSkill(join(seams.projectRoot, '.claude/skills/both/SKILL.md'), ['name: both', 'disable-model-invocation: true']);
    plantOverrides(settingsFiles(seams).project, { both: 'off' });

    expect(disabledState(skill('both', path), readSkillOverrides(seams))).toBe(OVERRIDE_DISABLED);
  });

  it('never disables an agent, whatever the settings or its frontmatter say', () => {
    const seams = freshSeams();
    const path = plantSkill(join(seams.projectRoot, '.claude/agents/reviewer.md'), ['name: reviewer', 'disable-model-invocation: true']);
    plantOverrides(settingsFiles(seams).project, { reviewer: 'off' });
    const reading = readSkillOverrides(seams);

    expect(disabledState({ kind: 'agent', name: 'reviewer', source: 'project', path }, reading)).toBeNull();
    // Control: the same file read as a skill row is disabled.
    expect(disabledState(skill('reviewer', path), reading)).toBe(OVERRIDE_DISABLED);
  });
});
