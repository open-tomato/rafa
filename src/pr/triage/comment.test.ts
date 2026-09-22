/**
 * Tests for the triage comment (`src/pr/triage/comment.ts`): the body
 * one assessment is written into, the block read back out of it, and the
 * post-or-edit that keeps one triage comment per pull request.
 *
 * The body half is pure — an input in, a string out — so those cases are
 * direct calls over literals. The write half goes through the real `gh`
 * adapter over the strict recorded fake (`../gh-fake.ts`), so every
 * command it sends is checked against a modelled `gh` invocation and
 * nothing here spawns a process or reaches GitHub.
 *
 * Three readings carry a control, because each could pass while wrong:
 *
 *   - The ROUND TRIP is the point of the module, so it is measured over
 *     a head that YAML would retype: a sha of digits alone reads back as
 *     the text that was written, and the control is the same block with
 *     its quotes stripped, which the reader refuses. A writer that
 *     stopped quoting would pass one and fail the other.
 *   - The EDIT is what "one comment per pull request, history in its
 *     edits" comes to, so its case asserts the pull request still holds
 *     exactly one comment afterwards, and that its id is the one that
 *     was there. A writer that posted beside the marker would leave two.
 *   - The `<details>` fence is widened by `fencedBlock` because the
 *     follow-up prompt carries fences of its own; the case that asserts
 *     the wider fence is paired with a read-back of the block from the
 *     same body, which is what a spilt fence would break.
 *
 * Six mutations of `comment.ts` were driven on 2026-09-18, one at a
 * time, over this file and `src/commands/pr/last-triage.test.ts`, which
 * reads the same block through this module. 41 pass either side, and the
 * module restored from a scratch copy and verified with `shasum -c`
 * after each. The failure lists are written from the runs:
 *
 *   - `quoted` writing the raw value instead of a JSON string: 5 fail,
 *     every round-trip case, the stripped-quotes control and the edit
 *     case, which reads its block back.
 *   - `writeTriageComment` posting whether or not it found a marker
 *     comment: 2 fail, the edit case and the handed-in-existing case.
 *   - `findTriageComment` taking the FIRST marker comment: 2 fail, the
 *     last-marker case here and its twin in `last-triage.test.ts`, which
 *     is also the reading that the command still delegates to this
 *     module rather than to a reader of its own.
 *   - `readText` coercing a non-string with `String(value)`: 3 fail, the
 *     stripped-quotes control here and both unquoted-head cases in
 *     `last-triage.test.ts`.
 *   - the `<details>` fence fixed at three backticks: 1 fail, the
 *     details case.
 *   - `writeTriageBlock` dropping its `files` line: 3 fail, both
 *     round-trip cases and the field-order case.
 */
import type { TriageAssessment } from './classify.js';
import type { TriageCommentInput } from './comment.js';
import type { FailedLogEvidence, FailedStep } from './evidence.js';
import type { FollowUpPullRequest } from './follow-up.js';
import type { PullRequestComment } from '../types.js';

import { describe, expect, it } from 'bun:test';

import { createFakePrGh } from '../gh-fake.js';
import { createGhPullRequests } from '../gh.js';

import {
  findTriageComment,
  readTriageBlock,
  TRIAGE_BLOCK_FENCE,
  TRIAGE_MARKER,
  triageCommentBody,
  triageComments,
  triageHeadline,
  writeTriageBlock,
  writeTriageComment,
} from './comment.js';

/** The fence a triage block opens with, spelled in parts so this file carries no block of its own. */
const FENCE = '```';

/** A 40-character head of digits alone, which unquoted YAML reads as a number. */
const DIGIT_HEAD = '1234567890123456789012345678901234567890';

/** A pull request, same-repository and red unless a case says otherwise. */
function pull(overrides: Partial<FollowUpPullRequest> = {}): FollowUpPullRequest {
  return {
    number: 21,
    title: 'chore(deps): bump bun-types from 1.3.0 to 1.3.1',
    url: 'https://github.com/open-tomato/rafa/pull/21',
    headRefName: 'dependabot/npm_and_yarn/bun-types-1.3.1',
    baseRefName: 'main',
    headRefOid: '9f2c1ab4e7d0c3b5a6f8091d2e3c4b5a6f708192',
    isCrossRepository: false,
    ...overrides,
  };
}

