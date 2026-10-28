/**
 * Tests for the learning library's entry: that it exports every runtime
 * name its modules do, as the modules' own bindings, and nothing else.
 *
 * The names are spelled here rather than read off the modules, so a name
 * dropped from the entry, or one added to it, fails a case instead of
 * agreeing with itself. The binding case compares each name with the
 * module that declares it, so an entry wrapping a function in one of its
 * own fails too.
 */
import { describe, expect, it } from 'bun:test';

import * as blessModule from './bless.js';
import * as identityModule from './identity.js';
import * as mergeModule from './merge.js';

import * as entry from './index.js';

/** Each runtime name the entry exports, with the module declaring it. */
const RUNTIME_NAMES: [string, Record<string, unknown>][] = [
  ['CONFIDENCE_MAX', identityModule],
  ['CONFIDENCE_MIN', identityModule],
  ['GAP', identityModule],
  ['SOURCE_STEP', identityModule],
  ['actionHash', identityModule],
  ['bless', blessModule],
  ['merge', mergeModule],
  ['promotable', blessModule],
  ['triggerKey', identityModule],
];

describe('the learning entry', () => {
  it('exports the runtime names spelled here, and nothing else', () => {
    expect(Object.keys(entry).sort()).toEqual(RUNTIME_NAMES.map(([name]) => name).sort());
  });

  it('exports every runtime name its modules do', () => {
    const declared = [
      ...Object.keys(blessModule),
      ...Object.keys(identityModule),
      ...Object.keys(mergeModule),
    ].sort();

    expect(Object.keys(entry).sort()).toEqual(declared);
  });

  it.each(RUNTIME_NAMES)('exports %s as the declaring module\'s own binding', (name, module) => {
    const exported = (entry as Record<string, unknown>)[name];

    expect(exported).toBeDefined();
    expect(exported).toBe(module[name]);
  });
});
