/**
 * Tests for `version.ts`: the contract version clients and servers compare
 * by major, and the two entries that must agree on it.
 */
import { describe, expect, it } from 'bun:test';

import { ATLAS_CONTRACT_VERSION as fromEntry } from '../../index.js';

import { ATLAS_CONTRACT_VERSION } from './version.js';

import { ATLAS_CONTRACT_VERSION as fromContract } from './index.js';

/** `major.minor.patch`, each a number with no leading zero. */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

describe('ATLAS_CONTRACT_VERSION', () => {
  it('is a plain semver string whose major is 1, the first contract', () => {
    expect(ATLAS_CONTRACT_VERSION).toMatch(SEMVER);
    expect(ATLAS_CONTRACT_VERSION.split('.')[0]).toBe('1');
  });

  it('is the one value the package entry and the contract entry both export', () => {
    expect(fromEntry).toBe(ATLAS_CONTRACT_VERSION);
    expect(fromContract).toBe(ATLAS_CONTRACT_VERSION);
  });
});
