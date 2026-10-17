/**
 * The `issue` declarations: `declarations.ts` imports no module under
 * `src/`, only the core entries; the values it copies from outside
 * `src/commands/` stay equal to their sources; and each of the nine
 * modules exports a command that is its declaration plus a `run`.
 *
 * The import reading takes every module specifier `ts.preProcessFile`
 * finds, `import type`, `export … from` and dynamic `import()` among
 * them, and resolves each from the file's own folder. A control runs the
 * same reading over a planted text naming two modules under `src/`, so a
 * reader that matched nothing could not pass for the real file.
 */
import type { CommandDeclaration, RafaCommand } from '@open-tomato/rafa/core/command';

import { readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

import { ISSUE_PRIORITIES, ISSUE_STATES, ISSUE_TYPES } from '../../adapters/tracker/issue-values.js';
import { SPEC_BLOCKED_LABEL } from '../../board/blocked.js';
import { SPEC_NEEDS_WORK_LABEL } from '../../board/gate.js';
import { SPEC_READY_LABEL } from '../../board/readiness.js';
import { HINT_FLAG_SPEC } from '../../next/ending.js';
import { TRIAGE_MODULE } from '../../triage/triage.js';

import issueCheck from './check.js';
import issueComment from './comment.js';
import issueCreate from './create.js';
import {
  ISSUE_BLOCKED_LABEL,
  ISSUE_CHECK_DECLARATION,
  ISSUE_COMMENT_DECLARATION,
  ISSUE_CREATE_DECLARATION,
  ISSUE_EDIT_DECLARATION,
  ISSUE_HINT_FLAG_SPEC,
  ISSUE_LIST_DECLARATION,
  ISSUE_MOVE_DECLARATION,
  ISSUE_NEEDS_WORK_LABEL,
  ISSUE_PRIORITY_WORDS,
  ISSUE_READY_DECLARATION,
  ISSUE_READY_LABEL,
  ISSUE_SHOW_DECLARATION,
  ISSUE_STATE_WORDS,
  ISSUE_SUBJECT,
  ISSUE_TRIAGE_MODULE,
  ISSUE_TYPE_WORDS,
  ISSUE_UNBLOCK_DECLARATION,
} from './declarations.js';
import issueEdit from './edit.js';
import issueList from './list.js';
import issueMove from './move.js';
import issueReady from './ready.js';
import issueShow from './show.js';
import issueUnblock from './unblock.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DECLARATIONS_PATH = join(HERE, 'declarations.ts');
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
 * A command less its `run`: the fields its declaration carries.
 *
 * @param command - A command a module exports.
 * @returns Every field but `run`.
 */
function lessRun(command: RafaCommand): object {
  return Object.fromEntries(Object.entries(command).filter(([field]) => field !== 'run'));
}

describe('what declarations.ts imports', () => {
  const imports = readImports(readFileSync(DECLARATIONS_PATH, 'utf8'), HERE);

  it('imports no module under src/', () => {
    expect(imports.length).toBeGreaterThan(0);
    expect(underSrc(imports)).toEqual([]);
  });

  it('imports from the core entries alone', () => {
    expect(imports.map(({ specifier }) => specifier).filter((specifier) => !specifier.startsWith(CORE_PREFIX)))
      .toEqual([]);
  });

  it('reads a planted import of a module under src/ as one, the control', () => {
    const planted = [
      'import type { RafaCommand } from \'@open-tomato/rafa/core/command\';',
      'import type { IssueSeams } from \'./issue-tracker.js\';',
      'import { ISSUE_STATES } from \'../../adapters/tracker/issue-values.js\';',
    ].join('\n');

    expect(underSrc(readImports(planted, HERE))).toEqual(['./issue-tracker.js', '../../adapters/tracker/issue-values.js']);
  });
});

describe('the values declarations.ts copies', () => {
  it('spells the states, types and priorities the port lists, in their order', () => {
    expect(ISSUE_STATE_WORDS).toEqual(ISSUE_STATES);
    expect(ISSUE_TYPE_WORDS).toEqual(ISSUE_TYPES);
    expect(ISSUE_PRIORITY_WORDS).toEqual(ISSUE_PRIORITIES);
  });

  it('spells the triage module and the three spec labels as their sources do', () => {
    expect(ISSUE_TRIAGE_MODULE).toBe(TRIAGE_MODULE);
    expect(ISSUE_READY_LABEL).toBe(SPEC_READY_LABEL);
    expect(ISSUE_NEEDS_WORK_LABEL).toBe(SPEC_NEEDS_WORK_LABEL);
    expect(ISSUE_BLOCKED_LABEL).toBe(SPEC_BLOCKED_LABEL);
  });

  it('declares the hint flag HINT_FLAG_SPEC declares, on issue ready', () => {
    expect(ISSUE_HINT_FLAG_SPEC).toEqual(HINT_FLAG_SPEC);
    expect(ISSUE_READY_DECLARATION.flags).toContain(ISSUE_HINT_FLAG_SPEC);
  });
});

describe('the issue declarations', () => {
  /** Each module's default command beside the declaration it spreads, in roster order. */
  const PAIRS: readonly (readonly [string, RafaCommand, CommandDeclaration])[] = [
    ['issue list', issueList, ISSUE_LIST_DECLARATION],
    ['issue show', issueShow, ISSUE_SHOW_DECLARATION],
    ['issue create', issueCreate, ISSUE_CREATE_DECLARATION],
    ['issue comment', issueComment, ISSUE_COMMENT_DECLARATION],
    ['issue move', issueMove, ISSUE_MOVE_DECLARATION],
    ['issue ready', issueReady, ISSUE_READY_DECLARATION],
    ['issue unblock', issueUnblock, ISSUE_UNBLOCK_DECLARATION],
    ['issue check', issueCheck, ISSUE_CHECK_DECLARATION],
    ['issue edit', issueEdit, ISSUE_EDIT_DECLARATION],
  ];

  it.each(PAIRS)('exports %s as its declaration plus a run', (name, command, declaration) => {
    expect(declaration.name).toBe(name);
    expect(declaration.subject).toBe(ISSUE_SUBJECT.name);
    expect(Object.isFrozen(declaration)).toBe(true);
    expect(lessRun(command)).toEqual({ ...declaration });
    expect(typeof command.run).toBe('function');
  });

  it('names the issue subject', () => {
    expect(ISSUE_SUBJECT.name).toBe('issue');
    expect(Object.isFrozen(ISSUE_SUBJECT)).toBe(true);
  });
});
