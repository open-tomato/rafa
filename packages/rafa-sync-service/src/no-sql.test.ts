/**
 * The leak rule's grep over this package: the sync client speaks
 * `WirePayload` and holds no SQL, so no source under `src/` names
 * `SELECT`, `INSERT`, `CREATE` or `WHERE` outside a comment. The words
 * are matched as whole words in capitals.
 *
 * TypeScript's parser says what a comment is, so a `//` or `/*` inside a
 * string hides nothing. Test files are not read: they open a device's
 * store to assert on it. `testdata/planted-sql.fixture.ts` plants the
 * fault and is left out of the reading of the real sources, then read on
 * its own to show the red.
 */
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

const SOURCE_ROOT = fileURLToPath(new URL('./', import.meta.url));
const FIXTURE = 'testdata/planted-sql.fixture.ts';
const SQL_WORD = /\b(?:SELECT|INSERT|CREATE|WHERE)\b/g;

/** The SQL words `text` holds outside comments, each as `<file>:<line> <word>`. */
function sqlWordsIn(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = node.getChildren(source);
    if (children.length > 0) {
      children.forEach(visit);
      return;
    }
    // A token's own text starts past its leading trivia, the comments.
    const start = node.getStart(source);
    for (const match of node.getText(source).matchAll(SQL_WORD)) {
      const { line } = source.getLineAndCharacterOfPosition(start + match.index);
      found.push(`${file}:${String(line + 1)} ${match[0]}`);
    }
  };
  visit(source);
  return found;
}

/** The sources under `src/`, test files and the planted fixture aside. */
function sourceFiles(): string[] {
  return [...new Bun.Glob('**/*.{ts,tsx,js,mjs,cjs,sql}').scanSync({ cwd: SOURCE_ROOT })]
    .filter((file) => !file.endsWith('.test.ts') && file !== FIXTURE)
    .sort();
}

async function readSource(file: string): Promise<string> {
  return Bun.file(`${SOURCE_ROOT}${file}`).text();
}

describe('the package holds no SQL', () => {
  it('reads the sources, test support included, and no test file', () => {
    const files = sourceFiles();
    expect(files).toEqual(expect.arrayContaining(['client.ts', 'state.ts', 'sync.ts', 'token.ts', 'testdata/stand-in-hub.ts']));
    expect(files.filter((file) => file.endsWith('.test.ts') || file === FIXTURE)).toEqual([]);
  });

  it('finds no SELECT, INSERT, CREATE or WHERE outside comments', async () => {
    const found = await Promise.all(sourceFiles().map(async (file) => sqlWordsIn(file, await readSource(file))));
    expect(found.flat()).toEqual([]);
  });

  it('fails over the planted fixture, naming each word and its line, and passes its comments', async () => {
    expect(sqlWordsIn(FIXTURE, await readSource(FIXTURE))).toEqual([
      `${FIXTURE}:8 SELECT`,
      `${FIXTURE}:11 INSERT`,
      `${FIXTURE}:13 CREATE`,
      `${FIXTURE}:16 WHERE`,
    ]);
  });
});
