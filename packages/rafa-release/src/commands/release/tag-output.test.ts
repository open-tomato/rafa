import type { ReleaseStep } from './step-cases.js';

import { describe, expect, it } from 'bun:test';

import { RELEASE_TAG_USAGE, refusal } from './tag-output.js';

/** The step of a tagged refusal, placed at the project root. */
const STATUS_STEP: ReleaseStep = {
  command: 'rafa release status',
  why: 'shows the version file, the changelog and the tags side by side',
  case: 'tag-tagged',
};

/** A step no refusal reason gave. */
const WORKSPACES_STEP: ReleaseStep = {
  command: 'check the workspaces field of package.json',
  why: 'the packages are read from it',
  case: null,
};

describe('the refusal of rafa release tag', () => {
  it('prints each sentence, the steps under Next:, and the usage, with no skill line by default', () => {
    expect(refusal(['v1.2.0 already names 1.2.0'], [STATUS_STEP]).message).toBe([
      '❌ v1.2.0 already names 1.2.0',
      'Next:',
      '  rafa release status — shows the version file, the changelog and the tags side by side',
      `Usage: ${RELEASE_TAG_USAGE}`,
    ].join('\n'));
  });

  it('follows a step with a case by its skill line under hints.skills, and a step with none by nothing', () => {
    expect(refusal(['refused'], [STATUS_STEP, WORKSPACES_STEP], true).message).toBe([
      '❌ refused',
      'Next:',
      '  rafa release status — shows the version file, the changelog and the tags side by side',
      '    skill: rafa-release › tag-tagged',
      '  check the workspaces field of package.json — the packages are read from it',
      `Usage: ${RELEASE_TAG_USAGE}`,
    ].join('\n'));
  });

  it('prints a step two refused units gave once, and no Next: heading over no steps', () => {
    const twice = refusal(['a', 'a', 'b'], [STATUS_STEP, STATUS_STEP], true).message.split('\n');

    expect(twice.filter((line) => line.startsWith('  rafa release status'))).toHaveLength(1);
    expect(twice.filter((line) => line.startsWith('❌'))).toEqual(['❌ a', '❌ b']);
    expect(refusal(['refused']).message).toBe(`❌ refused\nUsage: ${RELEASE_TAG_USAGE}`);
  });

  it('exits 1', () => {
    expect(refusal(['refused']).exitCode).toBe(1);
  });
});
