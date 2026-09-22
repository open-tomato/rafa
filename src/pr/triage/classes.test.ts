/**
 * Tests for the triage vocabulary (`src/pr/triage/classes.ts`).
 *
 * Everything in that module is pure and takes literals, so nothing here
 * plants a repository, spawns `gh` or reads a fixture. The two jobs the
 * file has:
 *
 *  - Hold the class set closed from both ends, the way
 *    `src/check/references.test.ts` holds its issue codes. One case
 *    walks {@link TRIAGE_CLASSES} and collects the classes the
 *    eligibility rule calls simple, so a class added to the list
 *    without a decision about its eligibility, and an eligibility
 *    granted to a class the list does not carry, are both a red case
 *    rather than a silent gap.
 *  - Pair every positive bump reading with a near-miss control, because
 *    a bump reading that answered true for everything would pass every
 *    positive case on its own.
 *
 * Four mutations of `classes.ts` were driven against this file on
 * 2026-09-18, one at a time, the module restored from a scratch copy
 * and verified with `shasum -c` after each, 12 pass either side:
 *
 *  - `isSimpleTriageClass` ignoring `options.dependencyBump`, so the
 *    two CI classes are simple on every pull request: 2 fail, the
 *    per-class eligibility case for a pull request that is not a bump
 *    and the case holding `ci-lint` apart by who opened it.
 *  - the title reading dropped, leaving authorship alone: 4 fail, the
 *    three human-authored bump titles and the same `ci-lint` case,
 *    which is what ties the bump reading to the eligibility rule.
 *  - the author reading dropped, leaving the title alone: 2 fail, the
 *    bot whose title says nothing about dependencies and the
 *    case-folded login beside it.
 *  - `DEPENDENCY_BUMP_TITLE_PREFIX` narrowed to `chore(deps)`, so a
 *    devDependency bump stops reading as one: 1 fail, the
 *    `chore(deps-dev)` case.
 */
import type { DependencyBumpReading, TriageClass } from './classes.js';

import { describe, expect, it } from 'bun:test';

import {
  DEPENDENCY_BUMP_AUTHORS,
  DEPENDENCY_BUMP_SIMPLE_CLASSES,
  DEPENDENCY_BUMP_TITLE_PREFIX,
  isDependencyBump,
  isSimpleTriageClass,
  isTriageClass,
  SIMPLE_TRIAGE_CLASSES,
  TRIAGE_CLASSES,
} from './classes.js';

/** A pull request as the bump reading sees one. */
function pr(title: string, login: string): DependencyBumpReading {
  return { title, author: { login, isBot: login.endsWith('[bot]') } };
}

/** Every class the eligibility rule calls simple for this bump reading. */
function simpleClasses(dependencyBump: boolean): readonly TriageClass[] {
  return TRIAGE_CLASSES.filter(
    (triageClass) => isSimpleTriageClass(triageClass, { dependencyBump }),
  );
}

describe('the class list', () => {
  it('carries eleven distinct classes and freezes the list', () => {
    expect(TRIAGE_CLASSES).toHaveLength(11);
    expect(new Set(TRIAGE_CLASSES).size).toBe(TRIAGE_CLASSES.length);
    expect(Object.isFrozen(TRIAGE_CLASSES)).toBe(true);
  });

  it('accepts every declared class and refuses a near miss', () => {
    for (const triageClass of TRIAGE_CLASSES) expect(isTriageClass(triageClass)).toBe(true);

    expect(isTriageClass('ci-typecheck')).toBe(false);
    expect(isTriageClass('conflict')).toBe(false);
    expect(isTriageClass('Green')).toBe(false);
    expect(isTriageClass('no-check')).toBe(false);
    expect(isTriageClass('none')).toBe(false);
    expect(isTriageClass('')).toBe(false);
    expect(isTriageClass(undefined)).toBe(false);
  });

  it('draws both simple sets from the class list and keeps them disjoint', () => {
    const declared = new Set<string>(TRIAGE_CLASSES);
    const always = new Set<string>(SIMPLE_TRIAGE_CLASSES);

    expect(SIMPLE_TRIAGE_CLASSES.every((one) => declared.has(one))).toBe(true);
    expect(DEPENDENCY_BUMP_SIMPLE_CLASSES.every((one) => declared.has(one))).toBe(true);
    expect(DEPENDENCY_BUMP_SIMPLE_CLASSES.some((one) => always.has(one))).toBe(false);
  });
});

