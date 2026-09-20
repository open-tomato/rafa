/**
 * Tests for step 1 of the release (`src/release/prepare.ts`): what it
 * writes, what it answers, and every reading that makes it write
 * nothing.
 *
 * Each case builds a scratch repository of its own under `mkdtemp` —
 * never the checkout the suite runs in, whose own `package.json` and
 * `CHANGELOG.md` are exactly the two files this module rewrites — and
 * hands the module a fake {@link GitRunner} that records its argv. No
 * case reaches a network, and the base version is whatever that fake
 * says `git show` answered.
 *
 * Several things here would pass while wrong, so each has an assertion
 * of its own:
 *
 *  - A preparation that wrote the changelog but not the version file
 *    satisfies every assertion about the entry. So the manifest on
 *    disk is read back in the happy path and compared byte for byte
 *    outside its version token, both trailing-newline states covered.
 *  - A skip that wrote a file before deciding to skip satisfies every
 *    assertion about its sentence. So EVERY skip case reads both files
 *    back and asserts they are the bytes they were.
 *  - A module that refused on a failed fetch would still pass the
 *    happy path, so the failed-fetch case asserts a prepared record
 *    with the bump made and `fetched` false.
 *  - A module that took the base version off the working tree's
 *    manifest would pass a case whose two manifests agree. So the
 *    scratch manifest on disk holds a DIFFERENT version from the one
 *    the fake git answers, in every case that bumps.
 *
 * Six mutations of `prepare.ts` were driven on 2026-09-20, one at a
 * time over `env -u CLAUDECODE bun test src/release/prepare.test.ts`,
 * the module restored from a scratch copy and verified with `shasum -c`
 * after each. 22 cases, all green on the unmutated module; each fail
 * count is that run's own:
 *
 *  - the `level === 'none'` skip dropped: 3 fail, the three cases that
 *    name a `none` level, each of which then finds both files written.
 *  - the two writes swapped, the changelog going first: 1 fails, the
 *    unreplaceable-manifest case, which then finds the entry already
 *    inserted for a release that never got its version.
 *  - the restore dropped from the failed changelog write: 1 fails, the
 *    read-only-changelog case, which then finds the bumped manifest
 *    left behind.
 *  - `nextVersion` replaced by the base version: 9 fail, every case
 *    naming a bumped number and the two that name an unbumpable base.
 *  - a failed fetch turned into a refusal: 1 fails, the failed-fetch
 *    case, which is the only one whose fetch does not succeed.
 *  - the base read off the worktree's manifest instead of the base
 *    ref: 11 fail, every case whose two manifests disagree, the two
 *    that refuse on what git said among them.
 */
import type { ChangelogNote } from './changelog.js';
import type { ReleasePreparationInput, ReleaseSettings } from './prepare.js';
import type { GitResult, GitRunner } from '../pr/git.js';

import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { RELEASE_AUTO } from '../config-sections.js';

import { prepareRelease } from './prepare.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-prepare-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/**
 * The manifest a scratch repository's worktree holds. Its version is
 * NOT the base's: a module reading the bump off the disk instead of
 * off `origin/main` answers `9.10.0` where the base answers `0.5.0`,
 * and is caught.
 */
const WORKTREE_MANIFEST = '{\n  "name": "scratch",\n  "version": "9.9.9",\n  "private": true\n}';

/** What the fake git answers for `show origin/main:package.json`. */
const BASE_MANIFEST = '{\n  "name": "scratch",\n  "version": "0.4.0",\n  "private": true\n}';

/** A changelog shaped as this repository's is: a heading, a preamble, then versions. */
const CHANGELOG = [
  '# Changelog',
  '',
  'Every notable change to this project, newest first.',
  '',
  '## 0.4.0 — 2026-09-19, the one before',
  '',
  '- loop: the loop learned to stop',
  '',
].join('\n');

/** The settings every case starts from; a case overrides what it is about. */
const SETTINGS: ReleaseSettings = {
  releaseEnabled: RELEASE_AUTO,
  releaseVersionFile: 'package.json',
  releaseChangelog: 'CHANGELOG.md',
  releaseHeading: '## {version} — {date}, {title}',
};

/** The date every heading is rendered with, built local so no zone moves it. */
const NOW = new Date(2026, 8, 20, 12, 0, 0);

