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
 *
 * The base's workflow files are read through a git runner of each
 * case's own that answers planted argv lines and records every one, so
 * "read no file" is a reading off its log. Each case letting `--yes`
 * through on what the files said sits beside the same files read for a
 * base they DO name, and every git failure beside the success it
 * replaces, so a reader that relaxed the rule on anything would redden.
 */
import type { UncheckedMerge, UncheckedMergeOptions } from './merge-unchecked.js';
import type { Prompter } from '../../cli/prompt/confirm.js';
import type { GitResult, GitRunner, PullRequestComment } from '../../pr/index.js';

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
  readBaseWorkflows,
  readUncheckedMerge,
  workflowBlobsOf,
} from './merge-unchecked.js';

/** The summary line every case merges under. */
const SUMMARY = '#86 Merge with no checks — feat/ci-gate → main — squash';

/** A base no workflow tests pull requests into, as `verify.yml` leaves `stretch/1`. */
const STRETCH = 'stretch/1';

/** The line the no-pull-request-workflow case prints for {@link STRETCH}. */
const STRETCH_LINE = 'no workflow runs on pull requests into stretch/1';

/** A workflow running on pull requests into `main` and on pushes to `stretch/**`, as `verify.yml` does. */
const VERIFY_YML = [
  'name: verify',
  'on:',
  '  pull_request:',
  '    branches:',
  '      - main',
  '  push:',
  '    branches:',
  '      - \'stretch/**\'',
  'jobs:',
  '  verify:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: bun test',
  '',
].join('\n');

/** The object id {@link VERIFY_YML} is listed under. */
const VERIFY_OID = '5003747ae06e6f49f5b3ee77d83106acd6e86876';

/** A git answer that worked, carrying `stdout`. */
function ok(stdout = ''): GitResult {
  return { ok: true, stdout, stderr: '' };
}

/** A git answer that failed, carrying `stderr`. */
function failed(stderr: string): GitResult {
  return { ok: false, stdout: '', stderr };
}

/** One `git ls-tree -z` entry, NUL-ended. */
function treeEntry(type: string, oid: string, path: string): string {
  const mode = type === 'tree'
    ? '040000'
    : '100644';
  return `${mode} ${type} ${oid}\t${path}\0`;
}

/** The git answers of a base `base` carrying {@link VERIFY_YML} alone, with `over` replacing any. */
function verifyAnswers(base: string, over: Readonly<Record<string, GitResult>> = {}): Record<string, GitResult> {
  return {
    [`fetch origin ${base}`]: ok(),
    [`ls-tree --full-tree -z origin/${base} .github/workflows/`]: ok(treeEntry('blob', VERIFY_OID, '.github/workflows/verify.yml')),
    [`cat-file blob ${VERIFY_OID}`]: ok(VERIFY_YML),
    ...over,
  };
}

/** A git runner answering planted argv lines (anything else fails), and the log of every line it was handed. */
function plantedGit(answers: Readonly<Record<string, GitResult>>): { git: GitRunner; ran: () => readonly string[] } {
  const ran: string[] = [];
  return {
    git: (args) => {
      const line = args.join(' ');
      ran.push(line);
      return answers[line] ?? failed(`no answer planted for git ${line}`);
    },
    ran: () => [...ran],
  };
}

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

describe('workflowBlobsOf', () => {
  it('keeps the *.yml and *.yaml blobs, and drops trees, submodules and other endings', () => {
    const listing = [
      treeEntry('blob', 'aaa111', '.github/workflows/verify.yml'),
      treeEntry('blob', 'bbb222', '.github/workflows/release.yaml'),
      treeEntry('blob', 'ccc333', '.github/workflows/README.md'),
      treeEntry('tree', 'ddd444', '.github/workflows/nested.yml'),
      '160000 commit eee555\t.github/workflows/vendored.yml\0',
    ].join('');

    expect(workflowBlobsOf(listing)).toEqual(['aaa111', 'bbb222']);
  });

  it('reads an empty listing as no blob', () => {
    expect(workflowBlobsOf('')).toEqual([]);
  });
});

