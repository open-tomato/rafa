/**
 * Tests for settle's grouping (`settle-groups.ts`): the two refusal
 * sentences first, then the batches it answers.
 *
 * The function is pure, so each case builds its fragments and members
 * as literals. Each refusal case carries its control: the same fragment
 * against a workspace that holds the package publicly groups cleanly,
 * so the refusal is shown to come from the workspace, not the fragment.
 */
import type { SettleFragment } from './settle.js';
import type { WorkspacePackage } from './workspace-packages.js';

import { describe, expect, it } from 'bun:test';

import { groupSettleFragments } from './settle-groups.js';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

/** A fragment at `.changes/<id>.md` naming `pkg`, or the root when null. */
function fragmentOf(id: string, pkg: string | null): SettleFragment {
  return {
    id,
    path: `.changes/${id}.md`,
    commit: COMMIT,
    addedOn: '2026-10-16',
    fragment: { plan: id, title: `the ${id} change`, level: 'minor', package: pkg, notes: [] },
  };
}

/** A member named `name` at `packages/<dir>`. */
function memberOf(name: string, dir: string, isPrivate: boolean): WorkspacePackage {
  return { name, dir: `packages/${dir}`, version: '0.1.0', isPrivate, manifestPath: `packages/${dir}/package.json` };
}

const CORE = memberOf('@scope/core', 'core', true);
const PLUGIN = memberOf('@scope/plugin', 'plugin', false);
const WIDGET = memberOf('@scope/widget', 'widget', false);

describe('groupSettleFragments refusals', () => {
  it('refuses a fragment naming a package the workspace does not hold, with the short commit', () => {
    const grouping = groupSettleFragments([fragmentOf('rafa-1200', '@scope/x')], [CORE, PLUGIN], COMMIT);
    expect(grouping).toEqual({
      ok: false,
      problems: ['.changes/rafa-1200.md names package @scope/x, which the workspace at 0123456789ab does not hold'],
    });
  });

  it('refuses a fragment naming a private package', () => {
    const grouping = groupSettleFragments([fragmentOf('rafa-1201', '@scope/core')], [CORE, PLUGIN], COMMIT);
    expect(grouping).toEqual({
      ok: false,
      problems: ['.changes/rafa-1201.md names package @scope/core, which is private and never publishes'],
    });
  });

  it('refuses a package name against an empty workspace', () => {
    const grouping = groupSettleFragments([fragmentOf('rafa-1202', '@scope/plugin')], [], COMMIT);
    expect(grouping.ok).toBe(false);
  });

  it('names every refused fragment in the order given, and refuses the whole batch', () => {
    const fragments = [
      fragmentOf('rafa-1', null),
      fragmentOf('rafa-2', '@scope/core'),
      fragmentOf('rafa-3', '@scope/plugin'),
      fragmentOf('rafa-4', '@scope/missing'),
    ];
    expect(groupSettleFragments(fragments, [CORE, PLUGIN], COMMIT)).toEqual({
      ok: false,
      problems: [
        '.changes/rafa-2.md names package @scope/core, which is private and never publishes',
        '.changes/rafa-4.md names package @scope/missing, which the workspace at 0123456789ab does not hold',
      ],
    });
  });

  it('control: the same names group cleanly once the workspace holds them publicly', () => {
    const publicCore = { ...CORE, isPrivate: false };
    const missing = memberOf('@scope/x', 'x', false);
    const grouping = groupSettleFragments(
      [fragmentOf('rafa-1200', '@scope/x'), fragmentOf('rafa-1201', '@scope/core')],
      [publicCore, missing],
      COMMIT,
    );
    expect(grouping.ok).toBe(true);
  });

  it('compares the package name exactly', () => {
    const grouping = groupSettleFragments([fragmentOf('rafa-5', '@Scope/plugin')], [PLUGIN], COMMIT);
    expect(grouping.ok).toBe(false);
  });
});

describe('groupSettleFragments batches', () => {
  it('answers an empty root batch and no package batch for no fragment', () => {
    expect(groupSettleFragments([], [CORE, PLUGIN], COMMIT)).toEqual({ ok: true, root: [], packages: [] });
  });

  it('puts three-field fragments in the root batch alone, without needing a workspace', () => {
    const fragments = [fragmentOf('rafa-1', null), fragmentOf('rafa-2', null)];
    expect(groupSettleFragments(fragments, [], COMMIT)).toEqual({ ok: true, root: fragments, packages: [] });
  });

  it('splits root and package fragments, keeping fold order within each batch', () => {
    const first = fragmentOf('rafa-1', '@scope/plugin');
    const second = fragmentOf('rafa-2', null);
    const third = fragmentOf('rafa-3', '@scope/plugin');
    const fourth = fragmentOf('rafa-4', null);
    const fragments = [first, second, third, fourth];
    expect(groupSettleFragments(fragments, [CORE, PLUGIN], COMMIT)).toEqual({
      ok: true,
      root: [second, fourth],
      packages: [{ package: PLUGIN, fragments: [first, third] }],
    });
  });

  it('orders package batches by workspace order, not fragment order, and leaves out a package no fragment names', () => {
    const fragments = [fragmentOf('rafa-1', '@scope/widget'), fragmentOf('rafa-2', '@scope/plugin')];
    const grouping = groupSettleFragments(fragments, [CORE, PLUGIN, WIDGET], COMMIT);
    expect(grouping.ok).toBe(true);
    if (!grouping.ok) return;
    expect(grouping.root).toEqual([]);
    expect(grouping.packages.map((group) => group.package.name)).toEqual(['@scope/plugin', '@scope/widget']);
  });

  it('answers new lists and leaves its inputs as handed', () => {
    const fragments = [fragmentOf('rafa-1', null)];
    const packages = [PLUGIN];
    const grouping = groupSettleFragments(fragments, packages, COMMIT);
    expect(grouping.ok).toBe(true);
    if (!grouping.ok) return;
    expect(grouping.root).not.toBe(fragments);
    expect(fragments).toHaveLength(1);
    expect(packages).toEqual([PLUGIN]);
  });
});
