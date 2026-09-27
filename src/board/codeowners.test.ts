/**
 * Tests for the CODEOWNERS reader (`src/board/codeowners.ts`): where the
 * file is found, which lines are rules, how each pattern shape matches,
 * whose a path is and which lines name an owner.
 *
 * The pattern and parsing cases are pure calls over literal text. The
 * location cases plant files in scratch repositories under `tmpdir`.
 *
 * ## The controls
 *
 * A matcher answering true for everything, or false for everything,
 * would pass half of any pattern case, so every pattern shape is read
 * against a path it must match AND one it must not. The rest:
 *
 *  - Last-match-wins is read both ways round, the same two lines in
 *    either order, so a reader taking the first match fails one of them.
 *  - The location order plants all three files and then takes them away
 *    one at a time, so a reader with a fixed answer fails a step.
 *  - The skipped lines sit beside a readable one in the same text, so a
 *    parser that dropped every line, or kept every line, fails.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  CODEOWNERS_LOCATIONS,
  findCodeowners,
  lastMatchingRule,
  matchesPattern,
  ownersOf,
  parseCodeowners,
  readCodeowners,
  rulesNaming,
} from './codeowners.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-codeowners-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A scratch repository holding `files`, repo-relative path to text. */
function plantRepo(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tempBase, 'repo-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** Each case: a pattern, the paths it matches, the paths it does not. */
const PATTERN_CASES: readonly (readonly [string, readonly string[], readonly string[]])[] = [
  // anchored
  ['/build/logs/', ['build/logs/a.txt', 'build/logs/deep/b.txt'], ['build/logs', 'x/build/logs/a.txt']],
  ['/apps/github', ['apps/github', 'apps/github/x.ts'], ['apps/githubber', 'x/apps/github']],
  ['docs/*.md', ['docs/a.md'], ['x/docs/a.md', 'docs/sub/a.md']],
  ['src/board', ['src/board/roadmap.ts'], ['lib/src/board/roadmap.ts']],
  // directory
  ['apps/', ['apps/a.ts', 'x/y/apps/a.ts'], ['apps', 'myapps/a.ts']],
  ['/docs/', ['docs/a.md', 'docs/sub/b.md'], ['docs', 'x/docs/a.md']],
  // `*`
  ['*', ['a.ts', 'deep/nested/b.ts'], ['']],
  ['*.js', ['a.js', 'x/y/a.js'], ['a.ts', 'a.jsx']],
  ['docs/*', ['docs/getting-started.md'], ['docs/build-app/troubleshooting.md', 'docs']],
  ['src/*/index.ts', ['src/board/index.ts'], ['src/a/b/index.ts', 'src/index.ts']],
  ['a?c.ts', ['abc.ts'], ['a/c.ts', 'ac.ts']],
  // `**`
  ['**/logs', ['build/logs/a', 'deeply/nested/logs/b', 'logs/c'], ['build/logsx/a', 'logs.txt']],
  ['/src/**/test.ts', ['src/test.ts', 'src/a/b/test.ts'], ['test.ts', 'lib/src/test.ts']],
  ['/src/**', ['src/a.ts', 'src/a/b.ts'], ['src', 'lib/src/a.ts']],
  ['**', ['a', 'a/b/c'], ['']],
  // literal characters a regular expression reads as syntax
  ['/a.b+c(1)', ['a.b+c(1)'], ['aXb+c(1)', 'a.bbc1']],
  ['/a\\*b', ['a*b'], ['axb']],
];

describe('matchesPattern', () => {
  for (const [pattern, matching, other] of PATTERN_CASES) {
    it(`reads ${pattern} as matching ${matching.join(', ')}`, () => {
      expect(matching.filter((path) => !matchesPattern(pattern, path))).toEqual([]);
    });
    it(`reads ${pattern} as not matching ${other.map((path) => `"${path}"`).join(', ')}`, () => {
      expect(other.filter((path) => matchesPattern(pattern, path))).toEqual([]);
    });
  }

  it('takes a leading ./ or / off the path', () => {
    expect(matchesPattern('/src/', './src/a.ts')).toBe(true);
    expect(matchesPattern('/src/', '/src/a.ts')).toBe(true);
    expect(matchesPattern('/src/', 'lib/a.ts')).toBe(false);
  });

  it('is case sensitive, as GitHub is', () => {
    expect(matchesPattern('/Docs/', 'Docs/a.md')).toBe(true);
    expect(matchesPattern('/Docs/', 'docs/a.md')).toBe(false);
  });

  it('matches nothing for a lone slash', () => {
    expect(matchesPattern('/', 'a.ts')).toBe(false);
  });
});

describe('parseCodeowners', () => {
  it('skips blank lines and comments, drops inline comments and keeps line numbers', () => {
    const text = [
      '# This is a comment.',
      '',
      '*       @global-owner1 @global-owner2',
      '   # an indented comment',
      '*.js    @js-owner #This is an inline comment.',
      '*.go docs@example.com',
      '*.txt @octo-org/octocats',
      '\t',
    ].join('\n');

    const read = parseCodeowners(text);

    expect(read.rules).toEqual([
      { pattern: '*', owners: ['@global-owner1', '@global-owner2'], line: 3 },
      { pattern: '*.js', owners: ['@js-owner'], line: 5 },
      { pattern: '*.go', owners: ['docs@example.com'], line: 6 },
      { pattern: '*.txt', owners: ['@octo-org/octocats'], line: 7 },
    ]);
    expect(read.skipped).toEqual([]);
  });

  it('keeps a pattern with no owners as a rule that unassigns', () => {
    expect(parseCodeowners('/apps/github\r\n').rules).toEqual([{ pattern: '/apps/github', owners: [], line: 1 }]);
  });

  it('skips the lines GitHub cannot read and keeps the readable one beside them', () => {
    const text = [
      '!/secret @a',
      '/[ab]/ @a',
      '/a/***/b @a',
      '/src/ owner-without-at',
      '/lib/ @kept',
    ].join('\n');

    const read = parseCodeowners(text);

    expect(read.rules).toEqual([{ pattern: '/lib/', owners: ['@kept'], line: 5 }]);
    expect(read.skipped.map((skip) => [skip.line, skip.reason])).toEqual([
      [1, 'negation'],
      [2, 'character-range'],
      [3, 'triple-asterisk'],
      [4, 'malformed-owner'],
    ]);
    expect(read.skipped[3]?.text).toBe('/src/ owner-without-at');
  });

  it('reads an empty text as no rules', () => {
    expect(parseCodeowners('')).toEqual({ rules: [], skipped: [] });
  });
});

describe('the last matching line', () => {
  const OWNED_THEN_OVERRIDDEN = parseCodeowners([
    '*        @global',
    '/apps/   @octocat',
    '/apps/github @doctocat',
  ].join('\n'));

  it('wins over every earlier match', () => {
    expect(ownersOf(OWNED_THEN_OVERRIDDEN, 'apps/github/x.ts')).toEqual(['@doctocat']);
    expect(ownersOf(OWNED_THEN_OVERRIDDEN, 'apps/other/x.ts')).toEqual(['@octocat']);
    expect(ownersOf(OWNED_THEN_OVERRIDDEN, 'README.md')).toEqual(['@global']);
    expect(lastMatchingRule(OWNED_THEN_OVERRIDDEN, 'apps/github/x.ts')?.line).toBe(3);
  });

  it('is the later line, not the more specific one', () => {
    const reversed = parseCodeowners([
      '/apps/github @doctocat',
      '/apps/   @octocat',
    ].join('\n'));

    expect(ownersOf(reversed, 'apps/github/x.ts')).toEqual(['@octocat']);
  });

  it('unassigns the path when it has no owners', () => {
    const unassigned = parseCodeowners([
      '/apps/ @octocat',
      '/apps/github',
    ].join('\n'));

    expect(ownersOf(unassigned, 'apps/github/x.ts')).toEqual([]);
    expect(lastMatchingRule(unassigned, 'apps/github/x.ts')?.line).toBe(2);
    expect(ownersOf(unassigned, 'apps/other.ts')).toEqual(['@octocat']);
  });

  it('is absent when no line matches', () => {
    const narrow = parseCodeowners('/src/ @a');

    expect(lastMatchingRule(narrow, 'lib/a.ts')).toBeNull();
    expect(ownersOf(narrow, 'lib/a.ts')).toEqual([]);
  });
});

describe('rulesNaming', () => {
  const FILE = parseCodeowners([
    '*              @org/everyone',
    '/src/board/    @Open-Tomato/Loop @someone',
    '/src/commands/ @open-tomato/cli',
    '/docs/         @open-tomato/loop',
  ].join('\n'));

  it('answers the lines naming an owner, in file order, handles case folded', () => {
    expect(rulesNaming(FILE, '@open-tomato/loop').map((rule) => rule.pattern)).toEqual(['/src/board/', '/docs/']);
    expect(rulesNaming(FILE, '@open-tomato/cli').map((rule) => rule.line)).toEqual([3]);
  });

  it('answers nothing for an owner no line names', () => {
    expect(rulesNaming(FILE, '@open-tomato/nobody')).toEqual([]);
  });
});

describe('findCodeowners and readCodeowners', () => {
  it('looks in .github/, the root and docs/, in that order, taking the first found', () => {
    const root = plantRepo({
      '.github/CODEOWNERS': '* @github\n',
      'CODEOWNERS': '* @root\n',
      'docs/CODEOWNERS': '* @docs\n',
    });
    const found: (string | null)[] = [];
    const owners: (readonly string[] | undefined)[] = [];

    for (const location of [...CODEOWNERS_LOCATIONS, null]) {
      found.push(findCodeowners(root));
      owners.push(readCodeowners(root)?.rules[0]?.owners);
      if (location !== null) rmSync(join(root, location));
    }

    expect(found).toEqual(['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS', null]);
    expect(owners).toEqual([['@github'], ['@root'], ['@docs'], undefined]);
  });

  it('takes an empty first file over a later full one', () => {
    const root = plantRepo({ '.github/CODEOWNERS': '', 'CODEOWNERS': '* @root\n' });

    expect(readCodeowners(root)).toEqual({ path: '.github/CODEOWNERS', rules: [], skipped: [] });
  });

  it('passes over a directory named CODEOWNERS', () => {
    const root = plantRepo({ 'CODEOWNERS/readme': 'not the file', 'docs/CODEOWNERS': '* @docs\n' });

    expect(findCodeowners(root)).toBe('docs/CODEOWNERS');
  });

  it('answers null for a repository with no file', () => {
    const root = plantRepo({ 'README.md': '# hi\n' });

    expect(findCodeowners(root)).toBeNull();
    expect(readCodeowners(root)).toBeNull();
  });
});
