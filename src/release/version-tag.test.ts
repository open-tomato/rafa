/**
 * Tests for the version tag spelling (`version-tag.ts`): the one string
 * `rafa release tag` and settle's tag step both write.
 *
 * The function is pure, so each case is a literal. The second case is
 * the control for the first: a version already carrying a `v` still
 * gets one in front, so the function is shown to prefix what it is
 * handed, not to answer a fixed tag or to normalise its input.
 */
import { describe, expect, it } from 'bun:test';

import { versionTag } from './version-tag.js';

describe('versionTag', () => {
  it('puts a v in front of the version', () => {
    expect(versionTag('0.4.0')).toBe('v0.4.0');
  });

  it('prefixes whatever it is handed, a pre-release or an already prefixed version included', () => {
    expect(versionTag('1.0.0-alpha.2')).toBe('v1.0.0-alpha.2');
    expect(versionTag('v0.4.0')).toBe('vv0.4.0');
  });
});
