/**
 * Tests for the shared package-fragment reading (`package-fragments.ts`):
 * the per-fragment answer under `release.packageFragments` and the helper
 * naming each refused fragment of a tree by path.
 *
 * The negative cases come first: `refuse` with a package line is
 * refused, then `refuse` with none and `allow` with one are taken, so a
 * rule that took everything fails the first case and one that refused
 * everything fails the next two.
 */
import type { Fragment, FragmentReading } from '@open-tomato/rafa/release/fragment';

import { parseFragment } from '@open-tomato/rafa/release/fragment';
import { describe, expect, it } from 'bun:test';

import {
  isPackageFragmentRefused,
  packageFragmentRefusal,
  refusedPackageFragments,
} from './package-fragments.js';

/** Where every case says the key is set. */
const WHERE = '/repo/rafa.config.ts';

/** The reading of a well-formed fragment releasing `packageName`, null for the root. */
function readingOf(packageName: string | null): FragmentReading {
  const fragment: Fragment = {
    plan: 'rafa-1',
    title: 'a title',
    level: 'patch',
    package: packageName,
    notes: ['- Loop: a change'],
  };
  return { ok: true, fragment };
}

describe('packageFragmentRefusal', () => {
  it('refuses a fragment naming a package under refuse, naming the key and where it is set', () => {
    expect(packageFragmentRefusal('refuse', '@scope/x', WHERE)).toBe(
      'release.packageFragments is refuse (/repo/rafa.config.ts): this project takes no package fragments; drop --package',
    );
  });

  it('takes a root fragment under refuse', () => {
    expect(packageFragmentRefusal('refuse', null, WHERE)).toBeNull();
  });

  it('takes a fragment naming a package under allow', () => {
    expect(packageFragmentRefusal('allow', '@scope/x', WHERE)).toBeNull();
  });

  it('takes a root fragment under allow', () => {
    expect(packageFragmentRefusal('allow', null, WHERE)).toBeNull();
  });
});

describe('isPackageFragmentRefused', () => {
  it('is true only under refuse with a package', () => {
    expect(isPackageFragmentRefused('refuse', '@scope/x')).toBe(true);
    expect(isPackageFragmentRefused('refuse', null)).toBe(false);
    expect(isPackageFragmentRefused('allow', '@scope/x')).toBe(false);
    expect(isPackageFragmentRefused('allow', null)).toBe(false);
  });
});

describe('refusedPackageFragments', () => {
  /** A tree holding one package fragment between two root fragments. */
  const tree = [
    { path: '.changes/rafa-1.md', reading: readingOf(null) },
    { path: '.changes/rafa-2.md', reading: readingOf('@scope/x') },
    { path: '.changes/rafa-3.md', reading: readingOf(null) },
  ];

  it('names each package fragment by path under refuse, with the package and the key', () => {
    expect(refusedPackageFragments('refuse', tree)).toEqual([
      {
        path: '.changes/rafa-2.md',
        package: '@scope/x',
        sentence: '.changes/rafa-2.md names package @scope/x, and release.packageFragments is refuse:'
          + ' this project takes no package fragments',
      },
    ]);
  });

  it('names every package fragment, in the order given', () => {
    const two = [
      { path: '.changes/b.md', reading: readingOf('@scope/b') },
      { path: '.changes/a.md', reading: readingOf('@scope/a') },
    ];
    expect(refusedPackageFragments('refuse', two).map(({ path }) => path)).toEqual([
      '.changes/b.md',
      '.changes/a.md',
    ]);
  });

  it('refuses nothing under refuse when no fragment names a package', () => {
    const roots = tree.filter(({ path }) => path !== '.changes/rafa-2.md');
    expect(refusedPackageFragments('refuse', roots)).toEqual([]);
  });

  it('refuses nothing under allow, package fragment included', () => {
    expect(refusedPackageFragments('allow', tree)).toEqual([]);
  });

  it('passes over a fragment the parser refused', () => {
    const malformed = parseFragment('no front matter here\n');
    expect(malformed.ok).toBe(false);
    expect(refusedPackageFragments('refuse', [{ path: '.changes/bad.md', reading: malformed }])).toEqual([]);
  });

  it('answers an empty tree with no refusals', () => {
    expect(refusedPackageFragments('refuse', [])).toEqual([]);
  });
});
