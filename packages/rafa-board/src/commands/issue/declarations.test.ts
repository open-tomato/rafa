/**
 * The `issue` declarations: `declarations.ts`, `declarations-create.ts`
 * and `declarations-shared.ts` import no module under `src/` but one
 * another, only the core entries.
 *
 * The import reading takes every module specifier `ts.preProcessFile`
 * finds, `import type`, `export … from` and dynamic `import()` among
 * them, and resolves each from the file's own folder. A control runs the
 * same reading over a planted text naming two modules under `src/`, so a
 * reader that matched nothing could not pass for the real files; another
 * plants an import of `declarations.ts` in a sibling, so the cycle case
 * could not pass on a reading that never saw one.
 *
 * The cases over the declarations' values are in
 * `src/commands/issue/declarations-integration.test.ts` at the root.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

import {
  ISSUE_COMMENT_DECLARATION,
  ISSUE_CREATE_DECLARATION,
  ISSUE_LIST_DECLARATION,
  ISSUE_LIST_FLAGS,
  ISSUE_SHOW_DECLARATION,
  ISSUE_UPSTREAM_FLAG,
  ISSUE_UPSTREAM_TOOL_WORDS,
} from './declarations.js';
import { UPSTREAM_FLAG, UPSTREAM_TOOLS } from './upstream.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The three declaration files, by name in this folder. */
const DECLARATION_FILES: readonly string[] = ['declarations.ts', 'declarations-create.ts', 'declarations-shared.ts'];

/** The files `declarations.ts` re-exports, which must never import it back. */
const SIBLING_FILES: readonly string[] = ['declarations-create.ts', 'declarations-shared.ts'];
const SRC_DIR = join(HERE, '..', '..') + sep;

/** The prefix every specifier of a declaration module starts with. */
const CORE_PREFIX = '@open-tomato/rafa/core/';

/** One import a file holds: what it names, and the file it resolves to. */
interface ReadImport {
  readonly specifier: string;
  readonly resolved: string;
}

/**
 * Every module a source text imports, resolved from `from`.
 *
 * @param text - The source text.
 * @param from - The folder its relative specifiers resolve from.
 * @returns Each specifier with the file it resolves to.
 */
function readImports(text: string, from: string): readonly ReadImport[] {
  return ts.preProcessFile(text, true, true).importedFiles.map(({ fileName }) => ({
    specifier: fileName,
    resolved: Bun.resolveSync(fileName, from),
  }));
}

/**
 * The imports of `imports` that land under `src/`.
 *
 * @param imports - What a file imports.
 * @returns The specifiers resolving to a file under `src/`.
 */
function underSrc(imports: readonly ReadImport[]): readonly string[] {
  return imports.filter(({ resolved }) => resolved.startsWith(SRC_DIR)).map(({ specifier }) => specifier);
}

/**
 * The imports of `imports` that resolve to a declaration file of this folder.
 *
 * @param imports - What a file imports.
 * @param names - The file names that count.
 * @returns The specifiers resolving to one of `names` here.
 */
function toFiles(imports: readonly ReadImport[], names: readonly string[]): readonly string[] {
  const paths = names.map((name) => join(HERE, name));
  return imports.filter(({ resolved }) => paths.includes(resolved)).map(({ specifier }) => specifier);
}

describe.each(DECLARATION_FILES)('what %s imports', (name) => {
  const imports = readImports(readFileSync(join(HERE, name), 'utf8'), HERE);
  const siblings = toFiles(imports, DECLARATION_FILES);

  it('imports no module under src/ but a declaration file', () => {
    expect(imports.length).toBeGreaterThan(0);
    expect(underSrc(imports).filter((specifier) => !siblings.includes(specifier))).toEqual([]);
  });

  it('imports from the core entries and the declaration files alone', () => {
    expect(imports.map(({ specifier }) => specifier)
      .filter((specifier) => !specifier.startsWith(CORE_PREFIX) && !siblings.includes(specifier)))
      .toEqual([]);
  });
});

