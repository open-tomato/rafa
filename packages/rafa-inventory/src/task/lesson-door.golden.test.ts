/**
 * A golden set for the lesson door: the `## Lessons from earlier tasks`
 * text a dispatched task is handed, read the way adebench reads a
 * memory's door (`adebench/sections.py`, `present()`), with no model and
 * no judge.
 *
 * Every case runs one task text through {@link selectLessons} and then
 * {@link renderLessonsSection}, over a held set built by pushing fixture
 * lessons through `merge` and blessing it with `bless`, the same path
 * the local adapter takes. The rendered text is then matched:
 *
 *   - `expected`: token groups that must all be present. A group is a
 *     list of alternatives, and any one of them satisfies it.
 *   - `forbidden`: token groups none of which may be present. A retired
 *     action next to the current one is worse than a miss, because the
 *     session has to guess between them.
 *
 * The cases fall in three kinds:
 *
 *   - **answerable**: the task text must bring in one known lesson.
 *   - **abstention**: the task text names invented files and subjects,
 *     and must be handed no lesson at all.
 *   - **update**: two actions for one trigger. Within `GAP` both are
 *     flagged and leave the blessed bundle, so rafa answers with a clean
 *     miss rather than a stale pair. The contrast case shows what
 *     happens past `GAP`.
 *
 * The door prints no date: `lessonLine` carries confidence, task count
 * and id, never `created_at`, so adebench's time section has nothing to
 * read here. That is recorded, not tested.
 *
 * Spike for the lesson-door golden set; the findings are in the commit
 * that adds this file.
 */
import type { TaskInput } from './resolve-skills.js';
import type { BlessedBundle, InstinctRecord, MergeResult } from '../learning/index.js';

import { describe, expect, it } from 'bun:test';

import { actionHash, bless, merge, triggerKey } from '../learning/index.js';

import { renderLessonsSection } from './sections.js';
import { selectLessons } from './select-lessons.js';

/** The blessing floor, `learning.bless.minConfidence`'s default. */
const MIN_CONFIDENCE = 0.5;

/** The time every fixture push is settled at. */
const NOW = '2026-10-30T00:00:00Z';

/** A letter or digit, the characters a token boundary is checked against. */
const ALNUM = /[\p{L}\p{N}]/u;

/**
 * The first alternative of `group` present in `text` as a whole token,
 * or null when none is. A port of adebench's `present()`: matching
 * ignores case, a boundary is enforced only on a side where the
 * alternative starts or ends with a letter or digit, and a trailing `*`
 * makes the alternative a prefix (`detach*` matches `detached`).
 */
function present(text: string, group: readonly string[]): string | null {
  for (const alternative of group) {
    const prefix = alternative.endsWith('*');
    const core = prefix
      ? alternative.slice(0, -1)
      : alternative;
    if (core === '') continue;

    let pattern = core.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (ALNUM.test(core[0]!)) pattern = `(?<![0-9A-Za-z])${pattern}`;
    if (ALNUM.test(core.at(-1)!) && !prefix) pattern = `${pattern}(?![0-9A-Za-z])`;
    if (new RegExp(pattern, 'iu').test(text)) return alternative;
  }
  return null;
}

/** The groups of `groups` that `text` does not satisfy. */
function missing(text: string, groups: readonly (readonly string[])[]): readonly (readonly string[])[] {
  return groups.filter((group) => present(text, group) === null);
}

/** The alternatives of `groups` that `text` carries. */
function delivered(text: string, groups: readonly (readonly string[])[]): readonly string[] {
  return groups
    .map((group) => present(text, group))
    .filter((found): found is string => found !== null);
}

/** One fixture lesson as a task report would push it. */
interface LessonSeed {
  readonly id: string;
  readonly trigger: string;
  readonly action: string;
  readonly confidence: number;
  readonly artifact?: string;
  readonly createdAt?: string;
}

