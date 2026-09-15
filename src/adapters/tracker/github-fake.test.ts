/**
 * Tests for the recorded `gh` fake (`src/adapters/tracker/github-fake.ts`).
 *
 * The `github` adapter's cases prove what they claim only as far as the
 * fake answers as `gh` does, so each recorded answer the module note
 * lists is held here as it was recorded, and each rule the fake enforces
 * sits beside a command it accepts. No case spawns anything.
 *
 * Ten mutations of `github-fake.ts` were driven on 2026-09-14, one run
 * each over this file and `github.test.ts`, with 126 pass before and
 * after and the module restored byte-identical (sha256), and every one
 * reddened at least one case. An unmodelled flag ignored, label existence
 * unchecked at create, labels not split on commas, and a PATCH accepted
 * without `-X PATCH` each reddened one case here and none in the
 * adapter's file. Listing oldest first reddened the listing case here and
 * the adapter's order case; a value opening with a dash refused, the dash
 * case here and the adapter's comment case; another repository accepted,
 * the repository case here and the adapter's; every field answered
 * whatever `--json` asked, three cases here; a reopen keeping its close
 * reason, the reopen case here and the adapter's four reopen cases. A
 * search of the title alone reddened no case here and the contract's body
 * case, since this file searches titles and the contract a body.
 */
import type { FakeGh } from './github-fake.js';

import { describe, expect, it } from 'bun:test';

import { createFakeGh } from './github-fake.js';

/** A create for `title`, with a body and any labels. */
function issueCreate(title: string, ...labels: string[]): string[] {
  return ['issue', 'create', '--title', title, '--body', 'body', ...labels.flatMap((label) => ['--label', label])];
}

/** A close for issue `number` in the repository the directory resolves. */
function closeIssue(number: string, reason: string): string[] {
  return ['api', `repos/{owner}/{repo}/issues/${number}`, '-X', 'PATCH', '-f', 'state=closed', '-f', `state_reason=${reason}`];
}

/** A failure writing `stderr`. */
function failure(stderr: string): { ok: false; stdout: string; stderr: string } {
  return { ok: false, stdout: '', stderr };
}

/** The numbers `gh issue list` writes for `flags`. */
async function listed(fake: FakeGh, ...flags: string[]): Promise<string> {
  return (await fake.run(['issue', 'list', '--json', 'number', ...flags])).stdout;
}

