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
 * the release's step 2 (`.rafa/specs/rafa-367-releases-settle-base-branch.md`):
 * the session rewrites the notes inside the plan's fragment. They
 * are the only bullets whose text depends on an argument, so each case
 * builds a step-1 record and reads what the prompt made of it. The
 * prepared and the skipped record are each other's control: what one
 * asserts present, the other asserts absent, which is what keeps a
 * `toContain` from passing on a prompt that emits every bullet
 * unconditionally.
 *
 * A group of its own covers the base the create bullet names: the
 * run's base as `runWrapUp` resolves it, read here through the same
 * `resolveBaseBranch` under `pr.base: integration` over a repository
 * whose `origin/HEAD` names `main`, so a prompt that named the default
 * branch instead would read `main` and fail. The already-open bullet is
 * pinned byte for byte, since it names no base at all.
 *
 * The third group covers the `## Lessons to promote` section that
 * replaced the three promotion bullets, and the fourth
 * `lessonsToPromote`, which reads the list off a stub adapter at the
 * `learning.promote.*` keys. The section's presence and its absence
 * are each other's control in the same way, and every threshold case
 * is paired with one where the same lesson moves across the line.
 *
 * One more group covers the section listing the test files the run's
 * suite steps read red only in the step (`start/step-only-report.ts`):
 * present with such a file, absent, heading and all, with none.
 */
import type { WrapUpLearning } from './wrap-up.js';
import type { AdapterContext } from '../adapters/registry.js';
import type { InstinctRecord } from '../learning/index.js';
import type { Learning } from '../ports/index.js';
import type { GitRunner } from '../pr/index.js';
import type { ReleasePrepared, ReleaseSkipped } from '../release/prepare.js';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { createAdapterRegistry, PORT_VERSIONS } from '../adapters/registry.js';
import { resolveBaseBranch } from '../cleanup/index.js';
import { classifyPromptContent } from '../effort/classify.js';
import { actionHash } from '../learning/index.js';
import { serializeFragment } from '../release/fragment.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { parsePromoted } from './promoted.js';
import { runStepOnlyOf, STEP_ONLY_HEADING, stepOnlySection } from './step-only-report.js';
import { buildWrapUpPrompt, lessonsToPromote } from './wrap-up.js';

/** The branch a case builds its prompt on. */
const BRANCH = 'feat/rafa-20-pr-commands';

/** A plan body standing in for the `full` rendering appended below. */
const PLAN = '# Plan: pull-request commands\n\n- [ ] A task\n';

/** A repository whose `origin/HEAD` names `main`, and the git calls made of it. */
function originHeadMain(): { readonly git: GitRunner; readonly calls: string[] } {
  const calls: string[] = [];
  const git: GitRunner = (args) => {
    calls.push(args.join(' '));
    return { ok: true, stdout: 'origin/main\n', stderr: '' };
  };
  return { git, calls };
}

/** The run's base under `pr.base: integration`, as `runWrapUp` resolves it. */
const BASE = resolveBaseBranch(originHeadMain().git, 'integration');

/** The open pull request a case reads the already-open bullet for. */
const OPEN_PULL = 601;

describe('the wrap-up prompt\'s pull-request base', () => {
  test('resolves `pr.base: integration` to `integration` over an origin/HEAD naming main', () => {
    const configured = originHeadMain();
    const unset = originHeadMain();

    expect(resolveBaseBranch(configured.git, 'integration')).toBe('integration');
    expect(configured.calls).toEqual([]);

    // The control: with no `pr.base` the same repository answers `main`,
    // so a prompt that read the default branch would name `main` below.
    expect(resolveBaseBranch(unset.git, null)).toBe('main');
    expect(unset.calls).toHaveLength(1);
  });

  test('writes the create bullet as `gh pr create --base integration`', () => {
    const prompt = buildWrapUpPrompt(BRANCH, BASE, PLAN, null);

    expect(prompt).toContain(`* No open PR was found for ${BRANCH}: open one with \`gh pr create --base integration\`.`);
    expect(prompt).not.toContain('`gh pr create`');
    expect(prompt).not.toContain('--base main');

    // The control: the base is read off the argument, not a constant.
    expect(buildWrapUpPrompt(BRANCH, 'main', PLAN, null)).toContain('`gh pr create --base main`');
    expect(buildWrapUpPrompt(BRANCH, 'main', PLAN, null)).not.toContain('--base integration');
  });

  test('leaves an already-open pull request\'s bullet unchanged, naming no base', () => {
    const prompt = buildWrapUpPrompt(BRANCH, BASE, PLAN, OPEN_PULL);

    expect(prompt).toContain(`* PR #${String(OPEN_PULL)} is already open for ${BRANCH}, likely opened by the plan's close-out: push to it and update its body with \`gh pr edit ${String(OPEN_PULL)}\` so the description covers the promotions this session committed.`);
    expect(prompt).not.toContain('--base');
    expect(prompt).not.toContain('gh pr create');

    // The control: the same base with no open pull request does name it,
    // so the absence above is the open bullet's.
    expect(buildWrapUpPrompt(BRANCH, BASE, PLAN, null)).toContain('--base integration');
  });
});