function record(seed: LessonSeed): InstinctRecord {
  const created = seed.createdAt ?? '2026-09-01T00:00:00Z';
  return {
    id: seed.id,
    trigger: seed.trigger,
    action: seed.action,
    action_hash: actionHash(seed.action),
    confidence: seed.confidence,
    usage_count: 1,
    signal: 'loud',
    status: 'active',
    created_at: created,
    updated_at: created,
    ...(seed.artifact === undefined
      ? {}
      : { artifact: seed.artifact }),
  };
}

/** The held set after `result`: untouched records, then each touched trigger's produced. */
function heldAfter(held: readonly InstinctRecord[], result: MergeResult): InstinctRecord[] {
  const produced = new Map(result.decisions.map((decision) => [triggerKey(decision.incoming.trigger), decision.produced]));
  const untouched = held.filter((each) => !produced.has(triggerKey(each.trigger)));
  return [...untouched, ...[...produced.values()].flat()];
}

/** `held` after `sourceId` pushes `seeds`. */
function push(held: readonly InstinctRecord[], sourceId: string, seeds: readonly LessonSeed[]): InstinctRecord[] {
  return heldAfter(held, merge(held, { source_id: sourceId, instincts: seeds.map(record) }, NOW));
}

/** The eight lessons the answerable cases look for, one task each. */
const LESSONS: readonly LessonSeed[] = [
  {
    id: 'bun-test-hangs',
    trigger: 'when bun test never exits after the last test passes',
    action: 'Start the server with detached: true and stop its whole process group in teardown; the grandchild keeps the stdout pipe open.',
    confidence: 0.7,
    artifact: 'packages/rafa-run/src/suite/spawn-server.ts',
  },
  {
    id: 'config-field-stripped',
    trigger: 'when adding a field to a config interface',
    action: 'Add the same field to the runtime schema, or the validator strips it in production.',
    confidence: 0.65,
    artifact: 'packages/rafa/src/config-schema-checks.ts',
  },
  {
    id: 'wrapped-markdown',
    trigger: 'when editing hand-wrapped markdown in context pages',
    action: 'Rewrap the edited paragraph by hand under 80 columns; no formatter reflows prose.',
    confidence: 0.6,
  },
  {
    id: 'drizzle-custom',
    trigger: 'when writing a drizzle custom migration by hand',
    action: 'End the file with a statement, never a trailing comment, and check the table exists after applying it.',
    confidence: 0.55,
  },
  {
    id: 'git-add-batch',
    trigger: 'when git add reports no changes added to commit',
    action: 'Stage each path in its own git add call; one missing pathspec drops the whole batch.',
    confidence: 0.6,
  },
  {
    id: 'tsc-test-errors',
    trigger: 'when tsc reports type errors in a test file',
    action: 'Fix the shared fixture type the errors trace to, not the line tsc names.',
    confidence: 0.55,
  },
  {
    id: 'release-tag',
    trigger: 'when a release tag is ready to push',
    action: 'Print the tag command for the user to run; a session never pushes a release tag.',
    confidence: 0.7,
  },
  {
    id: 'killed-child-exit',
    trigger: 'when asserting the exit code of a killed child process',
    action: 'Expect 128 plus the signal number, 143 for SIGTERM, never the code the child chose.',
    confidence: 0.6,
  },
];

/** The update triggers: a retired action, then the current one. */
const PUBLISH_TRIGGER = 'when choosing the publish command';
const HUB_PORT_TRIGGER = 'when the hub port is taken';
const REFRESH_TRIGGER = 'when the board refresh times out';

