/**
 * The `issue` declarations as values: the values `declarations.ts` copies
 * from outside `src/commands/` stay equal to their sources (the triage
 * module read off `src/triage/triage.ts` as text, so no module of the
 * triage feature is imported); `issue ready` declares core's
 * `HINT_FLAG_SPEC` itself, not a copy; and each of the nine modules
 * exports a command that is its declaration plus a `run`.
 *
 * These cases import `declarations.ts`, and so reach core's command
 * entry; the cases that read its source for what it imports stay in
 * `declarations.test.ts` beside this file. The initializer reading takes
 * the `TRIAGE_MODULE` declaration of a source text through the TypeScript
 * parser; a control runs it over a planted text spelling another value,
 * which must read as unequal.
 */
import type { CommandDeclaration, RafaCommand } from '@open-tomato/rafa/core/command';

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

import { HINT_FLAG_SPEC } from '@open-tomato/rafa/core/command';

import { ISSUE_PRIORITIES, ISSUE_STATES, ISSUE_TYPES } from '../../adapters/tracker/issue-values.js';
import { SPEC_BLOCKED_LABEL } from '../../board/blocked.js';
import { SPEC_NEEDS_WORK_LABEL } from '../../board/gate.js';
import { SPEC_READY_LABEL } from '../../board/readiness.js';

import issueCheck from './check.js';
import issueComment from './comment.js';
import issueCreate from './create.js';
import {
  ISSUE_BLOCKED_LABEL,
  ISSUE_CHECK_DECLARATION,
  ISSUE_COMMENT_DECLARATION,
  ISSUE_CREATE_DECLARATION,
  ISSUE_EDIT_DECLARATION,
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
const TRIAGE_PATH = join(HERE, '..', '..', 'triage', 'triage.ts');

/**
 * The string a source text initializes `TRIAGE_MODULE` with.
 *
 * @param text - The source text.
 * @returns The literal's value, or `undefined` when no such declaration holds one.
 */
function readTriageModule(text: string): string | undefined {
  const file = ts.createSourceFile('triage.ts', text, ts.ScriptTarget.Latest, true);
  let found: string | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === 'TRIAGE_MODULE'
      && node.initializer !== undefined
      && ts.isStringLiteralLike(node.initializer)
    ) {
      found = node.initializer.text;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
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

describe('the values declarations.ts copies', () => {
  it('spells the states, types and priorities the port lists, in their order', () => {
    expect(ISSUE_STATE_WORDS).toEqual(ISSUE_STATES);
    expect(ISSUE_TYPE_WORDS).toEqual(ISSUE_TYPES);
    expect(ISSUE_PRIORITY_WORDS).toEqual(ISSUE_PRIORITIES);
  });

  it('spells the triage module and the three spec labels as their sources do', () => {
    expect(readTriageModule(readFileSync(TRIAGE_PATH, 'utf8'))).toBe(ISSUE_TRIAGE_MODULE);
    expect(ISSUE_READY_LABEL).toBe(SPEC_READY_LABEL);
    expect(ISSUE_NEEDS_WORK_LABEL).toBe(SPEC_NEEDS_WORK_LABEL);
    expect(ISSUE_BLOCKED_LABEL).toBe(SPEC_BLOCKED_LABEL);
  });

  it('reads a planted TRIAGE_MODULE of another value as unequal, the control', () => {
    const planted = 'export const TRIAGE_MODULE = \'elsewhere\';';

    expect(readTriageModule(planted)).toBe('elsewhere');
    expect(readTriageModule(planted)).not.toBe(ISSUE_TRIAGE_MODULE);
    expect(readTriageModule('export const OTHER = \'unassigned\';')).toBeUndefined();
  });

  it('declares HINT_FLAG_SPEC itself on issue ready, and an equal copy would not pass', () => {
    expect(ISSUE_READY_DECLARATION.flags.includes(HINT_FLAG_SPEC)).toBe(true);
    expect(ISSUE_READY_DECLARATION.flags.includes(Object.freeze({ ...HINT_FLAG_SPEC }))).toBe(false);
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
