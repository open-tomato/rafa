/**
 * Tests for the issue board (`src/board/issue-board.ts`): the five
 * commands it sends, the comment shape it reads back, and the arguments
 * it refuses before any command leaves.
 *
 * Every case drives {@link stubGh}, a runner answering recorded results
 * and keeping the argument lists it was handed, so no case spawns a
 * process, reaches GitHub or reads the configuration `gh` keeps under
 * the home. The payloads are the REST shapes
 * `src/pr/gh-fake-shapes.ts` records for the comment endpoints, cut to
 * the three fields this board reads.
 *
 * A seam like this passes while wrong most easily by sending a command
 * nobody looks at, so every case that asserts an answer also asserts the
 * argument list that produced it, and every refusal asserts that NO
 * command was sent.
 *
 * One mutation of `issue-board.ts` was driven on 2026-09-19 over
 * `env -u CLAUDECODE bun test src/board/ src/plan.test.ts`, the module
 * restored from a scratch copy and verified with `shasum -c`: the
 * hyphen check dropped from the label argument, so `--repo` reaches
 * `gh` as a flag, left 196 pass and 1 fail against 197 pass either
 * side — the refusal case below.
 *
 * One mutation of `removeLabel` was driven on 2026-09-21 the same way,
 * over `bun test src/board/issue-board.test.ts`, the module restored
 * from a scratch copy and verified with `shasum -c`: `--add-label`
 * added back to its argument list, so the removal becomes a swap onto
 * a label nobody asked for, left 13 pass and 1 fail against 14 pass
 * either side — the argument list case below.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { createGhIssueBoard } from './issue-board.js';

/** A recorded `gh` result that succeeded, writing `stdout`. */
function wrote(stdout: string): GhResult {
  return { ok: true, stdout, stderr: '' };
}

/** A recorded `gh` result that failed, writing `stderr`. */
function failed(stderr: string): GhResult {
  return { ok: false, stdout: '', stderr };
}