/** The held set every case reads: the eight lessons, then three updates in two pushes. */
function heldSet(): InstinctRecord[] {
  const lessons = push([], 'session-lessons', LESSONS);
  const retired = push(lessons, 'session-old', [
    { id: 'publish-bun', trigger: PUBLISH_TRIGGER, action: 'Run bun publish from the package folder.', confidence: 0.6 },
    { id: 'hub-port-8010', trigger: HUB_PORT_TRIGGER, action: 'Start rafa-hub on port 8010.', confidence: 0.55 },
    { id: 'refresh-retry', trigger: REFRESH_TRIGGER, action: 'Retry the refresh once after 30 seconds.', confidence: 0.75 },
  ]);
  return push(retired, 'session-new', [
    { id: 'publish-npm', trigger: PUBLISH_TRIGGER, action: 'Run npm publish from the package folder.', confidence: 0.6, createdAt: '2026-10-01T00:00:00Z' },
    { id: 'hub-port-8766', trigger: HUB_PORT_TRIGGER, action: 'Start rafa-hub on port 8766.', confidence: 0.5, createdAt: '2026-10-01T00:00:00Z' },
    { id: 'refresh-backoff', trigger: REFRESH_TRIGGER, action: 'Wait for the board rate limit to reset before refreshing.', confidence: 0.5, createdAt: '2026-10-01T00:00:00Z' },
  ]);
}

const HELD = heldSet();
const BLESSED: BlessedBundle = bless(HELD, { minConfidence: MIN_CONFIDENCE });

/** The door: what `text` is handed as its lessons. */
function door(text: string): { readonly ids: readonly string[]; readonly rendered: string } {
  const task: TaskInput = { text, skills: [], stageContext: null };
  const lessons = selectLessons(task, BLESSED);
  return { ids: lessons.map((lesson) => lesson.id), rendered: renderLessonsSection(lessons) };
}

/** One answerable case. */
interface AnswerableCase {
  readonly task: string;
  readonly lesson: string;
  readonly expected: readonly (readonly string[])[];
}

const ANSWERABLE: readonly AnswerableCase[] = [
  {
    task: 'Fix the e2e suite: bun test never exits after `serve.test.ts` passes, because the server outlives teardown.',
    lesson: 'bun-test-hangs',
    expected: [['process group'], ['detach*']],
  },
  {
    task: 'Add `checks.publish` to the config interface and wire its reader in packages/rafa/src/config-schema-checks.ts.',
    lesson: 'config-field-stripped',
    expected: [['runtime schema'], ['strips']],
  },
  {
    task: 'Rewrite the merge section of context/effort-merge.md and keep its hand-wrapped lines.',
    lesson: 'wrapped-markdown',
    expected: [['rewrap*'], ['80']],
  },
  {
    task: 'Write the drizzle migration that adds the `claims` table as a custom migration.',
    lesson: 'drizzle-custom',
    expected: [['statement'], ['trailing comment']],
  },
  {
    task: 'Commit the moved fixtures; the last git add reported no changes added to commit.',
    lesson: 'git-add-batch',
    expected: [['each path'], ['pathspec']],
  },
  {
    task: 'Remove the test-file exclusion from tsconfig.json and clear the type errors tsc reports in the test files.',
    lesson: 'tsc-test-errors',
    expected: [['fixture type']],
  },
  {
    task: 'Cut release 0.49.0: fold the fragments and tag the release.',
    lesson: 'release-tag',
    expected: [['for the user', 'user to run'], ['never push*']],
  },
  {
    task: 'Test that `runWithTimeout` reports the exit code of a child killed by SIGTERM.',
    lesson: 'killed-child-exit',
    expected: [['128'], ['143']],
  },
];

const ABSTENTION: readonly string[] = [
  'Add `ballotQuorum` to packages/rafa-zeta/src/quorum/ballot.ts so a vote survives one lost peer, with its colocated tests.',
  'When the warp gauge reads a stale flux value, refresh the gauge cache in packages/rafa-warp/src/gauge/cache.ts.',
];