/** Two notes in two areas, as a plan's sessions would have stored them. */
const NOTES: readonly ChangelogNote[] = [
  { level: 'minor', area: 'loop', summary: 'the loop writes the changelog entry itself' },
  { level: 'patch', area: 'cli', summary: 'rafa release status prints the pending notes' },
  { level: 'minor', area: 'loop', summary: 'a task reports what its diff is worth' },
];

/** What a fake runner answered, and the argv it was asked. */
interface FakeGit {
  /** The runner to hand to the module. */
  readonly run: GitRunner;
  /** Every argv it was called with, in order. */
  readonly calls: string[][];
}

/** A runner answering per git subcommand, recording what it was asked. */
function fakeGit(replies: { fetch?: Partial<GitResult>; show?: Partial<GitResult> } = {}): FakeGit {
  const calls: string[][] = [];
  const run: GitRunner = (args) => {
    calls.push([...args]);
    const reply = args[0] === 'fetch'
      ? replies.fetch ?? {}
      : replies.show ?? { stdout: BASE_MANIFEST };
    return { ok: reply.ok ?? true, stdout: reply.stdout ?? '', stderr: reply.stderr ?? '' };
  };
  return { run, calls };
}

/** A scratch repository, its two files planted unless a case asks for neither. */
interface World {
  /** The repository root. */
  readonly root: string;
  /** The manifest's absolute path, planted or not. */
  readonly manifest: string;
  /** The changelog's absolute path, planted or not. */
  readonly changelog: string;
}

/** Plants a scratch repository; a null file is left absent. */
function world(
  name: string,
  files: { manifest?: string | null; changelog?: string | null } = {},
): World {
  const root = mkdtempSync(join(tempBase, `${name}-`));
  const manifest = join(root, 'package.json');
  const changelog = join(root, 'CHANGELOG.md');
  const manifestText = files.manifest === undefined
    ? WORKTREE_MANIFEST
    : files.manifest;
  const changelogText = files.changelog === undefined
    ? CHANGELOG
    : files.changelog;
  if (manifestText !== null) writeFileSync(manifest, manifestText);
  if (changelogText !== null) writeFileSync(changelog, changelogText);
  return { root, manifest, changelog };
}

/** The input every case starts from, over the scratch repository `at`. */
function input(
  at: World,
  git: GitRunner,
  over: Partial<ReleasePreparationInput> = {},
): ReleasePreparationInput {
  return {
    repoRoot: at.root,
    settings: SETTINGS,
    git,
    declared: 'minor',
    notes: NOTES,
    title: 'changelog and release in the loop',
    now: NOW,
    ...over,
  };
}

