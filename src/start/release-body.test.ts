/**
 * Tests for the pull request body writer (`src/start/release-body.ts`):
 * what {@link carryReleaseIntoPullRequest} does with a finish, once a
 * pull request may have been opened after it.
 *
 * Every finish here is a real one, made by `finishRelease` over the
 * stubbed seams of `src/tests/release-stage-fixtures.ts`, so the
 * `written` and `body` a case hands on are the ones the stage records
 * and not a hand-built pair. The first stub answers the finish's own
 * write; a second, fresh stub answers the carry, so its `calls` and
 * `bodies` hold the carry's effects alone.
 *
 * `stub` sets the active output, which is module state, so the
 * `afterEach` puts it back to null.
 */
import type { ReleaseFinish } from './release-stage.js';
import type { ReleasePreparation } from '../release/prepare.js';
import type { Script } from '../tests/release-stage-fixtures.js';

import { afterEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { RELEASE_BLOCK_CLOSE } from '../release/branch-forecast.js';
import {
  BRANCH,
  COMMITTED,
  FORECAST_LINE,
  PR,
  prepared,
  PROVIDER_NONE,
  REPO,
  SETTINGS,
  SKIP_SENTENCE,
  SKIPPED,
  stub,
  VERIFIED,
} from '../tests/release-stage-fixtures.js';

import { carryReleaseIntoPullRequest, RELEASE_BODY_SEAMS } from './release-body.js';
import { finishRelease } from './release-stage.js';

afterEach(() => {
  setActiveOutput(null);
});

/** The block the fixtures' forecast is written in, with no level report. */
const FORECAST_BLOCK = [
  '<!-- rafa:release v1 base=0.4.0 waiting=rafa-19 -->',
  FORECAST_LINE,
  RELEASE_BLOCK_CLOSE,
].join('\n');

/** Where every carry writes: the fixtures' checkout and head branch. */
const TARGET = { repoRoot: REPO, branch: BRANCH };

/** A finish over `preparation`, its own write answered by `script`. */
async function finished(preparation: ReleasePreparation | null, script: Script): Promise<ReleaseFinish> {
  const world = stub(script);
  return finishRelease(
    { repoRoot: REPO, branch: BRANCH, settings: SETTINGS, preparation },
    { ...world.seams, verify: () => VERIFIED },
  );
}

describe('carryReleaseIntoPullRequest', () => {
  it('writes nothing for a finish with no release', async () => {
    const finish = await finished(null, {});
    const carry = stub({});

    const answer = await carryReleaseIntoPullRequest(finish, TARGET, carry.seams);

    expect(finish.written).toBeNull();
    expect(answer).toBeNull();
    expect(carry.calls).toEqual([]);
    expect(carry.bodies).toEqual([]);
  });

  it('writes nothing for a finish whose write already reached a pull request', async () => {
    const finish = await finished(prepared(), { git: COMMITTED });
    const carry = stub({});

    const answer = await carryReleaseIntoPullRequest(finish, TARGET, carry.seams);

    // The control: the finish's own write did reach #21.
    expect(finish.body).toEqual({ number: PR, carried: true, already: false, problem: null });
    expect(answer).toBeNull();
    expect(carry.calls).toEqual([]);
  });

  it('writes the forecast block of a finish whose write found no pull request', async () => {
    const finish = await finished(prepared(), { git: COMMITTED, pull: null });
    const carry = stub({});

    const answer = await carryReleaseIntoPullRequest(finish, TARGET, carry.seams);

    expect(finish.outcome).toBe('released');
    expect(finish.body?.number).toBeNull();
    expect(finish.written).toEqual({ sentence: null, block: FORECAST_BLOCK, lines: [FORECAST_LINE] });
    expect(answer).toEqual({ number: PR, carried: true, already: false, problem: null });
    expect(carry.calls).toEqual(['findOpen', `get ${PR}`, `editBody ${PR}`]);
    expect(carry.bodies).toEqual([`Closes #21\n\n${FORECAST_BLOCK}`]);
    expect(carry.info).toEqual([`   That line is now in the body of pull request #${PR}.`]);
  });

  it('writes the sentence of a failure finish whose write found no pull request', async () => {
    const finish = await finished(SKIPPED, { pull: null });
    const carry = stub({});

    const answer = await carryReleaseIntoPullRequest(finish, TARGET, carry.seams);

    expect(finish.outcome).toBe('skipped');
    expect(finish.body?.number).toBeNull();
    expect(answer).toEqual({ number: PR, carried: true, already: false, problem: null });
    expect(carry.bodies).toEqual([`Closes #21\n\n${SKIP_SENTENCE}`]);
  });

  it('writes again a finish whose write a none provider kept off the body', async () => {
    const finish = await finished(SKIPPED, { provider: PROVIDER_NONE });
    const carry = stub({});

    const answer = await carryReleaseIntoPullRequest(finish, TARGET, carry.seams);

    expect(finish.body?.number).toBeNull();
    expect(answer?.number).toBe(PR);
    expect(carry.bodies).toEqual([`Closes #21\n\n${SKIP_SENTENCE}`]);
  });

  it('reports, without throwing, a carry that still finds no pull request', async () => {
    const finish = await finished(SKIPPED, { pull: null });
    const carry = stub({ pull: null });

    const answer = await carryReleaseIntoPullRequest(finish, TARGET, carry.seams);

    expect(answer).toEqual({
      number: null,
      carried: false,
      already: false,
      problem: `no open pull request was found for ${BRANCH} to write it to`,
    });
    expect(carry.bodies).toEqual([]);
    expect(carry.error).toEqual([
      `   That line is not in the pull request body: no open pull request was found for ${BRANCH} to write it to`,
    ]);
  });
});

describe('RELEASE_BODY_SEAMS', () => {
  it('names a real helper for both effects the write reaches through', () => {
    expect(Object.keys(RELEASE_BODY_SEAMS).sort()).toEqual(['pulls', 'readProvider']);
  });
});
