/**
 * Tests for the wrap-up prompt's naming bullets (`wrap-up.ts`).
 *
 * The prompt tells the session how to TITLE the pull request, and this
 * project's convention is `rafa-<n>: <title>` with `Closes #<n>` in the
 * body. Nothing else in the tree reads that spelling back, so a drift
 * in it would be silent; the cases below pin both spellings and, with
 * them, the two places the number may be read from.
 *
 * Every one of those bullets sits BELOW the prompt's first line, which
 * is the `wrap-up` classifier key `effort/classify.ts` buckets on. A
 * case that only asserted the new spelling present would pass on a
 * prompt that had pushed a bullet above that line and stopped
 * classifying, so the key is asserted first-line here as well, with the
 * classifier itself as the reading.
 *
 * The second group covers the release bullets, the prompt's half of
 * the spec's step 2 (`.specs/rafa-21-changelog-and-release.md`). They
 * are the only bullets whose text depends on an argument, so each case
 * builds a step-1 record and reads what the prompt made of it. The
 * prepared and the skipped record are each other's control: what one
 * asserts present, the other asserts absent, which is what keeps a
 * `toContain` from passing on a prompt that emits every bullet
 * unconditionally.
 */
import type { ReleasePrepared, ReleaseSkipped } from '../release/prepare.js';

import { describe, expect, test } from 'bun:test';

import { classifyPromptContent } from '../effort/classify.js';
import { renderChangelogEntry } from '../release/changelog.js';

import { buildWrapUpPrompt } from './wrap-up.js';

/** The branch a case builds its prompt on. */
const BRANCH = 'feat/rafa-20-pr-commands';

/** A plan body standing in for the `full` rendering appended below. */
const PLAN = '# Plan: pull-request commands\n\n- [ ] A task\n';

describe('the wrap-up prompt\'s pull-request naming', () => {
  test('spells the title `rafa-<n>: <title>` and closes the issue from the body', () => {
    const prompt = buildWrapUpPrompt(BRANCH, PLAN, null);

    expect(prompt).toContain('Title the PR `rafa-<n>: <title>`');
    expect(prompt).toContain('`Closes #<n>`');

    // The control: the superseded spelling is gone, so the assertions
    // above could not have passed on the old bullet.
    expect(prompt).not.toContain('Implement user authentication (#42)');
    expect(prompt).not.toContain('feat/42-slug');
  });

  test('names both places the number is read from, the plan then the branch', () => {
    const prompt = buildWrapUpPrompt(BRANCH, PLAN, null);
    const fromPlan = prompt.indexOf('`issue: <n>`');
    const fromBranch = prompt.indexOf(`the branch name (${BRANCH})`);

    expect(fromPlan).toBeGreaterThan(-1);
    expect(fromBranch).toBeGreaterThan(fromPlan);
  });

  test('keeps every naming bullet below the classifier key', () => {
    const prompt = buildWrapUpPrompt(BRANCH, PLAN, null);
    const [firstLine] = prompt.split('\n');

    expect(firstLine).toBe('* Read `@progress.txt` in full.');
    expect(classifyPromptContent(prompt)).toBe('wrap-up');
    expect(prompt.indexOf('rafa-<n>: <title>')).toBeGreaterThan(firstLine.length);
  });
});

/** The heading step 1 rendered, as every release case below reads it. */
const HEADING = '## 0.5.0 — 2026-09-20, Changelog and release in the loop';

/** The notes the entry's raw lines are rendered from. */
const NOTES = [
  { level: 'minor', area: 'release', summary: 'the loop writes the changelog entry' },
  { level: 'patch', area: 'loop', summary: 'the wrap-up leaves the release files alone' },
] as const;

/**
 * A step-1 record shaped as `release/prepare.ts` answers one, over a
 * real rendering of {@link NOTES} so the bullets quote the heading the
 * changelog actually carries.
 *
 * `overrides` is how the no-version-file case drops both the version
 * and the file edit, which is the one shape that changes the wording.
 */