describe('the dependency bump reading', () => {
  it('reads the bot author as a bump whatever its title says', () => {
    expect(DEPENDENCY_BUMP_AUTHORS).toContain('dependabot[bot]');
    expect(isDependencyBump(pr('Update things', 'dependabot[bot]'))).toBe(true);
    expect(isDependencyBump(pr('Update things', 'marcos'))).toBe(false);
  });

  it('reads a human bump title as a bump, and a title that only mentions deps as not', () => {
    expect(isDependencyBump(pr('chore(deps): bump bun-types to 1.3.0', 'marcos'))).toBe(true);
    expect(isDependencyBump(pr('chore: bump deps', 'marcos'))).toBe(false);
    expect(isDependencyBump(pr('fix(deps): pin the resolver', 'marcos'))).toBe(false);
  });

  it('reads a devDependency bump title, which the open prefix is for', () => {
    expect(DEPENDENCY_BUMP_TITLE_PREFIX).toBe('chore(deps');
    expect(isDependencyBump(pr('chore(deps-dev): bump eslint to 9.0.0', 'marcos'))).toBe(true);
  });

  it('folds case and leading space in the title, and case in the login', () => {
    expect(isDependencyBump(pr('  Chore(Deps): bump react', 'marcos'))).toBe(true);
    expect(isDependencyBump(pr('Update things', 'Dependabot[Bot]'))).toBe(true);
  });

  it('reads the app/dependabot author as a bump whatever its title says, unlike a human author', () => {
    expect(isDependencyBump(pr('Update things', 'app/dependabot'))).toBe(true);
    expect(isDependencyBump(pr('Update things', 'marcos'))).toBe(false);
  });
});

describe('the eligibility rule', () => {
  it('calls exactly the two conflict classes simple on a pull request that is not a bump', () => {
    expect(simpleClasses(false)).toEqual([...SIMPLE_TRIAGE_CLASSES]);
  });

  it('adds exactly the two CI classes on a dependency bump', () => {
    const added = simpleClasses(true).filter(
      (one) => !SIMPLE_TRIAGE_CLASSES.includes(one),
    );

    expect(added).toEqual([...DEPENDENCY_BUMP_SIMPLE_CLASSES]);
  });

  it('never calls green or pending simple, on a bump or off one', () => {
    for (const dependencyBump of [false, true]) {
      expect(isSimpleTriageClass('green', { dependencyBump })).toBe(false);
      expect(isSimpleTriageClass('pending', { dependencyBump })).toBe(false);
    }
  });

  it('declares no-checks, reads it back, and keeps it out of both simple sets', () => {
    expect(TRIAGE_CLASSES).toContain('no-checks');
    expect(TRIAGE_CLASSES.indexOf('no-checks')).toBe(TRIAGE_CLASSES.indexOf('pending') + 1);
    expect(isTriageClass('no-checks')).toBe(true);
    expect(SIMPLE_TRIAGE_CLASSES).not.toContain('no-checks');
    expect(DEPENDENCY_BUMP_SIMPLE_CLASSES).not.toContain('no-checks');
    for (const dependencyBump of [false, true]) {
      expect(isSimpleTriageClass('no-checks', { dependencyBump })).toBe(false);
    }
  });

  it('holds a failing lint apart by who opened the pull request', () => {
    const bump = { dependencyBump: isDependencyBump(pr('chore(deps): bump eslint', 'marcos')) };
    const human = { dependencyBump: isDependencyBump(pr('Add the triage command', 'marcos')) };

    expect(isSimpleTriageClass('ci-lint', bump)).toBe(true);
    expect(isSimpleTriageClass('ci-lint', human)).toBe(false);
  });

  it('never calls an unrecognised failure simple, however it was opened', () => {
    for (const dependencyBump of [false, true]) {
      expect(isSimpleTriageClass('ci-other', { dependencyBump })).toBe(false);
      expect(isSimpleTriageClass('conflict-other', { dependencyBump })).toBe(false);
      expect(isSimpleTriageClass('ci-test', { dependencyBump })).toBe(false);
      expect(isSimpleTriageClass('ci-types', { dependencyBump })).toBe(false);
    }
  });
});