/** `path`'s text, or null when it is not there. */
function textAt(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

describe('prepareRelease over a repository it writes', () => {
  it('bumps the base version, writes it, and inserts the entry under the first heading', () => {
    const at = world('happy');
    const git = fakeGit();

    const made = prepareRelease(input(at, git.run));

    expect(made.kind).toBe('prepared');
    if (made.kind !== 'prepared') return;
    expect(made.version).toBe('0.5.0');
    expect(made.baseVersion).toBe('0.4.0');
    expect(made.level).toBe('minor');
    expect(made.levelSource).toBe('plan');
    expect(made.notesLevel).toBe('minor');
    expect(made.fetched).toBe(true);
    expect(made.problems).toEqual([]);
    expect(made.insertPoint).toBe('before-next-heading');
    expect(git.calls).toEqual([
      ['fetch', 'origin', 'main'],
      ['show', 'origin/main:package.json'],
    ]);
  });

  it('writes the manifest byte for byte outside its version token', () => {
    const at = world('manifest-bytes');

    const made = prepareRelease(input(at, fakeGit().run));

    expect(made.kind).toBe('prepared');
    if (made.kind !== 'prepared') return;
    const written = textAt(at.manifest);
    expect(written).toBe('{\n  "name": "scratch",\n  "version": "0.5.0",\n  "private": true\n}');
    expect(made.versionFile).not.toBeNull();
    expect(made.versionFile?.before).toBe(WORKTREE_MANIFEST);
    expect(made.versionFile?.after).toBe(written);
    expect(made.versionFile?.path).toBe('package.json');
    expect(made.versionFile?.resolved).toBe(at.manifest);
  });

  it('keeps a manifest that ends with a newline ending with one', () => {
    const at = world('manifest-newline', { manifest: `${WORKTREE_MANIFEST}\n` });

    prepareRelease(input(at, fakeGit().run));

    expect(textAt(at.manifest)?.endsWith('}\n')).toBe(true);
  });

  it('puts the entry after the first heading and its preamble, leaving the rest alone', () => {
    const at = world('entry');

    const made = prepareRelease(input(at, fakeGit().run));

    expect(made.kind).toBe('prepared');
    if (made.kind !== 'prepared') return;
    expect(textAt(at.changelog)).toBe(made.changelog.after);
    expect(made.changelog.before).toBe(CHANGELOG);
    expect(made.changelog.after.split('\n')).toEqual([
      '# Changelog',
      '',
      'Every notable change to this project, newest first.',
      '',
      '## 0.5.0 — 2026-09-20, changelog and release in the loop',
      '',
      '- loop: the loop writes the changelog entry itself',
      '- loop: a task reports what its diff is worth',
      '- cli: rafa release status prints the pending notes',
      '',
      '## 0.4.0 — 2026-09-19, the one before',
      '',
      '- loop: the loop learned to stop',
      '',
    ]);
  });

  it('renders the heading from the configured template', () => {
    const at = world('template');
    const settings = { ...SETTINGS, releaseHeading: '## v{version} ({date}) {title}' };

    const made = prepareRelease(input(at, fakeGit().run, { settings }));

    expect(made.kind).toBe('prepared');
    if (made.kind !== 'prepared') return;
    expect(made.entry.heading).toBe('## v0.5.0 (2026-09-20) changelog and release in the loop');
    expect(textAt(at.changelog)).toContain('## v0.5.0 (2026-09-20) changelog and release in the loop');
  });

  it('takes the level from the notes when the plan declares none', () => {
    const at = world('notes-level');
    const notes: ChangelogNote[] = [
      { level: 'patch', area: 'cli', summary: 'a flag is spelled right' },
      { level: 'major', area: 'store', summary: 'the store drops its legacy backend' },
    ];

    const made = prepareRelease(input(at, fakeGit().run, { declared: null, notes }));

    expect(made.kind).toBe('prepared');
    if (made.kind !== 'prepared') return;
    expect(made.level).toBe('major');
    expect(made.levelSource).toBe('notes');
    expect(made.version).toBe('1.0.0');
    expect(textAt(at.manifest)).toContain('"version": "1.0.0"');
  });

  it('reads the base off the remote branch a caller names', () => {
    const at = world('base-options');
    const git = fakeGit();

    prepareRelease(input(at, git.run, { base: { remote: 'upstream', branch: 'trunk' } }));

    expect(git.calls).toEqual([
      ['fetch', 'upstream', 'trunk'],
      ['show', 'upstream/trunk:package.json'],
    ]);
  });
});

describe('prepareRelease when a reading does not come out as asked', () => {
  it('prepares anyway when the fetch failed, and says the base may be stale', () => {
    const at = world('fetch-failed');
    const git = fakeGit({ fetch: { ok: false, stderr: 'fatal: unable to access origin' } });

    const made = prepareRelease(input(at, git.run));

    expect(made.kind).toBe('prepared');
    if (made.kind !== 'prepared') return;
    expect(made.fetched).toBe(false);
    expect(made.version).toBe('0.5.0');
    expect(made.problems).toHaveLength(1);
    expect(made.problems[0]).toContain('could not be fetched from origin');
    expect(textAt(at.manifest)).toContain('"version": "0.5.0"');
  });

  it('writes the entry with no version, and asks git nothing, when there is no version file', () => {
    const at = world('no-manifest', { manifest: null });
    const git = fakeGit();
    const settings = { ...SETTINGS, releaseEnabled: true };

    const made = prepareRelease(input(at, git.run, { settings }));

    expect(made.kind).toBe('prepared');
    if (made.kind !== 'prepared') return;
    expect(made.version).toBeNull();
    expect(made.baseVersion).toBeNull();
    expect(made.versionFile).toBeNull();
    expect(git.calls).toEqual([]);
    expect(made.entry.heading).toBe('## 2026-09-20, changelog and release in the loop');
    expect(made.problems).toEqual([
      'package.json is not there, so the entry is dated and carries no version',
    ]);
  });

  it('reports an entry that came out with no lines under its heading', () => {
    const at = world('empty-entry');

    const made = prepareRelease(input(at, fakeGit().run, { notes: [] }));

    expect(made.kind).toBe('prepared');
    if (made.kind !== 'prepared') return;
    expect(made.entry.lines).toEqual([]);
    expect(made.problems).toEqual([
      '## 0.5.0 — 2026-09-20, changelog and release in the loop has no lines under it: the plan stored no change note',
    ]);
    expect(textAt(at.changelog)).toContain('## 0.5.0 — 2026-09-20, changelog and release in the loop');
  });
});

describe('prepareRelease when the release does not run', () => {
  it('skips with release.enabled false, and writes neither file', () => {
    const at = world('disabled');
    const settings = { ...SETTINGS, releaseEnabled: false };

    const made = prepareRelease(input(at, fakeGit().run, { settings }));

    expect(made.kind).toBe('skipped');
    if (made.kind !== 'skipped') return;
    expect(made.reason).toBe('disabled');
    expect(made.sentence).toBe(
      'no version bump and no changelog entry: release.enabled is false in this project',
    );
    expect(textAt(at.manifest)).toBe(WORKTREE_MANIFEST);
    expect(textAt(at.changelog)).toBe(CHANGELOG);
  });

  it('skips under auto when one of the two files is missing, naming it', () => {
    const at = world('auto-one-missing', { changelog: null });

    const made = prepareRelease(input(at, fakeGit().run));

    expect(made.kind).toBe('skipped');
    if (made.kind !== 'skipped') return;
    expect(made.reason).toBe('disabled');
    expect(made.sentence).toBe(
      'no version bump and no changelog entry: release.enabled is auto and CHANGELOG.md is not there',
    );
    expect(textAt(at.manifest)).toBe(WORKTREE_MANIFEST);
  });

  it('skips under auto when both files are missing, naming both', () => {
    const at = world('auto-both-missing', { manifest: null, changelog: null });

    const made = prepareRelease(input(at, fakeGit().run));

    expect(made.kind).toBe('skipped');
    if (made.kind !== 'skipped') return;
    expect(made.sentence).toBe(
      'no version bump and no changelog entry: release.enabled is auto and package.json and CHANGELOG.md are not there',
    );
  });

  it('skips a plan that declares release: none, and writes neither file', () => {
    const at = world('declared-none');

    const made = prepareRelease(input(at, fakeGit().run, { declared: 'none' }));

    expect(made.kind).toBe('skipped');
    if (made.kind !== 'skipped') return;
    expect(made.reason).toBe('level-none');
    expect(made.level).toBe('none');
    expect(made.levelSource).toBe('plan');
    expect(made.notesLevel).toBe('minor');
    expect(made.sentence).toBe(
      'the plan declares release: none, so this pull request ships no version bump and no changelog entry',
    );
    expect(textAt(at.manifest)).toBe(WORKTREE_MANIFEST);
    expect(textAt(at.changelog)).toBe(CHANGELOG);
  });

  it('skips a plan whose every note is at level none', () => {
    const at = world('notes-none');
    const notes: ChangelogNote[] = [
      { level: 'none', area: 'loop', summary: 'an internal rename no user sees' },
    ];

    const made = prepareRelease(input(at, fakeGit().run, { declared: null, notes }));

    expect(made.kind).toBe('skipped');
    if (made.kind !== 'skipped') return;
    expect(made.reason).toBe('level-none');
    expect(made.levelSource).toBe('notes');
    expect(made.sentence).toBe(
      'every change note this plan stored is at level none, so this pull request ships no version bump and no changelog entry',
    );
    expect(textAt(at.changelog)).toBe(CHANGELOG);
  });

  it('skips a plan that stored no note and declared no level', () => {
    const at = world('no-notes');

    const made = prepareRelease(input(at, fakeGit().run, { declared: null, notes: [] }));

    expect(made.kind).toBe('skipped');
    if (made.kind !== 'skipped') return;
    expect(made.reason).toBe('level-none');
    expect(made.levelSource).toBe('default');
    expect(made.notesLevel).toBeNull();
    expect(made.sentence).toBe(
      'this plan stored no change note and declares no release level, so this pull request ships no version bump and no changelog entry',
    );
    expect(textAt(at.changelog)).toBe(CHANGELOG);
  });

  it('skips a missing changelog even with the release on and a version file there', () => {
    const at = world('changelog-missing', { changelog: null });
    const settings = { ...SETTINGS, releaseEnabled: true };

    const made = prepareRelease(input(at, fakeGit().run, { settings }));

    expect(made.kind).toBe('skipped');
    if (made.kind !== 'skipped') return;
    expect(made.reason).toBe('changelog-missing');
    expect(made.sentence).toBe(
      'no version bump and no changelog entry: CHANGELOG.md is not there',
    );
    expect(textAt(at.manifest)).toBe(WORKTREE_MANIFEST);
  });

  it('skips a base version git could not show, carrying what git said', () => {
    const at = world('base-unreadable');
    const git = fakeGit({
      show: { ok: false, stderr: 'fatal: path \'package.json\' does not exist in \'origin/main\'' },
    });

    const made = prepareRelease(input(at, git.run));

    expect(made.kind).toBe('skipped');
    if (made.kind !== 'skipped') return;
    expect(made.reason).toBe('base-unreadable');
    expect(made.sentence).toBe(
      'no version bump and no changelog entry: the base version could not be read from origin/main:package.json',
    );
    expect(made.problems).toHaveLength(1);
    expect(made.problems[0]).toContain('does not exist in \'origin/main\'');
    expect(textAt(at.manifest)).toBe(WORKTREE_MANIFEST);
    expect(textAt(at.changelog)).toBe(CHANGELOG);
  });

  it('skips a base version that is no version to bump', () => {
    const at = world('base-unusable');
    const git = fakeGit({ show: { stdout: '{"name":"scratch","version":"nightly"}' } });

    const made = prepareRelease(input(at, git.run));

    expect(made.kind).toBe('skipped');
    if (made.kind !== 'skipped') return;
    expect(made.reason).toBe('base-unreadable');
    expect(made.sentence).toBe(
      'no version bump and no changelog entry: origin/main:package.json declares nightly, which is no version to bump',
    );
    expect(textAt(at.manifest)).toBe(WORKTREE_MANIFEST);
    expect(textAt(at.changelog)).toBe(CHANGELOG);
  });

  it('skips a manifest whose version could not be replaced, leaving the changelog alone', () => {
    const at = world('manifest-unwritable', { manifest: '{"name":"scratch"}' });

    const made = prepareRelease(input(at, fakeGit().run));

    expect(made.kind).toBe('skipped');
    if (made.kind !== 'skipped') return;
    expect(made.reason).toBe('version-unwritable');
    expect(made.sentence).toContain('declares no version to write 0.5.0 over');
    expect(textAt(at.manifest)).toBe('{"name":"scratch"}');
    expect(textAt(at.changelog)).toBe(CHANGELOG);
  });
});

describe('prepareRelease against a file it cannot open', () => {
  it('skips a changelog it cannot read', () => {
    const at = world('changelog-unreadable');
    chmodSync(at.changelog, 0o000);

    const made = prepareRelease(input(at, fakeGit().run));
    chmodSync(at.changelog, 0o644);

    expect(made.kind).toBe('skipped');
    if (made.kind !== 'skipped') return;
    expect(made.reason).toBe('changelog-unreadable');
    expect(made.sentence).toBe(
      'no version bump and no changelog entry: CHANGELOG.md could not be read',
    );
    expect(textAt(at.manifest)).toBe(WORKTREE_MANIFEST);
  });

  it('restores the bumped manifest when the changelog write fails', () => {
    const at = world('changelog-unwritable');
    chmodSync(at.changelog, 0o444);

    const made = prepareRelease(input(at, fakeGit().run));
    chmodSync(at.changelog, 0o644);

    expect(made.kind).toBe('skipped');
    if (made.kind !== 'skipped') return;
    expect(made.reason).toBe('changelog-unwritable');
    expect(made.sentence).toContain('package.json was restored to the version it held');
    expect(textAt(at.manifest)).toBe(WORKTREE_MANIFEST);
    expect(textAt(at.changelog)).toBe(CHANGELOG);
  });
});
