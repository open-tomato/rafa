/**
 * Tests for the end of an epic (`./epic-end.ts`): the three lines, the
 * release line only where a released version carries no tag, the
 * release reading over a planted changelog and a git runner answering
 * `tag --list`, and the watch that remembers a walk's dry epic.
 *
 * No case reaches a real git or `gh`: the git runner answers by argv,
 * the changelog is a file planted under `tmpdir`, and the board a watch
 * wraps is a literal.
 *
 * ## The controls
 *
 * Each reading that would pass while wrong is paired:
 *
 *  - The release line's presence is read beside the same epic with a
 *    changelog whose every version is tagged, which must give two lines.
 *  - A tag listing that FAILED must give no versions and a problem; the
 *    control is the same changelog over a listing that worked and named
 *    no tag, which must offer every version. A reading that took a
 *    failure as "no tags" would offer both, and pass the control alone.
 *  - The watch is read over a dry reading and then over a reading with
 *    none from the next watched answer, which must forget the first: a
 *    watch that never reset would pass the first alone.
 */
import type { NextBoard, NextRoadmapReading, NextSources } from './readings.js';
import type { GitResult, GitRunner } from '../pr/index.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  EPIC_END_RELEASE_COMMAND,
  EPIC_END_ROADMAP_COMMAND,
  epicCloseCommand,
  epicEndLines,
  readEpicEndRelease,
  watchDryEpic,
} from './epic-end.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-epic-end-')));
afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

let planted = 0;

/** The dry epic every case names. */
const EPIC = Object.freeze({ number: 80, title: 'Epics and boards' });

/** A changelog naming 0.3.0, 0.2.0 and 0.1.0, newest first. */
const CHANGELOG = ['# Changelog', '', '## 0.3.0', '', '- three', '', '## 0.2.0', '', '- two', '', '## 0.1.0', '', '- one', ''].join('\n');

/** A project root holding `text` at `path`, or nothing when `text` is null. */
function plantRoot(path: string, text: string | null): string {
  planted += 1;
  const root = join(tempBase, `project-${String(planted)}`);
  mkdirSync(root, { recursive: true });
  if (text !== null) writeFileSync(join(root, path), text, 'utf8');
  return root;
}

/** A git runner answering `tag --list` with `tags`, or failing it when `tags` is null, and recording every call. */
function tagGit(tags: readonly string[] | null): { readonly git: GitRunner; readonly calls: () => readonly string[] } {
  const calls: string[] = [];
  return {
    git: (args): GitResult => {
      calls.push(args.join(' '));
      if (args.join(' ') !== 'tag --list') return { ok: true, stdout: '', stderr: '' };
      return tags === null
        ? { ok: false, stdout: '', stderr: 'fatal: not a git repository' }
        : { ok: true, stdout: tags.map((tag) => `${tag}\n`).join(''), stderr: '' };
    },
    calls: () => calls,
  };
}

describe('the lines', () => {
  it('names the closing gate and the board\'s epics, with no release line where nothing is untagged', () => {
    const lines = epicEndLines(EPIC, { changelog: 'CHANGELOG.md', versions: [], problem: null });

    expect(lines).toEqual([
      '👉 epic #80 Epics and boards has run dry: close it through its gate — rafa epic close 80',
      '🗺 list the board\'s epics with their state and progress — rafa roadmap',
    ]);
    expect(epicCloseCommand(EPIC)).toBe('rafa epic close 80');
    expect(lines[1]?.endsWith(EPIC_END_ROADMAP_COMMAND)).toBe(true);
  });

  it('adds the release line where one version carries no tag', () => {
    const lines = epicEndLines(EPIC, { changelog: 'CHANGELOG.md', versions: ['0.3.0'], problem: null });

    expect(lines.length).toBe(3);
    expect(lines[2]).toBe('🏷 0.3.0 is in CHANGELOG.md with no tag: tag the release — rafa release tag');
    expect(lines[2]?.endsWith(EPIC_END_RELEASE_COMMAND)).toBe(true);
  });

  it('names every untagged version, with the verb that agrees', () => {
    const lines = epicEndLines(EPIC, { changelog: 'docs/CHANGES.md', versions: ['0.3.0', '0.2.0', '0.1.0'], problem: null });

    expect(lines[2]).toBe('🏷 0.3.0, 0.2.0 and 0.1.0 are in docs/CHANGES.md with no tag: tag the release — rafa release tag');
  });

  it('leaves the release line out where the release was not read', () => {
    expect(epicEndLines(EPIC, null).length).toBe(2);
  });
});

