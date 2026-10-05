/**
 * An integration suite over `rafa issue create` filing a spec, dispatched
 * in-process over the recorded `gh` fake as a fixture board
 * (`src/commands/issue/create.ts`): the lines the command refuses file
 * nothing and exit 1, and `--type=spec --body-file=spec.md` files
 * `type:spec` with the file's bytes, `spec:blocked` added when the body's
 * first line is `Blocked by: #20`.
 *
 * The board holds twenty issues before each case, so `#20` exists. A
 * refused line is checked against the issue count and the `gh` calls
 * that file (`issue create`), beside a line the same board takes.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createFakeGh } from '../adapters/tracker/github-fake.js';
import { SPEC_BLOCKED_LABEL } from '../board/blocked.js';
import { SPEC_LABEL } from '../board/issue.js';
import { createIssueCreateCommand } from '../commands/issue/create.js';

import { dispatchInProject, plantProject } from './cli-capture.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-issue-create-spec-integration-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const SUBJECTS = [{ name: 'issue', summary: 'issues' }];

/** The issues the fixture board holds before each case. */
const BOARD_SIZE = 20;

/** A body with leading blank-free text, tabs, a trailing blank line and non-ASCII, to be kept byte for byte. */
const PLAIN_SPEC = '# The spec\n\n\tCafé — naïve.\n\n';

let counter = 0;

/** A project and a fake board holding {@link BOARD_SIZE} issues, with the command over it. */
async function fixtureBoard() {
  counter += 1;
  const scope = join(tempBase, `case-${String(counter)}`);
  const project = plantProject(scope, 'tracker:\n  default: github\n');
  const fake = createFakeGh();
  const command = createIssueCreateCommand({ gh: fake.run });
  const run = (...flags: string[]) => dispatchInProject(['issue', 'create', '--title=A spec', ...flags], SUBJECTS, [command], project);
  for (let index = 0; index < BOARD_SIZE; index += 1) {
    const filed = await run('--type=bug', `--body=Filler ${String(index)}`);
    expect(filed.exitCode).toBe(0);
  }
  return { project, fake, run, scope };
}

describe('rafa issue create over a fixture board, refused lines', () => {
  it('refuses --body with --body-file and files nothing', async () => {
    const { fake, run, scope } = await fixtureBoard();
    const file = join(scope, 'spec.md');
    writeFileSync(file, PLAIN_SPEC);

    const outcome = await run('--type=spec', '--body=text', `--body-file=${file}`);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('--body and --body-file cannot be used together');
    expect(fake.issueCount()).toBe(BOARD_SIZE);
  });

  it('refuses an unreadable body file and files nothing', async () => {
    const { fake, run, scope } = await fixtureBoard();
    const missing = join(scope, 'absent.md');

    const outcome = await run('--type=spec', `--body-file=${missing}`);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('--body-file cannot read');
    expect(outcome.stderr).toContain(missing);
    expect(fake.issueCount()).toBe(BOARD_SIZE);
  });

  it('refuses a Blocked by line naming no issue and files nothing', async () => {
    const { fake, run, scope } = await fixtureBoard();
    const file = join(scope, 'spec.md');
    writeFileSync(file, 'Blocked by: the API work\n\nThe spec.\n');

    const outcome = await run('--type=spec', `--body-file=${file}`);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('names no issue: "the API work"');
    expect(fake.issueCount()).toBe(BOARD_SIZE);
  });
});

describe('rafa issue create over a fixture board, a spec filed from a file', () => {
  it('files type:spec with the file\'s bytes and no spec:blocked', async () => {
    const { fake, run, scope } = await fixtureBoard();
    const file = join(scope, 'spec.md');
    writeFileSync(file, PLAIN_SPEC);

    const outcome = await run('--type=spec', `--body-file=${file}`);

    expect(outcome.exitCode).toBe(0);
    expect(fake.issueCount()).toBe(BOARD_SIZE + 1);
    const filed = fake.issue(String(BOARD_SIZE + 1));
    expect(filed?.body).toBe(PLAIN_SPEC);
    expect(filed?.labels).toContain(SPEC_LABEL);
    expect(filed?.labels).not.toContain(SPEC_BLOCKED_LABEL);
  });

  it('adds spec:blocked for a first line Blocked by: #20', async () => {
    const { fake, run, scope } = await fixtureBoard();
    const body = 'Blocked by: #20\n\nThe spec.\n';
    const file = join(scope, 'spec.md');
    writeFileSync(file, body);

    const outcome = await run('--type=spec', `--body-file=${file}`);

    expect(outcome.exitCode).toBe(0);
    const filed = fake.issue(String(BOARD_SIZE + 1));
    expect(filed?.body).toBe(body);
    expect(filed?.labels).toContain(SPEC_LABEL);
    expect(filed?.labels).toContain(SPEC_BLOCKED_LABEL);
  });
});
