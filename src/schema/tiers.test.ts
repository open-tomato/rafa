/**
 * Tests for the tier resolver (`src/schema/tiers.ts`): the paths the
 * three skill tiers and the two instinct scopes resolve to, the link
 * the rafa tier is measured through, and the two membership checks.
 *
 * Every case hands a home and a project root of its own, both under a
 * temporary directory of this file's own, so nothing here reads the
 * real home or `~/.claude/skills`. The one case that needs files on
 * disk is the rafa tier's, which plants a runtime directory and a `bin`
 * link into it, as `~/.rafa/bin/rafa` links into
 * `~/.rafa/runtime/<version>/`.
 *
 * ## The control
 *
 * The link case could be a false negative: a resolver that ignored
 * links entirely would still answer a path ending in `skills`. So it is
 * held to the runtime's directory AND held apart from the link's own,
 * which is the answer an unresolved entry gives.
 *
 * The shadowing cases hand the user record first, so a resolver that
 * kept the order it was handed instead of the scope order would answer
 * the user's record and fail them.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  bundledSkillsDirectory,
  INSTINCT_SCOPES,
  instinctScopeDirectory,
  isInstinctScope,
  isSkillTier,
  realEntry,
  resolveInstinctScopes,
  resolveSkillTiers,
  shadowLessonsById,
  SKILL_TIERS,
  skillTierDirectory,
  tierExists,
} from './tiers.js';

/**
 * A temporary directory of this file's own, holding every planted
 * tree. Its own path is resolved through every link, because the rafa
 * tier resolves the entry it is given and `/var` is a link on macOS.
 */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-tiers-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A home and a project root of this file's own, neither of them read from disk. */
const HOME = join(tempBase, 'home');
const ROOT = join(tempBase, 'project');

/** The seams a case hands when it names an entry of its own. */
function seamsWith(entry: string) {
  return { home: HOME, projectRoot: ROOT, entry };
}