/** A failing step as the group-marker reading infers one. */
function step(name: string): FailedStep {
  return { name, source: 'group-marker' };
}

/** One assessment, a lockfile conflict unless a case says otherwise. */
function assess(overrides: Partial<TriageAssessment> = {}): TriageAssessment {
  return {
    triageClass: 'conflict-lockfile',
    simple: true,
    dependencyBump: true,
    verdict: 'none',
    conflicting: true,
    files: ['bun.lock'],
    step: undefined,
    failing: [],
    reason: 'the head conflicts with main over bun.lock',
    ...overrides,
  };
}

/** One log reading, already capped. */
function evidenceOf(lines: readonly string[]): FailedLogEvidence {
  return {
    jobs: ['gates'],
    step: step('bun install'),
    lines,
    omitted: 0,
    total: lines.length,
  };
}

/** Everything one comment is written from, filled from `overrides`. */
function input(overrides: Partial<TriageCommentInput> = {}): TriageCommentInput {
  return {
    pr: pull(),
    assessment: assess(),
    at: '2026-09-18T12:00:00Z',
    attempts: 0,
    resolved: false,
    ...overrides,
  };
}

/** A comment as the provider answers one, filled from `over`. */
function comment(over: Partial<PullRequestComment> = {}): PullRequestComment {
  return {
    id: '5000000001',
    author: { login: 'rafa-bot', isBot: false },
    body: 'nothing to do with a triage',
    updatedAt: '2026-09-18T12:00:00Z',
    url: 'https://github.com/open-tomato/rafa/pull/21#issuecomment-5000000001',
    ...over,
  };
}

/** A comment body carrying `block` as its `rafa:triage` block and nothing else. */
function bodyAround(block: string): string {
  return [TRIAGE_MARKER, `${FENCE}${TRIAGE_BLOCK_FENCE}`, block, FENCE, ''].join('\n');
}

/** A provider over an empty repository holding pull request 21. */
function withPull(): { fake: ReturnType<typeof createFakePrGh>; pr: ReturnType<typeof createGhPullRequests> } {
  const fake = createFakePrGh();
  fake.plant({ number: 21 });
  return { fake, pr: createGhPullRequests({ gh: fake.run }) };
}

describe('the block written and read back', () => {
  it('reads back every field that was written, the head of digits included', () => {
    const written = triageCommentBody(input({
      pr: pull({ headRefOid: DIGIT_HEAD }),
      assessment: assess({ files: ['bun.lock', 'package.json'] }),
      attempts: 2,
    }));

    expect(readTriageBlock(written)).toEqual({
      block: {
        head: DIGIT_HEAD,
        at: '2026-09-18T12:00:00Z',
        class: 'conflict-lockfile',
        simple: true,
        attempts: 2,
        files: ['bun.lock', 'package.json'],
      },
      problems: [],
    });
  });

  it('refuses the same block with its quotes stripped, which is the control on the quoting', () => {
    const quoted = writeTriageBlock({
      head: DIGIT_HEAD,
      at: '2026-09-18T12:00:00Z',
      triageClass: 'conflict-lockfile',
      simple: true,
      attempts: 0,
      files: ['bun.lock'],
    });
    const stripped = quoted.replaceAll('"', '');

    expect(readTriageBlock(bodyAround(quoted)).block?.head).toBe(DIGIT_HEAD);
    expect(readTriageBlock(bodyAround(stripped)).problems).toEqual([
      'head is 1.2345678901234568e+39, not text; write it quoted, as head: "..."',
    ]);
  });

  it('round-trips a path holding a quote, a backslash, a hash and a space', () => {
    const files = ['a "quoted" file.json', 'dir\\sub/bun.lock', 'notes # 2.md'];

    const written = triageCommentBody(input({ assessment: assess({ files }) }));

    expect(readTriageBlock(written).block?.files).toEqual(files);
  });

  it('writes the six fields in the order the spec spells them, one to a line', () => {
    const block = writeTriageBlock({
      head: 'deadbeef',
      at: '2026-09-18T12:00:00Z',
      triageClass: 'ci-lint',
      simple: false,
      attempts: 1,
      files: [],
    });

    expect(block.split('\n')).toEqual([
      'head: "deadbeef"',
      'at: "2026-09-18T12:00:00Z"',
      'class: "ci-lint"',
      'simple: false',
      'attempts: 1',
      'files: []',
    ]);
  });
});