describe('the wrap-up prompt\'s sync and lockfile bullets', () => {
  test('syncs with `origin/integration` under `pr.base: integration`', () => {
    const prompt = buildWrapUpPrompt(BRANCH, BASE, PLAN, null);

    expect(prompt).toContain('* BEFORE pushing, bring the branch up to date with the base: `git fetch origin integration` then `git merge origin/integration`. A branch that conflicts with integration gets NO CI run at all');
    expect(prompt).not.toContain('git fetch origin main');
    expect(prompt).not.toContain('git merge origin/main');

    // The control: the same bullet under a `main` base names `main`, so
    // the base is read off the argument rather than written in.
    const onMain = buildWrapUpPrompt(BRANCH, 'main', PLAN, null);
    expect(onMain).toContain('`git fetch origin main` then `git merge origin/main`. A branch that conflicts with main gets');
    expect(onMain).not.toContain('origin/integration');
  });

  test('restores the lockfile from `origin/integration` under `pr.base: integration`', () => {
    const prompt = buildWrapUpPrompt(BRANCH, BASE, PLAN, null);

    expect(prompt).toContain('restore the base\'s copy (`git checkout origin/integration -- bun.lock`)');
    expect(prompt).not.toContain('git checkout origin/main');

    // The control: a `main` base restores from `origin/main`.
    expect(buildWrapUpPrompt(BRANCH, 'main', PLAN, null)).toContain('`git checkout origin/main -- bun.lock`');
  });

  test('names no `origin/main` anywhere under `pr.base: integration`', () => {
    const prompt = buildWrapUpPrompt(BRANCH, BASE, PLAN, OPEN_PULL);

    expect(prompt).not.toContain('origin/main');
    expect(prompt).not.toContain('origin main');

    // The control: the same call under a `main` base does name it, so the
    // absence above is the base's and the check could have failed.
    expect(buildWrapUpPrompt(BRANCH, 'main', PLAN, OPEN_PULL)).toContain('origin/main');
  });
});

describe('the wrap-up prompt\'s pull-request naming', () => {
  test('spells the title `rafa-<n>: <title>` and closes the issue from the body', () => {
    const prompt = buildWrapUpPrompt(BRANCH, BASE, PLAN, null);

    expect(prompt).toContain('Title the PR `rafa-<n>: <title>`');
    expect(prompt).toContain('`Closes #<n>`');

    // The control: the superseded spelling is gone, so the assertions
    // above could not have passed on the old bullet.
    expect(prompt).not.toContain('Implement user authentication (#42)');
    expect(prompt).not.toContain('feat/42-slug');
  });

  test('names both places the number is read from, the plan then the branch', () => {
    const prompt = buildWrapUpPrompt(BRANCH, BASE, PLAN, null);
    const fromPlan = prompt.indexOf('`issue: <n>`');
    const fromBranch = prompt.indexOf(`the branch name (${BRANCH})`);

    expect(fromPlan).toBeGreaterThan(-1);
    expect(fromBranch).toBeGreaterThan(fromPlan);
  });

  test('keeps every naming bullet below the classifier key', () => {
    const prompt = buildWrapUpPrompt(BRANCH, BASE, PLAN, null);
    const [firstLine] = prompt.split('\n');

    expect(firstLine).toBe('* Read `@progress.txt` in full.');
    expect(classifyPromptContent(prompt)).toBe('wrap-up');
    expect(prompt.indexOf('rafa-<n>: <title>')).toBeGreaterThan(firstLine.length);
  });
});

/** The plan id every release case below writes its fragment for. */
const PLAN_ID = 'rafa-367';

