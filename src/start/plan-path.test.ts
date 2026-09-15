/**
 * Tests for the plan a run executes (`src/start/plan-path.ts`).
 *
 * Every root is a directory of its own under one temporary directory this
 * file creates and removes, holding a `PLAN.md` in each directory a case
 * names, and each case holds the path answered under that temporary
 * directory. No case reads the working directory.
 *
 * Each default sits beside its control: `plan.dir` holding a plan beside
 * the same root with the plan only at the root, and a `.plans/PLAN.md`
 * read under a `plan.dir` naming `.plans` beside the same file left
 * unread under the default.
 */
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { DEFAULT_PLAN_FILE, resolvePlanPath } from './plan-path.js';

/** The directory the config resolves `plan.dir` to when no file names one. */
const DEFAULT_PLAN_DIR = join('.rafa', 'plans');

const tempDir = mkdtempSync(join(tmpdir(), 'rafa-plan-path-'));
let made = 0;

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** A root of its own holding a `PLAN.md` in each of `dirs`, `.` naming the root. */
function rootWithPlans(...dirs: string[]): string {
  made += 1;
  const root = join(tempDir, `root-${made}`);
  mkdirSync(root, { recursive: true });
  for (const dir of dirs) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, DEFAULT_PLAN_FILE), `# a plan in ${dir}\n`, 'utf8');
  }
  return root;
}

describe('resolvePlanPath with no --plan', () => {
  it('answers PLAN.md in plan.dir when plan.dir holds one', () => {
    const root = rootWithPlans(DEFAULT_PLAN_DIR, '.');

    const planPath = resolvePlanPath(root, DEFAULT_PLAN_DIR, undefined);

    expect(planPath.startsWith(tempDir)).toBe(true);
    expect(planPath).toBe(join(root, '.rafa', 'plans', 'PLAN.md'));
  });

  it('answers PLAN.md at the project root when plan.dir holds none', () => {
    const root = rootWithPlans('.');

    expect(resolvePlanPath(root, DEFAULT_PLAN_DIR, undefined)).toBe(join(root, 'PLAN.md'));
  });

  it('reads a .plans/PLAN.md only when plan.dir names .plans', () => {
    const root = rootWithPlans('.plans');

    expect(resolvePlanPath(root, DEFAULT_PLAN_DIR, undefined)).toBe(join(root, 'PLAN.md'));
    expect(resolvePlanPath(root, '.plans', undefined)).toBe(join(root, '.plans', 'PLAN.md'));
  });

  it('reads an absolute plan.dir as it is, outside the project root', () => {
    const root = rootWithPlans('.');
    const outside = rootWithPlans('.');

    expect(resolvePlanPath(root, outside, undefined)).toBe(join(outside, 'PLAN.md'));
  });

  it('answers PLAN.md at the project root when no plan exists anywhere, for the run to refuse', () => {
    const root = rootWithPlans();

    expect(resolvePlanPath(root, DEFAULT_PLAN_DIR, undefined)).toBe(join(root, 'PLAN.md'));
  });

  it('reads a bare --plan= as no --plan', () => {
    const root = rootWithPlans(DEFAULT_PLAN_DIR);

    expect(resolvePlanPath(root, DEFAULT_PLAN_DIR, '')).toBe(join(root, '.rafa', 'plans', 'PLAN.md'));
  });
});

describe('resolvePlanPath with --plan', () => {
  it('resolves the value against the project root whatever plan.dir holds', () => {
    const root = rootWithPlans(DEFAULT_PLAN_DIR);

    const planPath = resolvePlanPath(root, DEFAULT_PLAN_DIR, join('elsewhere', 'PLAN-x.md'));

    expect(planPath.startsWith(tempDir)).toBe(true);
    expect(planPath).toBe(join(root, 'elsewhere', 'PLAN-x.md'));
  });

  it('answers an absolute value as it is', () => {
    const root = rootWithPlans(DEFAULT_PLAN_DIR);
    const outside = join(tempDir, 'outside', 'PLAN-y.md');

    expect(resolvePlanPath(root, DEFAULT_PLAN_DIR, outside)).toBe(outside);
  });
});
