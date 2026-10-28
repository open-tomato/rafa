/**
 * Tests for the package half of the tag readings (`status-readings.ts`):
 * a `<name>@<version>` tag read as a package's, `latest` kept the
 * highest ROOT tag, {@link rootTags} and {@link latestTagOf} picking a
 * unit's tags, and the untagged list compared against root tags only.
 * The root-only readings — the version order, the `[v]<semver>` tags,
 * the changelog headings — are measured in
 * `src/tests/release-coupled/commands/release/status.test.ts`, where they were first written.
 *
 * Two controls keep a pass from passing while wrong: the package tag is
 * asserted present in every reading whose `latest` or untagged list
 * must leave it out, and the same changelog is read once with the
 * root's own tag, which does take the version off the untagged list.
 */
import type { GitResult, GitRunner } from '@open-tomato/rafa/core/git';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { latestTagOf, readTags, readUntagged, releaseTagsOf, rootTags } from './status-readings.js';

/** A temporary directory of this file's own. */
const tempBase = mkdtempSync(join(tmpdir(), 'rafa-status-readings-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A runner answering `git tag --list` with `stdout`, and refusing anything else. */
function tagGit(stdout: string): GitRunner {
  return (args): GitResult => args.join(' ') === 'tag --list'
    ? { ok: true, stdout, stderr: '' }
    : { ok: false, stdout: '', stderr: `no answer planted for git ${args.join(' ')}` };
}

/** A tag list holding root tags, two packages' tags and a tag naming no release. */
const MIXED = 'v0.4.0\n@scope/plugin@0.2.0\n@scope/plugin@0.10.0\nlib@1.0.0\nv0.5.0\nnightly\n';

describe('a package tag read off a tag list', () => {
  it('reads a scoped name and a bare one as the package, the version after the last @', () => {
    const tags = releaseTagsOf('@scope/plugin@0.2.0\nlib@1.0.0-rc.1\n');

    expect(tags.map((each) => [each.tag, each.package, each.version])).toEqual([
      ['lib@1.0.0-rc.1', 'lib', '1.0.0-rc.1'],
      ['@scope/plugin@0.2.0', '@scope/plugin', '0.2.0'],
    ]);
  });

  it('reads a v-prefixed and a bare version as the root\'s, with no package', () => {
    expect(releaseTagsOf('v0.4.0\n0.3.0\n').map((each) => each.package)).toEqual([null, null]);
  });

  it('orders root and package tags together, highest version first', () => {
    expect(releaseTagsOf(MIXED).map((each) => each.tag))
      .toEqual(['lib@1.0.0', '@scope/plugin@0.10.0', 'v0.5.0', 'v0.4.0', '@scope/plugin@0.2.0']);
  });

  it('leaves out a name@ tag whose version does not parse, and a name npm would refuse', () => {
    // The control: the well-formed tag beside them IS read.
    expect(releaseTagsOf('plugin@1.2\n@scope/plugin@01.2.3\nPlugin@1.0.0\n@scope@1.0.0\nplugin@1.0.0\n')
      .map((each) => each.tag)).toEqual(['plugin@1.0.0']);
  });
});

describe('a unit\'s tags picked out of a reading', () => {
  const reading = readTags(tagGit(MIXED));

  it('holds every release tag, and answers the highest root tag as latest', () => {
    expect(reading.tags).toHaveLength(5);
    expect(reading.tags[0]?.tag).toBe('lib@1.0.0');
    expect(reading.latest?.tag).toBe('v0.5.0');
    expect(reading.problem).toBeNull();
  });

  it('answers no latest when the repository holds package tags and no root tag', () => {
    const packagesOnly = readTags(tagGit('@scope/plugin@0.2.0\n'));

    expect(packagesOnly.tags).toHaveLength(1);
    expect(packagesOnly.latest).toBeNull();
  });

  it('picks the root\'s tags, highest first', () => {
    expect(rootTags(reading).map((each) => each.tag)).toEqual(['v0.5.0', 'v0.4.0']);
  });

  it('picks a package\'s newest tag by name, and the root\'s for null', () => {
    expect(latestTagOf(reading, '@scope/plugin')?.tag).toBe('@scope/plugin@0.10.0');
    expect(latestTagOf(reading, 'lib')?.tag).toBe('lib@1.0.0');
    expect(latestTagOf(reading, null)?.tag).toBe('v0.5.0');
  });

  it('answers null for a package no tag names', () => {
    expect(latestTagOf(reading, '@scope/other')).toBeNull();
  });
});

describe('the untagged list against package tags', () => {
  const root = mkdtempSync(join(tempBase, 'untagged-'));
  writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n\n## 0.5.0 — x\n\n## 0.4.0 — y\n', 'utf8');

  it('keeps a version only a package\'s tag names on the root\'s untagged list', () => {
    const tags = releaseTagsOf('v0.4.0\n@scope/plugin@0.5.0\n');

    expect(tags.map((each) => each.tag)).toContain('@scope/plugin@0.5.0');
    expect(readUntagged(root, 'CHANGELOG.md', tags).versions).toEqual(['0.5.0']);
  });

  it('takes the version off once the root\'s own tag names it', () => {
    const tags = releaseTagsOf('v0.4.0\nv0.5.0\n@scope/plugin@0.5.0\n');

    expect(readUntagged(root, 'CHANGELOG.md', tags).versions).toEqual([]);
  });
});