/** The fragment path step 1 wrote, as every release case below reads it. */
const FRAGMENT_PATH = '.changes/rafa-367.md';

/** The raw note lines step 1 wrote below the front matter. */
const NOTES = [
  '- release: the wrap-up writes a change fragment',
  '- loop: the wrap-up leaves the version file alone',
] as const;

/**
 * A step-1 record shaped as `release/prepare.ts` answers one, its file
 * text a real serialization of the fragment so the record is one that
 * module could have written.
 *
 * `level` is how the `none` case changes the fragment, which is the one
 * reading that changes the wording.
 */
function preparedRelease(level: ReleasePrepared['level'] = 'minor'): ReleasePrepared {
  const fragment = { plan: PLAN_ID, title: 'Releases settle on the base branch', level, notes: [...NOTES] };
  return {
    kind: 'prepared',
    level,
    levelSource: 'plan',
    notesLevel: 'minor',
    plan: PLAN_ID,
    fragment,
    file: {
      path: FRAGMENT_PATH,
      resolved: `/repo/${FRAGMENT_PATH}`,
      before: null,
      after: serializeFragment(fragment),
    },
    base: { ref: 'origin/main', commit: 'a'.repeat(40), waiting: [] },
    fetched: true,
    problems: [],
  };
}

/** A step-1 record that wrote nothing, worded as `disabled` words it. */
function skippedRelease(): ReleaseSkipped {
  return {
    kind: 'skipped',
    reason: 'disabled',
    sentence: 'no release fragment: release.enabled is false in this project',
    level: 'minor',
    levelSource: 'plan',
    notesLevel: null,
    problems: [],
  };
}

describe('the wrap-up prompt\'s release bullets', () => {
  test('keeps the classifier key first-line whatever the release preparation holds', () => {
    const prepared = buildWrapUpPrompt(BRANCH, BASE, PLAN, null, preparedRelease());
    const skipped = buildWrapUpPrompt(BRANCH, BASE, PLAN, null, skippedRelease());

    for (const prompt of [prepared, skipped]) {
      const [firstLine] = prompt.split('\n');

      expect(firstLine).toBe('* Read `@progress.txt` in full.');
      expect(classifyPromptContent(prompt)).toBe('wrap-up');
    }
  });

  test('asks for the rewrite inside the fragment and nowhere else', () => {
    const prompt = buildWrapUpPrompt(BRANCH, BASE, PLAN, null, preparedRelease());

    expect(prompt).toContain(`release fragment: \`${FRAGMENT_PATH}\`, for plan \`${PLAN_ID}\` at level \`minor\``);
    expect(prompt).toContain('Rewrite the raw `- <area>: <summary>` lines below its front matter into one line per area');
    expect(prompt).toContain('not the `plan:`, `title:` or `level:` lines');
    expect(prompt).toContain('not the file\'s trailing newline');
    expect(prompt).toContain(`still names plan \`${PLAN_ID}\` and still carries level \`minor\``);

    // The control: with no preparation the prompt says none of it, so
    // the assertions above read the bullets and not the rest of the
    // list.
    const bare = buildWrapUpPrompt(BRANCH, BASE, PLAN, null);
    expect(bare).not.toContain(FRAGMENT_PATH);
    expect(bare).not.toContain('Rewrite the raw');
  });

  test('no longer asks for a rewrite under a changelog heading', () => {
    const prompt = buildWrapUpPrompt(BRANCH, BASE, PLAN, null, preparedRelease());

    expect(prompt).not.toContain('under THAT heading');
    expect(prompt).not.toContain('now carries a new section headed');
    expect(prompt).not.toContain('now declares');
    expect(prompt).not.toContain('Carry the entry into the pull request body: the heading');
  });

  test('leaves the fragment unstaged for the loop\'s own fragment commit', () => {
    const prompt = buildWrapUpPrompt(BRANCH, BASE, PLAN, null, preparedRelease());

    expect(prompt).toContain(`Leave \`${FRAGMENT_PATH}\` UNSTAGED and UNCOMMITTED`);
    expect(prompt).toContain('do not sweep it up with `git add -A`');
    expect(prompt).toContain(`\`chore: release fragment ${PLAN_ID}\` commit holding that file and nothing else`);
  });

  test('keeps the session off the version file, the changelog and the other fragments', () => {
    const prompt = buildWrapUpPrompt(BRANCH, BASE, PLAN, null, preparedRelease());

    expect(prompt).toContain('Do not edit the version file, the changelog, or any other file under `.changes/` either');
  });

  test('carries the fragment into the pull request body with no version number', () => {
    const prompt = buildWrapUpPrompt(BRANCH, BASE, PLAN, null, preparedRelease());

    expect(prompt).toContain('Carry the fragment into the pull request body: its level, `minor`');
    expect(prompt).toContain('as a section of the description');
    expect(prompt).toContain('Name no version number');
  });

  test('asks for the same rewrite over a none fragment, naming its level', () => {
    const prompt = buildWrapUpPrompt(BRANCH, BASE, PLAN, null, preparedRelease('none'));

    expect(prompt).toContain(`for plan \`${PLAN_ID}\` at level \`none\``);
    expect(prompt).toContain('its level, `none`');
    expect(prompt).not.toContain('ships NO release fragment');

    // The control: the minor record's prompt names its own level, so
    // the level above is read off the record and not a constant.
    expect(buildWrapUpPrompt(BRANCH, BASE, PLAN, null, preparedRelease())).not.toContain('at level `none`');
  });

  test('writes the skip sentence verbatim instead of the three bullets', () => {
    const skipped = skippedRelease();
    const prompt = buildWrapUpPrompt(BRANCH, BASE, PLAN, null, skipped);

    expect(prompt).toContain(`This pull request ships NO release fragment: ${skipped.sentence}.`);
    expect(prompt).toContain('do not write a fragment, an entry or a version by hand');

    // The control: the prepared bullets are the ones NOT emitted here,
    // and a prompt built from the prepared record carries them.
    expect(prompt).not.toContain('UNSTAGED and UNCOMMITTED');
    expect(prompt).not.toContain('Rewrite the raw');
    expect(buildWrapUpPrompt(BRANCH, BASE, PLAN, null, preparedRelease())).toContain('UNSTAGED and UNCOMMITTED');
  });
});