describe('a block that cannot be read', () => {
  it('reports a marker comment carrying no block at all', () => {
    const reading = readTriageBlock(`${TRIAGE_MARKER}\n**rafa triage**: it went badly\n`);

    expect(reading.block).toBeNull();
    expect(reading.problems).toEqual([
      `it carries the ${TRIAGE_MARKER} marker and no ${TRIAGE_BLOCK_FENCE} block`,
    ]);
  });

  it('reports a comment cut off inside its block, and still finds the comment', () => {
    const cut = [TRIAGE_MARKER, `${FENCE}${TRIAGE_BLOCK_FENCE}`, 'class: "ci-test"'].join('\n');

    expect(readTriageBlock(cut).problems).toEqual([
      `its ${TRIAGE_BLOCK_FENCE} block was never closed`,
    ]);
    expect(findTriageComment([comment({ body: cut })])?.id).toBe('5000000001');
  });

  it('reports a block that is not valid YAML, quoting what the parser said', () => {
    const problems = readTriageBlock(bodyAround('class: "ci-test\nfiles: [')).problems;

    expect(problems.length).toBe(1);
    expect(problems[0]).toStartWith(`its ${TRIAGE_BLOCK_FENCE} block is not valid YAML (`);
  });

  it('reports a block holding a list, and one holding nothing, rather than a mapping', () => {
    expect(readTriageBlock(bodyAround('- conflict-lockfile')).problems).toEqual([
      `its ${TRIAGE_BLOCK_FENCE} block holds a list, not a mapping of fields`,
    ]);
    expect(readTriageBlock(bodyAround('')).problems).toEqual([
      `its ${TRIAGE_BLOCK_FENCE} block holds null, not a mapping of fields`,
    ]);
  });

  it('names every unusable field at once, and leaves an absent one null with nothing to say', () => {
    const reading = readTriageBlock(bodyAround([
      'head: "deadbeef"',
      'class: ""',
      'simple: "yes"',
      'attempts: -1',
      'files: "bun.lock"',
    ].join('\n')));

    expect(reading.problems).toEqual([
      'class is "", not text with something in it',
      'simple is "yes", not true or false',
      'attempts is -1, not a whole number from 0',
      'files is "bun.lock", not a list of quoted paths',
    ]);
    expect(reading.block).toEqual({
      head: 'deadbeef',
      at: null,
      class: null,
      simple: null,
      attempts: null,
      files: null,
    });
  });
});

describe('the comment body', () => {
  it('opens with the marker and the headline the spec spells', () => {
    const lines = triageCommentBody(input()).split('\n');

    expect(lines[0]).toBe(TRIAGE_MARKER);
    expect(lines[1]).toBe('**rafa triage**: `conflict-lockfile`, simple, not resolved');
  });

  it('says not simple and resolved when that is what the assessment and the run came to', () => {
    expect(triageHeadline(assess({ triageClass: 'ci-test', simple: false }), true))
      .toBe('**rafa triage**: `ci-test`, not simple, resolved');
  });

  it('carries the evidence: the reason, the files, the step and the failing checks', () => {
    const body = triageCommentBody(input({
      assessment: assess({
        triageClass: 'ci-lint',
        conflicting: false,
        files: [],
        verdict: 'red',
        step: step('bun run lint'),
        failing: [{ name: 'gates (ubuntu)', state: 'FAILURE', link: 'https://example.invalid/1', outcome: 'fail' }],
        reason: 'the lint step failed',
      }),
    }));

    expect(body).toContain('- Why: the lint step failed');
    expect(body).toContain('- Conflicting files: none; the head merges cleanly');
    expect(body).toContain('- Failing step: `bun run lint`');
    expect(body).toContain('- Failing checks: `gates (ubuntu)`');
  });

  it('says the files were not read when a conflict was seen and none came back', () => {
    const body = triageCommentBody(input({ assessment: assess({ files: [] }) }));

    expect(body).toContain('- Conflicting files: none read; the head was not fetched locally');
  });

  it('shows the log excerpt, and shows none when no log was read', () => {
    const withLog = triageCommentBody(input({ evidence: evidenceOf(['error: lint failed', 'exit 1']) }));

    expect(withLog).toContain('error: lint failed');
    expect(withLog).toContain(`${FENCE}text`);
    expect(triageCommentBody(input())).not.toContain(`${FENCE}text`);
  });

  it('folds the follow-up prompt into a details block fenced wider than the prompt itself', () => {
    const body = triageCommentBody(input({ evidence: evidenceOf(['error: lint failed']) }));

    expect(body).toContain('<details>');
    expect(body).toContain('</details>');
    expect(body).toContain(`${FENCE}\`markdown`);
    expect(body).toContain('# Assessed pull request: act on this triage');
    expect(readTriageBlock(body).block?.class).toBe('conflict-lockfile');
  });
});

