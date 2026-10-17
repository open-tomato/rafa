import type {
  LadderKey,
  LadderLevel,
  LadderReadings,
  LadderSettings,
  LadderWorkflowReading,
} from './ladder.js';

import { describe, expect, it } from 'bun:test';

import {
  RELEASE_PUBLISH_MODES,
  RELEASE_SETTLE_MODES,
  RELEASE_TAG_MODES,
} from '@open-tomato/rafa/core/config/sections';

import {
  BOT_FRAGMENT_WORKFLOW,
  DEPENDABOT_CONFIG,
  LADDER_WORKFLOWS,
  ladderLevel,
  ladderPreconditions,
  ladderWorkflowNeeded,
  PUBLISH_SWITCH_VARIABLE,
  PUBLISH_WORKFLOW,
  TAG_WORKFLOW,
} from './ladder.js';

const PUBLISH_TEXT = [
  'permissions:',
  '  contents: read',
  '  id-token: write',
  '',
].join('\n');

function settings(
  releaseSettle: LadderSettings['releaseSettle'],
  releaseTag: LadderSettings['releaseTag'],
  releasePublish: LadderSettings['releasePublish'],
): LadderSettings {
  return { releaseSettle, releaseTag, releasePublish };
}

/** Every roster workflow a regular file, the publish one granting the token. */
function complete(overrides: Partial<LadderReadings> = {}): LadderReadings {
  const workflows = new Map<string, LadderWorkflowReading>(
    LADDER_WORKFLOWS.map(entry => [
      entry.path,
      entry === PUBLISH_WORKFLOW
        ? { kind: 'file', text: PUBLISH_TEXT }
        : { kind: 'file' },
    ]),
  );

  return {
    workflows,
    manifest: { path: 'package.json', private: false, name: '@scope/pkg' },
    dependabot: false,
    ...overrides,
  };
}

function withWorkflow(path: string, reading: LadderWorkflowReading): ReadonlyMap<string, LadderWorkflowReading> {
  return new Map([...complete().workflows, [path, reading]]);
}

describe('LADDER_WORKFLOWS', () => {
  it('names the four files under .github/workflows/ with the levels each serves', () => {
    expect(LADDER_WORKFLOWS.map(entry => [entry.path, entry.levels, entry.onlyWithDependabot])).toEqual([
      ['.github/workflows/release-publish.yml', [2, 3, 4], false],
      ['.github/workflows/release-tag.yml', [3], false],
      ['.github/workflows/release-settle.yml', [4], false],
      ['.github/workflows/release-bot-fragment.yml', [3, 4], true],
    ]);
  });

  it('needs the bot fragment workflow only while the Dependabot config exists', () => {
    expect(ladderWorkflowNeeded(BOT_FRAGMENT_WORKFLOW, 3, false)).toBe(false);
    expect(ladderWorkflowNeeded(BOT_FRAGMENT_WORKFLOW, 3, true)).toBe(true);
    expect(ladderWorkflowNeeded(BOT_FRAGMENT_WORKFLOW, 2, true)).toBe(false);
    expect(ladderWorkflowNeeded(PUBLISH_WORKFLOW, 2, false)).toBe(true);
    expect(ladderWorkflowNeeded(PUBLISH_WORKFLOW, 1, true)).toBe(false);
  });
});

describe('PUBLISH_SWITCH_VARIABLE', () => {
  it('names the variable the job condition of the publish template reads', async () => {
    const template = await Bun.file(`${import.meta.dir}/templates/${PUBLISH_WORKFLOW.file}`).text();

    expect(PUBLISH_SWITCH_VARIABLE).toBe('RAFA_RELEASE_PUBLISH');
    expect(template).toContain(`if: vars.${PUBLISH_SWITCH_VARIABLE} == 'ci'`);
  });

  it('is never a missing item: complete readings at level 2 and up miss nothing', () => {
    const levels: LadderLevel[] = [2, 3, 4];

    expect(levels.map(level => ladderPreconditions(level, complete()))).toEqual([[], [], []]);
  });
});

