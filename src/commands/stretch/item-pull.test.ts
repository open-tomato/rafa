/**
 * The pull request read of `rafa stretch item` (`./item-pull.ts`), over
 * a `gh` stand-in answering one recorded `pr view` row per case.
 *
 * Control: each word of `mergeable` is read back as it was written, so a
 * read that mapped or dropped the word fails the case of that word, and
 * a row without the field fails with exit 2 beside them.
 */
import type { GhRunner } from '@open-tomato/rafa-board/adapters/tracker/github';

import { describe, expect, it } from 'bun:test';

import { PR_VIEW_FIELDS, prViewArgs, viewPull } from './item-pull.js';

const MERGE_SHA = '0326b9da1b76e75bfdd0ed3b2002897e5bae75e4';

/** A `gh` that answers every call with `stdout`, or fails it. */
function answering(stdout: string, ok = true): GhRunner {
  return async () => Promise.resolve({ ok, stdout, stderr: ok
    ? ''
    : 'no pull requests found' });
}

/** An open pull request row as `gh pr view --json` writes one, with `fields` over it. */
function openRow(fields: Readonly<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    baseRefName: 'stretch/4', body: 'Closes #812', headRefName: 'feat/x', mergeCommit: null, mergeable: 'MERGEABLE', number: 5, state: 'OPEN', ...fields,
  });
}

describe('viewPull', () => {
  it('asks for the fields it reads, mergeable among them', () => {
    expect(PR_VIEW_FIELDS).toContain('mergeable');
    expect(prViewArgs(5)).toEqual(['pr', 'view', '5', '--json', PR_VIEW_FIELDS.join(',')]);
  });

  it('reads a merged pull request as gh 2.102.0 wrote one', async () => {
    const recorded = JSON.stringify({
      baseRefName: 'main', body: '', headRefName: 'feat/x', mergeCommit: { oid: MERGE_SHA }, mergeable: 'UNKNOWN', number: 881, state: 'MERGED',
    });

    expect(await viewPull(answering(`${recorded}\n`), 881)).toEqual({
      number: 881, state: 'MERGED', base: 'main', head: 'feat/x', body: '', mergeCommit: MERGE_SHA, mergeable: 'UNKNOWN',
    });
  });

  it.each([
    ['MERGEABLE'],
    ['CONFLICTING'],
    ['UNKNOWN'],
    ['ANOTHER_WORD'],
  ])('reads mergeable %s verbatim', async (word) => {
    const pull = await viewPull(answering(openRow({ mergeable: word })), 5);

    expect(pull.mergeable).toBe(word);
    expect(pull.state).toBe('OPEN');
  });

  it.each([
    ['a gh failure', answering('', false), 'failed: no pull requests found'],
    ['output that is not JSON', answering('<html>'), 'wrote output that is not JSON'],
    ['another pull request', answering(JSON.stringify({ number: 6 })), 'answered number 6'],
    ['a merge commit with no sha', answering(openRow({ state: 'MERGED', mergeCommit: { oid: 'abc' } })), 'answered mergeCommit'],
    ['a missing field', answering(JSON.stringify({ number: 5, state: 'OPEN' })), 'answered baseRefName'],
    ['no mergeable', answering(openRow({ mergeable: undefined })), 'answered mergeable undefined'],
    ['a mergeable that is not a word', answering(openRow({ mergeable: null })), 'answered mergeable null'],
  ])('fails with exit 2 on %s', async (_name, gh, said) => {
    const read = viewPull(gh, 5);

    expect(read).rejects.toMatchObject({ exitCode: 2 });
    await expect(read).rejects.toThrow(said);
  });
});
