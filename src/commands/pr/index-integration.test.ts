/**
 * `PR_FEATURE`: the `pr` subject and its ten lazy commands, each spelled
 * as its declaration, in roster order, over a module whose command is
 * that declaration under a `run`.
 *
 * These cases import `index.ts` and the declarations, and so reach core's
 * command types; the cases that read the source of `index.ts` stay in
 * `index.test.ts` beside this file.
 */
import type { CommandDeclaration, RafaCommand } from '@open-tomato/rafa/core/command';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

import { commandProblem, commandSpelling } from '@open-tomato/rafa/core/command';

import {
  PR_CLOSE_DECLARATION,
  PR_CURRENT_DECLARATION,
  PR_LIST_DECLARATION,
  PR_MERGE_DECLARATION,
  PR_OPEN_DECLARATION,
  PR_RETARGET_DECLARATION,
  PR_SHOW_DECLARATION,
  PR_SUBJECT,
  PR_TRIAGE_DECLARATION,
  PR_VIEW_DECLARATION,
  PR_WAIT_DECLARATION,
} from './declarations.js';

import { PR_FEATURE } from './index.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Each declaration in roster order, beside the module its command is the default export of. */
const DECLARED: readonly (readonly [string, CommandDeclaration])[] = [
  ['./current.js', PR_CURRENT_DECLARATION],
  ['./show.js', PR_SHOW_DECLARATION],
  ['./view.js', PR_VIEW_DECLARATION],
  ['./open.js', PR_OPEN_DECLARATION],
  ['./retarget.js', PR_RETARGET_DECLARATION],
  ['./close.js', PR_CLOSE_DECLARATION],
  ['./list.js', PR_LIST_DECLARATION],
  ['./wait.js', PR_WAIT_DECLARATION],
  ['./merge.js', PR_MERGE_DECLARATION],
  ['./triage.js', PR_TRIAGE_DECLARATION],
];

/**
 * A command's fields less its `run`.
 *
 * @param command - The command.
 * @returns The rest of it.
 */
function lessRun(command: RafaCommand): CommandDeclaration {
  return Object.fromEntries(Object.entries(command).filter(([field]) => field !== 'run')) as CommandDeclaration;
}

describe('PR_FEATURE', () => {
  it('is the pr feature, declaring the pr subject', () => {
    expect(PR_FEATURE.name).toBe('pr');
    expect(PR_FEATURE.subjects).toEqual([PR_SUBJECT]);
  });

  it('spells each lazy command as its declaration, in roster order', () => {
    expect(PR_FEATURE.commands.map(commandSpelling)).toEqual(DECLARED.map(([, declaration]) => commandSpelling(declaration)));
    expect(PR_FEATURE.commands.map(commandSpelling)).toEqual([
      'pr current',
      'pr show',
      'pr view',
      'pr open',
      'pr retarget',
      'pr close',
      'pr list',
      'pr wait',
      'pr merge',
      'pr triage',
    ]);
  });

  it('makes each command its declaration under a run of its own', () => {
    PR_FEATURE.commands.forEach((command, position) => {
      const [, declaration] = DECLARED[position] ?? [];

      expect(commandProblem(command)).toBeNull();
      expect(lessRun(command)).toEqual(declaration as CommandDeclaration);
    });
  });

  it.each(DECLARED)('loads from %s the command its declaration spells, that declaration under a run', async (path, declaration) => {
    const loaded = await import(join(HERE, path)) as { default: RafaCommand };

    expect(commandSpelling(loaded.default)).toBe(commandSpelling(declaration));
    expect(lessRun(loaded.default)).toEqual(declaration);
  });

  it.each(DECLARED)('loads from %s the command its declaration spells, that declaration under a run', async (path, declaration) => {
    const loaded = await import(join(HERE, path)) as { default: RafaCommand };

    expect(commandSpelling(loaded.default)).toBe(commandSpelling(declaration));
    expect(lessRun(loaded.default)).toEqual(declaration);
  });
});
