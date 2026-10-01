/**
 * Tests for `selectBoardRelations` (`./select.ts`): each mode picks its
 * own adapter, selecting sends no `gh` call, and a value naming no mode
 * (including an inherited property name) is refused with the modes named.
 */
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { RafaConfig } from '../../config.js';

import { describe, expect, it } from 'bun:test';

import { selectBoardRelations } from './select.js';

/** A `gh` that records each call it is sent. */
function recordingGh(): { gh: GhRunner; calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const gh: GhRunner = (args) => {
    calls.push(args);
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
  return { gh, calls };
}

/** A config naming `value` as the mode, whatever it is. */
function configWith(value: unknown): Pick<RafaConfig, 'boardRelationships'> {
  return { boardRelationships: value as RafaConfig['boardRelationships'] };
}

describe('selectBoardRelations', () => {
  it.each(['labels', 'native'] as const)('picks the %s adapter and sends nothing', (mode) => {
    const { gh, calls } = recordingGh();
    const relations = selectBoardRelations(configWith(mode), { gh, repository: 'acme/board' });
    expect(relations.mode).toBe(mode);
    expect(calls).toEqual([]);
  });

  it.each([
    ['"github"', 'github'],
    ['"constructor"', 'constructor'],
    ['"toString"', 'toString'],
    ['null', null],
    ['7', 7],
  ])('refuses %s naming the modes', (shown, value) => {
    const { gh, calls } = recordingGh();
    expect(() => selectBoardRelations(configWith(value), { gh, repository: 'acme/board' }))
      .toThrow(new TypeError(
        `board relations: board.relationships is ${shown}, expected one of: labels, native`,
      ));
    expect(calls).toEqual([]);
  });
});
