/**
 * Tests for the classifier (`src/pr/triage/classify.ts`).
 *
 * The module is a pure function over four already-captured readings, so
 * nothing here plants a repository, spawns `gh` or `git`, or reads a
 * fixture: every case is a literal pull request, a literal step and a
 * literal path list. The check rows are the one exception, and they are
 * built by putting captured-shape JSON through `parseChecks`
 * (`../checks.ts`) rather than by writing `CheckRow` objects out by
 * hand, so that a case saying `IN_PROGRESS` is pending is measuring the
 * state mapping the rest of rafa uses and not one this file invented.
 *
 * Three jobs:
 *
 *  - Hold the class set closed from both ends, the way
 *    `src/check/references.test.ts` holds its issue codes.
 *    {@link EVERY_CLASS} carries one input per class and the class it
 *    must produce, and the closed-set case asserts the classes it
 *    produced are exactly `TRIAGE_CLASSES` — so a class added to the
 *    vocabulary with no input that reaches it, and an input reaching a
 *    class the vocabulary does not carry, are both a red case.
 *  - Pair every reading that could pass by accident with a control:
 *    each conflict class beside the same list one path wider, the
 *    precedence beside the same pull request with the earlier reading
 *    removed, and each `ci-*` class beside a near-miss step name.
 *  - Keep the step phrases honest about their own matcher: a phrase is
 *    matched on token boundaries, so a phrase that is not itself in
 *    token form could never match anything, and one case normalises
 *    every declared phrase and compares it against itself.
 *
 * Seven mutations of `classify.ts` were driven against this file on
 * 2026-09-18, one at a time, the module restored from a scratch copy
 * and verified with `shasum -c` after each, 27 pass either side:
 *
 *  - the conflict branch moved BELOW the two check branches, so a
 *    conflicting pull request whose checks are red is classed on those
 *    stale rows: 7 fail, the three closed-set cases, both cases that
 *    read a conflict reason, the conflict half of the simple case and
 *    the precedence case. That count is the reason `conflicting` builds
 *    its pull requests with RED rows rather than with the empty reading
 *    a freshly conflicted pull request usually carries: on empty rows
 *    this mutation costs one case instead of seven, since a conflict
 *    with no checks reaches the same class from either position.
 *  - `classifyConflictFiles` answering on ANY lockfile or manifest
 *    rather than on every path being one: 2 fail, the mixed list beside
 *    `bun.lock` and the mixed one beside `package.json`, which are the
 *    two controls written for exactly this reading.
 *  - the manifest reading dropped, leaving lockfile and other: 3 fail,
 *    the manifest case and two closed-set cases, which lose
 *    `conflict-manifest` from the set the inputs produce.
 *  - `classifyFailedStep` matching substrings rather than whole tokens:
 *    3 fail, the near-miss case and two closed-set cases, because
 *    `Upload attestations` carries `test` as a substring and the set
 *    then loses `ci-other`.
 *  - the rule order reversed to test, types, lint, install: 1 fail, the
 *    case over the three steps that name two gates at once, which is
 *    the only reading in the file the order can change.
 *  - `readsAsConflicting` trusting a non-empty local file list over
 *    GitHub's `mergeable`: 2 fail, the case holding a stale local
 *    reading under a mergeable pull request and the precedence case,
 *    whose control half is that same shape.
 *  - `simple` computed as though every pull request were a dependency
 *    bump: 1 fail, the case holding a failing install apart by who
 *    opened the pull request.
 */
import type { CheckRow } from '../checks.js';
import type { TriageClass } from './classes.js';
import type { ClassifiedPullRequest, ClassifyTriageInput } from './classify.js';
import type { FailedStep } from './evidence.js';

import { describe, expect, it } from 'bun:test';

import { parseChecks } from '../checks.js';

import { isTriageClass, TRIAGE_CLASSES } from './classes.js';
import {
  CI_STEP_RULES,
  classifyConflictFiles,
  classifyFailedStep,
  classifyTriage,
  isLockfilePath,
  isManifestPath,
  LOCKFILE_FILES,
  MANIFEST_FILES,
  noChecksReason,
  readsAsConflicting,
  stepTokens,
} from './classify.js';

