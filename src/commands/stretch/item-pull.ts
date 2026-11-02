/**
 * The pull request read of `rafa stretch item` (`./item-merge.ts`): one
 * `gh pr view <pr> --json ...` for the fields the merge half needs,
 * answered as a {@link ViewedPull} or failed with exit 2 when `gh` fails
 * or answers something else.
 *
 * `mergeable` is the word `gh pr view --json mergeable` wrote, kept
 * verbatim: `MERGEABLE`, `CONFLICTING`, `UNKNOWN` while GitHub has not
 * computed it yet, or another word, so a refusal can name what `gh` said.
 * Measured on `gh` 2.102.0 against `open-tomato/rafa` (`rafa pr show 1407`
 * and `1403`): a merged pull request reads `UNKNOWN`.
 */
import type { GhRunner } from '@open-tomato/rafa-board';

import { CommandExit } from '@open-tomato/rafa/core/command';
import { describeValue, isMapping, messageOf } from '@open-tomato/rafa/core/config/sections';

/** The command's spelling, as its failures name it. */
const COMMAND_NAME = 'rafa stretch item';

/** The exit code of a reading that failed. */
const FAILED_EXIT = 2;

/** A full commit sha. */
const SHA = /^[0-9a-f]{40}$/;

/** The `--json` fields the pull request is read with. */
export const PR_VIEW_FIELDS = ['number', 'state', 'baseRefName', 'headRefName', 'body', 'mergeCommit', 'mergeable'] as const;

/** The pull request, as `gh pr view` answers it. */
export interface ViewedPull {
  readonly number: number;
  /** `OPEN`, `MERGED` or `CLOSED`, as `gh` writes it. */
  readonly state: string;
  readonly base: string;
  readonly head: string;
  readonly body: string;
  /** The merge commit's sha, or null before it merged. */
  readonly mergeCommit: string | null;
  /** `MERGEABLE`, `CONFLICTING`, `UNKNOWN` or another word, verbatim as `gh` writes it. */
  readonly mergeable: string;
}

/** A failure with exit code 2 naming `why`. */
function failure(why: string): CommandExit {
  return new CommandExit(FAILED_EXIT, `❌ ${COMMAND_NAME}: ${why}`);
}

/** The arguments after `gh` that read pull request `number`. */
export function prViewArgs(number: number): string[] {
  return ['pr', 'view', String(number), '--json', PR_VIEW_FIELDS.join(',')];
}

/** The text `field` of `row` holds, or a failure naming it. */
function textField(row: Readonly<Record<string, unknown>>, field: string, command: string): string {
  const value = row[field];
  if (typeof value !== 'string') throw failure(`${command} answered ${field} ${describeValue(value)}, expected a string`);
  return value;
}

/** The merge commit `gh` wrote, null for none, or a failure. */
function mergeCommitOf(value: unknown, command: string): string | null {
  if (value === null || value === undefined) return null;
  const oid = isMapping(value)
    ? value['oid']
    : undefined;
  if (typeof oid !== 'string' || !SHA.test(oid)) {
    throw failure(`${command} answered mergeCommit ${describeValue(value)}, expected null or an object holding a 40-character oid`);
  }
  return oid;
}

/** Pull request `number`, read through `gh pr view`; a failure when `gh` fails or answers something else. */
export async function viewPull(gh: GhRunner, number: number): Promise<ViewedPull> {
  const args = prViewArgs(number);
  const command = `gh ${args.join(' ')}`;
  const result = await gh(args);
  if (!result.ok) {
    const said = result.stderr.trim() || result.stdout.trim() || 'it exited non-zero and wrote nothing';
    throw failure(`${command} failed: ${said}`);
  }
  let row: unknown;
  try {
    row = JSON.parse(result.stdout) as unknown;
  } catch (error) {
    throw failure(`${command} wrote output that is not JSON: ${messageOf(error)}`);
  }
  if (!isMapping(row)) throw failure(`${command} answered ${describeValue(row)}, expected an object`);
  if (row['number'] !== number) throw failure(`${command} answered number ${describeValue(row['number'])}`);
  return {
    number,
    state: textField(row, 'state', command),
    base: textField(row, 'baseRefName', command),
    head: textField(row, 'headRefName', command),
    body: textField(row, 'body', command),
    mergeCommit: mergeCommitOf(row['mergeCommit'], command),
    mergeable: textField(row, 'mergeable', command),
  };
}
