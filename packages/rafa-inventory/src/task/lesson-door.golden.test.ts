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
 *   - `canary`: token groups that must be present next to every
 *     forbidden one. See "Guards".
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
 * ## Guards
 *
 * A check must not pass for the wrong reason, so four guards stand
 * around it:
 *
 *   - **The empty-ledger control.** Every check's presence groups are
 *     matched again against the task text, the section heading and what
 *     an empty bundle renders. A check that passes there gets the fifth
 *     state, `VACUOUS`: its words came from the context and not from a
 *     lesson. The states are adebench's `PASS`, `FAIL` and `ERROR`, and
 *     `VACUOUS`; adebench's `SKIP` has no use here, since every case
 *     carries evidence. Only `PASS` is green.
 *   - **A canary next to every absence.** "The retired value is not
 *     delivered" passes as well when nothing is delivered at all, so
 *     every check with a `forbidden` group also names a word that must
 *     be delivered in the same section: the successor's, the action that
 *     won the trigger, or, where nothing wins (a flagged pair renders
 *     nothing), the anchor lesson's. The anchor is unrelated to every
 *     trigger, and its artifact path is named in the task text, so the
 *     path reading always selects it.
 *   - **A lint at fixture load.** No expected or canary alternative may
 *     already be present, by {@link present}, in its task text or in the
 *     section heading, and no absence check may lack a canary. A problem
 *     throws as the file loads, so no case runs on a broken fixture.
 *   - **Failure output.** A check that is not `PASS` fails with its state,
 *     its notes, the exact delivered section and its groups, so the
 *     reading needs no second run.
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

import { LESSONS_HEADING, renderLessonsSection } from './sections.js';
import { selectLessons } from './select-lessons.js';

/** The blessing floor, `learning.bless.minConfidence`'s default. */
const MIN_CONFIDENCE = 0.5;

/** The time every fixture push is settled at. */
const NOW = '2026-10-30T00:00:00Z';

/** A letter or digit, the characters a token boundary is checked against. */
const ALNUM = /[\p{L}\p{N}]/u;

/** Token groups: every group must match, by any one of its alternatives. */
type Groups = readonly (readonly string[])[];

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
function missing(text: string, groups: Groups): Groups {
  return groups.filter((group) => present(text, group) === null);
}