/** A check as `gh pr checks --json name,state,link` reports one. */
type CapturedCheck = readonly [name: string, state: string];

/**
 * Rows the way the rest of rafa reads them: captured-shape JSON through
 * `parseChecks`, so the outcome of a state is the shared mapping's.
 */
function rowsOf(...checks: readonly CapturedCheck[]): readonly CheckRow[] {
  const raw = checks.map(([name, state]) => ({
    name,
    state,
    link: `https://github.com/open-tomato/rafa/actions/runs/1#${name}`,
  }));
  return parseChecks(JSON.stringify(raw));
}

/** A green battery, a red one and a half-finished one. */
const GREEN_ROWS = rowsOf(['gates', 'SUCCESS'], ['snapshot', 'SKIPPED']);
const RED_ROWS = rowsOf(['gates', 'FAILURE'], ['snapshot', 'SUCCESS']);
const PENDING_ROWS = rowsOf(['gates', 'IN_PROGRESS'], ['snapshot', 'FAILURE']);

/** A pull request, mergeable and human-authored unless a case says otherwise. */
function pull(overrides: Partial<ClassifiedPullRequest> = {}): ClassifiedPullRequest {
  return {
    number: 86,
    title: 'Add the pr triage command',
    author: { login: 'marcos', isBot: false },
    mergeable: 'mergeable',
    mergeStateStatus: 'CLEAN',
    ...overrides,
  };
}

/** The same pull request as dependabot would have opened it. */
function bumpPull(): ClassifiedPullRequest {
  return pull({
    title: 'chore(deps): bump bun-types from 1.3.0 to 1.3.1',
    author: { login: 'dependabot[bot]', isBot: true },
  });
}

/** A failing step as `./evidence.ts` infers one from a group marker. */
function step(name: string): FailedStep {
  return { name, source: 'group-marker' };
}

/** One classifier input, defaulting to a green mergeable pull request. */
function input(overrides: Partial<ClassifyTriageInput> = {}): ClassifyTriageInput {
  return {
    pr: pull(),
    rows: GREEN_ROWS,
    step: undefined,
    conflictFiles: [],
    workflowCount: 0,
    ...overrides,
  };
}

/**
 * A conflicting pull request over `files`.
 *
 * Its rows and its step are the RED ones on purpose, not the empty
 * reading a freshly conflicted pull request usually has: a conflict
 * that arrives on a pull request CI has already redded is the case
 * where the precedence is load-bearing, and a conflict case built on no
 * checks at all would be classed the same way whatever the order of the
 * branches.
 */
function conflicting(files: readonly string[]): ClassifyTriageInput {
  return input({
    pr: pull({ mergeable: 'conflicting', mergeStateStatus: 'DIRTY' }),
    rows: RED_ROWS,
    step: step('bun test'),
    conflictFiles: files,
  });
}

/** A red pull request whose failing job died in `name`. */
function failedIn(name: string, pr: ClassifiedPullRequest = pull()): ClassifyTriageInput {
  return input({ pr, rows: RED_ROWS, step: step(name) });
}

/** The class one input is classified as. */
function classOf(one: ClassifyTriageInput): TriageClass {
  return classifyTriage(one).triageClass;
}

/**
 * One input per class, each labelled with the class it must produce.
 * The closed-set case reads this from both ends; see the module note.
 */
const EVERY_CLASS: readonly (readonly [TriageClass, ClassifyTriageInput])[] = [
  ['green', input()],
  ['pending', input({ rows: PENDING_ROWS })],
  ['no-checks', input({ rows: [] })],
  ['conflict-lockfile', conflicting(['bun.lock'])],
  ['conflict-manifest', conflicting(['package.json'])],
  ['conflict-other', conflicting(['src/config.ts'])],
  ['ci-install', failedIn('bun install --frozen-lockfile')],
  ['ci-lint', failedIn('bunx eslint .')],
  ['ci-types', failedIn('bunx tsc --noEmit')],
  ['ci-test', failedIn('bun test')],
  ['ci-other', failedIn('Upload attestations')],
];

