/**
 * Tests for the retarget of a delivered pull request (`pr-retarget.ts`).
 *
 * The provider is the real `gh` adapter over the recorded fake
 * (`pr/gh-fake.ts`), so a case reads which `gh` commands were sent and
 * the base the fake holds afterwards. The pull request a case hands over
 * is the one the adapter's `findOpen` reads back from the fake, as
 * `deliverPullRequest` hands over the one it found. The lines go to
 * plain arrays through the seam, so no case touches the active output.
 *
 * The matching-base case is the control on the other two: the same pull
 * request handed the base it already has sends no `gh pr edit` at all.
 */
import type { PrRetargetSeams } from './pr-retarget.js';
import type { FakePrGh } from '../pr/gh-fake.js';
import type { PullRequests, PullRequestSummary } from '../pr/index.js';

import { describe, expect, it } from 'bun:test';

import { createFakePrGh } from '../pr/gh-fake.js';
import { createGhPullRequests } from '../pr/gh.js';

import { retargetPullRequest } from './pr-retarget.js';

const NUMBER = 627;

const HEAD = 'feat/rafa-628-pr-base';

/** The base the pull request was opened into. */
const OPENED_BASE = 'main';

/** The run's base, as `pr.base` names it. */
const RUN_BASE = 'stretch/1';

/** A fake holding the delivered pull request, opened into {@link OPENED_BASE}, and the provider over it. */
function withDelivered(): { fake: FakePrGh; pulls: PullRequests } {
  const fake = createFakePrGh();
  fake.plant({ number: NUMBER, headRefName: HEAD, baseRefName: OPENED_BASE });
  return { fake, pulls: createGhPullRequests({ gh: fake.run }) };
}

/** The delivered pull request as the adapter reads it back. */
async function delivered(pulls: PullRequests): Promise<PullRequestSummary> {
  const pull = await pulls.findOpen(HEAD);
  if (pull === null) throw new Error(`the fake answered no open pull request for ${HEAD}`);
  return pull;
}

/** Seams over `pulls`, and the lines written at each level. */
function seamsOver(pulls: PullRequests): { seams: PrRetargetSeams; info: string[]; warn: string[] } {
  const info: string[] = [];
  const warn: string[] = [];
  const output = { info: (line: string) => { info.push(line); }, warn: (line: string) => { warn.push(line); } };
  return { seams: { pulls, output }, info, warn };
}

/** The `gh pr edit` commands among what the fake was handed. */
function edits(fake: FakePrGh): readonly (readonly string[])[] {
  return fake.calls().filter((call) => call[0] === 'pr' && call[1] === 'edit');
}

describe('retargetPullRequest', () => {
  it('sends no gh pr edit and prints nothing when the pull request is already into the base', async () => {
    const { fake, pulls } = withDelivered();
    const pull = await delivered(pulls);
    const { seams, info, warn } = seamsOver(pulls);

    const outcome = await retargetPullRequest(pull, OPENED_BASE, seams);

    expect(outcome).toEqual({ kind: 'unchanged' });
    expect(edits(fake)).toEqual([]);
    expect(info).toEqual([]);
    expect(warn).toEqual([]);
  });

  it('edits the base and prints one line naming both bases when they differ', async () => {
    const { fake, pulls } = withDelivered();
    const pull = await delivered(pulls);
    const { seams, info, warn } = seamsOver(pulls);

    const outcome = await retargetPullRequest(pull, RUN_BASE, seams);

    expect(outcome).toEqual({ kind: 'retargeted', from: OPENED_BASE, to: RUN_BASE });
    expect(edits(fake)).toEqual([['pr', 'edit', String(NUMBER), '--base', RUN_BASE]]);
    expect(fake.pull(NUMBER)?.baseRefName).toBe(RUN_BASE);
    expect(info).toEqual([`↪ Retargeted pull request #${String(NUMBER)} from ${OPENED_BASE} to ${RUN_BASE} (pr.base).`]);
    expect(warn).toEqual([]);
  });

  it('prints one warning naming the pull request, both bases and what gh said, and does not throw, when the edit is refused', async () => {
    const { pulls: reader } = withDelivered();
    const pull = await delivered(reader);
    // A fake holding no pull request refuses the edit with the recorded GraphQL answer for an absent number.
    const refusing = createFakePrGh();
    const { seams, info, warn } = seamsOver(createGhPullRequests({ gh: refusing.run }));

    const outcome = await retargetPullRequest(pull, RUN_BASE, seams);

    expect(edits(refusing)).toEqual([['pr', 'edit', String(NUMBER), '--base', RUN_BASE]]);
    expect(outcome).toMatchObject({ kind: 'refused', from: OPENED_BASE, to: RUN_BASE });
    expect(info).toEqual([]);
    expect(warn).toHaveLength(1);
    const [line] = warn;
    expect(line).toContain(`#${String(NUMBER)}`);
    expect(line).toContain(`from ${OPENED_BASE} to ${RUN_BASE}`);
    expect(line).toContain('Could not resolve to a PullRequest with the number of 627');
  });
});
