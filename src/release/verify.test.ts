/**
 * Tests for step 3 of the release (`src/release/verify.ts`): the three
 * readings over the files a wrap-up session left, and the restore of
 * step 1's text on every refusal.
 *
 * Each case builds a scratch repository of its own under `mkdtemp` and
 * runs the REAL step 1 over it — never the checkout the suite runs in,
 * whose own `package.json` and `CHANGELOG.md` are exactly the two
 * files these modules rewrite. So the record every case verifies
 * against is the one `prepareRelease` actually answers, and a change to
 * the insertion that step 3 could not follow reddens here rather than
 * in production. The fake {@link GitRunner} answers a base manifest
 * whose version differs from the worktree one, as in
 * `./prepare.test.ts`; no case reaches a network.
 *
 * What a session did to the files is planted by writing over them
 * between step 1 and step 3, which is exactly the seam the real
 * session sits in.
 *
 * Several things here would pass while wrong, so each has an assertion
 * of its own:
 *
 *  - A module that restored on EVERY call would satisfy every refusal
 *    case. So one verified case reads both files back and asserts the
 *    text the session left is still on disk, step 1's text having been
 *    written over.
 *  - A module that answered `verified` without reading the version
 *    file would pass every changelog case. So the three version
 *    refusals leave the changelog exactly as a passing session left
 *    it, and can only be caught by opening the manifest.
 *  - A module that compared the changelog against step 1's `after`
 *    whole, rather than outside the span, would refuse every
 *    legitimate rewrite. So the rewrite case replaces every raw line
 *    under the heading with different prose, and still verifies.
 *  - A restore that wrote `before` instead of `after` would still put
 *    a file back. So every refusal case compares both files byte for
 *    byte against step 1's `after`, which is not the text step 1 found.
 *
 * Six mutations of `verify.ts` were driven on 2026-09-20, one at a
 * time over `env -u CLAUDECODE bun test src/release/verify.test.ts`,
 * the module restored from a scratch copy and verified with `shasum -c`
 * after each. 23 cases, all green on the unmutated module; each fail
 * count is that run's own:
 *
 *  - `changedOutside` answering null always: 3 fail, the edits planted
 *    in the preamble, in the older release and past the end of the
 *    file. The two shortened files still refuse, on the length reading
 *    before it, which is why they are separate cases.
 *  - the suffix half of `changedOutside` dropped: 2 fail, the edits
 *    BELOW the section; the preamble edit above it still refuses. That
 *    is why there is a planted edit on each side of the entry.
 *  - the restore dropped from `refuse`: 13 fail, every refusal case
 *    that reads a file back — all of them but the one that asserts
 *    only the singular in a sentence.
 *  - the restore writing `before` instead of `after`: the same 13,
 *    since step 1's text is not the text step 1 found.
 *  - `checkVersion` answering null always: 5 fail, the four manifests
 *    the session broke and the restore-failure case built on one of
 *    them. None of the five touches the changelog, so only a module
 *    that opens the manifest catches them.
 *  - the `section[0] !== heading` reading dropped: 1 fails, the stray
 *    line planted above the heading, which is the only case whose
 *    heading is present but not first.
 */
import type { ChangelogNote } from './changelog.js';
import type { ReleasePrepared, ReleasePreparationInput, ReleaseSettings } from './prepare.js';
import type { GitRunner } from '../pr/git.js';

import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { RELEASE_AUTO } from '../config-sections.js';

import { prepareRelease } from './prepare.js';
import { changelogInsertionSpan, verifyRelease } from './verify.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-verify-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The manifest the scratch worktree holds; its version is not the base's. */
const WORKTREE_MANIFEST = '{\n  "name": "scratch",\n  "version": "9.9.9",\n  "private": true\n}';

/** The manifest step 1 leaves behind, once the base is bumped into it. */
const BUMPED_MANIFEST = '{\n  "name": "scratch",\n  "version": "0.5.0",\n  "private": true\n}';

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