describe('the class set', () => {
  it('provokes every class the module declares, and no class it does not', () => {
    const produced = EVERY_CLASS.map(([, one]) => classOf(one));

    expect([...new Set(produced)].sort()).toEqual([...TRIAGE_CLASSES].sort());
    expect(produced.every((one) => isTriageClass(one))).toBe(true);
  });

  it('reaches from each labelled input exactly the class it is labelled with', () => {
    for (const [expected, one] of EVERY_CLASS) expect(classOf(one)).toBe(expected);
  });

  it('gives every class a reason, and carries files and a step only where they decided it', () => {
    for (const [expected, one] of EVERY_CLASS) {
      const read = classifyTriage(one);

      const expectedFiles = expected.startsWith('conflict-')
        ? one.conflictFiles
        : [];

      expect(read.reason.length).toBeGreaterThan(0);
      expect(read.files).toEqual([...expectedFiles]);
      expect(read.step === undefined).toBe(!expected.startsWith('ci-'));
    }
  });
});

describe('the conflicting file list', () => {
  it('reads a lockfile by its basename, in a workspace as at the root', () => {
    expect(isLockfilePath('bun.lock')).toBe(true);
    expect(isLockfilePath('packages/cli/bun.lock')).toBe(true);
    expect(isLockfilePath('bun.lock.md')).toBe(false);
    expect(isLockfilePath('src/lockfile.ts')).toBe(false);
  });

  it('keeps the two file lists disjoint and frozen', () => {
    expect(Object.isFrozen(LOCKFILE_FILES)).toBe(true);
    expect(Object.isFrozen(MANIFEST_FILES)).toBe(true);
    expect(LOCKFILE_FILES.some((one) => MANIFEST_FILES.includes(one))).toBe(false);
    expect(MANIFEST_FILES.every((one) => isManifestPath(one))).toBe(true);
  });

  it('needs every path to be a lockfile, one ordinary file being enough to lose it', () => {
    expect(classifyConflictFiles(['bun.lock', 'packages/cli/bun.lock'])).toBe('conflict-lockfile');
    expect(classifyConflictFiles(['bun.lock', 'src/config.ts'])).toBe('conflict-other');
  });

  it('calls a manifest conflict the manifest one even when the lockfile conflicts too', () => {
    expect(classifyConflictFiles(['package.json'])).toBe('conflict-manifest');
    expect(classifyConflictFiles(['package.json', 'bun.lock'])).toBe('conflict-manifest');
    expect(classifyConflictFiles(['package.json', 'src/config.ts'])).toBe('conflict-other');
  });

  it('calls another ecosystem manifest other, since no pinned plan can read one', () => {
    expect(classifyConflictFiles(['Cargo.toml'])).toBe('conflict-other');
    expect(classifyConflictFiles(['Cargo.lock'])).toBe('conflict-lockfile');
  });

  it('calls a conflict whose paths could not be read other, and says so', () => {
    const read = classifyTriage(conflicting([]));

    expect(read.triageClass).toBe('conflict-other');
    expect(read.conflicting).toBe(true);
    expect(read.reason).toContain('no conflicting file was read');
  });

  it('names the first few paths in the reason and counts the rest', () => {
    const many = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'];

    expect(classifyTriage(conflicting(['bun.lock'])).reason).toContain('bun.lock');
    expect(classifyTriage(conflicting(many)).reason).toContain('a.ts, b.ts, c.ts and 2 more');
  });
});