describe('ladderLevel', () => {
  it('reads every combination of the three keys as the table says', () => {
    const table: Array<[LadderSettings, LadderLevel, LadderKey | null]> = [
      [settings('push', 'manual', 'manual'), 0, null],
      [settings('pr', 'manual', 'manual'), 0, null],
      [settings('push', 'settle', 'manual'), 1, null],
      [settings('pr', 'settle', 'manual'), 0, 'release.tag'],
      [settings('push', 'manual', 'ci'), 2, null],
      [settings('pr', 'manual', 'ci'), 2, 'release.settle'],
      [settings('pr', 'settle', 'ci'), 3, null],
      [settings('push', 'settle', 'ci'), 4, null],
    ];

    expect(table.map(([input]) => input)).toHaveLength(
      RELEASE_SETTLE_MODES.length * RELEASE_TAG_MODES.length * RELEASE_PUBLISH_MODES.length,
    );
    for (const [input, level, misfitKey] of table) {
      const reading = ladderLevel(input);

      expect([reading.level, reading.misfit?.key ?? null]).toEqual([level, misfitKey]);
    }
  });

  it('names the level and the value the misfit holds against the one expected', () => {
    expect(ladderLevel(settings('pr', 'manual', 'ci'))).toEqual({
      level: 2,
      name: 'CI publishes',
      misfit: { key: 'release.settle', value: 'pr', expected: 'push' },
    });
    expect(ladderLevel(settings('push', 'manual', 'manual'))).toEqual({
      level: 0,
      name: 'Manual',
      misfit: null,
    });
  });
});

describe('ladderPreconditions', () => {
  it('reports a needed workflow path holding a directory as not a file', () => {
    const readings = complete({ workflows: withWorkflow('.github/workflows/release-tag.yml', { kind: 'not-a-file' }) });

    expect(ladderPreconditions(3, readings)).toEqual([
      { kind: 'workflow', workflow: TAG_WORKFLOW, found: 'not-a-file' },
    ]);
  });

  it('reports an absent workflow, and a path left out of the readings as absent', () => {
    const absent = complete({ workflows: withWorkflow(PUBLISH_WORKFLOW.path, { kind: 'absent' }) });
    const omitted = complete({ workflows: new Map() });

    expect(ladderPreconditions(2, absent)).toEqual([
      { kind: 'workflow', workflow: PUBLISH_WORKFLOW, found: 'absent' },
    ]);
    expect(ladderPreconditions(4, omitted).map(item => item.kind === 'workflow' && item.workflow.file)).toEqual([
      'release-publish.yml',
      'release-settle.yml',
    ]);
  });

  it('reports a publish workflow without id-token: write, a commented line included', () => {
    const commented = PUBLISH_TEXT.replace('  id-token: write', '  # id-token: write');
    const readings = complete({ workflows: withWorkflow(PUBLISH_WORKFLOW.path, { kind: 'file', text: commented }) });

    expect(ladderPreconditions(2, readings)).toEqual([{ kind: 'id-token', workflow: PUBLISH_WORKFLOW }]);
  });

  it('accepts a quoted write with a trailing comment', () => {
    const quoted = PUBLISH_TEXT.replace('id-token: write', 'id-token: \'write\' # trusted publishing');
    const readings = complete({ workflows: withWorkflow(PUBLISH_WORKFLOW.path, { kind: 'file', text: quoted }) });

    expect(ladderPreconditions(2, readings)).toEqual([]);
  });

  it('reports a private manifest and one without a name', () => {
    const readings = complete({ manifest: { path: 'package.json', private: true, name: null } });

    expect(ladderPreconditions(2, readings)).toEqual([
      { kind: 'manifest-private', path: 'package.json' },
      { kind: 'manifest-unnamed', path: 'package.json' },
    ]);
  });

  it('reports a Dependabot config while the bot fragment workflow is absent', () => {
    const readings = complete({
      dependabot: true,
      workflows: withWorkflow(BOT_FRAGMENT_WORKFLOW.path, { kind: 'absent' }),
    });

    expect(ladderPreconditions(3, readings)).toEqual([
      { kind: 'bot-workflow', workflow: BOT_FRAGMENT_WORKFLOW, found: 'absent', dependabot: DEPENDABOT_CONFIG },
    ]);
    expect(ladderPreconditions(3, { ...readings, dependabot: false })).toEqual([]);
  });

  it('asks nothing at levels 0 and 1, whatever the readings hold', () => {
    const empty: LadderReadings = {
      workflows: new Map(),
      manifest: { path: 'package.json', private: true, name: null },
      dependabot: true,
    };

    expect(ladderPreconditions(0, empty)).toEqual([]);
    expect(ladderPreconditions(1, empty)).toEqual([]);
    expect(ladderPreconditions(2, empty).length).toBeGreaterThan(0);
  });

  it('answers nothing missing for complete readings at every level', () => {
    const levels: LadderLevel[] = [0, 1, 2, 3, 4];

    expect(levels.map(level => ladderPreconditions(level, complete({ dependabot: true })))).toEqual([
      [],
      [],
      [],
      [],
      [],
    ]);
  });
});