function preparedRelease(overrides: Partial<ReleasePrepared> = {}): ReleasePrepared {
  const changelogText = `# Changelog\n\n${HEADING}\n`;
  return {
    kind: 'prepared',
    level: 'minor',
    levelSource: 'plan',
    notesLevel: 'minor',
    version: '0.5.0',
    baseVersion: '0.4.0',
    fetched: true,
    entry: renderChangelogEntry({
      template: '## {version} — {date}, {title}',
      values: { version: '0.5.0', date: '2026-09-20', title: 'Changelog and release in the loop' },
      notes: [...NOTES],
    }),
    insertPoint: 'file-end',
    insertLine: 3,
    changelog: { path: 'CHANGELOG.md', resolved: '/repo/CHANGELOG.md', before: '# Changelog\n', after: changelogText },
    versionFile: {
      path: 'package.json',
      resolved: '/repo/package.json',
      before: '{"version":"0.4.0"}',
      after: '{"version":"0.5.0"}',
    },
    problems: [],
    ...overrides,
  };
}

/** A step-1 record that wrote nothing, worded as `level-none` words it. */
function skippedRelease(): ReleaseSkipped {
  return {
    kind: 'skipped',
    reason: 'level-none',
    sentence: 'the plan declares release: none, so this pull request ships no version bump and no changelog entry',
    level: 'none',
    levelSource: 'plan',
    notesLevel: null,
    problems: [],
  };
}

describe('the wrap-up prompt\'s release bullets', () => {
  test('keeps the classifier key first-line whatever the release preparation holds', () => {
    const prepared = buildWrapUpPrompt(BRANCH, PLAN, null, preparedRelease());
    const skipped = buildWrapUpPrompt(BRANCH, PLAN, null, skippedRelease());

    for (const prompt of [prepared, skipped]) {
      const [firstLine] = prompt.split('\n');

      expect(firstLine).toBe('* Read `@progress.txt` in full.');
      expect(classifyPromptContent(prompt)).toBe('wrap-up');
    }
  });

  test('asks for the rewrite under the prepared heading and nowhere else', () => {
    const prompt = buildWrapUpPrompt(BRANCH, PLAN, null, preparedRelease());

    expect(prompt).toContain(`headed \`${HEADING}\``);
    expect(prompt).toContain('Rewrite the raw `- <area>: <summary>` lines under THAT heading into one line per area');
    expect(prompt).toContain('not another release\'s section');
    expect(prompt).toContain('not the file\'s trailing newline');

    // The control: with no preparation the prompt says none of it, so
    // the assertions above read the bullets and not the rest of the
    // list.
    const bare = buildWrapUpPrompt(BRANCH, PLAN, null);
    expect(bare).not.toContain(HEADING);
    expect(bare).not.toContain('Rewrite the raw');
  });

  test('leaves both release files unstaged and uncommitted for the loop\'s own commit', () => {
    const prompt = buildWrapUpPrompt(BRANCH, PLAN, null, preparedRelease());

    expect(prompt).toContain('Leave `CHANGELOG.md` and `package.json` UNSTAGED and UNCOMMITTED');
    expect(prompt).toContain('do not sweep them up with `git add -A`');
    expect(prompt).toContain('`chore: release 0.5.0` commit holding those files and nothing else');
  });

  test('carries the entry into the pull request body', () => {
    const prompt = buildWrapUpPrompt(BRANCH, PLAN, null, preparedRelease());

    expect(prompt).toContain(`Carry the entry into the pull request body: the heading \`${HEADING}\``);
    expect(prompt).toContain('as a section of the description');
  });

  test('names the changelog alone when the project has no version file', () => {
    const prompt = buildWrapUpPrompt(BRANCH, PLAN, null, preparedRelease({ version: null, versionFile: null }));

    expect(prompt).toContain('this project has no version file to bump');
    expect(prompt).toContain('Leave `CHANGELOG.md` UNSTAGED and UNCOMMITTED');
    expect(prompt).toContain('its own `chore: release` commit');
    expect(prompt).not.toContain('`package.json` now declares');
  });

  test('writes the skip sentence verbatim instead of the three bullets', () => {
    const skipped = skippedRelease();
    const prompt = buildWrapUpPrompt(BRANCH, PLAN, null, skipped);

    expect(prompt).toContain(`This pull request ships NO release: ${skipped.sentence}.`);
    expect(prompt).toContain('do not write an entry or bump a version by hand');

    // The control: the prepared bullets are the ones NOT emitted here,
    // and a prompt built from the prepared record carries them.
    expect(prompt).not.toContain('UNSTAGED and UNCOMMITTED');
    expect(prompt).not.toContain('Rewrite the raw');
    expect(buildWrapUpPrompt(BRANCH, PLAN, null, preparedRelease())).toContain('UNSTAGED and UNCOMMITTED');
  });
});