describe('who decides that it conflicts', () => {
  it('takes GitHub at its word both ways, a stale local list never overriding a mergeable one', () => {
    expect(readsAsConflicting(pull({ mergeable: 'conflicting' }), [])).toBe(true);
    expect(readsAsConflicting(pull({ mergeable: 'mergeable' }), ['bun.lock'])).toBe(false);
  });

  it('breaks an unknown with the DIRTY merge state, then with the local list', () => {
    const unknown = pull({ mergeable: 'unknown', mergeStateStatus: 'UNKNOWN' });
    const dirty = pull({ mergeable: 'unknown', mergeStateStatus: 'DIRTY' });

    expect(readsAsConflicting(dirty, [])).toBe(true);
    expect(readsAsConflicting(unknown, ['bun.lock'])).toBe(true);
    expect(readsAsConflicting(unknown, [])).toBe(false);
  });

  it('classes a conflicting pull request on its conflict even when its checks are red', () => {
    const conflicted = input({
      pr: pull({ mergeable: 'conflicting', mergeStateStatus: 'DIRTY' }),
      rows: RED_ROWS,
      step: step('bun install --frozen-lockfile'),
      conflictFiles: ['bun.lock'],
    });
    const merged = input({
      pr: pull(),
      rows: RED_ROWS,
      step: step('bun install --frozen-lockfile'),
      conflictFiles: ['bun.lock'],
    });

    expect(classOf(conflicted)).toBe('conflict-lockfile');
    expect(classOf(merged)).toBe('ci-install');
  });
});

describe('the failing step', () => {
  it('holds every declared phrase in the form its own matcher compares', () => {
    for (const rule of CI_STEP_RULES) {
      expect(isTriageClass(rule.triageClass)).toBe(true);
      for (const phrase of rule.phrases) expect(stepTokens(phrase).join(' ')).toBe(phrase);
    }
  });

  it('declares a rule for each CI class but the catch-all, and none twice', () => {
    const declared = CI_STEP_RULES.map((rule) => rule.triageClass);

    expect(declared).toEqual(['ci-install', 'ci-lint', 'ci-types', 'ci-test']);
    expect(new Set(declared).size).toBe(declared.length);
  });

  it('reads a provider step label and an inferred command alike', () => {
    expect(classifyFailedStep('Install dependencies')).toBe('ci-install');
    expect(classifyFailedStep('bun install --frozen-lockfile')).toBe('ci-install');
    expect(classifyFailedStep('npm ci')).toBe('ci-install');
  });

  it('reads the lint, type and test tools by name', () => {
    expect(classifyFailedStep('bunx eslint .')).toBe('ci-lint');
    expect(classifyFailedStep('Lint')).toBe('ci-lint');
    expect(classifyFailedStep('bunx tsc --noEmit')).toBe('ci-types');
    expect(classifyFailedStep('bun run type-check')).toBe('ci-types');
    expect(classifyFailedStep('bun test')).toBe('ci-test');
    expect(classifyFailedStep('npx vitest run')).toBe('ci-test');
  });

  it('matches a whole token, so a step that merely contains one is not it', () => {
    expect(classifyFailedStep('Upload attestations')).toBe('ci-other');
    expect(classifyFailedStep('Use the latest runner image')).toBe('ci-other');
    expect(classifyFailedStep('vitest')).toBe('ci-test');
  });

  it('classes a step naming two gates as the earlier one, which is fixed first', () => {
    expect(classifyFailedStep('bun run test:types')).toBe('ci-types');
    expect(classifyFailedStep('bun run lint:types')).toBe('ci-lint');
    expect(classifyFailedStep('Install and test')).toBe('ci-install');
  });

  it('classes an unnamed step and a nameless one as the catch-all', () => {
    expect(classifyFailedStep(undefined)).toBe('ci-other');
    expect(classifyFailedStep('   ')).toBe('ci-other');
    expect(classifyFailedStep('Run the thing')).toBe('ci-other');
  });

  it('quotes the step in the reason, and says so when nothing named one', () => {
    const named = classifyTriage(failedIn('bunx tsc --noEmit'));
    const unnamed = classifyTriage(input({ rows: RED_ROWS, step: undefined }));

    expect(named.reason).toContain('"bunx tsc --noEmit"');
    expect(unnamed.triageClass).toBe('ci-other');
    expect(unnamed.reason).toContain('no failing step was named');
  });
});