describe('the declaration files beside declarations.ts', () => {
  it('re-exports both from declarations.ts', () => {
    const imports = readImports(readFileSync(join(HERE, 'declarations.ts'), 'utf8'), HERE);

    expect(toFiles(imports, SIBLING_FILES)).toEqual(expect.arrayContaining(['./declarations-create.js', './declarations-shared.js']));
  });

  it.each(SIBLING_FILES)('never imports declarations.ts back from %s', (name) => {
    const imports = readImports(readFileSync(join(HERE, name), 'utf8'), HERE);

    expect(toFiles(imports, ['declarations.ts'])).toEqual([]);
  });

  it('reads a planted import of declarations.ts as one, the control', () => {
    const planted = 'import { ISSUE_SUBJECT } from \'./declarations.js\';';

    expect(toFiles(readImports(planted, HERE), ['declarations.ts'])).toEqual(['./declarations.js']);
  });
});

describe('the import reading', () => {
  it('reads a planted import of a module under src/ as one, the control', () => {
    const planted = [
      'import type { RafaCommand } from \'@open-tomato/rafa/core/command\';',
      'import type { IssueSeams } from \'./issue-tracker.js\';',
      'import { ISSUE_STATES } from \'../../adapters/tracker/issue-values.js\';',
    ].join('\n');

    expect(underSrc(readImports(planted, HERE))).toEqual(['./issue-tracker.js', '../../adapters/tracker/issue-values.js']);
  });
});

describe('the flags each upstream command declares', () => {
  it('declares no --upstream on issue show, the control', () => {
    expect(ISSUE_SHOW_DECLARATION.flags.map(({ name }) => name)).not.toContain(UPSTREAM_FLAG);
  });

  it('keeps --upstream off ISSUE_LIST_FLAGS, which roadmap reuses', () => {
    expect(ISSUE_LIST_FLAGS.map(({ name }) => name)).not.toContain(UPSTREAM_FLAG);
  });

  it('holds the copied flag name and tool list equal to upstream.ts', () => {
    expect(ISSUE_UPSTREAM_FLAG).toBe(UPSTREAM_FLAG);
    expect(ISSUE_UPSTREAM_TOOL_WORDS).toEqual([...UPSTREAM_TOOLS]);
  });

  it('lists the flags of issue create', () => {
    expect(ISSUE_CREATE_DECLARATION.flags.map(({ name }) => name)).toEqual([
      'title', 'body', 'body-file', 'type', 'module', 'priority', 'summary', 'action', 'cause',
      'proposed', 'reproduce', 'rerun', 'env', 'project', 'path', 'dry-run', 'upstream',
    ]);
  });

  it('lists the flags of issue comment', () => {
    expect(ISSUE_COMMENT_DECLARATION.flags.map(({ name }) => name)).toEqual(['body', 'upstream']);
  });

  it('lists the flags of issue list', () => {
    expect(ISSUE_LIST_DECLARATION.flags.map(({ name }) => name)).toEqual([
      'roadmap', 'all', 'full', 'check', 'labels', 'texts', 'refresh', 'state', 'type', 'module',
      'search', 'limit', 'upstream',
    ]);
  });

  it.each([ISSUE_CREATE_DECLARATION, ISSUE_COMMENT_DECLARATION, ISSUE_LIST_DECLARATION])(
    'names collaborate.rafa and the same-owner rule in the help of $name',
    ({ flags }) => {
      const flag = flags.find(({ name }) => name === UPSTREAM_FLAG);

      expect(flag?.type).toBe('string');
      expect(flag?.description).toContain('collaborate.rafa');
      expect(flag?.description).toContain('only between repositories of one owner');
    },
  );

  it('names the bug-only rule on issue create alone', () => {
    const help = (flags: typeof ISSUE_CREATE_DECLARATION.flags): string | undefined => flags
      .find(({ name }) => name === UPSTREAM_FLAG)?.description;

    expect(help(ISSUE_CREATE_DECLARATION.flags)).toContain('a bug only (--type=bug)');
    expect(help(ISSUE_COMMENT_DECLARATION.flags)).not.toContain('--type=bug');
  });
});