/** The heading step 1 renders for every case below. */
const HEADING = '## 0.5.0 — 2026-09-20, changelog and release in the loop';

/** The settings every case starts from. */
const SETTINGS: ReleaseSettings = {
  releaseEnabled: RELEASE_AUTO,
  releaseVersionFile: 'package.json',
  releaseChangelog: 'CHANGELOG.md',
  releaseHeading: '## {version} — {date}, {title}',
};

/** The date every heading is rendered with, built local so no zone moves it. */
const NOW = new Date(2026, 8, 20, 12, 0, 0);

/** Three notes in two areas, as a plan's sessions would have stored them. */
const NOTES: readonly ChangelogNote[] = [
  { level: 'minor', area: 'loop', summary: 'the loop writes the changelog entry itself' },
  { level: 'patch', area: 'cli', summary: 'rafa release status prints the pending notes' },
  { level: 'minor', area: 'loop', summary: 'a task reports what its diff is worth' },
];

/** A runner that fetches cleanly and shows the base manifest. */
const git: GitRunner = (args) => ({
  ok: true,
  stdout: args[0] === 'show'
    ? BASE_MANIFEST
    : '',
  stderr: '',
});

/** A scratch repository step 1 has already run over. */
interface World {
  /** The repository root. */
  readonly root: string;
  /** The manifest's absolute path, planted or not. */
  readonly manifest: string;
  /** The changelog's absolute path. */
  readonly changelog: string;
  /** What step 1 answered over it. */
  readonly prepared: ReleasePrepared;
}

