/**
 * Tests for what `src/start/release-stage.ts` gives the pull request
 * body besides a failure sentence: the forecast of a pushed fragment,
 * and the level report when the plan declared a level below its notes.
 * `./release-stage.test.ts` holds the commit, the push and the failure
 * sentences; its file ran past 800 lines before this split, so these
 * cases sit here over the same fixtures
 * (`src/tests/release-stage-fixtures.ts`).
 *
 * The forecast seam is stubbed: what the fold answers is
 * `src/release/branch-forecast.test.ts`'s question, and what the stage
 * does with the answer is this file's.
 */
import type { ReleaseStageSeams } from './release-stage.js';
import type { ReleasePreparation } from '../release/prepare.js';

import { afterEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { RELEASE_BLOCK_CLOSE } from '../release/branch-forecast.js';
import { sinkOutput } from '../tests/output-sinks.js';
import {
  COMMITTED,
  detail,
  FORECAST,
  FORECAST_LINE,
  NOTES,
  OK,
  PR,
  prepared,
  PROVIDER_NONE,
  REPO,
  SETTINGS,
  SKIP_SENTENCE,
  SKIPPED,
  STAGE_INPUT,
  stub,
  VERIFIED,
} from '../tests/release-stage-fixtures.js';

import { finishRelease, prepareReleaseStage } from './release-stage.js';

afterEach(() => {
  setActiveOutput(null);
});

/** The block {@link FORECAST} is written in, with no level report. */
const FORECAST_BLOCK = [
  '<!-- rafa:release v1 base=0.4.0 waiting=rafa-19 -->',
  FORECAST_LINE,
  RELEASE_BLOCK_CLOSE,
].join('\n');

/** The level report of a plan declaring patch whose notes reach major. */
const LEVEL_REPORT = 'the plan declares release: patch, below the major its change notes reach;'
  + ' the declaration stands, so this pull request ships as patch';

/** A preparation of a plan declaring patch whose notes reach major. */
const UNDER_DECLARED = prepared({ level: 'patch', levelSource: 'plan', notesLevel: 'major' });

/** The finish input every case runs under, over `preparation`. */
function finishOf(preparation: ReleasePreparation): Parameters<typeof finishRelease>[0] {
  return { repoRoot: REPO, settings: SETTINGS, preparation };
}

describe('finishRelease forecast', () => {
  it('forecasts the verified fragment against step 1 record, after the push', async () => {
    const world = stub({ git: COMMITTED });
    const preparation = prepared();

    const finish = await finishRelease(finishOf(preparation), { ...world.seams, verify: () => VERIFIED });

    expect(world.forecasts).toHaveLength(1);
    const asked = world.forecasts[0];
    expect(asked?.prepared).toBe(preparation);
    expect(asked?.verified).toBe(VERIFIED);
    expect(asked?.settings).toBe(SETTINGS);
    expect(asked?.now.toISOString()).toBe('2026-09-20T09:00:00.000Z');
    expect(finish.forecast).toBe(FORECAST);
    // The push came first: a forecast is of what the pull request carries.
    expect(world.calls.slice(0, 2)).toEqual([`push ${REPO} feat/rafa-21-changelog-and-release`, 'findOpen']);
  });

  it('writes the forecast into the pull request body as a marked block', async () => {
    const world = stub({ git: COMMITTED });

    const finish = await finishRelease(finishOf(prepared()), { ...world.seams, verify: () => VERIFIED });

    expect(finish.outcome).toBe('released');
    expect(finish.body).toEqual({ number: PR, carried: true, already: false, problem: null });
    expect(world.bodies).toEqual([`Closes #21\n\n${FORECAST_BLOCK}`]);
    expect(world.info).toContain(`   ${FORECAST_LINE}.`);
  });

  it('replaces the forecast an earlier wrap-up left rather than adding a second', async () => {
    const stale = FORECAST_BLOCK.replace('base=0.4.0', 'base=0.3.0').replace('at 0.4.0', 'at 0.3.0');
    const world = stub({ git: COMMITTED, detail: detail(`Closes #21\n\n${stale}`) });

    await finishRelease(finishOf(prepared()), { ...world.seams, verify: () => VERIFIED });

    expect(world.bodies).toEqual([`Closes #21\n\n${FORECAST_BLOCK}`]);
  });

  it('leaves a body that already carries the same forecast as it is', async () => {
    const world = stub({ git: COMMITTED, detail: detail(`Closes #21\n\n${FORECAST_BLOCK}`) });

    const finish = await finishRelease(finishOf(prepared()), { ...world.seams, verify: () => VERIFIED });

    expect(finish.body?.already).toBe(true);
    expect(world.bodies).toEqual([]);
  });

  it('says in the body why no forecast was computed, and still releases', async () => {
    const unread = { ok: false, ref: 'origin/main', problem: 'origin/main:package.json declares no version', problems: [] } as const;
    const world = stub({ git: COMMITTED, forecast: unread });

    const finish = await finishRelease(finishOf(prepared()), { ...world.seams, verify: () => VERIFIED });

    expect(finish.outcome).toBe('released');
    expect(world.bodies[0]).toContain('<!-- rafa:release v1 -->\nRelease forecast: none computed, because origin/main:package.json declares no version');
  });

  it('warns about every waiting fragment the forecast left out', async () => {
    const world = stub({ git: COMMITTED, forecast: { ...FORECAST, problems: ['origin/main\'s .changes/rafa-9.md was left out'] } });

    await finishRelease(finishOf(prepared()), { ...world.seams, verify: () => VERIFIED });

    expect(world.warn).toEqual(['   ⚠️  origin/main\'s .changes/rafa-9.md was left out']);
  });

  it('prints the forecast it could not write when the provider is none, and asks nothing', async () => {
    const world = stub({ git: COMMITTED, provider: PROVIDER_NONE });

    const finish = await finishRelease(finishOf(prepared()), { ...world.seams, verify: () => VERIFIED });

    expect(finish.outcome).toBe('released');
    expect(finish.body?.carried).toBe(false);
    expect(world.calls).toEqual([`push ${REPO} feat/rafa-21-changelog-and-release`]);
    expect(world.info.at(-1)).toContain(`No pull request body carries ${JSON.stringify(FORECAST_LINE)}`);
  });
});

describe('finishRelease level report', () => {
  it('adds the level report under the forecast when the declaration is below the notes', async () => {
    const world = stub({ git: COMMITTED });

    const finish = await finishRelease(finishOf(UNDER_DECLARED), { ...world.seams, verify: () => VERIFIED });

    expect(finish.levelReport).toBe(LEVEL_REPORT);
    expect(world.bodies).toEqual([
      `Closes #21\n\n${FORECAST_BLOCK.replace(RELEASE_BLOCK_CLOSE, `Level report: ${LEVEL_REPORT}\n${RELEASE_BLOCK_CLOSE}`)}`,
    ]);
  });

  it('adds no level report when the declaration matches the notes, which is the control', async () => {
    const world = stub({ git: COMMITTED });

    const finish = await finishRelease(finishOf(prepared()), { ...world.seams, verify: () => VERIFIED });

    expect(finish.levelReport).toBeNull();
    expect(world.bodies[0]).not.toContain('Level report');
  });

  it('carries the level report beside a skip sentence, and never refuses over it', async () => {
    const world = stub({});
    const skipped = { ...SKIPPED, level: 'patch', notesLevel: 'major' } as const;

    const finish = await finishRelease(finishOf(skipped), world.seams);

    expect(finish.outcome).toBe('skipped');
    expect(world.bodies).toEqual([
      `Closes #21\n\n${SKIP_SENTENCE}\n\n<!-- rafa:release v1 -->\nLevel report: ${LEVEL_REPORT}\n${RELEASE_BLOCK_CLOSE}`,
    ]);
  });

  it('carries the level report on a pushed fragment whose commit the verification allowed at the declared level', async () => {
    const world = stub({ git: COMMITTED });

    const finish = await finishRelease(finishOf(UNDER_DECLARED), { ...world.seams, verify: () => VERIFIED });

    // A report, not a refusal: the fragment is committed and pushed.
    expect(finish.outcome).toBe('released');
    expect(finish.sha).not.toBeNull();
  });
});

describe('prepareReleaseStage level report and base', () => {
  /** Step 1 stubbed to answer `answer`, recording the input. */
  function seamsAnswering(answer: ReleasePreparation, inputs: unknown[] = []): Partial<ReleaseStageSeams> {
    return {
      prepare: (input) => {
        inputs.push(input.base);
        return answer;
      },
      readNotes: () => NOTES,
      git: () => () => OK,
    };
  }

  it('warns the level report on the terminal before the session runs', () => {
    const warned: string[] = [];
    setActiveOutput(sinkOutput({ warn: (line) => warned.push(line) }));

    prepareReleaseStage(STAGE_INPUT, seamsAnswering(UNDER_DECLARED));

    expect(warned).toEqual([`   ⚠️  Level report: ${LEVEL_REPORT}`]);
  });

  it('warns nothing for a declaration that matches its notes, which is the control', () => {
    const warned: string[] = [];
    setActiveOutput(sinkOutput({ warn: (line) => warned.push(line) }));

    prepareReleaseStage(STAGE_INPUT, seamsAnswering(prepared()));

    expect(warned).toEqual([]);
  });

  it('allocates the fragment name against pr.base when the project names one', () => {
    setActiveOutput(sinkOutput({}));
    const bases: unknown[] = [];

    prepareReleaseStage(
      { ...STAGE_INPUT, settings: { ...SETTINGS, prBase: 'develop' } },
      seamsAnswering(prepared(), bases),
    );

    expect(bases).toEqual([{ branch: 'develop' }]);
  });
});
