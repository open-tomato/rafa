/**
 * Tests for the `packages` reading of `rafa release status`
 * (`status-packages.ts`): which members it lists, the columns each line
 * carries, and what a reading that failed leaves.
 *
 * Each case plants a workspace of its own under this file's temporary
 * base, because the members are read off the disk by
 * `readWorkspacePackages`. The git seam is a table, so no case runs
 * `git`, and it records every command it was sent: the cases handing
 * in `made` readings assert it was sent none, and the one that hands
 * none in asserts it WAS asked, so "no git command is sent twice" is
 * measured against a seam that could have been reached.
 */
import type { WaitingFragment, WaitingReading, WaitingSettings } from './status-fragments.js';
import type { PackagesReading } from './status-packages.js';
import type { GitResult, GitRunner } from '../../pr/index.js';
import type { TagReading } from '../../release/status-readings.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { releaseTagsOf } from '../../release/status-readings.js';

import { packagesCell, packagesLines, readPackages, UNTAGGED } from './status-packages.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-status-packages-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How many scratch directories this file has made, so each gets its own. */
let scratchCount = 0;

/** A directory of this case's own, under the temporary base. */
function scratch(): string {
  scratchCount += 1;
  const path = join(tempBase, `case-${scratchCount}`);
  mkdirSync(path, { recursive: true });
  return path;
}

/** What `readPackages` is told the base is; only read when no waiting reading is handed in. */
const SETTINGS: WaitingSettings = {
  ref: 'origin/main',
  releaseFragments: '.changes',
  releaseVersionFile: 'package.json',
  releaseStrategy: 'semver-by-level',
  releaseHeading: '## {version} — {date}',
};

/** A git runner recording each command it is sent and answering from `table`, refusing the rest. */
function recordingGit(table: Readonly<Record<string, GitResult>> = {}): { git: GitRunner; sent: string[] } {
  const sent: string[] = [];
  const git: GitRunner = (args) => {
    const words = args.join(' ');
    sent.push(words);
    return table[words] ?? { ok: false, stdout: '', stderr: `the case planted no answer for git ${words}` };
  };
  return { git, sent };
}

/** A tag reading over `text`, as `git tag --list` writes it. */
function tagsOf(text: string): TagReading {
  const tags = releaseTagsOf(text);
  return { tags, latest: tags.find((each) => each.package === null) ?? null, problem: null };
}

/** A waiting fragment naming `name`, or the root for null. */
function fragment(id: string, name: string | null): WaitingFragment {
  return { id, path: `.changes/${id}.md`, level: 'minor', title: 'a plan', package: name, addedOn: '2026-10-01' };
}

/** A waiting reading holding `fragments`. */
function waitingOf(fragments: readonly WaitingFragment[], read = true): WaitingReading {
  return {
    ref: 'origin/main',
    read,
    baseVersion: '0.5.0',
    fragments,
    malformed: 0,
    refused: 0,
    forecast: null,
    packages: [],
    problems: [],
  };
}

/** A member manifest's fields. */
interface Member {
  readonly dir: string;
  readonly name: string;
  readonly version?: string;
  readonly isPrivate?: boolean;
}

/** A project root with a workspace of `members` under `packages/*`. */
function plantWorkspace(members: readonly Member[]): string {
  const root = scratch();
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'root', version: '0.5.0', workspaces: ['packages/*'] }));
  for (const member of members) {
    mkdirSync(join(root, member.dir), { recursive: true });
    writeFileSync(join(root, member.dir, 'package.json'), JSON.stringify({
      name: member.name,
      ...(member.version === undefined
        ? {}
        : { version: member.version }),
      ...(member.isPrivate === true
        ? { private: true }
        : {}),
    }));
  }
  return root;
}