describe('a no-checks comment', () => {
  const NO_WORKFLOW = 'nothing on GitHub has tested this branch; you are relying on the checks run locally';
  const WORKFLOWS_EXIST = 'CI may not have started (a path filter, a draft, Actions disabled, or it has not registered yet);'
    + ' this is probably not what you want';

  /** A `no-checks` assessment, as the classifier reaches one. */
  const noChecks = assess({
    triageClass: 'no-checks',
    simple: false,
    dependencyBump: false,
    conflicting: false,
    files: [],
    reason: 'the head reports no checks at all; the repository defines 0 workflows;'
      + ' to merge it anyway, run rafa pr merge 21 --skip-checks',
  });

  it('ends the evidence, after the verdict, with the count, the warning and the --skip-checks line', () => {
    const lines = triageCommentBody(input({ assessment: noChecks, workflowCount: 0 })).split('\n');
    const verdict = lines.findIndex((line) => line.startsWith('- Checks verdict: `none`'));

    expect(lines).toContain('**rafa triage**: `no-checks`, not simple, not resolved');
    expect(lines).toContain('class: "no-checks"');
    expect(verdict).toBeGreaterThan(0);
    expect(lines.slice(verdict + 1, verdict + 4)).toEqual([
      '- Workflows: The repository defines 0 workflows.',
      `- Warning: ${NO_WORKFLOW}`,
      '- To merge it anyway: `rafa pr merge 21 --skip-checks` (it asks first; `--yes` may answer it)',
    ]);
  });

  it('warns that CI may not have started, and refuses --yes, when one or more workflows exist', () => {
    const body = triageCommentBody(input({ assessment: noChecks, workflowCount: 1 }));

    expect(body).toContain('- Workflows: The repository defines 1 workflow.');
    expect(body).toContain(`- Warning: ${WORKFLOWS_EXIST}`);
    expect(body).toContain('(it asks first; `--yes` is refused, so a person must answer it)');
    expect(body).not.toContain(NO_WORKFLOW);
  });

  it('reads a count that could not be read, and one left out, as workflows existing and never as none', () => {
    for (const workflowCount of [null, undefined]) {
      const body = triageCommentBody(input({ assessment: noChecks, workflowCount }));

      expect(body).toContain('- Workflows: The repository\'s workflow count could not be read.');
      expect(body).toContain(`- Warning: ${WORKFLOWS_EXIST}`);
      expect(body).not.toContain(NO_WORKFLOW);
    }
  });

  it('carries none of the three lines for any other class, whatever count it is handed', () => {
    const others = [assess(), assess({ triageClass: 'green', conflicting: false, files: [], verdict: 'green' })];

    for (const assessment of others) {
      const body = triageCommentBody(input({ assessment, workflowCount: 0 }));

      expect(body).not.toContain('- Workflows:');
      expect(body).not.toContain('--skip-checks');
    }
  });
});

