/**
 * Tests for what a `plan create` run does with the claim on its issue
 * (`src/commands/plan/claim-route.ts`): the line a claim prints, the
 * warning an unclaimed run writes its plan under, the exit 1 a refused
 * `--issue` ends with, and the `--next` walk resolved again past a
 * refused pick.
 *
 * Every seam is planted: the resolution answers specs a case names, the
 * cheap refusals answer a stub, and the claim answers what the case
 * plants, so nothing here reaches git, GitHub or a store. What the claim
 * itself answers over a remote is `src/claims/plan-claim.test.ts`'s; the
 * walk reading a passed-over issue as taken is
 * `src/board/spec-source-roadmap.test.ts`'s.
 *
 * The last block builds the run's claim context for real over a scratch
 * directory under `tmpdir`, whose provider and store the config names.
 */
import type { ClaimRouteSeams, PassOver } from './claim-route.js';
import type { PlanSpecResolution } from '../../board/plan-spec.js';
import type { SpecSourceKind } from '../../board/spec-source.js';
import type { PlanClaim, PlanClaimRequest } from '../../claims/plan-claim.js';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '../../cli/command.js';
import { sinkOutput } from '../../tests/output-sinks.js';

import {
  CLAIM_REFUSAL_EXIT,
  claimedLine,
  claimRefusalMessage,
  createPlanClaimContext,
  passedOverLine,
  resolveAndClaim,
  unclaimedWarning,
} from './claim-route.js';

/** The store id every planted claim names as this device's. */
const OWN_STORE = 'store-own-1';

/** The store id every planted refusal names as the owner. */
const OTHER_STORE = 'store-other-2';

/** The labels the planted issues carry. */
const LABELS = ['spec', 'spec:ready'];

/** A resolution answering a spec read off issue `issue` by `kind`. */
function specResolution(issue: number, kind: SpecSourceKind = 'issue'): PlanSpecResolution {
  const path = `.rafa/specs/rafa-${String(issue)}-issue.md`;
  return {
    outcome: 'spec',
    spec: {
      path,
      kind,
      source: `issue #${String(issue)}`,
      issue,
      read: { number: issue, title: 'Issue', body: '', state: 'OPEN', labels: LABELS, author: 'octocat' },
      snapshot: null,
    },
    gate: null,
  };
}

/** A resolution answering a `--spec` file, with no issue read. */
function fileResolution(path: string): PlanSpecResolution {
  return {
    outcome: 'spec',
    spec: { path, kind: 'spec', source: path, issue: null, read: null, snapshot: null },
    gate: null,
  };
}

/** The claim this device holds on `issue`, reached `via`. */
function claimedOn(issue: number, via: 'claim' | 'take' | 'held' = 'claim', warnings: readonly string[] = []): PlanClaim {
  return { outcome: 'claimed', issue, branch: `feat/rafa-${String(issue)}-issue`, storeId: OWN_STORE, via, warnings };
}

/** The refusal of `issue`, owned by {@link OTHER_STORE}. */
function refusedOn(issue: number): Extract<PlanClaim, { outcome: 'refused' }> {
  const branch = `feat/rafa-${String(issue)}-issue`;
  return {
    outcome: 'refused',
    issue,
    branch,
    owner: OTHER_STORE,
    reason: `#${String(issue)} is claimed by store ${OTHER_STORE} on ${branch}`,
  };
}

/** What a planted route kept: the lines, the pass-overs and the claim requests. */
interface Kept {
  readonly info: string[];
  readonly warn: string[];
  readonly passOvers: PassOver[];
  readonly prepared: string[];
  readonly requests: PlanClaimRequest[];
}

/**
 * Seams answering `resolutions` in turn, the stub off each spec's name,
 * and `claims` in turn, keeping what each was handed.
 */