/** A lesson as the library holds it, confirmed by `sources` at `confidence`. */
function lesson(id: string, sources: number, confidence: number, extra: Partial<InstinctRecord> = {}): InstinctRecord {
  const action = extra.action ?? `run the gate named by ${id}`;
  const confirmed = Array.from({ length: sources }, (_, index) => `session-${String(index + 1)}`);
  return {
    id,
    trigger: `when ${id} comes up`,
    action,
    action_hash: actionHash(action),
    confidence,
    usage_count: confirmed.length,
    sources: confirmed,
    signal: 'loud',
    status: 'active',
    created_at: '2026-09-20T00:00:00.000Z',
    updated_at: '2026-09-20T00:00:00.000Z',
    ...extra,
  };
}

/** The section's heading, as the prompt writes it. */
const SECTION = '## Lessons to promote';

/** The three bullets the section replaced, each by a phrase only it held. */
const REMOVED_BULLETS: readonly string[] = [
  'If there\'s anything worth keeping',
  'Promote a finding ONLY when all three hold',
  'learn/learn-eval skill',
];

describe('the wrap-up prompt\'s lessons to promote', () => {
  test('writes no section, heading or block when no lesson is promotable', () => {
    for (const prompt of [buildWrapUpPrompt(BRANCH, BASE, PLAN, null), buildWrapUpPrompt(BRANCH, BASE, PLAN, null, null, [])]) {
      expect(prompt).not.toContain(SECTION);
      expect(prompt).not.toContain('rafa:promoted');
    }

    // The control: one lesson brings both in, so the absence above is
    // the empty list's and not a prompt that never writes them.
    const listed = buildWrapUpPrompt(BRANCH, BASE, PLAN, null, null, [lesson('a-lesson-1a2b3c4d', 3, 0.7)]);
    expect(listed).toContain(SECTION);
    expect(listed).toContain('```rafa:promoted');
  });

  test('drops the three promotion bullets whatever the list holds', () => {
    const bare = buildWrapUpPrompt(BRANCH, BASE, PLAN, null);
    const listed = buildWrapUpPrompt(BRANCH, BASE, PLAN, null, null, [lesson('a-lesson-1a2b3c4d', 3, 0.7)]);

    for (const phrase of REMOVED_BULLETS) {
      expect(bare).not.toContain(phrase);
      expect(listed).not.toContain(phrase);
    }
  });

  test('lists each lesson by id, trigger, action and artifact, in the order given', () => {
    const first = lesson('bun-test-worktree-1a2b3c4d', 3, 0.8, { artifact: 'Cannot find package' });
    const second = lesson('lint-type-imports-5e6f7a8b', 4, 0.7);
    const prompt = buildWrapUpPrompt(BRANCH, BASE, PLAN, null, null, [first, second]);

    expect(prompt).toContain([
      '- `bun-test-worktree-1a2b3c4d`',
      '  - trigger: when bun-test-worktree-1a2b3c4d comes up',
      '  - action: run the gate named by bun-test-worktree-1a2b3c4d',
      '  - artifact: Cannot find package',
      '- `lint-type-imports-5e6f7a8b`',
      '  - trigger: when lint-type-imports-5e6f7a8b comes up',
      '  - action: run the gate named by lint-type-imports-5e6f7a8b',
      '  - artifact: none',
    ].join('\n'));
  });

  test('writes a multi-line action as one line of the list', () => {
    const prompt = buildWrapUpPrompt(BRANCH, BASE, PLAN, null, null, [
      lesson('multi-line-9c8d7e6f', 3, 0.7, { action: '  run bun install\n\n  before   the first test  ' }),
    ]);

    expect(prompt).toContain('  - action: run bun install before the first test\n');
    expect(prompt).not.toContain('run bun install\n');
  });

  test('keeps the classifier key first and the section between the bullets and the plan', () => {
    const prompt = buildWrapUpPrompt(BRANCH, BASE, PLAN, null, null, [lesson('a-lesson-1a2b3c4d', 3, 0.7)]);
    const [firstLine] = prompt.split('\n');
    const section = prompt.indexOf(SECTION);

    expect(firstLine).toBe('* Read `@progress.txt` in full.');
    expect(classifyPromptContent(prompt)).toBe('wrap-up');
    expect(section).toBeGreaterThan(prompt.indexOf('* Do not include Claude attribution'));
    expect(section).toBeLessThan(prompt.indexOf('The plan this run executed follows'));
    expect(prompt.endsWith(`\n${PLAN}`)).toBe(true);
  });

  test('asks for a block whose two line shapes the parser reads', () => {
    const prompt = buildWrapUpPrompt(BRANCH, BASE, PLAN, null, null, [lesson('a-lesson-1a2b3c4d', 3, 0.7)]);
    const opening = prompt.indexOf('```rafa:promoted\n');
    const body = prompt.slice(opening, prompt.indexOf('\n```', opening)).split('\n')
      .slice(1);

    // Each shape is read as its own block: the template spells both
    // with the one placeholder id, which a single block answers once.
    const kinds = body.map((line) => {
      const reading = parsePromoted(`\`\`\`rafa:promoted\n${line}\n\`\`\`\n`);
      expect(reading.unreadable).toEqual([]);
      return reading.answers.map((answer) => answer.kind);
    });
    expect(kinds).toEqual([['promoted'], ['skipped']]);
  });
});

