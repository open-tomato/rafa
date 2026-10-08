/**
 * Tests for `start/forced-draft.ts`: the passed-over section a forced
 * wrap-up writes into its pull request body, and the draft conversion,
 * each read off the `gh` arguments a scripted runner was handed and the
 * calls a pull request double recorded. Every failure is a warning line
 * and never a throw, and a body already holding the section is not
 * written again, the same body without it being the control.
 */
import type { PassedOverTask } from './loop-events.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { PullRequestDetail } from '../pr/index.js';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { bodyWithPassedOver, markForcedDraft, PASSED_OVER_HEADING, passedOverSection } from './forced-draft.js';

/** The two tasks a forced wrap-up passed over. */
const TASKS: readonly PassedOverTask[] = [
  { line: 3, text: 'Check the env file a person writes', strategy: 'jump', reason: 'A person writes it.' },
  { line: 9, text: 'Wire the helper', strategy: 'defer', reason: 'Line 12 writes it.' },
];

/** Lines written at warn level, and at info level. */
let warnings: string[] = [];
let infos: string[] = [];

beforeEach(() => {
  warnings = [];
  infos = [];
  setActiveOutput(sinkOutput({
    warn: (message) => {
      warnings.push(message);
    },
    info: (message) => {
      infos.push(message);
    },
  }));
});

afterEach(() => {
  setActiveOutput(null);
});

/** A runner answering `result` to every command, and the commands it was handed. */
function gh(result: GhResult): { run: GhRunner; sent: (readonly string[])[] } {
  const sent: (readonly string[])[] = [];
  return {
    run: (args) => {
      sent.push([...args]);
      return Promise.resolve(result);
    },
    sent,
  };
}

/** A pull request detail holding `body`. */
function detail(body: string): PullRequestDetail {
  return { body } as PullRequestDetail;
}

describe('passedOverSection', () => {
  it('lists each task with its line, strategy and reason under the heading', () => {
    const section = passedOverSection(TASKS);

    expect(section.startsWith(PASSED_OVER_HEADING)).toBe(true);
    expect(section).toContain('- line 3 (jump): Check the env file a person writes. A person writes it.');
    expect(section).toContain('- line 9 (defer): Wire the helper. Line 12 writes it.');
  });
});

describe('bodyWithPassedOver', () => {
  it('appends the section to a body that lacks it, and leaves one that holds it', () => {
    const appended = bodyWithPassedOver('Closes #12', TASKS);

    expect(appended.startsWith('Closes #12\n\n')).toBe(true);
    expect(appended).toContain(PASSED_OVER_HEADING);
    expect(bodyWithPassedOver(appended, TASKS)).toBe(appended);
  });
});

describe('markForcedDraft', () => {
  it('converts the pull request to a draft and writes the section into its body', async () => {
    const runner = gh({ ok: true, stdout: '', stderr: '' });
    const double = createPullRequestsDouble({
      get: () => Promise.resolve(detail('Closes #12')),
      editBody: () => Promise.resolve(),
    });

    await markForcedDraft(41, TASKS, { gh: runner.run, pulls: double.pulls });

    expect(runner.sent).toEqual([['pr', 'ready', '41', '--undo']]);
    expect(double.calls().map((call) => [call.member, call.args[0]])).toEqual([['get', 41], ['editBody', 41]]);
    expect(String(double.calls()[1]?.args[1])).toContain(PASSED_OVER_HEADING);
    expect(warnings).toEqual([]);
    expect(infos.join('\n')).toContain('#41 is a draft');
  });

  it('writes no body that already holds the section', async () => {
    const double = createPullRequestsDouble({ get: () => Promise.resolve(detail(bodyWithPassedOver('Closes #12', TASKS))) });

    await markForcedDraft(41, TASKS, { gh: gh({ ok: true, stdout: '', stderr: '' }).run, pulls: double.pulls });

    expect(double.calls().map((call) => call.member)).toEqual(['get']);
  });

  it('warns, never throws, when gh refuses the draft or the body cannot be read', async () => {
    const double = createPullRequestsDouble({});

    await markForcedDraft(41, TASKS, { gh: gh({ ok: false, stdout: '', stderr: 'draft pull requests are not supported' }).run, pulls: double.pulls });

    expect(warnings.join('\n')).toContain('draft pull requests are not supported');
    expect(warnings.join('\n')).toContain('gh pr ready 41 --undo');
    expect(warnings.join('\n')).toContain('could not write the passed-over tasks');
  });
});