describe('which comment is the triage', () => {
  it('answers null for a list with no marker in it, one naming a triage included', () => {
    const comments = [
      comment({ body: 'I ran rafa pr triage and it said conflict-lockfile' }),
      comment({ body: 'still red' }),
    ];

    expect(findTriageComment(comments)).toBeNull();
    expect(findTriageComment([])).toBeNull();
  });

  it('takes the last marker comment, with later ordinary comments after it', () => {
    const comments = [
      comment({ id: '1', body: bodyAround('class: "ci-test"') }),
      comment({ id: '2', body: bodyAround('class: "conflict-lockfile"') }),
      comment({ id: '3', body: 'thanks' }),
    ];

    expect(findTriageComment(comments)?.id).toBe('2');
  });

  it('answers every marker comment newest first, which is the order a trust check walks', () => {
    const comments = [
      comment({ id: '1', body: bodyAround('class: "ci-test"') }),
      comment({ id: '2', body: 'thanks' }),
      comment({ id: '3', body: bodyAround('class: "conflict-lockfile"') }),
    ];

    expect(triageComments(comments).map((one) => one.id)).toEqual(['3', '1']);
    expect(triageComments([comment({ body: 'thanks' })])).toEqual([]);
  });
});

describe('writing the comment', () => {
  it('posts one when the pull request carries none', async () => {
    const { fake, pr } = withPull();
    const body = triageCommentBody(input());

    const write = await writeTriageComment({ pulls: pr, number: 21, body });

    expect(write.action).toBe('posted');
    expect(write.comment.body).toBe(body);
    expect(await pr.comments(21)).toEqual([write.comment]);
    expect(fake.calls()[0]).toEqual(['api', 'repos/{owner}/{repo}/issues/21/comments']);
  });

  it('edits the marker comment it finds, leaving the pull request one comment', async () => {
    const { pr } = withPull();
    const first = triageCommentBody(input());
    const second = triageCommentBody(input({
      pr: pull({ headRefOid: DIGIT_HEAD }),
      assessment: assess({ triageClass: 'ci-test', simple: false }),
      attempts: 1,
    }));

    const posted = await writeTriageComment({ pulls: pr, number: 21, body: first });
    const edited = await writeTriageComment({ pulls: pr, number: 21, body: second });

    expect(edited.action).toBe('edited');
    expect(edited.comment.id).toBe(posted.comment.id);
    const after = await pr.comments(21);
    expect(after.length).toBe(1);
    expect(readTriageBlock(after[0]?.body ?? '').block).toMatchObject({
      head: DIGIT_HEAD,
      class: 'ci-test',
      simple: false,
      attempts: 1,
    });
  });

  it('posts beside an ordinary comment, which carries no marker', async () => {
    const { pr } = withPull();
    await pr.comment(21, 'looks fine to me');

    const write = await writeTriageComment({ pulls: pr, number: 21, body: triageCommentBody(input()) });

    expect(write.action).toBe('posted');
    expect((await pr.comments(21)).length).toBe(2);
  });

  it('takes an existing comment the caller already found, listing none itself', async () => {
    const { fake, pr } = withPull();
    const posted = await pr.comment(21, `${TRIAGE_MARKER}\nan earlier triage\n`);
    const before = fake.calls().length;

    const write = await writeTriageComment({
      pulls: pr,
      number: 21,
      body: triageCommentBody(input()),
      existing: posted,
    });

    expect(write.action).toBe('edited');
    const sent = fake.calls()
      .slice(before)
      .map((call) => call[1]);

    expect(sent).toEqual([
      'repos/{owner}/{repo}/issues/comments/5000000001',
    ]);
  });

  it('posts without listing when the caller looked and found none', async () => {
    const { fake, pr } = withPull();

    const write = await writeTriageComment({
      pulls: pr,
      number: 21,
      body: triageCommentBody(input()),
      existing: null,
    });

    expect(write.action).toBe('posted');
    expect(fake.calls().length).toBe(1);
    expect(fake.calls()[0]?.slice(0, 4)).toEqual([
      'api',
      'repos/{owner}/{repo}/issues/21/comments',
      '-X',
      'POST',
    ]);
  });
});
