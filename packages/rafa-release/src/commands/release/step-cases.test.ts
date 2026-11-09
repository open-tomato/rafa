import type { ReleaseStep } from './step-cases.js';

import { describe, expect, it } from 'bun:test';

import { caseOf, RELEASE_CASES, renderNextSteps, stepEntry } from './step-cases.js';

/** The step of a branch refusal run from a linked worktree. */
const BRANCH_STEP: ReleaseStep = {
  command: 'cd /repo && rafa release tag',
  why: 'integration is checked out there',
  case: caseOf('branch'),
};

/** A follow-up of a run that tagged, which no refusal or outcome gave. */
const PUSH_STEP: ReleaseStep = {
  command: 'git push origin v1.2.0',
  why: 'the tag is local until origin has it',
  case: null,
};

describe('the release case table', () => {
  it('names one case per tag refusal reason and settle outcome, each spelled by its action', () => {
    expect(RELEASE_CASES).toEqual({
      branch: 'tag-branch',
      behind: 'tag-behind',
      version: 'tag-version',
      tagged: 'tag-tagged',
      changelog: 'tag-changelog',
      git: 'tag-git',
      receipt: 'tag-receipt',
      push: 'settle-push',
      pr: 'settle-pr',
      nothing: 'settle-nothing',
    });
  });
});

describe('renderNextSteps', () => {
  it('follows a step with a case by its skill line when hints.skills is on', () => {
    expect(renderNextSteps([BRANCH_STEP], true)).toEqual([
      'Next:',
      '  cd /repo && rafa release tag — integration is checked out there',
      '    skill: rafa-release › tag-branch',
    ]);
  });

  it('prints no skill line when hints.skills is off', () => {
    expect(renderNextSteps([BRANCH_STEP], false)).toEqual([
      'Next:',
      '  cd /repo && rafa release tag — integration is checked out there',
    ]);
  });

  it('prints no skill line for a step with no case, even with hints.skills on', () => {
    expect(renderNextSteps([PUSH_STEP, BRANCH_STEP], true)).toEqual([
      'Next:',
      '  git push origin v1.2.0 — the tag is local until origin has it',
      '  cd /repo && rafa release tag — integration is checked out there',
      '    skill: rafa-release › tag-branch',
    ]);
  });

  it('gives no lines, the heading included, for no steps', () => {
    expect(renderNextSteps([], true)).toEqual([]);
  });
});

describe('stepEntry', () => {
  it('carries the skill reference under hints.skills on, null when off or with no case', () => {
    expect(stepEntry(BRANCH_STEP, true)).toEqual({ ...BRANCH_STEP, skill: 'rafa-release › tag-branch' });
    expect(stepEntry(BRANCH_STEP, false)).toEqual({ ...BRANCH_STEP, skill: null });
    expect(stepEntry(PUSH_STEP, true)).toEqual({ ...PUSH_STEP, skill: null });
  });
});
