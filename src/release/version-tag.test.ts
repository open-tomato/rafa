/**
 * Tests for the version tag spellings (`version-tag.ts`): the root's
 * `v<version>`, which `rafa release tag` and settle's tag step both
 * write, a package's `<name>@<version>`, and `moveTag` picking one.
 *
 * The function is pure, so each case is a literal. The second case is
 * the control for the first: a version already carrying a `v` still
 * gets one in front, so the function is shown to prefix what it is
 * handed, not to answer a fixed tag or to normalise its input. The
 * `moveTag` cases are each other's control: the same `to` gives a
 * different tag once `package` is set.
 */
import type { ReleaseMove } from './release-move.js';

import { describe, expect, it } from 'bun:test';

import { moveTag, packageTag, versionTag } from './version-tag.js';

describe('versionTag', () => {
  it('puts a v in front of the version', () => {
    expect(versionTag('0.4.0')).toBe('v0.4.0');
  });

  it('prefixes whatever it is handed, a pre-release or an already prefixed version included', () => {
    expect(versionTag('1.0.0-alpha.2')).toBe('v1.0.0-alpha.2');
    expect(versionTag('v0.4.0')).toBe('vv0.4.0');
  });
});

describe('packageTag', () => {
  it('spells the package name, an at sign and the version', () => {
    expect(packageTag('@scope/plugin', '0.2.0')).toBe('@scope/plugin@0.2.0');
    expect(packageTag('plain', '1.0.0')).toBe('plain@1.0.0');
  });
});

describe('moveTag', () => {
  const root: ReleaseMove = { package: null, dir: '.', from: '0.45.0', to: '0.46.0' };

  it('tags the root\'s move with versionTag', () => {
    expect(moveTag(root)).toBe('v0.46.0');
  });

  it('tags a package\'s move with packageTag', () => {
    expect(moveTag({ ...root, package: '@scope/plugin', dir: 'packages/plugin' })).toBe('@scope/plugin@0.46.0');
  });
});
