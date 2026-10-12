import type { GitResult, GitRunner } from '../pr/git.js';

import { describe, expect, it } from 'bun:test';

import { suggestedEnvironment } from './places.js';
import { codeVersionOf, errorLineOf, versionsText } from './versions.js';

/** A git answering each first argument with what `answers` holds, recording every call. */
function plantGit(answers: Readonly<Record<string, Partial<GitResult>>>): { readonly git: GitRunner; readonly calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    git: (args) => {
      calls.push([...args]);
      return { ok: true, stdout: '', stderr: '', ...answers[args[0] ?? ''] };
    },
  };
}

describe('the code version a bug is filed with', () => {
  it('reads the short commit, and a clean tree as not dirty', () => {
    const planted = plantGit({ 'rev-parse': { stdout: '2bdad97\n' } });
    expect(codeVersionOf(planted.git)).toEqual({ commit: '2bdad97', dirty: false });
    expect(planted.calls).toEqual([['rev-parse', '--short', 'HEAD'], ['status', '--porcelain', '--untracked-files=no']]);
  });

  it('reads a tracked change as dirty', () => {
    const planted = plantGit({ 'rev-parse': { stdout: '2bdad97\n' }, 'status': { stdout: ' M src/a.ts\n' } });
    expect(codeVersionOf(planted.git)).toEqual({ commit: '2bdad97', dirty: true });
  });

  it('answers no commit outside a repository, asking nothing more', () => {
    const planted = plantGit({ 'rev-parse': { ok: false, stderr: 'fatal: not a git repository' } });
    expect(codeVersionOf(planted.git)).toEqual({ commit: null, dirty: false });
    expect(planted.calls).toHaveLength(1);
  });

  it('reads a status that failed as not dirty', () => {
    const planted = plantGit({ 'rev-parse': { stdout: '2bdad97\n' }, 'status': { ok: false, stdout: 'noise' } });
    expect(codeVersionOf(planted.git)).toEqual({ commit: '2bdad97', dirty: false });
  });
});

describe('the place rafa suggests', () => {
  it.each([{}, { CI: '' }, { CI: '0' }, { CI: 'false' }, { CI: 'FALSE' }, { CI: '  ' }])('reads %p as local', (env) => {
    expect(suggestedEnvironment(env)).toBe('local');
  });

  it.each([{ CI: 'true' }, { CI: '1' }, { CI: 'yes' }])('reads %p as ci', (env) => {
    expect(suggestedEnvironment(env)).toBe('ci');
  });
});

describe('the Versions section', () => {
  const owner = { name: '@acme/hub', version: '0.3.1', dir: 'packages/hub' };

  it('writes the rafa version, the commit with its dirty mark, the package and the path', () => {
    expect(versionsText({ rafa: '0.42.0', code: { commit: '2bdad97', dirty: true }, owner, path: 'packages/hub/src/deep/b.ts' }))
      .toBe('rafa: 0.42.0\ncode: 2bdad97-dirty\npackage: @acme/hub@0.3.1\npath: packages/hub/src/deep/b.ts');
  });

  it('writes an unknown commit, and leaves out a package and a path it has none of', () => {
    expect(versionsText({ rafa: '0.42.0', code: { commit: null, dirty: false }, owner: null, path: null }))
      .toBe('rafa: 0.42.0\ncode: unknown');
  });

  it('writes a package with no version by its name alone', () => {
    expect(versionsText({ rafa: '0.42.0', code: { commit: '2bdad97', dirty: false }, owner: { ...owner, version: null }, path: null }))
      .toBe('rafa: 0.42.0\ncode: 2bdad97\npackage: @acme/hub');
  });
});

describe('the error line of an artifact', () => {
  it('is its first line that is not blank', () => {
    expect(errorLineOf('\n  TypeError: x is not a function\n    at run (src/a.ts:1:1)')).toBe('TypeError: x is not a function');
  });

  it('is none for a blank artifact', () => {
    expect(errorLineOf('  \n')).toBeNull();
  });
});
