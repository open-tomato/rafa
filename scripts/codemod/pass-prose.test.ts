/**
 * Step 5's scope of the pass-moves codemod: which files are the build's,
 * and the notes it lists for them in place of rewrites.
 */
import { describe, expect, it } from 'bun:test';

import { BUILD_FOLDER, BUILD_MANIFEST, buildNotes, isBuildScope, isProseScope } from './pass-prose';

describe('isBuildScope', () => {
  it.each([
    ['the library build script', 'scripts/build/bundle.ts'],
    ['its test', 'scripts/build/bundle.test.ts'],
    ['the root manifest', BUILD_MANIFEST],
  ])('reads %s as a build file', (_name, file) => {
    expect(isBuildScope(file)).toBe(true);
  });

  it.each([
    ['a script outside the build folder', 'scripts/survey/files.ts'],
    ['a prose file under the build folder', `${BUILD_FOLDER}README.md`],
    ['a package\'s manifest', 'packages/rafa-inventory/package.json'],
    ['a source file', 'src/index.ts'],
  ])('does not read %s as a build file', (_name, file) => {
    expect(isBuildScope(file)).toBe(false);
  });

  it('reads a build script as prose too, so step 5 finds its paths before it leaves them', () => {
    expect(isProseScope('scripts/build/bundle.ts')).toBe(true);
    expect(isProseScope(BUILD_MANIFEST)).toBe(false);
  });
});

describe('buildNotes', () => {
  it('names each rewrite by its line, the path as written and the path it would take, in text order', () => {
    // Arrange
    const text = 'const A = 1;\nexport const E = [\'src/a.ts\', \'src/b.ts\'];\n';
    const at = (token: string): number => text.indexOf(token);
    const edits = [
      { end: at('src/b.ts') + 8, pos: at('src/b.ts'), text: 'packages/x/src/b.ts' },
      { end: at('src/a.ts') + 8, pos: at('src/a.ts'), text: 'packages/x/src/a.ts' },
    ];

    // Act
    const notes = buildNotes('scripts/build/bundle.ts', text, edits);

    // Assert
    expect(notes).toEqual([
      { file: 'scripts/build/bundle.ts', line: 2, text: 'src/a.ts -> packages/x/src/a.ts' },
      { file: 'scripts/build/bundle.ts', line: 2, text: 'src/b.ts -> packages/x/src/b.ts' },
    ]);
  });

  it('names nothing for a file with no rewrite', () => {
    expect(buildNotes('package.json', '{}\n', [])).toEqual([]);
  });
});