/** The alternatives of `groups` that `text` carries. */
function delivered(text: string, groups: Groups): readonly string[] {
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

/** The anchor's artifact path: a task that names it is always handed the anchor. */
const ANCHOR_PATH = 'src/anchor/marker.ts';

/** The anchor lesson's canary word, in its action only. */
const ANCHOR_CANARY: Groups = [['KESTREL']];

/** The anchor lesson: unrelated to every trigger, kept by its artifact path. See "Guards". */
const ANCHOR: LessonSeed = {
  id: 'anchor-marker',
  trigger: 'when the kestrel marker is moved',
  action: 'Leave the KESTREL marker where the loader reads it.',
  confidence: 0.6,
  artifact: ANCHOR_PATH,
};

/** The update triggers: a retired action, then the current one. */
const PUBLISH_TRIGGER = 'when choosing the publish command';
const HUB_PORT_TRIGGER = 'when the hub port is taken';
const REFRESH_TRIGGER = 'when the board refresh times out';

/** The held set every case reads: the eight lessons and the anchor, then three updates in two pushes. */
function heldSet(): InstinctRecord[] {
  const lessons = push([], 'session-lessons', [...LESSONS, ANCHOR]);
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

/** A bundle with no lesson: the empty-ledger control's selection. */
const EMPTY: BlessedBundle = { version: 'empty', instincts: [] };

/** What one task is handed. */
interface Handed {
  readonly ids: readonly string[];
  readonly rendered: string;
}

/** The door: what `text` is handed as its lessons from `bundle`. */
function door(text: string, bundle: BlessedBundle = BLESSED): Handed {
  const task: TaskInput = { text, skills: [], stageContext: null };
  const lessons = selectLessons(task, bundle);
  return { ids: lessons.map((lesson) => lesson.id), rendered: renderLessonsSection(lessons) };
}

/** One check over the door. See the module note. */
interface DoorCheck {
  readonly name: string;
  readonly task: string;
  /** The lesson the task must be handed, when the check names one. */
  readonly lesson?: string;
  readonly expected: Groups;
  readonly forbidden: Groups;
  readonly canary: Groups;
  /** The bundle the task reads, {@link BLESSED} when left out. */
  readonly bundle?: BlessedBundle;
}

/** adebench's `PASS`, `FAIL` and `ERROR`, and `VACUOUS`. See "Guards". */
type CheckState = 'PASS' | 'FAIL' | 'ERROR' | 'VACUOUS';

/** What one check read. */
interface CheckResult {
  readonly check: DoorCheck;
  readonly state: CheckState;
  /** The delivered lessons section, empty when nothing was handed. */
  readonly section: string;
  readonly notes: readonly string[];
}

/** The context a check's words could come from with no lesson handed. */
function controlText(task: string): string {
  return [task, LESSONS_HEADING, door(task, EMPTY).rendered].join('\n');
}

/** The groups of `check` that must be present: its expected and canary groups. */
function presenceGroups(check: DoorCheck): Groups {
  return [...check.expected, ...check.canary];
}

/** Reads `check` over the door and the empty-ledger control. */
function runCheck(check: DoorCheck): CheckResult {
  let handed: Handed;
  try {
    handed = door(check.task, check.bundle);
  } catch (error) {
    return { check, state: 'ERROR', section: '', notes: [String(error)] };
  }

  const { ids, rendered } = handed;
  const required = presenceGroups(check);
  const failures = [
    ...(check.lesson === undefined || ids.includes(check.lesson)
      ? []
      : [`lesson ${check.lesson} not handed (handed: ${ids.join(', ') || 'none'})`]),
    ...missing(rendered, required).map((group) => `missing ${group.join(' / ')}`),
    ...delivered(rendered, check.forbidden).map((found) => `forbidden ${found} delivered`),
  ];
  if (failures.length > 0) return { check, state: 'FAIL', section: rendered, notes: failures };

  const control = controlText(check.task);
  const vacuous = required.filter((group) => present(control, group) !== null);
  if (vacuous.length > 0) {
    const notes = vacuous.map((group) => `${group.join(' / ')} is present with no lesson handed`);
    return { check, state: 'VACUOUS', section: rendered, notes };
  }
  return { check, state: 'PASS', section: rendered, notes: [] };
}

/** `groups` as one line for a failure report. */
function groupsLine(groups: Groups): string {
  return groups.length === 0
    ? '(none)'
    : groups.map((group) => group.join(' / ')).join(' | ');
}

/** Null for a `PASS`, otherwise the report a failing check prints. See "Guards". */
function explain(result: CheckResult): string | null {
  if (result.state === 'PASS') return null;
  const { check } = result;
  return [
    `${result.state}: ${check.name}`,
    ...result.notes.map((note) => `  ${note}`),
    `task: ${check.task}`,
    `expected: ${groupsLine(check.expected)}`,
    `canary: ${groupsLine(check.canary)}`,
    `forbidden: ${groupsLine(check.forbidden)}`,
    'delivered section:',
    result.section === ''
      ? '(empty)'
      : result.section,
  ].join('\n');
}

/** The fixture problems of `check`. See "Guards". */
function lintCheck(check: DoorCheck): readonly string[] {
  const context = `${check.task}\n${LESSONS_HEADING}`;
  const shared = presenceGroups(check).flat()
    .filter((alternative) => present(context, [alternative]) !== null)
    .map((alternative) => `${check.name}: \`${alternative}\` is already in the task text or the section heading`);
  const bare = check.forbidden.length > 0 && check.canary.length === 0
    ? [`${check.name}: an absence check with no canary`]
    : [];
  return [...shared, ...bare];
}

/** One answerable case. */
interface AnswerableCase {
  readonly task: string;
  readonly lesson: string;
  readonly expected: Groups;
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

const ANSWERABLE_CHECKS: readonly DoorCheck[] = ANSWERABLE.map(({ task, lesson, expected }) => ({
  name: lesson,
  task,
  lesson,
  expected,
  forbidden: [],
  canary: [],
}));

const ABSTENTION: readonly string[] = [
  'Add `ballotQuorum` to packages/rafa-zeta/src/quorum/ballot.ts so a vote survives one lost peer, with its colocated tests.',
  'When the warp gauge reads a stale flux value, refresh the gauge cache in packages/rafa-warp/src/gauge/cache.ts.',
];

/** The update tasks, the two flagged ones naming the anchor's path. */
const PUBLISH_TASK = `Publish the package once the release is tagged; choose the publish command. The loader is ${ANCHOR_PATH}.`;
const HUB_PORT_TASK = `Start the hub; its port is taken by another process. The loader is ${ANCHOR_PATH}.`;
const REFRESH_TASK = 'Make the board refresh survive when it times out.';

const UPDATE_CHECKS: readonly DoorCheck[] = [
  {
    name: 'two actions at one confidence are both flagged and neither is handed out',
    task: PUBLISH_TASK,
    expected: [],
    forbidden: [['npm publish'], ['bun publish']],
    canary: ANCHOR_CANARY,
  },
  {
    name: 'a newer action 0.05 below the held one flags both, so neither port is handed out',
    task: HUB_PORT_TASK,
    expected: [],
    forbidden: [['8766'], ['8010']],
    canary: ANCHOR_CANARY,
  },
];

const CONTRAST_CHECK: DoorCheck = {
  name: 'a newer action more than GAP below the held one is discarded, and the retired one is still handed out',
  task: REFRESH_TASK,
  expected: [],
  forbidden: [['rate limit']],
  canary: [['30 seconds']],
};

/** Every check the fixture holds, linted as the file loads. */
const CHECKS: readonly DoorCheck[] = [...ANSWERABLE_CHECKS, ...UPDATE_CHECKS, CONTRAST_CHECK];

const LINT = CHECKS.flatMap(lintCheck);
if (LINT.length > 0) throw new Error(`lesson-door fixture lint:\n${LINT.join('\n')}`);

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

describe('guards: each one can fail', () => {
  const answerable = ANSWERABLE_CHECKS[0]!;

  it('reads a check whose word the task text already carries as VACUOUS', () => {
    const echo: DoorCheck = { ...answerable, name: 'echo', expected: [['teardown']] };

    expect(runCheck(echo).state).toBe('VACUOUS');
  });

  it('reads a check whose word only the section heading carries as VACUOUS', () => {
    const heading: DoorCheck = { ...answerable, name: 'heading', expected: [['earlier']] };

    expect(runCheck(heading).state).toBe('VACUOUS');
  });

  it('fails an absence check whose canary is not delivered, though the forbidden word is absent too', () => {
    const silent: DoorCheck = { ...UPDATE_CHECKS[0]!, task: 'Publish the package; choose the publish command.' };

    expect(runCheck(silent).state).toBe('FAIL');
  });

  it('lints an echoed word and an absence check with no canary', () => {
    const echo: DoorCheck = { ...answerable, name: 'echo', expected: [['teardown']] };
    const bare: DoorCheck = { ...CONTRAST_CHECK, name: 'bare', canary: [] };

    expect(lintCheck(echo)).toEqual(['echo: `teardown` is already in the task text or the section heading']);
    expect(lintCheck(bare)).toEqual(['bare: an absence check with no canary']);
  });

  it('prints the delivered section, the groups and the notes of a failing check', () => {
    const wrong: DoorCheck = { ...answerable, name: 'wrong', expected: [['8766']] };

    expect(explain(runCheck(wrong))).toBe([
      'FAIL: wrong',
      '  missing 8766',
      `task: ${answerable.task}`,
      'expected: 8766',
      'canary: (none)',
      'forbidden: (none)',
      'delivered section:',
      door(answerable.task).rendered,
    ].join('\n'));
  });
});

describe('guards: the empty-ledger control finds no vacuous check', () => {
  it('reads every fixture check against the control', () => {
    const vacuous = CHECKS.map(runCheck).filter((result) => result.state === 'VACUOUS');

    expect(vacuous.map(explain)).toEqual([]);
  });
});

describe('lesson door: answerable tasks bring in their lesson', () => {
  for (const check of ANSWERABLE_CHECKS) {
    it(`${check.name}: ${check.task}`, () => {
      expect(explain(runCheck(check))).toBeNull();
    });
  }
});

/**
 * Both abstention cases share one ordinary word with a held trigger:
 * `tests` (a prefix of `test`) and `add` in the first, `refresh` in the
 * second. Under a floor of one matched word they were handed four
 * lessons between them; `TRIGGER_WORD_FLOOR` asks for two. They carry
 * no canary, since a canary would be a lesson handed; the answerable
 * cases are the proof that the same door delivers.
 */
describe('lesson door: abstention tasks are handed no lesson', () => {
  for (const task of ABSTENTION) {
    it(task, () => {
      const { ids, rendered } = door(task);

      expect(ids).toEqual([]);
      expect(rendered).toBe('');
    });
  }
});

describe('lesson door: an update within GAP is a clean miss, never a stale pair', () => {
  it('holds both publish actions and both hub ports as flagged', () => {
    const statuses = (trigger: string): readonly string[] => HELD
      .filter((each) => each.trigger === trigger)
      .map((each) => each.status);

    expect(statuses(PUBLISH_TRIGGER)).toEqual(['flagged', 'flagged']);
    expect(statuses(HUB_PORT_TRIGGER)).toEqual(['flagged', 'flagged']);
  });

  for (const check of UPDATE_CHECKS) {
    it(check.name, () => {
      expect(explain(runCheck(check))).toBeNull();
    });
  }
});

describe('lesson door: no task is handed a retired action next to the current one', () => {
  const pairs = [
    { current: [['npm publish']], retired: [['bun publish']] },
    { current: [['8766']], retired: [['8010']] },
    { current: [['rate limit']], retired: [['30 seconds']] },
  ];
  const tasks = [...ANSWERABLE.map((each) => each.task), ...ABSTENTION, PUBLISH_TASK, HUB_PORT_TASK, REFRESH_TASK];

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
  it(CONTRAST_CHECK.name, () => {
    expect(explain(runCheck(CONTRAST_CHECK))).toBeNull();
  });
});
