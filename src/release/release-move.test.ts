/**
 * Tests for the release commit's subject (`release-move.ts`): the three
 * spellings the stage names, and the order the root takes in them.
 *
 * The function is pure, so each case is a literal. The ordering case is
 * the control for the two-move one: the root handed last still comes
 * first, so the function is shown to order the moves, not to join them
 * as handed.
 */
import type { ReleaseMove } from './release-move.js';

import { describe, expect, it } from 'bun:test';

import { releaseCommitSubject } from './release-move.js';

const ROOT: ReleaseMove = { package: null, dir: '.', from: '0.45.0', to: '0.46.0' };
const PLUGIN: ReleaseMove = { package: '@scope/plugin', dir: 'packages/plugin', from: '0.1.0', to: '0.2.0' };
const WIDGET: ReleaseMove = { package: '@scope/widget', dir: 'packages/widget', from: '1.0.0', to: '1.1.0' };

describe('releaseCommitSubject', () => {
  it('spells the root alone as its bare version', () => {
    expect(releaseCommitSubject([ROOT])).toBe('chore: release 0.46.0');
  });

  it('spells the root and a package as the version, then the package at its version', () => {
    expect(releaseCommitSubject([ROOT, PLUGIN])).toBe('chore: release 0.46.0, @scope/plugin@0.2.0');
  });

  it('spells a package alone as the package at its version', () => {
    expect(releaseCommitSubject([PLUGIN])).toBe('chore: release @scope/plugin@0.2.0');
  });

  it('puts the root first wherever it is handed, and keeps the packages in the order handed', () => {
    expect(releaseCommitSubject([WIDGET, ROOT, PLUGIN])).toBe('chore: release 0.46.0, @scope/widget@1.1.0, @scope/plugin@0.2.0');
  });
});
