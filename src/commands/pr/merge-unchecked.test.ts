/**
 * Tests for the unchecked half of `rafa pr merge --skip-checks`
 * (`src/commands/pr/merge-unchecked.ts`): the workflow count read, the
 * two refusals it decides, the warning and the question, and the comment
 * posted after the merge.
 *
 * Every case drives the port double (`src/pr/pull-requests-double.ts`)
 * and a prompter of its own that records each question, so "asked
 * nothing" and "posted nothing" are readings off what was recorded, not
 * inferences from a message. The way this module passes while wrong is by
 * letting `--yes` answer where workflows exist or an unreadable count
 * says they may, so every refusal case has a control beside it — the same
 * call with the count reading zero — that proves the refusal is
 * conditional rather than unconditional.
 */
import type { UncheckedMerge, UncheckedMergeOptions } from './merge-unchecked.js';
import type { PullRequestComment } from '../../pr/index.js';
import type { Prompter } from '../../project/root-choice.js';

import { describe, expect, it } from 'bun:test';

import { CommandExit } from '../../cli/command.js';
import { createPullRequestsDouble } from '../../pr/pull-requests-double.js';
import {
  NO_WORKFLOW_WARNING,
  UNCHECKED_MERGE_SENTENCE,
  WORKFLOWS_EXIST_WARNING,
} from '../../pr/unchecked.js';

import {
  commentProblemLine,
  confirmUncheckedMerge,
  postUncheckedComment,
  readUncheckedMerge,
} from './merge-unchecked.js';

/** The summary line every case merges under. */
const SUMMARY = '#86 Merge with no checks — feat/ci-gate → main — squash';

/** A double answering the workflow count alone, with `count`. */
function countingDouble(count: number | null): ReturnType<typeof createPullRequestsDouble> {
  return createPullRequestsDouble({ workflowCount: () => Promise.resolve(count) });
}

/** The options every read is handed, with `count`, `--yes` and a terminal chosen per case. */
function readOptions(
  count: number | null,
  yes: boolean,
  terminal: boolean,
): { options: UncheckedMergeOptions; double: ReturnType<typeof createPullRequestsDouble> } {
  const double = countingDouble(count);
  return {
    double,
    options: { pulls: double.pulls, number: 86, yes, summary: SUMMARY, isTerminal: () => terminal },
  };
}

