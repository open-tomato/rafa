/**
 * Tests for `branch-template.ts`: the base `pr.base` unset is read as,
 * the glob a template names its plan branches by, and the stub read back
 * off a branch.
 *
 * Every null sits beside a branch the same template accepts, so a reader
 * that answered null for everything would fail here. Every expected
 * value is spelled, never built from the template under test.
 */
import { describe, expect, it } from 'bun:test';

import { branchGlob, DEFAULT_BASE_BRANCH, stubOfBranch } from './branch-template.js';

describe('DEFAULT_BASE_BRANCH', () => {
  it('reads pr.base unset as main', () => {
    expect(DEFAULT_BASE_BRANCH).toBe('main');
  });
});

describe('branchGlob', () => {
  it('names feat/rafa-* under the default template', () => {
    expect(branchGlob('feat/{stub}')).toBe('feat/rafa-*');
  });

  it('names work/rafa-* under work/{stub}', () => {
    expect(branchGlob('work/{stub}')).toBe('work/rafa-*');
  });

  it('keeps the part after the stub under the suffix template {stub}-wip', () => {
    expect(branchGlob('{stub}-wip')).toBe('rafa-*-wip');
  });

  it('names rafa-* under the bare {stub}', () => {
    expect(branchGlob('{stub}')).toBe('rafa-*');
  });

  it('replaces the marker literally, a $ in the template included', () => {
    expect(branchGlob('$&/{stub}')).toBe('$&/rafa-*');
  });
});

describe('stubOfBranch', () => {
  it('reads the stub off a branch of the default template', () => {
    expect(stubOfBranch('feat/{stub}', 'feat/rafa-12-claim-status')).toBe('rafa-12-claim-status');
  });

  it('reads the stub off a branch of work/{stub}', () => {
    expect(stubOfBranch('work/{stub}', 'work/rafa-7-x')).toBe('rafa-7-x');
  });

  it('reads the stub before the suffix under {stub}-wip', () => {
    expect(stubOfBranch('{stub}-wip', 'rafa-3-y-wip')).toBe('rafa-3-y');
  });

  it('answers null under {stub}-wip for a branch without the suffix', () => {
    expect(stubOfBranch('{stub}-wip', 'rafa-3-y')).toBeNull();
  });

  it('reads the whole branch as the stub under the bare {stub}', () => {
    expect(stubOfBranch('{stub}', 'rafa-9-z')).toBe('rafa-9-z');
  });

  it('answers null under the bare {stub} for a branch with a prefix', () => {
    expect(stubOfBranch('{stub}', 'feat/rafa-9-z')).toBeNull();
  });

  it('answers null for a branch of another template', () => {
    expect(stubOfBranch('work/{stub}', 'feat/rafa-7-x')).toBeNull();
    expect(stubOfBranch('feat/{stub}', 'work/rafa-7-x')).toBeNull();
    expect(stubOfBranch('feat/{stub}', 'lost/rafa-7-x')).toBeNull();
  });

  it('answers null for a stub that does not open with rafa-', () => {
    expect(stubOfBranch('feat/{stub}', 'feat/login-form')).toBeNull();
    expect(stubOfBranch('work/{stub}', 'work/other-7-x')).toBeNull();
    expect(stubOfBranch('{stub}', 'main')).toBeNull();
  });

  it('answers null when prefix and suffix would overlap', () => {
    expect(stubOfBranch('rafa-{stub}-rafa', 'rafa-rafa')).toBeNull();
    expect(stubOfBranch('rafa-{stub}-rafa', 'rafa-rafa-1-rafa')).toBe('rafa-1');
  });

  it('answers null under a template that does not hold {stub} exactly once', () => {
    expect(stubOfBranch('feat/rafa-1', 'feat/rafa-1')).toBeNull();
    expect(stubOfBranch('{stub}/{stub}', 'rafa-1/rafa-1')).toBeNull();
  });
});