/** `path`'s text, or null when it is not there. */
function textAt(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Plants a scratch repository and runs step 1 over it, answering both.
 * `manifest: null` leaves the version file absent, which is the
 * dated-entry-no-bump shape — and turns `release.enabled` on by hand,
 * since `auto` reads a missing version file as a project with no
 * release to make (`./enabled.ts`).
 */
function world(name: string, files: { manifest?: string | null } = {}): World {
  const root = mkdtempSync(join(tempBase, `${name}-`));
  const manifest = join(root, 'package.json');
  const changelog = join(root, 'CHANGELOG.md');
  const manifestText = files.manifest === undefined
    ? WORKTREE_MANIFEST
    : files.manifest;
  if (manifestText !== null) writeFileSync(manifest, manifestText);
  writeFileSync(changelog, CHANGELOG);

  const input: ReleasePreparationInput = {
    repoRoot: root,
    settings: manifestText === null
      ? { ...SETTINGS, releaseEnabled: true }
      : SETTINGS,
    git,
    declared: 'minor',
    notes: NOTES,
    title: 'changelog and release in the loop',
    now: NOW,
  };
  const prepared = prepareRelease(input);
  if (prepared.kind !== 'prepared') {
    throw new Error(`step 1 skipped the scratch repository: ${prepared.sentence}`);
  }
  return { root, manifest, changelog, prepared };
}

/** The changelog as it stands, by line. */
function linesAt(at: World): string[] {
  return (textAt(at.changelog) ?? '').split('\n');
}

/** Writes `lines` back as the changelog, as a wrap-up session would. */
function writeLines(at: World, lines: readonly string[]): void {
  writeFileSync(at.changelog, lines.join('\n'));
}

/** The session rewriting the three raw lines into one line per area. */
const REWRITTEN = [
  '- loop: the loop now writes the changelog entry and picks the version itself',
  '- cli: rafa release status prints the version, the latest tag and the pending notes',
];

/** Step 1's raw lines rewritten in place, touching nothing else. */
function rewriteSection(at: World): void {
  const lines = linesAt(at);
  const first = lines.indexOf(HEADING);
  writeLines(at, [
    ...lines.slice(0, first + 2),
    ...REWRITTEN,
    ...lines.slice(first + 5),
  ]);
}

describe('changelogInsertionSpan over the two texts step 1 recorded', () => {
  it('splits a middle insertion into its prefix, its lines and its suffix', () => {
    const before = 'a\nb\nc';
    const after = 'a\nX\nY\nb\nc';

    const span = changelogInsertionSpan(before, after);

    expect(span.prefix).toBe(1);
    expect(span.suffix).toBe(2);
    expect(span.inserted).toEqual(['X', 'Y']);
  });

  it('keeps the two counts from overlapping when the inserted lines repeat the file', () => {
    const before = 'a\nb';
    const after = 'a\nb\na\nb';

    const span = changelogInsertionSpan(before, after);

    expect(span.prefix + span.suffix).toBe(2);
    expect(span.inserted.length).toBe(2);
  });

  it('reads an insertion at the top of the file as an empty prefix', () => {
    const span = changelogInsertionSpan('a\nb', 'X\n\na\nb');

    expect(span.prefix).toBe(0);
    expect(span.suffix).toBe(2);
    expect(span.inserted).toEqual(['X', '']);
  });

  it('reads an insertion at the end of the file as an empty suffix', () => {
    const span = changelogInsertionSpan('a\nb', 'a\nb\n\nX');

    expect(span.prefix).toBe(2);
    expect(span.suffix).toBe(0);
    expect(span.inserted).toEqual(['', 'X']);
  });

  it('answers the span of a real preparation, one entry wide', () => {
    const at = world('span');

    const span = changelogInsertionSpan(at.prepared.changelog.before, at.prepared.changelog.after);

    expect(span.prefix).toBe(4);
    expect(span.suffix).toBe(4);
    expect(span.inserted[0]).toBe(HEADING);
  });
});

describe('verifyRelease over a session that did as it was told', () => {
  it('verifies a section rewritten in place and answers its lines', () => {
    const at = world('rewritten');
    rewriteSection(at);

    const read = verifyRelease(at.prepared);

    expect(read.kind).toBe('verified');
    if (read.kind !== 'verified') return;
    expect(read.version).toBe('0.5.0');
    expect(read.heading).toBe(HEADING);
    expect(read.section).toEqual([HEADING, '', ...REWRITTEN]);
    expect(read.lines).toEqual(REWRITTEN);
  });

  it('leaves both files exactly as the session left them', () => {
    const at = world('no-restore');
    rewriteSection(at);
    const session = textAt(at.changelog);

    const read = verifyRelease(at.prepared);

    expect(read.kind).toBe('verified');
    expect(textAt(at.changelog)).toBe(session);
    expect(session).not.toBe(at.prepared.changelog.after);
    expect(textAt(at.manifest)).toBe(BUMPED_MANIFEST);
  });

  it('verifies a session that rewrote nothing at all', () => {
    const at = world('untouched');

    const read = verifyRelease(at.prepared);

    expect(read.kind).toBe('verified');
    if (read.kind !== 'verified') return;
    expect(read.lines).toEqual([
      '- loop: the loop writes the changelog entry itself',
      '- loop: a task reports what its diff is worth',
      '- cli: rafa release status prints the pending notes',
    ]);
    expect(read.changelog).toBe(at.prepared.changelog.after);
  });

  it('verifies a release with no version file, checking only the changelog', () => {
    const at = world('no-version-file', { manifest: null });
    expect(at.prepared.versionFile).toBeNull();

    const read = verifyRelease(at.prepared);

    expect(read.kind).toBe('verified');
    if (read.kind !== 'verified') return;
    expect(read.version).toBeNull();
    expect(read.heading).toBe('## 2026-09-20, changelog and release in the loop');
    expect(textAt(at.manifest)).toBeNull();
  });
});

describe('verifyRelease over a session that changed another section', () => {
  it('refuses an edit to an older release and restores step 1s text', () => {
    const at = world('old-section');
    const lines = linesAt(at);
    writeLines(at, lines.map((line) => (
      line === '- loop: the loop learned to stop'
        ? '- loop: the loop learned to stop, rewritten'
        : line
    )));

    const read = verifyRelease(at.prepared);

    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') return;
    expect(read.reason).toBe('changelog-changed');
    expect(read.sentence).toBe(
      'no release commit: CHANGELOG.md line 13 reads "- loop: the loop learned to stop, rewritten" '
      + `where the loop left "- loop: the loop learned to stop", outside the ${HEADING} section, `
      + 'and CHANGELOG.md and package.json were restored to the text the loop wrote',
    );
    expect(textAt(at.changelog)).toBe(at.prepared.changelog.after);
    expect(textAt(at.manifest)).toBe(BUMPED_MANIFEST);
  });

  it('refuses an edit to the preamble above the entry', () => {
    const at = world('preamble');
    const lines = linesAt(at);
    writeLines(at, lines.map((line) => (
      line.startsWith('Every notable')
        ? 'Everything notable, newest first.'
        : line
    )));

    const read = verifyRelease(at.prepared);

    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') return;
    expect(read.reason).toBe('changelog-changed');
    expect(read.sentence).toContain('CHANGELOG.md line 3 reads "Everything notable, newest first."');
    expect(textAt(at.changelog)).toBe(at.prepared.changelog.after);
  });

  it('refuses a line appended past the end of the file', () => {
    const at = world('appended');
    writeFileSync(at.changelog, `${at.prepared.changelog.after}<!-- generated -->`);

    const read = verifyRelease(at.prepared);

    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') return;
    expect(read.reason).toBe('changelog-changed');
    expect(read.sentence).toContain('reads "<!-- generated -->" where the loop left ""');
    expect(textAt(at.changelog)).toBe(at.prepared.changelog.after);
  });

  it('refuses a file that lost more lines than the entry had', () => {
    const at = world('shrunk');
    writeFileSync(at.changelog, '# Changelog\n');

    const read = verifyRelease(at.prepared);

    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') return;
    expect(read.reason).toBe('changelog-changed');
    expect(read.sentence).toContain(`CHANGELOG.md is 6 lines shorter than the text the loop left around the ${HEADING} section`);
    expect(textAt(at.changelog)).toBe(at.prepared.changelog.after);
  });

  it('names one line when exactly one is missing', () => {
    const at = world('one-short');
    const lines = linesAt(at);
    writeLines(at, lines.slice(0, 7));

    const read = verifyRelease(at.prepared);

    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') return;
    expect(read.sentence).toContain('CHANGELOG.md is 1 line shorter than');
  });
});

describe('verifyRelease over a session that lost the heading', () => {
  it('refuses a heading the session rewrote', () => {
    const at = world('heading-rewritten');
    const lines = linesAt(at);
    writeLines(at, lines.map((line) => (
      line === HEADING
        ? '## Unreleased'
        : line
    )));

    const read = verifyRelease(at.prepared);

    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') return;
    expect(read.reason).toBe('heading-missing');
    expect(read.sentence).toBe(
      `no release commit: the heading ${HEADING} is no longer in CHANGELOG.md, `
      + 'and CHANGELOG.md and package.json were restored to the text the loop wrote',
    );
    expect(textAt(at.changelog)).toBe(at.prepared.changelog.after);
  });

  it('refuses a line the session put above the heading', () => {
    const at = world('heading-not-first');
    const lines = linesAt(at);
    const first = lines.indexOf(HEADING);
    writeLines(at, [...lines.slice(0, first), '<!-- newest -->', ...lines.slice(first)]);

    const read = verifyRelease(at.prepared);

    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') return;
    expect(read.reason).toBe('heading-missing');
    expect(read.sentence).toContain(`the heading ${HEADING} no longer opens the section the loop inserted into CHANGELOG.md`);
    expect(textAt(at.changelog)).toBe(at.prepared.changelog.after);
  });
});

describe('verifyRelease over a version file the session touched', () => {
  it('refuses a manifest holding a version other than the prepared one', () => {
    const at = world('version-changed');
    rewriteSection(at);
    writeFileSync(at.manifest, BUMPED_MANIFEST.replace('0.5.0', '0.6.0'));

    const read = verifyRelease(at.prepared);

    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') return;
    expect(read.reason).toBe('version-changed');
    expect(read.sentence).toBe(
      'no release commit: package.json declares 0.6.0, not the 0.5.0 this release was prepared for, '
      + 'and CHANGELOG.md and package.json were restored to the text the loop wrote',
    );
    expect(textAt(at.manifest)).toBe(BUMPED_MANIFEST);
    expect(textAt(at.changelog)).toBe(at.prepared.changelog.after);
  });

  it('refuses a manifest whose version is no version at all', () => {
    const at = world('version-unparsable');
    writeFileSync(at.manifest, BUMPED_MANIFEST.replace('0.5.0', 'nightly'));

    const read = verifyRelease(at.prepared);

    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') return;
    expect(read.reason).toBe('version-unparsable');
    expect(read.sentence).toContain('package.json declares nightly, which is no version');
    expect(textAt(at.manifest)).toBe(BUMPED_MANIFEST);
  });

  it('refuses a manifest that no longer parses as JSON', () => {
    const at = world('version-unjson');
    writeFileSync(at.manifest, `${BUMPED_MANIFEST}<<<<<<< HEAD`);

    const read = verifyRelease(at.prepared);

    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') return;
    expect(read.reason).toBe('version-unreadable');
    expect(read.sentence).toContain('package.json no longer parses as a manifest declaring a version');
    expect(textAt(at.manifest)).toBe(BUMPED_MANIFEST);
  });

  it('refuses a manifest the session deleted, and writes it back', () => {
    const at = world('version-deleted');
    rmSync(at.manifest);

    const read = verifyRelease(at.prepared);

    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') return;
    expect(read.reason).toBe('version-unreadable');
    expect(read.sentence).toContain('package.json could not be read back after the wrap-up session');
    expect(textAt(at.manifest)).toBe(BUMPED_MANIFEST);
  });
});

describe('verifyRelease over files it cannot open', () => {
  it('refuses a changelog the session deleted, and writes it back', () => {
    const at = world('changelog-deleted');
    rmSync(at.changelog);

    const read = verifyRelease(at.prepared);

    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') return;
    expect(read.reason).toBe('changelog-unreadable');
    expect(read.sentence).toContain('CHANGELOG.md could not be read back after the wrap-up session');
    expect(textAt(at.changelog)).toBe(at.prepared.changelog.after);
    expect(textAt(at.manifest)).toBe(BUMPED_MANIFEST);
  });

  it('says which file could not be restored when the restore itself fails', () => {
    const at = world('restore-unwritable');
    writeFileSync(at.manifest, BUMPED_MANIFEST.replace('0.5.0', '0.6.0'));
    chmodSync(at.changelog, 0o444);

    const read = verifyRelease(at.prepared);
    chmodSync(at.changelog, 0o644);

    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') return;
    expect(read.reason).toBe('version-changed');
    expect(read.sentence).toContain('CHANGELOG.md could not be restored to the text the loop wrote:');
    expect(read.restores.map((restore) => [restore.path, restore.restored])).toEqual([
      ['CHANGELOG.md', false],
      ['package.json', true],
    ]);
    expect(textAt(at.manifest)).toBe(BUMPED_MANIFEST);
  });

  it('restores the changelog alone when there is no version file', () => {
    const at = world('restore-one', { manifest: null });
    writeFileSync(at.changelog, '# Changelog\n');

    const read = verifyRelease(at.prepared);

    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') return;
    expect(read.sentence).toContain('CHANGELOG.md was restored to the text the loop wrote');
    expect(read.restores.length).toBe(1);
    expect(textAt(at.changelog)).toBe(at.prepared.changelog.after);
  });
});