describe('the wrap-up prompt\'s files red only in a suite step', () => {
  const items = runStepOnlyOf([{
    kind: 'task',
    scope: 'affected',
    command: ['bun', 'test'],
    exitCode: 1,
    summary: 'Ran 3 tests across 2 files. [1.00ms]',
    failures: [{ file: 'src/utils/claude.test.ts', name: 'claude > first' }],
    newFailures: [],
    stepOnly: [{ file: 'src/utils/claude.test.ts', tests: ['claude > first'], errorLines: ['UndeclaredSpendError: declared none'], position: 2, before: ['src/a.test.ts'] }],
  }]);

  test('writes no section and no heading when the run holds none', () => {
    for (const prompt of [buildWrapUpPrompt(BRANCH, BASE, PLAN, null), buildWrapUpPrompt(BRANCH, BASE, PLAN, null, null, [], [])]) {
      expect(prompt).not.toContain(STEP_ONLY_HEADING);
      expect(prompt).not.toContain('green when run alone');
    }

    // The control: one such file brings the section in, so the absence
    // above is the empty list's.
    expect(buildWrapUpPrompt(BRANCH, BASE, PLAN, null, null, [], items)).toContain(`## ${STEP_ONLY_HEADING}`);
  });

  test('lists each file as the run\'s end prints it, and asks for the list in the pull request body under a heading', () => {
    const prompt = buildWrapUpPrompt(BRANCH, BASE, PLAN, null, null, [], items);

    expect(prompt).toContain(stepOnlySection(items).join('\n'));
    expect(prompt).toContain('- `src/utils/claude.test.ts`: 1 test (`claude > first`) red in 1 step (task) and green when run alone; first error: "UndeclaredSpendError: declared none"; run after src/a.test.ts.');
    expect(prompt).toContain(`under the heading \`### ${STEP_ONLY_HEADING}\``);
  });

  test('keeps the classifier key first, the section below the bullets and above the lessons and the plan', () => {
    const prompt = buildWrapUpPrompt(BRANCH, BASE, PLAN, null, null, [lesson('a-lesson-1a2b3c4d', 3, 0.7)], items);
    const section = prompt.indexOf(`## ${STEP_ONLY_HEADING}`);

    expect(prompt.split('\n')[0]).toBe('* Read `@progress.txt` in full.');
    expect(classifyPromptContent(prompt)).toBe('wrap-up');
    expect(section).toBeGreaterThan(prompt.indexOf('* Do not include Claude attribution'));
    expect(section).toBeLessThan(prompt.indexOf(SECTION));
    expect(section).toBeLessThan(prompt.indexOf('The plan this run executed follows'));
    expect(prompt.endsWith(`\n${PLAN}`)).toBe(true);
  });
});