/** Awaits `work` and answers the `CommandExit` it rejected with; fails when it resolved or threw anything else. */
async function refusalOf(work: Promise<unknown>): Promise<CommandExit> {
  try {
    await work;
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('expected a refusal, and it resolved');
}

/** A prompter answering `answer` to every question, recording each question and each close. */
function recordingPrompter(answer: string | null): {
  open: () => Prompter;
  asked: () => readonly string[];
  closed: () => number;
} {
  const asked: string[] = [];
  let closed = 0;
  const prompter: Prompter = {
    say: () => undefined,
    ask: (question: string) => {
      asked.push(question);
      return Promise.resolve(answer);
    },
    close: () => {
      closed += 1;
    },
  };
  return { open: () => prompter, asked: () => asked, closed: () => closed };
}

/** A warn sink keeping every line. */
function sink(): { warn: (message: string) => void; lines: () => readonly string[] } {
  const lines: string[] = [];
  return { warn: (message: string): void => void lines.push(message), lines: () => lines };
}

/** An unchecked merge read over `count`, allowed past both refusals on a terminal. */
async function allowed(count: number | null, yes: boolean): Promise<UncheckedMerge> {
  return readUncheckedMerge(readOptions(count, yes, true).options);
}

/** The comment the double answers once posted. */
function posted(body: string): PullRequestComment {
  return {
    id: '901',
    author: { login: 'rafa-bot', isBot: false },
    body,
    updatedAt: '2026-09-22T10:00:00Z',
    url: 'https://github.com/open-tomato/rafa/pull/86#issuecomment-901',
  };
}

describe('readUncheckedMerge', () => {
  it('reads the workflow count once and answers the no-workflow reading for zero', async () => {
    const { options, double } = readOptions(0, true, false);

    const unchecked = await readUncheckedMerge(options);

    expect(double.sent()).toEqual(['workflowCount']);
    expect(unchecked.workflowCount).toBe(0);
    expect(unchecked.reading.case).toBe('no-workflow');
    expect(unchecked.yes).toBe(true);
  });

  it('refuses --yes with exit 1 where one workflow exists, naming the count and the warning', async () => {
    const { options } = readOptions(1, true, true);

    const refused = await refusalOf(readUncheckedMerge(options));

    expect(refused.exitCode).toBe(1);
    expect(refused.message).toContain('refuses --yes for #86 with no checks');
    expect(refused.message).toContain('The repository defines 1 workflow.');
    expect(refused.message).toContain(WORKFLOWS_EXIST_WARNING);
    expect(refused.message).toContain(SUMMARY);
    expect(refused.message).toContain('a person has to answer');
  });

  it('refuses --yes where the count could not be read, the riskier reading', async () => {
    const { options } = readOptions(null, true, true);

    const refused = await refusalOf(readUncheckedMerge(options));

    expect(refused.exitCode).toBe(1);
    expect(refused.message).toContain('The repository\'s workflow count could not be read.');
    expect(refused.message).toContain(WORKFLOWS_EXIST_WARNING);
  });

  it('reads a provider that threw as an unreadable count, and so refuses --yes', async () => {
    const double = createPullRequestsDouble({ workflowCount: () => Promise.reject(new Error('gh is gone')) });

    const refused = await refusalOf(readUncheckedMerge({
      pulls: double.pulls,
      number: 86,
      yes: true,
      summary: SUMMARY,
      isTerminal: () => true,
    }));

    expect(refused.exitCode).toBe(1);
    expect(refused.message).toContain('could not be read');
  });

  it('refuses --yes even on a terminal: the refusal is of what was typed', async () => {
    const onTerminal = await refusalOf(readUncheckedMerge(readOptions(3, true, true).options));
    const offTerminal = await refusalOf(readUncheckedMerge(readOptions(3, true, false).options));

    expect(onTerminal.message).toContain('refuses --yes');
    expect(offTerminal.message).toContain('refuses --yes');
  });

  it('refuses no terminal and no --yes with exit 1, pointing at --yes only where it may answer', async () => {
    const none = await refusalOf(readUncheckedMerge(readOptions(0, false, false).options));
    const some = await refusalOf(readUncheckedMerge(readOptions(2, false, false).options));

    expect(none.exitCode).toBe(1);
    expect(none.message).toContain('standard input is no terminal');
    expect(none.message).toContain(NO_WORKFLOW_WARNING);
    expect(none.message).toContain('Merge it without the question with --yes.');

    expect(some.exitCode).toBe(1);
    expect(some.message).toContain('standard input is no terminal');
    expect(some.message).toContain('The repository defines 2 workflows.');
    expect(some.message).toContain('--yes is refused here');
    expect(some.message).not.toContain('Merge it without the question with --yes.');
  });

  it('allows a terminal without --yes in both cases', async () => {
    const none = await allowed(0, false);
    const some = await allowed(4, false);

    expect(none.reading.case).toBe('no-workflow');
    expect(some.reading.case).toBe('workflows-exist');
    expect(some.workflowCount).toBe(4);
  });
});

describe('confirmUncheckedMerge', () => {
  it('prints the count line and the warning and asks nothing where --yes answered', async () => {
    const unchecked = await allowed(0, true);
    const prompter = recordingPrompter('n');
    const warnings = sink();

    const merge = await confirmUncheckedMerge(unchecked, { warn: warnings.warn, openPrompter: prompter.open });

    expect(merge).toBe(true);
    expect(warnings.lines()).toEqual(['The repository defines 0 workflows.', NO_WORKFLOW_WARNING]);
    expect(prompter.asked()).toEqual([]);
  });

  it('prints the warning and then asks the question, merging on y', async () => {
    const unchecked = await allowed(1, false);
    const prompter = recordingPrompter('y');
    const warnings = sink();

    const merge = await confirmUncheckedMerge(unchecked, { warn: warnings.warn, openPrompter: prompter.open });

    expect(merge).toBe(true);
    expect(warnings.lines()).toEqual(['The repository defines 1 workflow.', WORKFLOWS_EXIST_WARNING]);
    expect(prompter.asked()).toEqual(['Merge #86 with no checks? [y/N] ']);
    expect(prompter.closed()).toBe(1);
  });

  it('reads YES padded as yes, and the empty answer, n and an ended input as no', async () => {
    const answers: readonly (string | null)[] = ['  YES ', '', 'n', 'nope', null];
    const unchecked = await allowed(0, false);

    const read: boolean[] = [];
    for (const answer of answers) {
      const prompter = recordingPrompter(answer);
      read.push(await confirmUncheckedMerge(unchecked, { warn: () => undefined, openPrompter: prompter.open }));
    }

    expect(read).toEqual([true, false, false, false, false]);
  });

  it('closes the prompter when asking throws', async () => {
    const unchecked = await allowed(0, false);
    let closed = 0;
    const prompter: Prompter = {
      say: () => undefined,
      ask: () => Promise.reject(new Error('input broke')),
      close: () => {
        closed += 1;
      },
    };

    const failed = confirmUncheckedMerge(unchecked, { warn: () => undefined, openPrompter: () => prompter });

    await expect(failed).rejects.toThrow('input broke');
    expect(closed).toBe(1);
  });
});

describe('postUncheckedComment', () => {
  it('posts one comment: the unchecked sentence, then the workflow count read', async () => {
    const unchecked = await allowed(0, true);
    const double = createPullRequestsDouble({
      comment: (_number: number, body: string) => Promise.resolve(posted(body)),
    });
    const warnings = sink();

    const comment = await postUncheckedComment(double.pulls, 86, unchecked, warnings.warn);

    expect(double.calls().map((call) => call.member)).toEqual(['comment']);
    expect(double.calls()[0]?.args).toEqual([86, `${UNCHECKED_MERGE_SENTENCE}\n\nThe repository defines 0 workflows.`]);
    expect(comment?.id).toBe('901');
    expect(warnings.lines()).toEqual([]);
  });

  it('carries the count it read into the comment where workflows exist', async () => {
    const unchecked = await allowed(2, false);
    const double = createPullRequestsDouble({
      comment: (_number: number, body: string) => Promise.resolve(posted(body)),
    });

    await postUncheckedComment(double.pulls, 86, unchecked, () => undefined);

    expect(double.calls()[0]?.args[1]).toBe(`${UNCHECKED_MERGE_SENTENCE}\n\nThe repository defines 2 workflows.`);
  });

  it('warns rather than throws where the comment would not post, carrying the body to paste', async () => {
    const unchecked = await allowed(null, false);
    const double = createPullRequestsDouble({ comment: () => Promise.reject(new Error('HTTP 403')) });
    const warnings = sink();

    const comment = await postUncheckedComment(double.pulls, 86, unchecked, warnings.warn);

    expect(comment).toBeNull();
    expect(warnings.lines()).toEqual([
      commentProblemLine(86, 'HTTP 403', `${UNCHECKED_MERGE_SENTENCE}\n\nThe repository's workflow count could not be read.`),
    ]);
    expect(warnings.lines()[0]).toContain(`   ${UNCHECKED_MERGE_SENTENCE}`);
  });
});