describe('the non-red readings', () => {
  it('calls a mergeable pull request whose checks all passed green', () => {
    const read = classifyTriage(input());

    expect(read.triageClass).toBe('green');
    expect(read.verdict).toBe('green');
    expect(read.failing).toEqual([]);
    expect(classOf(input({ rows: RED_ROWS, step: step('bun test') }))).toBe('ci-test');
  });

  it('calls a pull request with no checks at all no-checks, never green, and never simple', () => {
    const read = classifyTriage(input({ rows: [] }));

    expect(read.triageClass).toBe('no-checks');
    expect(read.verdict).toBe('none');
    expect(read.failing).toEqual([]);
    expect(read.simple).toBe(false);
    expect(classifyTriage(input({ rows: [], pr: bumpPull() })).simple).toBe(false);
    expect(classOf(input())).toBe('green');
  });

  it('carries the workflow count and the --skip-checks line in the no-checks reason', () => {
    const none = classifyTriage(input({ rows: [], workflowCount: 0 })).reason;
    const one = classifyTriage(input({ rows: [], workflowCount: 1 })).reason;
    const unread = classifyTriage(input({ rows: [], workflowCount: null })).reason;

    expect(none).toBe('the head reports no checks at all; the repository defines 0 workflows;'
      + ' to merge it anyway, run rafa pr merge 86 --skip-checks');
    expect(one).toContain('; the repository defines 1 workflow;');
    expect(unread).toContain('; the repository\'s workflow count could not be read;');
    expect(unread).toContain('rafa pr merge 86 --skip-checks');
    expect(noChecksReason(7, 3)).toContain('defines 3 workflows; to merge it anyway, run rafa pr merge 7 --skip-checks');
  });

  it('reads the workflow count only on no checks, and keeps a conflict with none a conflict', () => {
    const green = classifyTriage(input({ workflowCount: null })).reason;
    const conflicted = classifyTriage(input({
      pr: pull({ mergeable: 'conflicting', mergeStateStatus: 'DIRTY' }),
      rows: [],
      conflictFiles: ['bun.lock'],
    }));

    expect(green).not.toContain('workflow');
    expect(green).not.toContain('--skip-checks');
    expect(conflicted.triageClass).toBe('conflict-lockfile');
    expect(conflicted.reason).not.toContain('--skip-checks');
  });

  it('calls a run still going pending even when another row has already failed', () => {
    const read = classifyTriage(input({ rows: PENDING_ROWS, step: step('bun test') }));

    expect(read.triageClass).toBe('pending');
    expect(read.reason).toBe('1 check of 2 still running');
    expect(read.failing.map((row) => row.name)).toEqual(['snapshot']);
    expect(classOf(input({ rows: RED_ROWS, step: step('bun test') }))).toBe('ci-test');
  });
});

describe('the simple flag', () => {
  it('holds a failing install apart by who opened the pull request', () => {
    const bump = classifyTriage(failedIn('bun install --frozen-lockfile', bumpPull()));
    const human = classifyTriage(failedIn('bun install --frozen-lockfile'));

    expect(bump.triageClass).toBe('ci-install');
    expect(human.triageClass).toBe('ci-install');
    expect(bump.dependencyBump).toBe(true);
    expect(human.dependencyBump).toBe(false);
    expect(bump.simple).toBe(true);
    expect(human.simple).toBe(false);
  });

  it('calls a lockfile conflict simple whoever opened it, and an other conflict never', () => {
    expect(classifyTriage(conflicting(['bun.lock'])).simple).toBe(true);
    expect(classifyTriage(conflicting(['package.json'])).simple).toBe(true);
    expect(classifyTriage(conflicting(['src/config.ts'])).simple).toBe(false);
  });

  it('never calls a non-failure simple, on a bump or off one', () => {
    for (const pr of [pull(), bumpPull()]) {
      expect(classifyTriage(input({ pr })).simple).toBe(false);
      expect(classifyTriage(input({ pr, rows: PENDING_ROWS })).simple).toBe(false);
      expect(classifyTriage(input({ pr, rows: [] })).simple).toBe(false);
      expect(classifyTriage(failedIn('bun test', pr)).simple).toBe(false);
    }
  });
});