describe('the recorded gh fake', () => {
  it('refuses a flag it does not model, recording the call, beside the create it accepts', async () => {
    const fake = createFakeGh();

    expect(await fake.run([...issueCreate('t', 'bug'), '--type', 'Bug']))
      .toEqual(failure('fake gh: issue create does not model flag --type\n'));
    expect(await fake.run([...issueCreate('t', 'bug'), '--project', 'Board']))
      .toEqual(failure('fake gh: issue create does not model flag --project\n'));
    expect(fake.issueCount()).toBe(0);
    expect(await fake.run(issueCreate('t', 'bug')))
      .toEqual({ ok: true, stdout: 'https://github.com/open-tomato/rafa/issues/1\n', stderr: '' });
    expect(fake.calls()).toHaveLength(3);
  });

  it.each([
    [['api', 'graphql', '-f', 'query=projectsV2'], 'fake gh: api models repos/<repository>/issues/<number> alone, and was handed graphql\n'],
    [['project', 'item-add', '1'], 'fake gh: unhandled command project item-add 1\n'],
    [['issue', 'close', '1'], 'fake gh: unhandled command issue close 1\n'],
    [['label', 'list'], 'fake gh: unhandled command label list\n'],
    [['issue', 'view', '--json', 'number'], 'fake gh: issue view takes 1 arguments besides its flags, and was handed 0\n'],
  ])('refuses the command %p it does not model', async (args, stderr) => {
    expect(await createFakeGh().run(args)).toEqual(failure(stderr));
  });

  it('fails a whole create on a label the repository lacks, filing nothing until the label is made', async () => {
    const fake = createFakeGh();

    expect(await fake.run(issueCreate('t', 'bug', 'module:auth')))
      .toEqual(failure('could not add label: \'module:auth\' not found\n'));
    expect(fake.issueCount()).toBe(0);
    expect((await fake.run(['label', 'create', 'module:auth', '--force'])).ok).toBe(true);
    expect((await fake.run(issueCreate('t', 'bug', 'module:auth'))).ok).toBe(true);
    expect(fake.issue('1')?.labels).toEqual(['bug', 'module:auth']);
  });

  it('refuses a label create when made to, and makes the label otherwise', async () => {
    const refusing = createFakeGh({ labelCreateOk: false });
    const making = createFakeGh();

    expect(await refusing.run(['label', 'create', 'type:bug', '--force']))
      .toEqual(failure('HTTP 403: Resource not accessible by integration (label create)\n'));
    expect(refusing.hasLabel('type:bug')).toBe(false);
    expect((await making.run(['label', 'create', 'type:bug', '--force'])).ok).toBe(true);
    expect(making.hasLabel('type:bug')).toBe(true);
  });

  it('splits a label value on commas, as recorded, in a create and in a listing', async () => {
    const fake = createFakeGh();
    await fake.run(issueCreate('first', 'bug,wontfix'));
    await fake.run(issueCreate('second', 'bug'));

    expect(fake.issue('1')?.labels).toEqual(['bug', 'wontfix']);
    expect(await listed(fake, '--label', 'bug,wontfix')).toBe('[{"number":1}]\n');
    expect(await listed(fake, '--label', 'bug', '--label', 'wontfix')).toBe('[{"number":1}]\n');
  });

  it('takes the argument after a value flag even when it opens with a dash', async () => {
    const fake = createFakeGh();

    await fake.run(['issue', 'create', '--title', '--help', '--body', '--web']);

    expect(fake.issue('1')).toMatchObject({ title: '--help', body: '--web' });
    expect(await fake.run(['issue', 'comment', '1', '--body']))
      .toEqual(failure('fake gh: issue comment --body needs an argument\n'));
  });

  it('writes the fields asked for, keys in name order, each label as recorded and an open reason empty', async () => {
    const fake = createFakeGh();
    await fake.run(issueCreate('Fix it', 'bug'));

    expect(await fake.run(['issue', 'view', '1', '--json', 'url,stateReason,number,labels,state'])).toEqual({
      ok: true,
      stdout: '{"labels":[{"id":"LA_fake0","name":"bug","description":"","color":"ededed"}],'
        + '"number":1,"state":"OPEN","stateReason":"","url":"https://github.com/open-tomato/rafa/issues/1"}\n',
      stderr: '',
    });
    expect(await fake.run(['issue', 'view', '1', '--json', 'issueType']))
      .toEqual(failure('fake gh: does not model --json field "issueType"\n'));
  });

  it('lists newest first and open alone by default, narrowed by state, labels, search text and limit', async () => {
    const fake = createFakeGh();
    await fake.run(issueCreate('Replay window', 'bug'));
    await fake.run(issueCreate('Cookie flags', 'bug'));
    await fake.run(issueCreate('Replay again', 'wontfix'));
    await fake.run(closeIssue('2', 'completed'));

    expect(await listed(fake, '--state', 'all')).toBe('[{"number":3},{"number":2},{"number":1}]\n');
    expect(await listed(fake)).toBe('[{"number":3},{"number":1}]\n');
    expect(await listed(fake, '--state', 'closed')).toBe('[{"number":2}]\n');
    expect(await listed(fake, '--state', 'all', '--label', 'bug')).toBe('[{"number":2},{"number":1}]\n');
    expect(await listed(fake, '--state', 'all', '--search', 'REPLAY')).toBe('[{"number":3},{"number":1}]\n');
    expect(await listed(fake, '--state', 'all', '--limit', '1')).toBe('[{"number":3}]\n');
  });

  it('answers the recorded failures for no login, no remote, an unknown issue and an unexpandable path', async () => {
    const noRemote = createFakeGh({ repo: null });

    expect(await createFakeGh({ authOk: false }).run(['auth', 'status']))
      .toEqual(failure('You are not logged into any GitHub hosts. To log in, run: gh auth login\n'));
    expect(await noRemote.run(['repo', 'view', '--json', 'nameWithOwner'])).toEqual(failure('no git remotes found\n'));
    expect(await noRemote.run(closeIssue('1', 'completed')))
      .toEqual(failure('unable to expand placeholder in path: no git remotes found\n'));
    expect(await createFakeGh().run(['issue', 'view', '7', '--json', 'number'])).toEqual(failure(
      'GraphQL: Could not resolve to an issue or pull request with the number of 7. (repository.issue)\n',
    ));
    expect(await createFakeGh().run(['repo', 'view', '--json', 'nameWithOwner']))
      .toEqual({ ok: true, stdout: '{"nameWithOwner":"open-tomato/rafa"}\n', stderr: '' });
  });

  it('refuses another repository and a PATCH without -X PATCH, beside the ones it accepts', async () => {
    const fake = createFakeGh();
    await fake.run(issueCreate('t', 'bug'));
    const patch = ['api', 'repos/open-tomato/rafa/issues/1', '-f', 'state=closed', '-f', 'state_reason=not_planned'];

    expect(await fake.run(['issue', 'reopen', '1', '--repo', 'open-tomato/other'])).toEqual(
      failure('fake gh: models one repository, open-tomato/rafa, and was handed --repo open-tomato/other\n'),
    );
    expect((await fake.run(['issue', 'reopen', '1', '--repo', 'open-tomato/rafa'])).ok).toBe(true);
    expect(await fake.run(['api', 'repos/open-tomato/other/issues/1', '-X', 'PATCH'])).toEqual(
      failure('fake gh: models one repository, open-tomato/rafa, and was handed repos/open-tomato/other/issues/1\n'),
    );
    expect(await fake.run(patch))
      .toEqual(failure('fake gh: repos/open-tomato/rafa/issues/1 is modelled for -X PATCH alone\n'));
    expect(fake.issue('1')).toMatchObject({ state: 'OPEN', stateReason: '' });
    expect((await fake.run([...patch, '-X', 'PATCH'])).ok).toBe(true);
    expect(fake.issue('1')).toMatchObject({ state: 'CLOSED', stateReason: 'NOT_PLANNED' });
  });

  it('clears the close reason on a reopen', async () => {
    const fake = createFakeGh();
    await fake.run(issueCreate('t', 'bug'));
    await fake.run(closeIssue('1', 'not_planned'));

    await fake.run(['issue', 'reopen', '1']);

    expect(fake.issue('1')).toMatchObject({ state: 'OPEN', stateReason: '' });
  });

  it('replaces an issue through update, keeping its number, and throws for one it does not hold', async () => {
    const fake = createFakeGh();
    await fake.run(issueCreate('t', 'bug'));

    fake.update('1', (issue) => ({ ...issue, number: 9, title: 'Edited' }));

    expect(fake.issue('1')).toMatchObject({ number: 1, title: 'Edited' });
    expect(fake.issue('9')).toBeUndefined();
    expect(() => fake.update('2', (issue) => issue)).toThrow('fake gh: holds no issue 2');
  });

  it('records each call as handed over, frozen, so changing the arguments afterwards changes nothing', async () => {
    const fake = createFakeGh();
    const args = ['auth', 'status'];

    await fake.run(args);
    args.push('--hostname');

    expect(fake.calls()).toEqual([['auth', 'status']]);
    expect(Object.isFrozen(fake.calls()[0])).toBe(true);
    expect(Object.isFrozen(fake)).toBe(true);
  });
});
