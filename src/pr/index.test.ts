/**
 * Tests for the pull request barrel (`src/pr/index.ts`).
 *
 * A barrel has no behaviour of its own, so what is held here is that
 * every name it answers is the SAME binding its owning module exports,
 * and that the test helpers are not among them. Identity is the reading
 * that matters: a barrel re-exporting a look-alike, or a later edit
 * pointing a name at another module, passes a presence check and fails
 * these.
 *
 * Two mutations were driven on 2026-09-18, the barrel restored
 * sha256-identical after each. `parseChecks` re-exported as `verdictOf`
 * reddened the checks-readers case and nothing else. `ghAuthOkIn`
 * dropped from the export list reddened the gh-adapter case here — bun
 * transpiles without type-checking, so the missing name reads as
 * `undefined` rather than as an error — and `tsc --noEmit` reported it
 * at the import in `src/start/pr-lifecycle.ts` (TS2724).
 */
import { describe, expect, it } from 'bun:test';

import * as checks from './checks.js';
import * as gh from './gh.js';
import * as preflightItems from './preflight-items.js';
import * as provider from './provider.js';
import * as types from './types.js';

import * as barrel from './index.js';

describe('the pull request barrel', () => {
  it('answers the check-row readers of ./checks.js themselves', () => {
    expect(barrel.classifyState).toBe(checks.classifyState);
    expect(barrel.failingRows).toBe(checks.failingRows);
    expect(barrel.formatRows).toBe(checks.formatRows);
    expect(barrel.parseChecks).toBe(checks.parseChecks);
    expect(barrel.verdictOf).toBe(checks.verdictOf);
    expect(barrel.waitForChecks).toBe(checks.waitForChecks);
  });

  it('answers the port values of ./types.js themselves', () => {
    expect(barrel.MERGE_METHODS).toBe(types.MERGE_METHODS);
    expect(barrel.isMergeMethod).toBe(types.isMergeMethod);
  });

  it('answers the gh adapter of ./gh.js itself', () => {
    expect(barrel.createGhPullRequests).toBe(gh.createGhPullRequests);
    expect(barrel.ghAuthOk).toBe(gh.ghAuthOk);
    expect(barrel.ghAuthOkIn).toBe(gh.ghAuthOkIn);
    expect(barrel.ghPullRequestsIn).toBe(gh.ghPullRequestsIn);
  });

  it('answers the provider readers of ./provider.js themselves', () => {
    expect(barrel.isGitHubRemote).toBe(provider.isGitHubRemote);
    expect(barrel.PR_NEEDS_GH).toBe(provider.PR_NEEDS_GH);
    expect(barrel.PR_REFUSAL_EXIT).toBe(provider.PR_REFUSAL_EXIT);
    expect(barrel.remoteHost).toBe(provider.remoteHost);
    expect(barrel.requireGhProvider).toBe(provider.requireGhProvider);
    expect(barrel.resolvePrProvider).toBe(provider.resolvePrProvider);
  });

  it('answers the preflight item builders of ./preflight-items.js themselves', () => {
    expect(barrel.DEFAULT_GH_HOST).toBe(preflightItems.DEFAULT_GH_HOST);
    expect(barrel.GH_INSTALL_LINE).toBe(preflightItems.GH_INSTALL_LINE);
    expect(barrel.ghAuthItem).toBe(preflightItems.ghAuthItem);
    expect(barrel.ghAuthLine).toBe(preflightItems.ghAuthLine);
    expect(barrel.ghHostOf).toBe(preflightItems.ghHostOf);
    expect(barrel.ghOnPathItem).toBe(preflightItems.ghOnPathItem);
    expect(barrel.ghPreflightItems).toBe(preflightItems.ghPreflightItems);
  });

  it('keeps the recorded fake out of the import graph of the loop', () => {
    expect(Object.keys(barrel)).not.toContain('createFakePrGh');
    expect(Object.keys(barrel)).not.toContain('logFailedText');
  });
});
