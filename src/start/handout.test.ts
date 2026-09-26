/**
 * Unit tests for `start/handout.ts`: the task as a resolver reads it
 * (`taskInputFor`, its `skills=` and its stage context found by line),
 * and `handOut` running the resolver the run's `task.skills` names and
 * `selectLessons` under `task.lessons`, pulling the blessed bundle from a
 * stubbed Learning adapter registered under the kind `stub`: once per
 * call, never under `off` or a null `learning`, and a refused pull or an
 * unknown kind warned about while the skills are still handed out.
 *
 * Every resolution here is built with `resolveTiers` over rows alone, so
 * nothing reads a tier on disk. The lines the module prints go to a sink
 * output set for each case and unset after it.
 */
import type { TaskLearning } from './dispatch.js';
import type { TaskHandout } from './handout.js';
import type { AdapterContext } from '../adapters/registry.js';
import type { InstinctRecord } from '../learning/index.js';
import type { Learning } from '../ports/index.js';
import type { TaskInput } from '../task/resolve-skills.js';
import type { Resolution } from '../tiers/resolve.js';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { createAdapterRegistry, PORT_VERSIONS } from '../adapters/registry.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { resolveTiers } from '../tiers/resolve.js';
import { parseTaskDeclaration } from '../utils/declaration.js';

import {
  EMPTY_RESOLUTION,
  handOut,
  NOTHING_HANDED_OUT,
  taskInputFor,
} from './handout.js';

/** A plan with one task above every stage and two stages, the first holding a stage context. */
const PLAN = [
  '# Plan',
  '',
  '- [ ] Set up the checkout',
  '',
  '# Stage: Wiring',
  '',
  '```rafa:stage-context',
  'Touch src/start/dispatch.ts only.',
  '```',
  '',
  '- [ ] Wire the thing  {skills=git-workflow,bun-testing}',
  '',
  '# Stage: Records',
  '',
  '- [ ] Store the thing',
  '',
].join('\n');

/** `line`'s task as the tracker answers it: the text after the checkbox, at its zero-based line. */
function taskInfoAt(line: number): { task: string; lineNum: number } {
  const text = PLAN.split('\n')[line] ?? '';
  return { task: text.replace(/^- \[ \] /, ''), lineNum: line };
}

/** The task as a resolver reads it, for the plan line at `line`. */
function inputAt(line: number): TaskInput {
  const info = taskInfoAt(line);
  const { text, declaration } = parseTaskDeclaration(info.task);
  return taskInputFor(info, text, declaration, PLAN);
}

describe('taskInputFor', () => {
  it('reads the sentence, its skills= names in order and its stage context', () => {
    expect(inputAt(10)).toEqual({
      text: 'Wire the thing',
      skills: ['git-workflow', 'bun-testing'],
      stageContext: 'Touch src/start/dispatch.ts only.',
    });
  });

  it('reads no stage context for a stage without one, nor for a task above every stage', () => {
    expect(inputAt(14)).toEqual({ text: 'Store the thing', skills: [], stageContext: null });
    expect(inputAt(2)).toEqual({ text: 'Set up the checkout', skills: [], stageContext: null });
  });

  it('reads no stage context when the plan holds another task at the line', () => {
    // The control is the first case: the same line holding the same task
    // reads the stage context.
    const info = { ...taskInfoAt(10), task: 'Wire another thing' };

    expect(taskInputFor(info, 'Wire another thing', null, PLAN).stageContext).toBeNull();
  });
});

/** What each served skill below is used for; only `git-workflow` names words a task below uses. */
const USES: Readonly<Record<string, string>> = {
  'git-workflow': 'branches and pull requests',
  'bun-testing': 'unit suites',
};

/** Two served project skills, one per {@link USES} entry. */
function resolution(): Resolution {
  const rows = Object.entries(USES).map(([name, use]) => ({
    kind: 'skill' as const,
    name,
    source: 'project' as const,
    path: `/project/skills/${name}/SKILL.md`,
    summary: `Use when working on ${use}`,
    tags: [],
    prevents: null,
    whenToUse: null,
  }));
  return resolveTiers(
    rows,
    { settingSources: ['project', 'local'], tiersRafa: 'on', tiersSkills: new Map(), tiersAgents: new Map() },
    (path) => new TextEncoder().encode(path),
  );
}

/** A blessed lesson whose trigger names `words`. */
function lesson(id: string, trigger: string, confidence: number): InstinctRecord {
  return {
    id,
    trigger,
    action: `act on ${id}`,
    action_hash: id,
    confidence,
    usage_count: 1,
    signal: 'loud',
    status: 'active',
    created_at: '2026-09-25T00:00:00.000Z',
    updated_at: '2026-09-25T00:00:00.000Z',
  };
}

/** The bundle every stub pull answers: one lesson matching the task below, one matching nothing. */
const BUNDLE = [lesson('matching', 'when opening pull requests', 0.7), lesson('unrelated', 'when compiling kernels', 0.9)];

