/**
 * Tests for the version tag spellings (`version-tag.ts`): the root's
 * `v<version>`, which `rafa release tag` and settle's tag step both
 * write, a package's `<name>@<version>`, `moveTag` picking one, and
 * `parseReleaseTag` reading either back.
 *
 * The function is pure, so each case is a literal. The second case is
 * the control for the first: a version already carrying a `v` still
 * gets one in front, so the function is shown to prefix what it is
 * handed, not to answer a fixed tag or to normalise its input. The
 * `moveTag` cases are each other's control: the same `to` gives a
 * different tag once `package` is set. The `parseReleaseTag` cases
 * pair each accepted shape with a near miss it refuses (a root tag
 * without its `v`, a scoped name with a second slash), so a parser
 * answering every tag, or none, fails one of each pair; the round trip
 * runs the spellings' own output back through it.
 */
import type { ReleaseMove } from './release-move.js';

import { describe, expect, it } from 'bun:test';

import { moveTag, packageTag, parseReleaseTag, versionTag } from './version-tag.js';

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

describe('parseReleaseTag', () => {
  it('answers the root for a v and a version', () => {
    expect(parseReleaseTag('v0.4.0')).toEqual({ package: null, version: '0.4.0' });
    expect(parseReleaseTag('v1.0.0-alpha.2+build.7')).toEqual({ package: null, version: '1.0.0-alpha.2+build.7' });
  });

  it('answers a package by its name, splitting at the last at sign', () => {
    expect(parseReleaseTag('@scope/plugin@0.2.0')).toEqual({ package: '@scope/plugin', version: '0.2.0' });
    expect(parseReleaseTag('plain@1.0.0')).toEqual({ package: 'plain', version: '1.0.0' });
    expect(parseReleaseTag('v1@2.0.0')).toEqual({ package: 'v1', version: '2.0.0' });
  });

  it('answers null for a root tag without its v or with no version after it', () => {
    expect(parseReleaseTag('0.4.0')).toBeNull();
    expect(parseReleaseTag('vv0.4.0')).toBeNull();
    expect(parseReleaseTag('v0.4')).toBeNull();
    expect(parseReleaseTag('very-old')).toBeNull();
    expect(parseReleaseTag('v')).toBeNull();
    expect(parseReleaseTag('')).toBeNull();
  });

  it('answers null for a package tag whose name or version is not one', () => {
    expect(parseReleaseTag('@scope/a/b@1.0.0')).toBeNull();
    expect(parseReleaseTag('dir/plugin@1.0.0')).toBeNull();
    expect(parseReleaseTag('@scope@1.0.0')).toBeNull();
    expect(parseReleaseTag('@/plugin@1.0.0')).toBeNull();
    expect(parseReleaseTag('@scope/@1.0.0')).toBeNull();
    expect(parseReleaseTag('a@b@1.0.0')).toBeNull();
    expect(parseReleaseTag('@1.0.0')).toBeNull();
    expect(parseReleaseTag('plugin@v1.0.0')).toBeNull();
    expect(parseReleaseTag('plugin@')).toBeNull();
    expect(parseReleaseTag(' v0.4.0')).toBeNull();
  });

  it('reads back what versionTag, packageTag and moveTag write', () => {
    expect(parseReleaseTag(versionTag('0.46.0'))).toEqual({ package: null, version: '0.46.0' });
    expect(parseReleaseTag(packageTag('@open-tomato/rafa-core', '0.3.1'))).toEqual({ package: '@open-tomato/rafa-core', version: '0.3.1' });
    const move: ReleaseMove = { package: '@scope/plugin', dir: 'packages/plugin', from: '0.1.0', to: '0.2.0' };
    expect(parseReleaseTag(moveTag(move))).toEqual({ package: move.package, version: move.to });
  });
});