describe('the release reading', () => {
  it('answers the released versions no tag names, newest first', () => {
    const root = plantRoot('CHANGELOG.md', CHANGELOG);
    const git = tagGit(['v0.1.0', 'v0.2.0']);

    const release = readEpicEndRelease(git.git, root, 'CHANGELOG.md');

    expect(release).toEqual({ changelog: 'CHANGELOG.md', versions: ['0.3.0'], problem: null });
    expect(git.calls()).toEqual(['tag --list']);
  });

  it('answers no version where every released version is tagged, so the lines stay two', () => {
    const root = plantRoot('CHANGELOG.md', CHANGELOG);

    const release = readEpicEndRelease(tagGit(['v0.1.0', 'v0.2.0', 'v0.3.0']).git, root, 'CHANGELOG.md');

    expect(release.versions).toEqual([]);
    expect(release.problem).toBeNull();
    expect(epicEndLines(EPIC, release).length).toBe(2);
  });

  it('answers no version and says why when the tags could not be listed, never taking that as no tags', () => {
    const root = plantRoot('CHANGELOG.md', CHANGELOG);

    const failed = readEpicEndRelease(tagGit(null).git, root, 'CHANGELOG.md');
    const untaggedAll = readEpicEndRelease(tagGit([]).git, root, 'CHANGELOG.md');

    expect(failed.versions).toEqual([]);
    expect(failed.problem).toContain('the tags could not be listed');
    expect(untaggedAll.versions).toEqual(['0.3.0', '0.2.0', '0.1.0']);
  });

  it('answers no version and says why when the changelog is not there', () => {
    const root = plantRoot('CHANGELOG.md', null);

    const release = readEpicEndRelease(tagGit([]).git, root, 'CHANGELOG.md');

    expect(release.versions).toEqual([]);
    expect(release.problem).toBe(`the changelog could not be read at ${join(root, 'CHANGELOG.md')}`);
  });
});

/** A board whose walk answers `reading`, counting the walks. */
function boardAnswering(reading: NextRoadmapReading): { readonly board: NextBoard; readonly walks: () => number } {
  let walks = 0;
  return {
    board: {
      next: () => {
        walks += 1;
        return Promise.resolve(reading);
      },
      blocking: () => Promise.resolve(null),
      isReady: () => Promise.resolve(false),
    },
    walks: () => walks,
  };
}

/** Sources holding `board` and nothing a case reads besides. */
function sourcesOver(board: NextBoard): NextSources {
  return { board } as unknown as NextSources;
}

describe('the watch', () => {
  const dry: NextRoadmapReading = { roadmap: 31, line: null, passed: 2, problems: [], dryEpic: EPIC };
  const plain: NextRoadmapReading = { roadmap: 31, line: null, passed: 2, problems: [] };

  it('remembers the dry epic of a walk, passing the reading through untouched and walking once', async () => {
    const watch = watchDryEpic();
    const held = boardAnswering(dry);

    const reading = await watch.watch(sourcesOver(held.board)).board.next();

    expect(reading).toBe(dry);
    expect(watch.last()).toEqual(EPIC);
    expect(held.walks()).toBe(1);
  });

  it('forgets it for the next watched answer, which walked no epic dry', async () => {
    const watch = watchDryEpic();
    await watch.watch(sourcesOver(boardAnswering(dry).board)).board.next();

    const next = watch.watch(sourcesOver(boardAnswering(plain).board));
    const beforeWalk = watch.last();
    await next.board.next();

    expect(beforeWalk).toBeNull();
    expect(watch.last()).toBeNull();
  });

  it('walks nothing of its own, so an answer whose rows never walk remembers no epic', () => {
    const watch = watchDryEpic();
    const held = boardAnswering(dry);

    watch.watch(sourcesOver(held.board));

    expect(held.walks()).toBe(0);
    expect(watch.last()).toBeNull();
  });
});