describe('lessonsToPromote', () => {
  /** The contexts the stub adapter was made with. */
  let made: AdapterContext[] = [];

  /** What the stub's pull answers, or rejects with. */
  let pulled: readonly InstinctRecord[] | Error = [];

  /** Lines the reader warned about. */
  let warnings: string[] = [];

  beforeEach(() => {
    made = [];
    pulled = [];
    warnings = [];
    setActiveOutput(sinkOutput({
      warn: (message) => {
        warnings.push(message);
      },
    }));
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  /** A learning adapter whose pull answers {@link pulled}. */
  const stub: Learning = {
    push: () => Promise.reject(new Error('the wrap-up pushes nothing')),
    pullBlessed: () => pulled instanceof Error
      ? Promise.reject(pulled)
      : Promise.resolve({ version: 'stub', instincts: [...pulled] }),
    flag: () => Promise.reject(new Error('the wrap-up flags nothing')),
  };

  const registry = createAdapterRegistry([{
    port: 'learning',
    kind: 'stub',
    portVersion: PORT_VERSIONS.learning,
    create: (context) => {
      made.push(context);
      return stub;
    },
  }]);

  /** The run's learning settings at the default promote keys, over the stub. */
  function learningOf(overrides: Partial<WrapUpLearning> = {}): WrapUpLearning {
    return {
      kind: 'stub',
      home: '/home/stand-in',
      blessMinConfidence: 0.5,
      registry,
      repoRoot: '/repo/stand-in',
      promoteAfter: 3,
      promoteMinConfidence: 0.7,
      ...overrides,
    };
  }

  test('lists a lesson held by three sources at 0.7, and not one short of either key', async () => {
    pulled = [lesson('held-by-three', 3, 0.7), lesson('held-by-two', 2, 0.9), lesson('below-the-floor', 5, 0.6)];

    const lessons = await lessonsToPromote(learningOf());

    expect(lessons.map((each) => each.id)).toEqual(['held-by-three']);

    // The control: at `after: 2` and `minConfidence: 0.6` the same pull
    // lists all three, so each was left out by its key above.
    const wider = await lessonsToPromote(learningOf({ promoteAfter: 2, promoteMinConfidence: 0.6 }));
    expect(wider.map((each) => each.id).sort()).toEqual(['below-the-floor', 'held-by-three', 'held-by-two']);
  });

  test('makes the adapter at the run\'s root, home and bless floor', async () => {
    await lessonsToPromote(learningOf());

    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ repoRoot: '/repo/stand-in', home: '/home/stand-in', learningBlessMinConfidence: 0.5 });
  });

  test('lists nothing and makes no adapter when the run names no learning', async () => {
    expect(await lessonsToPromote(null)).toEqual([]);
    expect(made).toEqual([]);
  });

  test('lists nothing and warns once when the pull is refused', async () => {
    pulled = new Error('flags.ndjson line 2 is not a flag');

    expect(await lessonsToPromote(learningOf())).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('flags.ndjson line 2 is not a flag');
  });

  test('lists nothing and warns once when no adapter has the kind', async () => {
    expect(await lessonsToPromote(learningOf({ kind: 'absent' }))).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('`absent` learning adapter');
  });
});