describe('the skill tiers', () => {
  it('resolves user to the home, project to the root and rafa to the entry directory', () => {
    const seams = seamsWith('/install/runtime/cli.js');

    expect(skillTierDirectory('user', seams)).toBe(join(HOME, '.claude', 'skills'));
    expect(skillTierDirectory('project', seams)).toBe(join(ROOT, '.claude', 'skills'));
    expect(skillTierDirectory('rafa', seams)).toBe(join('/install/runtime', 'skills'));
  });

  it('answers no directory for the project tier without a project root', () => {
    const seams = { home: HOME, projectRoot: null, entry: '/install/runtime/cli.js' };

    expect(skillTierDirectory('project', seams)).toBeNull();
    expect(skillTierDirectory('user', seams)).toBe(join(HOME, '.claude', 'skills'));
  });

  it('lists the tiers nearest the work first, leaving out the one with no directory', () => {
    expect(SKILL_TIERS).toEqual(['project', 'rafa', 'user']);
    expect(resolveSkillTiers(seamsWith('/install/runtime/cli.js')).map((tier) => tier.tier))
      .toEqual(['project', 'rafa', 'user']);
    expect(resolveSkillTiers({ home: HOME, projectRoot: null, entry: '/install/runtime/cli.js' })
      .map((tier) => tier.tier)).toEqual(['rafa', 'user']);
  });

  it('measures the rafa tier through the link an installed rafa is reached by', () => {
    const install = join(tempBase, 'install');
    const runtime = join(install, 'runtime', '0.3.0');
    const bin = join(install, 'bin');
    mkdirSync(runtime, { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(runtime, 'cli.js'), '// the runtime\n', 'utf8');
    symlinkSync(join(runtime, 'cli.js'), join(bin, 'rafa'));

    const answered = bundledSkillsDirectory(join(bin, 'rafa'));

    expect(answered).toBe(join(runtime, 'skills'));
    expect(answered).not.toBe(join(bin, 'skills'));
  });

  it('answers a path that is not there as it was given', () => {
    const absent = join(tempBase, 'no-such', 'cli.js');

    expect(realEntry(absent)).toBe(absent);
    expect(bundledSkillsDirectory(absent)).toBe(join(dirname(absent), 'skills'));
  });

  it('measures the entry off Bun.main when the caller names none', () => {
    expect(bundledSkillsDirectory()).toBe(join(dirname(realEntry(Bun.main)), 'skills'));
  });
});

describe('the instinct scopes', () => {
  it('resolves user to the home and project to the root, with no rafa scope', () => {
    const seams = seamsWith('/install/runtime/cli.js');

    expect(INSTINCT_SCOPES).toEqual(['project', 'user']);
    expect(instinctScopeDirectory('user', seams)).toBe(join(HOME, '.rafa', 'instincts'));
    expect(instinctScopeDirectory('project', seams)).toBe(join(ROOT, '.rafa', 'instincts'));
  });

  it('leaves the project scope out when there is no project root', () => {
    const without = resolveInstinctScopes({ home: HOME, projectRoot: null });

    expect(resolveInstinctScopes(seamsWith('/x/cli.js')).map((scope) => scope.scope)).toEqual(['project', 'user']);
    expect(without.map((scope) => scope.scope)).toEqual(['user']);
    expect(instinctScopeDirectory('project', { home: HOME, projectRoot: null })).toBeNull();
  });
});

describe('lesson shadowing by id', () => {
  const lesson = (scope: 'project' | 'user', id: string, path: string) => ({ scope, id, path });

  it('serves the project record and shadows the user one of the same id', () => {
    const user = lesson('user', 'retry-flaky', '/home/retry-flaky.md');
    const project = lesson('project', 'retry-flaky', '/root/retry-flaky.md');

    const answered = shadowLessonsById([user, project]);

    expect(answered.winners).toEqual([project]);
    expect(answered.shadowed).toEqual([{ record: user, by: project }]);
  });

  it('keeps every record whose id only one scope holds, in scope order', () => {
    const userOnly = lesson('user', 'only-user', '/home/only-user.md');
    const projectOnly = lesson('project', 'only-project', '/root/only-project.md');

    const answered = shadowLessonsById([userOnly, projectOnly]);

    expect(answered.winners).toEqual([projectOnly, userOnly]);
    expect(answered.shadowed).toEqual([]);
  });

  it('shadows a second record of one id inside one scope by the first it was handed', () => {
    const first = lesson('user', 'twice', '/home/a/twice.md');
    const second = lesson('user', 'twice', '/home/b/twice.md');

    const answered = shadowLessonsById([first, second]);

    expect(answered.winners).toEqual([first]);
    expect(answered.shadowed).toEqual([{ record: second, by: first }]);
  });

  it('answers nothing for no records', () => {
    expect(shadowLessonsById([])).toEqual({ winners: [], shadowed: [] });
  });

  it('refuses a record in the rafa tier, which holds no lessons', () => {
    const rafa = { scope: 'rafa', id: 'shipped', path: '/install/shipped.md' } as unknown as ReturnType<typeof lesson>;

    expect(() => shadowLessonsById([lesson('project', 'shipped', '/root/shipped.md'), rafa]))
      .toThrow('lesson shipped names scope rafa, which holds no lessons');
  });
});

describe('what a line may name', () => {
  it('reads the three tiers and the two scopes, and nothing else', () => {
    expect(SKILL_TIERS.filter((tier) => !isSkillTier(tier))).toEqual([]);
    expect(isSkillTier('rafa')).toBe(true);
    expect(isSkillTier('rafas')).toBe(false);
    expect(isInstinctScope('project')).toBe(true);
    expect(isInstinctScope('rafa')).toBe(false);
  });
});

describe('whether a resolved directory is there', () => {
  it('tells an absent tier from one that exists', () => {
    const tier = join(tempBase, 'present', '.claude', 'skills');
    mkdirSync(tier, { recursive: true });

    expect(tierExists(tier)).toBe(true);
    expect(tierExists(join(tempBase, 'present', '.claude', 'absent'))).toBe(false);
  });
});
