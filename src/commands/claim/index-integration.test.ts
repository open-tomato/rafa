/**
 * `RUN_FEATURE`: the `claim` subject and its four lazy commands, each spelled
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
  CLAIM_ACCEPT_DECLARATION,
  CLAIM_HAND_DECLARATION,
  CLAIM_RELEASE_DECLARATION,
  CLAIM_SUBJECT,
  CLAIM_TAKE_DECLARATION,
} from './declarations.js';

import { RUN_FEATURE } from './index.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Each declaration in roster order, beside the module its command is the default export of. */
const DECLARED: readonly (readonly [string, CommandDeclaration])[] = [
  ['./release.js', CLAIM_RELEASE_DECLARATION],
  ['./hand.js', CLAIM_HAND_DECLARATION],
  ['./accept.js', CLAIM_ACCEPT_DECLARATION],
  ['./take.js', CLAIM_TAKE_DECLARATION],
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

describe('RUN_FEATURE', () => {
  it('is the run feature, declaring the claim subject', () => {
    expect(RUN_FEATURE.name).toBe('run');
    expect(RUN_FEATURE.subjects).toEqual([CLAIM_SUBJECT]);
  });

  it('spells each lazy command as its declaration, in roster order', () => {
    expect(RUN_FEATURE.commands.map(commandSpelling)).toEqual(DECLARED.map(([, declaration]) => commandSpelling(declaration)));
    expect(RUN_FEATURE.commands.map(commandSpelling)).toEqual([
      'claim release',
      'claim hand',
      'claim accept',
      'claim take',
    ]);
  });

  it('makes each command its declaration under a run of its own', () => {
    RUN_FEATURE.commands.forEach((command, position) => {
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
});