describe('the packages reading', () => {
  it('lists each publishable member with its version, its waiting count and its newest tag', () => {
    const root = plantWorkspace([
      { dir: 'packages/plugin', name: '@scope/plugin', version: '0.1.0' },
      { dir: 'packages/tool', name: 'tool', version: '2.0.0' },
    ]);
    const { git, sent } = recordingGit();

    const reading = readPackages(root, git, SETTINGS, {
      tags: tagsOf('v0.5.0\n@scope/plugin@0.1.0\n@scope/plugin@0.0.9\n'),
      waiting: waitingOf([fragment('a', '@scope/plugin'), fragment('b', null), fragment('c', '@scope/plugin')]),
    });

    expect(reading).toEqual({
      read: true,
      tagsRead: true,
      problem: null,
      packages: [
        { name: '@scope/plugin', dir: 'packages/plugin', version: '0.1.0', waiting: 2, tag: '@scope/plugin@0.1.0' },
        { name: 'tool', dir: 'packages/tool', version: '2.0.0', waiting: 0, tag: null },
      ],
    });
    expect(sent).toEqual([]);
  });

  it('leaves a private member out, which is the control that the filter is applied', () => {
    const root = plantWorkspace([
      { dir: 'packages/hub', name: '@scope/hub', version: '1.0.0', isPrivate: true },
      { dir: 'packages/plugin', name: '@scope/plugin', version: '0.1.0' },
    ]);

    const reading = readPackages(root, recordingGit().git, SETTINGS, { tags: tagsOf(''), waiting: waitingOf([]) });

    expect(reading.packages.map((each) => each.name)).toEqual(['@scope/plugin']);
  });

  it('reads a workspace of private members only, and a root with no workspace, as none publishable', () => {
    const privateOnly = plantWorkspace([{ dir: 'packages/hub', name: '@scope/hub', version: '1.0.0', isPrivate: true }]);
    const single = scratch();
    writeFileSync(join(single, 'package.json'), '{"version": "0.5.0"}');

    const empty: PackagesReading = { read: true, packages: [], tagsRead: true, problem: null };

    expect(readPackages(privateOnly, recordingGit().git, SETTINGS)).toEqual(empty);
    expect(readPackages(single, recordingGit().git, SETTINGS)).toEqual(empty);
  });

  it('reads a root with no package.json as no workspace, not as a failure', () => {
    const { git, sent } = recordingGit();

    expect(readPackages(scratch(), git, SETTINGS)).toEqual({ read: true, packages: [], tagsRead: true, problem: null });
    expect(sent).toEqual([]);
  });

  it('keeps a member manifest that does not parse as an unread workspace with the reader\'s sentence', () => {
    const root = plantWorkspace([]);
    mkdirSync(join(root, 'packages/broken'), { recursive: true });
    writeFileSync(join(root, 'packages/broken/package.json'), 'not json');

    const reading = readPackages(root, recordingGit().git, SETTINGS);

    expect(reading.read).toBe(false);
    expect(reading.problem).toStartWith('the workspace packages could not be read: ');
    expect(reading.problem).toContain('packages/broken/package.json');
  });

  it('reads the tags and the waiting tree itself when none is handed in', () => {
    const root = plantWorkspace([{ dir: 'packages/plugin', name: '@scope/plugin', version: '0.1.0' }]);
    const { git, sent } = recordingGit({ 'tag --list': { ok: true, stdout: '@scope/plugin@0.1.0\n', stderr: '' } });

    const reading = readPackages(root, git, SETTINGS);

    expect(sent[0]).toBe('tag --list');
    expect(sent.length).toBeGreaterThan(1);
    // The waiting tree the table refuses leaves the count unknown; the tag it answers is read.
    expect(reading.packages).toEqual([
      { name: '@scope/plugin', dir: 'packages/plugin', version: '0.1.0', waiting: null, tag: '@scope/plugin@0.1.0' },
    ]);
  });

  it('knows no tag of any member when the tag list could not be read', () => {
    const root = plantWorkspace([{ dir: 'packages/plugin', name: '@scope/plugin', version: '0.1.0' }]);

    const reading = readPackages(root, recordingGit().git, SETTINGS, {
      tags: { tags: [], latest: null, problem: 'the tags could not be listed' },
      waiting: waitingOf([], false),
    });

    expect(reading.tagsRead).toBe(false);
    expect(reading.packages[0]).toMatchObject({ waiting: null, tag: null });
  });
});

describe('the packages cell', () => {
  it('says none for no publishable member, a count otherwise, and null for an unread workspace', () => {
    const row = { name: 'a', dir: 'packages/a', version: '1.0.0', waiting: 0, tag: null };

    expect(packagesCell({ read: true, packages: [], tagsRead: true, problem: null }, 'none')).toBe('none');
    expect(packagesCell({ read: true, packages: [row], tagsRead: true, problem: null }, 'none')).toBe('1 publishable');
    expect(packagesCell({ read: true, packages: [row, row], tagsRead: true, problem: null }, 'none')).toBe('2 publishable');
    expect(packagesCell({ read: false, packages: [], tagsRead: true, problem: 'x' }, 'none')).toBeNull();
  });
});

describe('the packages lines', () => {
  it('writes one line per package in columns, untagged where no tag names it', () => {
    const reading: PackagesReading = {
      read: true,
      tagsRead: true,
      problem: null,
      packages: [
        { name: '@scope/plugin', dir: 'packages/plugin', version: '0.1.0', waiting: 1, tag: '@scope/plugin@0.1.0' },
        { name: 'tool', dir: 'packages/tool', version: '12.0.0', waiting: 10, tag: null },
      ],
    };

    expect(packagesLines(reading, '?')).toEqual([
      '@scope/plugin  0.1.0   1 waiting   @scope/plugin@0.1.0',
      `tool           12.0.0  10 waiting  ${UNTAGGED}`,
    ]);
  });

  it('marks each column that could not be read with the caller\'s mark', () => {
    const reading: PackagesReading = {
      read: true,
      tagsRead: false,
      problem: null,
      packages: [{ name: '@scope/plugin', dir: 'packages/plugin', version: null, waiting: null, tag: null }],
    };

    expect(packagesLines(reading, '?')).toEqual(['@scope/plugin  ?  ? waiting  ?']);
  });

  it('writes no line for none publishable', () => {
    expect(packagesLines({ read: true, packages: [], tagsRead: true, problem: null }, '?')).toEqual([]);
  });
});