describe('readBaseWorkflows', () => {
  it('fetches the base, lists its workflows and reads each, answering that none runs on pull requests into stretch/1', () => {
    const git = plantedGit(verifyAnswers(STRETCH));

    const read = readBaseWorkflows(git.git, STRETCH);

    expect(read).toEqual({ base: STRETCH, runsOnPullRequests: false });
    expect(git.ran()).toEqual([
      `fetch origin ${STRETCH}`,
      `ls-tree --full-tree -z origin/${STRETCH} .github/workflows/`,
      `cat-file blob ${VERIFY_OID}`,
    ]);
  });

  it('answers that the same file runs on pull requests into main, the control on the case above', () => {
    const read = readBaseWorkflows(plantedGit(verifyAnswers('main')).git, 'main');

    expect(read).toEqual({ base: 'main', runsOnPullRequests: true });
  });

  it('answers null where the fetch fails, and reads nothing past it', () => {
    const git = plantedGit(verifyAnswers(STRETCH, { [`fetch origin ${STRETCH}`]: failed('fatal: couldn\'t find remote ref') }));

    expect(readBaseWorkflows(git.git, STRETCH)).toBeNull();
    expect(git.ran()).toEqual([`fetch origin ${STRETCH}`]);
  });

  it('answers null where the listing fails', () => {
    const over = { [`ls-tree --full-tree -z origin/${STRETCH} .github/workflows/`]: failed('fatal: Not a valid object name') };

    expect(readBaseWorkflows(plantedGit(verifyAnswers(STRETCH, over)).git, STRETCH)).toBeNull();
  });

  it('answers null where a file will not read', () => {
    const over = { [`cat-file blob ${VERIFY_OID}`]: failed('fatal: bad file') };

    expect(readBaseWorkflows(plantedGit(verifyAnswers(STRETCH, over)).git, STRETCH)).toBeNull();
  });

  it('answers null for a base with no workflow file, which workflows the files cannot show may still test', () => {
    const over = { [`ls-tree --full-tree -z origin/${STRETCH} .github/workflows/`]: ok('') };

    expect(readBaseWorkflows(plantedGit(verifyAnswers(STRETCH, over)).git, STRETCH)).toBeNull();
  });

  it('answers null for a base git would read as an option, running nothing', () => {
    const git = plantedGit(verifyAnswers('--upload-pack=x'));

    expect(readBaseWorkflows(git.git, '--upload-pack=x')).toBeNull();
    expect(readBaseWorkflows(git.git, '')).toBeNull();
    expect(git.ran()).toEqual([]);
  });

  it('reads every file, and answers that one runs on pull requests into the base where any does', () => {
    const listing = treeEntry('blob', VERIFY_OID, '.github/workflows/verify.yml')
      + treeEntry('blob', 'fff666', '.github/workflows/lint.yaml');
    const git = plantedGit(verifyAnswers(STRETCH, {
      [`ls-tree --full-tree -z origin/${STRETCH} .github/workflows/`]: ok(listing),
      'cat-file blob fff666': ok('on: pull_request\njobs: {}\n'),
    }));

    expect(readBaseWorkflows(git.git, STRETCH)).toEqual({ base: STRETCH, runsOnPullRequests: true });
    expect(git.ran()).toContain('cat-file blob fff666');
  });
});

describe('readUncheckedMerge over the base\'s workflow files', () => {
  /** The options of a read with `count`, `--yes`, a terminal, and `base` read through `git`. */
  function baseOptions(count: number | null, yes: boolean, base: string, git: GitRunner): UncheckedMergeOptions {
    return { ...readOptions(count, yes, true).options, base, git };
  }

  it('lets --yes answer where workflows exist and none runs on pull requests into the base, naming why', async () => {
    const git = plantedGit(verifyAnswers(STRETCH));

    const unchecked = await readUncheckedMerge(baseOptions(1, true, STRETCH, git.git));

    expect(unchecked.reading.case).toBe('no-pull-request-workflow');
    expect(unchecked.reading.yesMayAnswer).toBe(true);
    expect(unchecked.reading.warning).toEqual(['The repository defines 1 workflow.', STRETCH_LINE]);
    expect(unchecked.baseWorkflows).toEqual({ base: STRETCH, runsOnPullRequests: false });
    expect(git.ran()).toContain(`fetch origin ${STRETCH}`);
  });

  it('refuses --yes where the same file runs on pull requests into the base, the control on the case above', async () => {
    const git = plantedGit(verifyAnswers('main'));

    const refused = await refusalOf(readUncheckedMerge(baseOptions(1, true, 'main', git.git)));

    expect(refused.exitCode).toBe(1);
    expect(refused.message).toContain(WORKFLOWS_EXIST_WARNING);
    expect(refused.message).not.toContain('no workflow runs on pull requests');
  });

  it('falls back to the count rule and refuses --yes where the fetch fails', async () => {
    const git = plantedGit(verifyAnswers(STRETCH, { [`fetch origin ${STRETCH}`]: failed('fatal: unable to access') }));

    const refused = await refusalOf(readUncheckedMerge(baseOptions(1, true, STRETCH, git.git)));

    expect(refused.message).toContain(WORKFLOWS_EXIST_WARNING);
  });

  it('refuses --yes for an unreadable count without reading the files at all', async () => {
    const git = plantedGit(verifyAnswers(STRETCH));

    const refused = await refusalOf(readUncheckedMerge(baseOptions(null, true, STRETCH, git.git)));

    expect(refused.message).toContain('could not be read');
    expect(git.ran()).toEqual([]);
  });

  it('reads no file for a count of zero, which already lets --yes answer', async () => {
    const git = plantedGit(verifyAnswers(STRETCH));

    const unchecked = await readUncheckedMerge(baseOptions(0, true, STRETCH, git.git));

    expect(unchecked.reading.case).toBe('no-workflow');
    expect(unchecked.baseWorkflows).toBeNull();
    expect(git.ran()).toEqual([]);
  });

  it('points at --yes in the no-terminal refusal of the third case', async () => {
    const git = plantedGit(verifyAnswers(STRETCH));
    const options = { ...baseOptions(2, false, STRETCH, git.git), isTerminal: () => false };

    const refused = await refusalOf(readUncheckedMerge(options));

    expect(refused.message).toContain(STRETCH_LINE);
    expect(refused.message).toContain('Merge it without the question with --yes.');
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

  it('carries the base line into the comment in the no-pull-request-workflow case', async () => {
    const unchecked = await readUncheckedMerge({
      ...readOptions(1, true, true).options,
      base: STRETCH,
      git: plantedGit(verifyAnswers(STRETCH)).git,
    });
    const double = createPullRequestsDouble({
      comment: (_number: number, body: string) => Promise.resolve(posted(body)),
    });

    await postUncheckedComment(double.pulls, 86, unchecked, () => undefined);

    expect(double.calls()[0]?.args[1]).toBe(
      `${UNCHECKED_MERGE_SENTENCE}\n\nThe repository defines 1 workflow.\n\n${STRETCH_LINE}`,
    );
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