function planted(resolutions: readonly PlanSpecResolution[], claims: readonly PlanClaim[]): { seams: ClaimRouteSeams; kept: Kept } {
  const kept: Kept = { info: [], warn: [], passOvers: [], prepared: [], requests: [] };
  let resolved = 0;
  let claimed = 0;
  const seams: ClaimRouteSeams = {
    resolve: (passOver) => {
      kept.passOvers.push(new Map(passOver));
      const next = resolutions[resolved];
      resolved += 1;
      return next === undefined
        ? Promise.reject(new Error('resolved once more than the case planted'))
        : Promise.resolve(next);
    },
    prepare: (spec) => {
      kept.prepared.push(spec.path);
      return Promise.resolve(spec.path.replace(/^.*\//u, '').replace(/\.md$/u, ''));
    },
    claim: (request) => {
      kept.requests.push(request);
      const next = claims[claimed];
      claimed += 1;
      return next === undefined
        ? Promise.reject(new Error('claimed once more than the case planted'))
        : Promise.resolve(next);
    },
    output: sinkOutput({
      info: (message) => {
        kept.info.push(message);
      },
      warn: (message) => {
        kept.warn.push(message);
      },
    }),
  };
  return { seams, kept };
}

/** The `CommandExit` a call threw, or the failure of one that did not. */
async function refusal(run: () => Promise<unknown>): Promise<CommandExit> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('expected a CommandExit, and the call answered instead');
}

describe('resolveAndClaim on a claim that lands', () => {
  it('claims the resolved issue with its spec, stub and labels, and prints the claim', async () => {
    const { seams, kept } = planted([specResolution(20)], [claimedOn(20)]);

    const route = await resolveAndClaim(seams);

    expect(route.outcome).toBe('spec');
    expect(route.outcome === 'spec'
      ? route.stub
      : null).toBe('rafa-20-issue');
    expect(kept.requests).toEqual([{ issue: 20, specPath: '.rafa/specs/rafa-20-issue.md', stub: 'rafa-20-issue', labels: LABELS }]);
    expect(kept.info).toEqual([claimedLine(claimedOn(20) as Extract<PlanClaim, { outcome: 'claimed' }>)]);
    expect(kept.info[0]).toBe(`🔒 Claimed #20 on feat/rafa-20-issue for store ${OWN_STORE}.`);
    expect(kept.warn).toEqual([]);
    expect(kept.passOvers).toEqual([new Map()]);
  });

  it('prints the warnings a claim carries, a label that was not written among them', async () => {
    const { seams, kept } = planted([specResolution(20)], [claimedOn(20, 'claim', ['claim labels: #20 was not labelled'])]);

    await resolveAndClaim(seams);

    expect(kept.warn).toEqual(['⚠️  claim labels: #20 was not labelled']);
  });

  it('prints a claim ahead report after the claim and before the warnings', async () => {
    const ahead: PlanClaim = { ...claimedOn(20, 'claim', ['w']), ahead: { outcome: 'claimed', issue: 21, branch: 'feat/rafa-21-next', via: 'claim' } };
    const other: PlanClaim = {
      ...claimedOn(20),
      ahead: { outcome: 'not-claimed', issue: 30, cause: 'other-board', reason: '#30, the line ahead, was not claimed: board' },
    };
    const landed = planted([specResolution(20)], [ahead]);
    const reported = planted([specResolution(20)], [other]);

    await resolveAndClaim(landed.seams);
    await resolveAndClaim(reported.seams);

    expect(landed.kept.info).toEqual([`🔒 Claimed #20 on feat/rafa-20-issue for store ${OWN_STORE}.`, '🔒 Claimed #21, the line ahead, on feat/rafa-21-next.']);
    expect(landed.kept.warn).toEqual(['⚠️  w']);
    expect(reported.kept.warn).toEqual(['⚠️  Claim ahead: #30, the line ahead, was not claimed: board']);
  });

  it('names a takeover and a claim already held in lines of their own', () => {
    const take = claimedOn(20, 'take') as Extract<PlanClaim, { outcome: 'claimed' }>;
    const held = claimedOn(20, 'held') as Extract<PlanClaim, { outcome: 'claimed' }>;

    expect(claimedLine(take)).toBe(`🔒 Took over the claim on #20: feat/rafa-20-issue now names store ${OWN_STORE}.`);
    expect(claimedLine(held)).toBe(`🔒 #20 is already claimed by this device (store ${OWN_STORE}) on feat/rafa-20-issue.`);
  });

  it('hands a --spec run its null issue and null labels, for the claim to read the issue off the name', async () => {
    const unclaimed: PlanClaim = { outcome: 'unclaimed', issue: null, cause: 'no-issue', reason: 'no issue', pending: null, warnings: [] };
    const { seams, kept } = planted([fileResolution('specs/my-feature.md')], [unclaimed]);

    await resolveAndClaim(seams);

    expect(kept.requests).toEqual([{ issue: null, specPath: 'specs/my-feature.md', stub: 'my-feature', labels: null }]);
  });
});

describe('resolveAndClaim on an unclaimed answer', () => {
  it('answers the spec, so the plan is written, with a warning naming why', async () => {
    const offline: PlanClaim = {
      outcome: 'unclaimed',
      issue: 20,
      cause: 'offline',
      reason: 'the claim on #20 was not pushed: could not read from remote',
      pending: { branch: 'feat/rafa-20-issue', sha: 'abc' },
      warnings: [],
    };
    const { seams, kept } = planted([specResolution(20)], [offline]);

    const route = await resolveAndClaim(seams);

    expect(route.outcome).toBe('spec');
    expect(kept.warn).toEqual(['⚠️  Planning issue #20 unclaimed: the claim on #20 was not pushed: could not read from remote']);
    expect(kept.info).toEqual([]);
  });

  it('prints nothing for a run that names no issue, whose spec has nothing to claim', async () => {
    const unclaimed: PlanClaim = { outcome: 'unclaimed', issue: null, cause: 'no-issue', reason: 'no issue', pending: null, warnings: [] };
    const { seams, kept } = planted([fileResolution('specs/my-feature.md')], [unclaimed]);

    const route = await resolveAndClaim(seams);

    expect(route.outcome).toBe('spec');
    expect(kept.warn).toEqual([]);
    expect(kept.info).toEqual([]);
    expect(unclaimedWarning(unclaimed as Extract<PlanClaim, { outcome: 'unclaimed' }>)).toBeNull();
  });

  it('prints the warning of a store that names no claimant, and the warnings after it', async () => {
    const noStore: PlanClaim = {
      outcome: 'unclaimed',
      issue: 20,
      cause: 'no-store-id',
      reason: 'no claim can name this device. Next safe step: rafa effort move --to=sqlite',
      pending: null,
      warnings: ['feat/rafa-20-issue was left as it was'],
    };
    const { seams, kept } = planted([specResolution(20)], [noStore]);

    await resolveAndClaim(seams);

    expect(kept.warn).toEqual([
      '⚠️  Planning issue #20 unclaimed: no claim can name this device. Next safe step: rafa effort move --to=sqlite',
      '⚠️  feat/rafa-20-issue was left as it was',
    ]);
  });
});

describe('resolveAndClaim on a refused claim', () => {
  it('refuses --issue with exit 1 naming the owner, and resolves nothing more', async () => {
    const { seams, kept } = planted([specResolution(20, 'issue')], [refusedOn(20)]);

    const thrown = await refusal(() => resolveAndClaim(seams));

    expect(thrown.exitCode).toBe(CLAIM_REFUSAL_EXIT);
    expect(CLAIM_REFUSAL_EXIT).toBe(1);
    expect(thrown.message).toBe(claimRefusalMessage(refusedOn(20)));
    expect(thrown.message).toContain(`store ${OTHER_STORE}`);
    expect(kept.passOvers).toHaveLength(1);
    expect(kept.info).toEqual([]);
  });

  it('refuses a --spec naming its issue the same way', async () => {
    const { seams } = planted([specResolution(20, 'spec')], [refusedOn(20)]);

    const thrown = await refusal(() => resolveAndClaim(seams));

    expect(thrown.exitCode).toBe(CLAIM_REFUSAL_EXIT);
  });

  it('passes a refused --next pick over and plans the line the walk picks next', async () => {
    const { seams, kept } = planted([specResolution(20, 'next'), specResolution(33, 'next')], [refusedOn(20), claimedOn(33)]);

    const route = await resolveAndClaim(seams);

    expect(route.outcome === 'spec'
      ? route.spec.issue
      : null).toBe(33);
    expect(kept.passOvers).toEqual([new Map(), new Map([[20, 'feat/rafa-20-issue']])]);
    expect(kept.info[0]).toBe(passedOverLine(refusedOn(20)));
    expect(kept.info[0]).toContain(`store ${OTHER_STORE}`);
    expect(kept.requests.map((request) => request.issue)).toEqual([20, 33]);
  });

  it('keeps every issue passed over in one run, handing the walk all of them', async () => {
    const { seams, kept } = planted(
      [specResolution(20, 'next'), specResolution(33, 'next'), specResolution(34, 'next')],
      [refusedOn(20), refusedOn(33), claimedOn(34)],
    );

    await resolveAndClaim(seams);

    expect(kept.passOvers.at(-1)).toEqual(new Map([[20, 'feat/rafa-20-issue'], [33, 'feat/rafa-33-issue']]));
  });

  it('stops as the walk stops once every line is passed over, claiming nothing more', async () => {
    const { seams, kept } = planted([specResolution(20, 'next'), { outcome: 'stopped', reason: 'exhausted' }], [refusedOn(20)]);

    const route = await resolveAndClaim(seams);

    expect(route).toEqual({ outcome: 'stopped' });
    expect(kept.requests).toHaveLength(1);
  });

  it('throws rather than loop when the walk picks an issue it was told to pass over', async () => {
    const { seams } = planted([specResolution(20, 'next'), specResolution(20, 'next')], [refusedOn(20), refusedOn(20)]);

    let thrown: unknown = null;
    try {
      await resolveAndClaim(seams);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(CommandExit);
    expect((thrown as Error).message).toContain('picked #20 again');
  });
});

describe('resolveAndClaim before the claim', () => {
  it('claims nothing for a resolution that stopped', async () => {
    const { seams, kept } = planted([{ outcome: 'stopped', reason: 'dry-run' }], []);

    expect(await resolveAndClaim(seams)).toEqual({ outcome: 'stopped' });
    expect(kept.requests).toEqual([]);
    expect(kept.prepared).toEqual([]);
  });

  it('claims nothing when a cheap refusal throws first', async () => {
    const { seams, kept } = planted([specResolution(20)], [claimedOn(20)]);
    const refusing: ClaimRouteSeams = {
      ...seams,
      prepare: () => Promise.reject(new CommandExit(1, 'the plan is already there')),
    };

    const thrown = await refusal(() => resolveAndClaim(refusing));

    expect(thrown.message).toBe('the plan is already there');
    expect(kept.requests).toEqual([]);
  });
});

describe('createPlanClaimContext', () => {
  let root = '';

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'rafa-claim-route-'));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('opens no board for a provider that is not gh, and one for gh', () => {
    const none = createPlanClaimContext(root, { prProvider: 'none', store: 'sqlite', claimsStaleAfter: 'disabled', claimsAhead: 'off' });
    const gh = createPlanClaimContext(root, { prProvider: 'gh', store: 'sqlite', claimsStaleAfter: 'disabled', claimsAhead: 'off' });

    expect(none.board).toBeNull();
    expect(gh.board).not.toBeNull();
    expect(none.staleAfter).toBe('disabled');
  });

  it('carries claims.ahead as configured', () => {
    const allow = createPlanClaimContext(root, { prProvider: 'none', store: 'sqlite', claimsStaleAfter: 'disabled', claimsAhead: 'allow' });
    const off = createPlanClaimContext(root, { prProvider: 'none', store: 'sqlite', claimsStaleAfter: 'disabled', claimsAhead: 'off' });

    expect([allow.claimsAhead, off.claimsAhead]).toEqual(['allow', 'off']);
  });

  it('reads the store id under the configured store: an NDJSON store names no claimant', () => {
    const ndjson = createPlanClaimContext(root, { prProvider: 'none', store: 'ndjson', claimsStaleAfter: 'disabled', claimsAhead: 'off' });
    const sqlite = createPlanClaimContext(root, { prProvider: 'none', store: 'sqlite', claimsStaleAfter: 'disabled', claimsAhead: 'off' });

    const fromNdjson = ndjson.readStoreId();
    const fromSqlite = sqlite.readStoreId();

    expect(fromNdjson.ok === false
      ? fromNdjson.cause
      : null).toBe('ndjson');
    expect(fromSqlite.ok === false
      ? fromSqlite.cause
      : null).toBe('absent');
  });
});
