/**
 * Tests for the version the running build answers with
 * (`src/cli/version.ts`).
 *
 * The version is held to `package.json`'s, read here through the same
 * named import the module uses, and the line to `rafa <version>` spelled
 * out. So a module answering a version of its own, or a line spelled
 * `rafa v<version>` or without the name, is red. The shape case is the
 * control that the comparison could fail for an empty version: a version
 * of no characters would leave the line `rafa `, and the pattern refuses
 * it.
 */
import { describe, expect, it } from 'bun:test';

import { version } from '../../package.json';

import { RAFA_VERSION, versionLine } from './version.js';

describe('the version the build answers with', () => {
  it('is the version of package.json', () => {
    expect(RAFA_VERSION).toBe(version);
  });

  it('reads as a dotted version with something in every part', () => {
    expect(RAFA_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('the line it is printed as', () => {
  it('is the name, one space and the version, with no newline of its own', () => {
    expect(versionLine()).toBe(`rafa ${version}`);
    expect(versionLine()).not.toContain('\n');
  });
});
