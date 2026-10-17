import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { rerunOf } from '../triage/bug-filing.js';

import { NO_RERUN_REASON, readTestReference, resolveTestReference } from './test-reference.js';

/** The reason `value` is refused with, or the reading when it is not refused. */
function reasonOf(value: string | null): string {
  const reference = readTestReference(value);
  return reference.kind === 'manual'
    ? reference.reason
    : `runnable ${JSON.stringify(reference)}`;
}

describe('reading a Rerun value', () => {
  it('reads a file with no -t as runnable with a null pattern', () => {
    expect(readTestReference('bun test src/a.test.ts'))
      .toEqual({ kind: 'runnable', file: 'src/a.test.ts', pattern: null });
  });

  it('reads a file and a quoted -t value as runnable', () => {
    expect(readTestReference('  bun test src/a.test.ts -t "outer the case"  '))
      .toEqual({ kind: 'runnable', file: 'src/a.test.ts', pattern: 'outer the case' });
  });

  it('reads the value triage writes for a case with parentheses as the single-backslash pattern', () => {
    // Arrange
    const rerun = rerunOf({ what: 'red', artifact: 'src/c.test.ts > outer > a (case) [1]' });

    // Act
    const reference = readTestReference(rerun);

    // Assert: the control proves triage wrote the doubled backslashes the reading undoes
    expect(rerun).toBe('bun test src/c.test.ts -t "outer a \\\\(case\\\\) \\\\[1\\\\]"');
    expect(reference).toEqual({ kind: 'runnable', file: 'src/c.test.ts', pattern: 'outer a \\(case\\) \\[1\\]' });
  });

  it('reads an escaped backslash before a parenthesis and a bracket as one backslash', () => {
    expect(readTestReference('bun test a.test.ts -t "a \\\\(b\\\\) \\\\[1\\\\]"'))
      .toEqual({ kind: 'runnable', file: 'a.test.ts', pattern: 'a \\(b\\) \\[1\\]' });
  });

  it('reads an escaped double quote and an escaped dollar as the character', () => {
    expect(readTestReference('bun test a.test.ts -t "a \\"q\\" b"'))
      .toEqual({ kind: 'runnable', file: 'a.test.ts', pattern: 'a "q" b' });
    expect(readTestReference('bun test a.test.ts -t "\\$x"'))
      .toEqual({ kind: 'runnable', file: 'a.test.ts', pattern: '$x' });
  });

  it('keeps a backslash before any other character with that character', () => {
    expect(readTestReference('bun test a.test.ts -t "a\\.b \\(c\\)"'))
      .toEqual({ kind: 'runnable', file: 'a.test.ts', pattern: 'a\\.b \\(c\\)' });
  });

  it('keeps shell characters inside the quoted -t value as one word', () => {
    expect(readTestReference('bun test a.spec.tsx -t "a; b | (c) \\$x"'))
      .toEqual({ kind: 'runnable', file: 'a.spec.tsx', pattern: 'a; b | (c) $x' });
  });

  it('refuses an unescaped dollar or backtick inside the -t value, naming the character', () => {
    expect(reasonOf('bun test a.test.ts -t "a $x"')).toBe('a shell character $ inside the -t value');
    expect(reasonOf('bun test a.test.ts -t "a `x`"')).toBe('a shell character ` inside the -t value');
    expect(reasonOf('bun test a.test.ts -t "\\\\$x"')).toBe('a shell character $ inside the -t value');
  });

  it('refuses an odd backslash before the closing quote as an unterminated double quote', () => {
    expect(reasonOf('bun test a.test.ts -t "case\\"')).toBe('an unterminated double quote');
    expect(reasonOf('bun test a.test.ts -t "case\\\\\\"')).toBe('an unterminated double quote');
    // Control: an even run of backslashes closes the value
    expect(readTestReference('bun test a.test.ts -t "case\\\\"'))
      .toEqual({ kind: 'runnable', file: 'a.test.ts', pattern: 'case\\' });
  });

  it('refuses a null or blank value as having no Rerun section', () => {
    expect(readTestReference(null)).toEqual({ kind: 'manual', reason: NO_RERUN_REASON });
    expect(reasonOf('  \n ')).toBe(NO_RERUN_REASON);
  });

  it('refuses a shell character after the file', () => {
    expect(reasonOf('bun test a.test.ts; echo x')).toBe('a shell character ; in a.test.ts;');
    expect(reasonOf('bun test a.test.ts && echo x')).toBe('a shell character & in &&');
  });

  it('refuses a flag other than -t', () => {
    expect(reasonOf('bun test --preload ./x.ts a.test.ts')).toBe('a flag other than -t: --preload');
    expect(reasonOf('bun test a.test.ts --bail')).toBe('a flag other than -t: --bail');
  });

  it('refuses a path that leaves the checkout, and an absolute one', () => {
    expect(reasonOf('bun test ../a.test.ts')).toBe('a path that leaves the checkout: ../a.test.ts');
    expect(reasonOf('bun test src/../../a.test.ts')).toBe('a path that leaves the checkout: src/../../a.test.ts');
    expect(reasonOf('bun test /repo/src/a.test.ts')).toBe('an absolute path /repo/src/a.test.ts');
  });

  it('refuses a second line', () => {
    expect(reasonOf('bun test a.test.ts\nbun test b.test.ts')).toBe('a second line');
  });

  it('refuses a second -t', () => {
    expect(reasonOf('bun test a.test.ts -t "x" -t "y"')).toBe('a second -t');
  });

  it('refuses an unquoted, missing or empty -t value, and a double quote inside it', () => {
    expect(reasonOf('bun test a.test.ts -t case')).toBe('an unquoted -t value: case');
    expect(reasonOf('bun test a.test.ts -t')).toBe('a missing -t value');
    expect(reasonOf('bun test a.test.ts -t ""')).toBe('an empty -t value');
    expect(reasonOf('bun test a.test.ts -t "a "q" b"')).toBe('a double quote inside the -t value');
    expect(reasonOf('bun test a.test.ts -t "open')).toBe('an unterminated double quote');
  });

  it('refuses a word after the file, and after the -t value', () => {
    expect(reasonOf('bun test a.test.ts b.test.ts')).toBe('a word after the file: b.test.ts');
    expect(reasonOf('bun test a.test.ts -t "x" extra')).toBe('a word after the -t value: extra');
  });

  it('refuses another command, a missing file and a file that is not a test file', () => {
    expect(reasonOf('bunx test a.test.ts')).toBe('not a bun test command');
    expect(reasonOf('bun run a.test.ts')).toBe('not a bun test command');
    expect(reasonOf('bun test')).toBe('no test file');
    expect(reasonOf('bun test src/a.ts')).toBe('not a test file: src/a.ts');
    expect(reasonOf('bun test "a.test.ts"')).toBe('a quoted file "a.test.ts"');
  });
});