/** A runner answering `results` in turn, the last one repeating, keeping every call. */
function stubGh(...results: readonly GhResult[]): { run: GhRunner; calls: () => readonly (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  let index = 0;
  const run: GhRunner = (args) => {
    calls.push([...args]);
    const result = results[Math.min(index, results.length - 1)] ?? wrote('');
    index += 1;
    return Promise.resolve(result);
  };
  return { run, calls: () => calls };
}

/** One comment as the REST resource writes it, cut to what the board reads. */
function restComment(id: number, body: string, login: string | null = 'octocat'): string {
  return JSON.stringify(login === null
    ? { id, body }
    : { id, body, user: { login } });
}

describe('comments', () => {
  it('reads the issue comments off the REST endpoint, in the order they came', async () => {
    const stub = stubGh(wrote(`[${restComment(11, 'first')},${restComment(12, 'second', 'hubot')}]`));

    const comments = await createGhIssueBoard({ gh: stub.run }).comments(7);

    expect(stub.calls()).toEqual([['api', 'repos/{owner}/{repo}/issues/7/comments']]);
    expect(comments).toEqual([
      { id: '11', body: 'first', author: 'octocat' },
      { id: '12', body: 'second', author: 'hubot' },
    ]);
  });

  it('reads a comment carrying no user as one written by nobody it names', async () => {
    const stub = stubGh(wrote(`[${restComment(11, 'first', null)}]`));

    expect(await createGhIssueBoard({ gh: stub.run }).comments(7)).toEqual([
      { id: '11', body: 'first', author: '' },
    ]);
  });

  it('rejects a failed command, naming it and what it wrote, and a failure that wrote nothing', async () => {
    const board = createGhIssueBoard({ gh: stubGh(failed('gh: Not Found (HTTP 404)')).run });
    const silent = createGhIssueBoard({ gh: stubGh({ ok: false, stdout: '', stderr: '' }).run });

    await expect(board.comments(7)).rejects.toThrow(
      'board issue: gh api repos/{owner}/{repo}/issues/7/comments failed: gh: Not Found (HTTP 404)',
    );
    await expect(silent.comments(7)).rejects.toThrow(
      'board issue: gh api repos/{owner}/{repo}/issues/7/comments failed and wrote nothing',
    );
  });

  it('rejects output that is not JSON, one that is no list, and a row that is no comment', async () => {
    const board = (stdout: string): ReturnType<typeof createGhIssueBoard> => createGhIssueBoard({
      gh: stubGh(wrote(stdout)).run,
    });

    await expect(board('<html>rate limited</html>').comments(7)).rejects.toThrow('wrote output that is not JSON');
    await expect(board('{"id":11}').comments(7)).rejects.toThrow('expected a list of comments');
    await expect(board('["a comment"]').comments(7)).rejects.toThrow('answered comment 0 as "a comment", expected a mapping');
    await expect(board('[{"id":"11","body":"x"}]').comments(7)).rejects.toThrow('comment 0.id');
    await expect(board('[{"id":11}]').comments(7)).rejects.toThrow('comment 0.body');
    // The control: the same reader takes the shape the endpoint writes.
    await expect(board(`[${restComment(11, 'x')}]`).comments(7)).resolves.toHaveLength(1);
  });
});

describe('comment and editComment', () => {
  it('posts a comment through the REST endpoint and answers what came back', async () => {
    const stub = stubGh(wrote(restComment(31, 'the gaps')));

    const comment = await createGhIssueBoard({ gh: stub.run }).comment(7, 'the gaps');

    expect(stub.calls()).toEqual([[
      'api',
      'repos/{owner}/{repo}/issues/7/comments',
      '-X',
      'POST',
      '-f',
      'body=the gaps',
    ]]);
    expect(comment).toEqual({ id: '31', body: 'the gaps', author: 'octocat' });
  });

  it('edits a comment by its REST id', async () => {
    const stub = stubGh(wrote(restComment(31, 'the new gaps')));

    const comment = await createGhIssueBoard({ gh: stub.run }).editComment('31', 'the new gaps');

    expect(stub.calls()).toEqual([[
      'api',
      'repos/{owner}/{repo}/issues/comments/31',
      '-X',
      'PATCH',
      '-f',
      'body=the new gaps',
    ]]);
    expect(comment.body).toBe('the new gaps');
  });

  it('refuses a comment id that is no whole number, and sends no command', async () => {
    const stub = stubGh(wrote(restComment(31, 'x')));
    const board = createGhIssueBoard({ gh: stub.run });

    await expect(board.editComment('../../issues/1', 'x')).rejects.toThrow(TypeError);
    await expect(board.editComment('', 'x')).rejects.toThrow(TypeError);
    await expect(board.editComment('031', 'x')).rejects.toThrow(TypeError);
    expect(stub.calls()).toEqual([]);
    // The control: a REST id is taken.
    await expect(board.editComment('31', 'x')).resolves.toMatchObject({ id: '31' });
  });
});

describe('swapLabels', () => {
  it('takes one label off and puts the other on in a single gh issue edit', async () => {
    const stub = stubGh(wrote(''));

    await createGhIssueBoard({ gh: stub.run }).swapLabels(7, 'spec:ready', 'spec:needs-work');

    expect(stub.calls()).toEqual([[
      'issue',
      'edit',
      '7',
      '--remove-label',
      'spec:ready',
      '--add-label',
      'spec:needs-work',
    ]]);
  });

  it('rejects a failed swap, naming the command', async () => {
    const stub = stubGh(failed('gh: could not add label: not found'));

    await expect(createGhIssueBoard({ gh: stub.run }).swapLabels(7, 'spec:ready', 'spec:needs-work'))
      .rejects.toThrow('gh issue edit 7 --remove-label spec:ready --add-label spec:needs-work failed');
  });

  it('refuses a label that would reach gh as a flag, an empty one, and an issue that is no number', async () => {
    const stub = stubGh(wrote(''));
    const board = createGhIssueBoard({ gh: stub.run });

    await expect(board.swapLabels(7, '--repo', 'spec:needs-work')).rejects.toThrow(TypeError);
    await expect(board.swapLabels(7, 'spec:ready', '')).rejects.toThrow(TypeError);
    await expect(board.swapLabels(0, 'spec:ready', 'spec:needs-work')).rejects.toThrow(TypeError);
    await expect(board.comments(1.5)).rejects.toThrow(TypeError);
    expect(stub.calls()).toEqual([]);
    // The control: ordinary labels on an ordinary issue send the command.
    await expect(board.swapLabels(7, 'spec:ready', 'spec:needs-work')).resolves.toBeUndefined();
  });
});

describe('removeLabel', () => {
  it('takes the label off in a gh issue edit carrying no --add-label', async () => {
    const stub = stubGh(wrote(''));

    await createGhIssueBoard({ gh: stub.run }).removeLabel(7, 'spec:blocked');

    expect(stub.calls()).toEqual([['issue', 'edit', '7', '--remove-label', 'spec:blocked']]);
  });

  it('rejects a failed removal, naming the command', async () => {
    const stub = stubGh(failed('gh: could not remove label: not found'));

    await expect(createGhIssueBoard({ gh: stub.run }).removeLabel(7, 'spec:blocked'))
      .rejects.toThrow('gh issue edit 7 --remove-label spec:blocked failed');
  });

  it('names itself, not swapLabels, in the label it refuses', async () => {
    const stub = stubGh(wrote(''));

    await expect(createGhIssueBoard({ gh: stub.run }).removeLabel(7, '--repo')).rejects.toThrow(
      'board issue: removeLabel refused the label',
    );
  });

  it('refuses a label that would reach gh as a flag, an empty one, and an issue that is no number', async () => {
    const stub = stubGh(wrote(''));
    const board = createGhIssueBoard({ gh: stub.run });

    await expect(board.removeLabel(7, '--repo')).rejects.toThrow(TypeError);
    await expect(board.removeLabel(7, '')).rejects.toThrow(TypeError);
    await expect(board.removeLabel(0, 'spec:blocked')).rejects.toThrow(TypeError);
    await expect(board.removeLabel(1.5, 'spec:blocked')).rejects.toThrow(TypeError);
    expect(stub.calls()).toEqual([]);
    // The control: an ordinary label on an ordinary issue sends the command.
    await expect(board.removeLabel(7, 'spec:blocked')).resolves.toBeUndefined();
  });
});