describe('present: the adebench matcher port', () => {
  it('matches a whole token only, and a path inside a longer path', () => {
    expect(present('listen on 18766', ['8766'])).toBeNull();
    expect(present('listen on 8766.', ['8766'])).toBe('8766');
    expect(present('version 10.2.4', ['0.2.4'])).toBeNull();
    expect(present('see lib/src/a.ts', ['src/a.ts'])).toBe('src/a.ts');
  });

  it('ignores case, reads a trailing star as a prefix, and returns the first alternative found', () => {
    expect(present('ANONIMIZZA', ['anonimizz*'])).toBe('anonimizz*');
    expect(present('anonimizza', ['anonimizz'])).toBeNull();
    expect(present('port 8766', ['8010', '8766'])).toBe('8766');
  });
});

describe('lesson door: answerable tasks bring in their lesson', () => {
  for (const { task, lesson, expected } of ANSWERABLE) {
    it(`${lesson}: ${task}`, () => {
      const { ids, rendered } = door(task);

      expect(ids).toContain(lesson);
      expect(missing(rendered, expected)).toEqual([]);
    });
  }
});

/**
 * Both abstention cases fail today, so they run as `it.failing` and turn
 * red the day they pass. `RANK_FLOOR` is 0, so one shared trigger word
 * keeps a lesson: `tests` (a prefix of `test`) and `add` hand the first
 * task three lessons, and `refresh` hands the second one. The change
 * they ask for is a floor of its own for `selectLessons`: at least two
 * question words matched in the trigger. Every expected lesson above
 * matches two or more. Drop `.failing` when that lands.
 */
describe('lesson door: abstention tasks are handed no lesson', () => {
  for (const task of ABSTENTION) {
    it.failing(task, () => {
      const { ids, rendered } = door(task);

      expect(ids).toEqual([]);
      expect(rendered).toBe('');
    });
  }
});

describe('lesson door: an update within GAP is a clean miss, never a stale pair', () => {
  it('two actions at one confidence are both flagged and neither is handed out', () => {
    const { rendered } = door('Publish the package once the release is tagged; choose the publish command.');
    const current = [['npm publish']];
    const retired = [['bun publish']];

    expect(HELD.filter((each) => each.trigger === PUBLISH_TRIGGER).map((each) => each.status))
      .toEqual(['flagged', 'flagged']);
    expect(delivered(rendered, current)).toEqual([]);
    expect(delivered(rendered, retired)).toEqual([]);
  });

  it('a newer action 0.05 below the held one flags both, so neither port is handed out', () => {
    const { rendered } = door('Start the hub; its port is taken by another process.');
    const current = [['8766']];
    const retired = [['8010']];

    expect(HELD.filter((each) => each.trigger === HUB_PORT_TRIGGER).map((each) => each.status))
      .toEqual(['flagged', 'flagged']);
    expect(delivered(rendered, current)).toEqual([]);
    expect(delivered(rendered, retired)).toEqual([]);
  });
});

describe('lesson door: no task is handed a retired action next to the current one', () => {
  const pairs = [
    { current: [['npm publish']], retired: [['bun publish']] },
    { current: [['8766']], retired: [['8010']] },
    { current: [['rate limit']], retired: [['30 seconds']] },
  ];
  const tasks = [
    ...ANSWERABLE.map((each) => each.task),
    ...ABSTENTION,
    'Publish the package once the release is tagged; choose the publish command.',
    'Start the hub; its port is taken by another process.',
    'Make the board refresh survive when it times out.',
  ];

  for (const task of tasks) {
    it(task, () => {
      const { rendered } = door(task);
      const both = ({ current, retired }: (typeof pairs)[number]): boolean => delivered(rendered, current).length > 0
        && delivered(rendered, retired).length > 0;
      const stale = pairs.filter(both);

      expect(stale).toEqual([]);
    });
  }
});

describe('lesson door: an update past GAP keeps the held action', () => {
  it('a newer action more than GAP below the held one is discarded, and the retired one is still handed out', () => {
    const { rendered } = door('Make the board refresh survive when it times out.');

    expect(present(rendered, ['30 seconds'])).toBe('30 seconds');
    expect(present(rendered, ['rate limit'])).toBeNull();
  });
});