describe('handOut', () => {
  let warned: string[] = [];
  let made: AdapterContext[] = [];
  let pulls = 0;
  let refusal: Error | null = null;

  const stub: Learning = {
    push: () => Promise.reject(new Error('no push expected')),
    pullBlessed: () => {
      pulls += 1;
      return refusal === null
        ? Promise.resolve({ version: 'stub', instincts: BUNDLE })
        : Promise.reject(refusal);
    },
    flag: () => Promise.resolve(),
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

  function learningOf(kind = 'stub'): TaskLearning {
    return { kind, home: '/home/stand-in', blessMinConfidence: 0.6, registry };
  }

  function handoutOf(fields: Partial<TaskHandout> = {}): TaskHandout {
    return { resolver: 'planner', lessons: 'on', learning: learningOf(), ...fields };
  }

  /** A task declaring `skills=bun-testing` whose text names pull requests. */
  const TASK: TaskInput = { text: 'Open the pull requests', skills: ['bun-testing'], stageContext: null };

  beforeEach(() => {
    warned = [];
    made = [];
    pulls = 0;
    refusal = null;
    setActiveOutput(sinkOutput({ warn: (message) => warned.push(message) }));
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  it('hands out the planner\'s skills= and the lessons selectLessons keeps, pulled once', async () => {
    const handed = await handOut(handoutOf(), TASK, resolution(), '/repo');

    expect(handed.resolver).toBe('planner');
    expect(handed.skills.map((skill) => skill.name)).toEqual(['bun-testing']);
    expect(handed.lessons.map((each) => each.id)).toEqual(['matching']);
    expect(made).toEqual([{ repoRoot: '/repo', home: '/home/stand-in', learningBlessMinConfidence: 0.6 }]);
    expect(pulls).toBe(1);
    expect(warned).toEqual([]);
  });

  it('hands out what the resolver named by task.skills chose, the same lessons under each', async () => {
    const tag = await handOut(handoutOf({ resolver: 'tag' }), TASK, resolution(), '/repo');
    const none = await handOut(handoutOf({ resolver: 'none' }), TASK, resolution(), '/repo');

    // `tag` ignores skills= and ranks the text: pull requests name git-workflow.
    expect(tag.resolver).toBe('tag');
    expect(tag.skills.map((skill) => skill.name)).toEqual(['git-workflow']);
    expect(none.resolver).toBe('none');
    expect(none.skills).toEqual([]);
    expect(tag.lessons).toEqual(none.lessons);
    expect(none.lessons.map((each) => each.id)).toEqual(['matching']);
  });

  it('offers no skill from a resolution holding none, the resolver still named', async () => {
    const handed = await handOut(handoutOf(), TASK, EMPTY_RESOLUTION, '/repo');

    expect(handed.resolver).toBe('planner');
    expect(handed.skills).toEqual([]);
  });

  it('makes no adapter under task.lessons off, nor under a null learning', async () => {
    // The control is the first case: the same handout under `on` makes
    // the adapter once and pulls once.
    const off = await handOut(handoutOf({ lessons: 'off' }), TASK, resolution(), '/repo');
    const unset = await handOut(handoutOf({ learning: null }), TASK, resolution(), '/repo');

    expect(off.lessons).toEqual([]);
    expect(unset.lessons).toEqual([]);
    expect(off.skills.map((skill) => skill.name)).toEqual(['bun-testing']);
    expect(made).toEqual([]);
    expect(pulls).toBe(0);
    expect(warned).toEqual([]);
  });

  it('warns about a refused pull and hands out the skills without lessons', async () => {
    refusal = new Error('the store is locked');

    const handed = await handOut(handoutOf(), TASK, resolution(), '/repo');

    expect(handed.skills.map((skill) => skill.name)).toEqual(['bun-testing']);
    expect(handed.lessons).toEqual([]);
    expect(warned).toEqual([
      '   Lessons: none handed to this task: the `stub` learning adapter answered no blessed set: the store is locked',
      '   The task is not failed for it: it is dispatched without a lessons section.',
    ]);
  });

  it('warns about a kind no registry holds and pulls nothing', async () => {
    const handed = await handOut(handoutOf({ learning: learningOf('absent') }), TASK, resolution(), '/repo');

    expect(handed.lessons).toEqual([]);
    expect(pulls).toBe(0);
    expect(warned).toHaveLength(2);
    expect(warned[0]).toStartWith('   Lessons: none handed to this task: the `absent` learning adapter answered no blessed set: ');
  });

  it('hands out nothing and runs no resolver for a null handout', async () => {
    expect(await handOut(null, TASK, resolution(), '/repo')).toEqual(NOTHING_HANDED_OUT);
    expect(NOTHING_HANDED_OUT).toEqual({ resolver: null, skills: [], lessons: [] });
    expect(made).toEqual([]);
  });
});