describe('the value triage writes and the pattern recheck runs', () => {
  const CASES: readonly (readonly [string, string])[] = [
    ['a (case)', 'a \\(case\\)'],
    ['a [1]', 'a \\[1\\]'],
    ['a.b', 'a\\.b'],
    ['a*b', 'a\\*b'],
    ['a "q"', 'a "q"'],
    ['$x', '\\$x'],
  ];

  for (const [name, spelled] of CASES) {
    it(`reads the case ${name} back as its escaped pattern, which matches it`, () => {
      // Act
      const reference = readTestReference(rerunOf({ what: 'red', artifact: `src/c.test.ts > ${name}` }));

      // Assert
      expect(reference).toEqual({ kind: 'runnable', file: 'src/c.test.ts', pattern: spelled });
      expect(new RegExp(spelled).test(name)).toBe(true);
    });
  }
});

describe('resolving a test reference against a checkout', () => {
  let root: string;
  let checkout: string;

  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'test-reference-')));
    checkout = join(root, 'checkout');
    mkdirSync(join(checkout, 'src'), { recursive: true });
    writeFileSync(join(checkout, 'src', 'a.test.ts'), '');
    writeFileSync(join(root, 'far.test.ts'), '');
    symlinkSync(join(root, 'far.test.ts'), join(checkout, 'src', 'out.test.ts'));
    symlinkSync(join(checkout, 'src', 'a.test.ts'), join(checkout, 'src', 'in.test.ts'));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** The reference to `file` with no pattern. */
  const referenceTo = (file: string) => ({ kind: 'runnable' as const, file, pattern: null });

  it('resolves a file inside the checkout to its repo-relative path', () => {
    expect(resolveTestReference(referenceTo('src/a.test.ts'), checkout))
      .toEqual({ kind: 'resolved', path: 'src/a.test.ts' });
  });

  it('reads a symlink that leaves the checkout as outside, where one inside resolves', () => {
    expect(resolveTestReference(referenceTo('src/out.test.ts'), checkout)).toEqual({ kind: 'outside' });
    expect(resolveTestReference(referenceTo('src/in.test.ts'), checkout))
      .toEqual({ kind: 'resolved', path: 'src/a.test.ts' });
  });

  it('reads a file that is not there as missing', () => {
    expect(resolveTestReference(referenceTo('src/gone.test.ts'), checkout)).toEqual({ kind: 'missing' });
  });
});
