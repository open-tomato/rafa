/**
 * Unit tests for the library half of `rafa pr open` (`open-pull.ts`):
 * the line reader, the body file reader, the warning for a pull request
 * open on the head into another base, and the one line text mode prints.
 * `openPull` over a provider is read through the command, in
 * `open.test.ts`, where each case runs from a project of its own.
 *
 * Each refusal case reads the refusal's own exit code and message, so a
 * reader that threw for another reason, or threw nothing, fails the
 * case; and each refusal of a flag left out is read beside the valid
 * line, which reads.
 */
import type { PrOpenResult } from './open-pull.js';
import type { LineFlags } from './pr-context.js';
import type { PullRequestSummary } from '../../pr/index.js';

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '@open-tomato/rafa/core/command';

import { baseWarning, readOpenBody, readOpenLine, renderOpen } from './open-pull.js';
import { PR_USAGE } from './pr-context.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-open-pull-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The usage line every refusal of this action names. */
const USAGE = PR_USAGE.open;

/** The head every case opens from, and the base it opens into. */
const HEAD = 'feat/rafa-9-one-item';
const BASE = 'stretch/9';

/** The title every case opens with. */
const TITLE = 'rafa-9: one item';

/** A body as a caller writes it: markdown, quotes, a trailing newline. */
const BODY = 'Closes #9.\n\n## What changed\n\n- `one` "item"\n';

/** The four flags of a valid line. */
const VALID: LineFlags = { head: HEAD, base: BASE, title: TITLE, 'body-file': 'body.md' };

/** A body file holding `text`, under a directory of this case's own. */
function bodyFile(text: string = BODY): string {
  const path = join(mkdtempSync(join(tempBase, 'body-')), 'body.md');
  writeFileSync(path, text, 'utf8');
  return path;
}

/** What `read` threw, or a failure when it threw nothing. */
function thrownBy(read: () => unknown): unknown {
  try {
    read();
  } catch (error) {
    return error;
  }
  throw new Error('expected the reader to throw');
}

/** What `read` rejected with, or a failure when it resolved. */
async function rejectionOf(read: () => Promise<unknown>): Promise<unknown> {
  try {
    await read();
  } catch (error) {
    return error;
  }
  throw new Error('expected the reader to reject');
}

/** The exit code and message of a refusal, or the value itself when it is no refusal. */
function refusalOf(error: unknown): unknown {
  return error instanceof CommandExit
    ? [error.exitCode, error.message]
    : error;
}

/** A summary as the provider answers one, filled from `over`. */
function summary(over: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number: 41,
    title: TITLE,
    url: 'https://github.com/open-tomato/rafa/pull/41',
    state: 'open',
    headRefName: HEAD,
    baseRefName: BASE,
    author: { login: 'octo', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-10-07T09:00:00Z',
    ...over,
  };
}

/** A result for the line's head and base, filled from `over`. */
function result(over: Partial<PrOpenResult> = {}): PrOpenResult {
  return { opened: true, head: HEAD, base: BASE, pull: summary(), ...over };
}

describe('the line reader', () => {
  it('reads the four flags', () => {
    expect(readOpenLine([], VALID)).toEqual({ head: HEAD, base: BASE, title: TITLE, bodyFile: 'body.md' });
  });

  it('refuses a head equal to the base', () => {
    const error = thrownBy(() => readOpenLine([], { ...VALID, base: HEAD }));

    expect(refusalOf(error)).toEqual([1, `❌ --head and --base are both "${HEAD}": a branch cannot be merged into itself\nUsage: ${USAGE}`]);
  });

  it('refuses each flag left out', () => {
    const names = ['head', 'base', 'title', 'body-file'];

    const refusals = names.map((name) => {
      const flags = Object.fromEntries(Object.entries(VALID).filter(([held]) => held !== name));
      return refusalOf(thrownBy(() => readOpenLine([], flags)));
    });

    expect(refusals).toEqual(names.map((name) => [1, `❌ --${name} is required: --${name}=<value>\nUsage: ${USAGE}`]));
  });

  it('refuses a stray word', () => {
    expect(refusalOf(thrownBy(() => readOpenLine(['41'], VALID)))).toEqual([1, `❌ Expected no arguments, got 1: 41\nUsage: ${USAGE}`]);
  });
});

describe('the body file reader', () => {
  it('reads a relative path from the directory rafa runs in', async () => {
    const path = relative(process.cwd(), bodyFile());

    expect(isAbsolute(path)).toBe(false);
    expect(await readOpenBody(path)).toBe(BODY);
  });

  it('refuses a path that is not there, naming it', async () => {
    const missing = join(tempBase, 'no-such-body.md');

    const error = await rejectionOf(() => readOpenBody(missing));

    expect(error).toBeInstanceOf(CommandExit);
    expect((error as CommandExit).exitCode).toBe(1);
    expect((error as CommandExit).message).toStartWith(`❌ --body-file cannot read "${missing}": `);
  });

  it('refuses a directory, naming it', async () => {
    const directory = mkdtempSync(join(tempBase, 'dir-'));

    const error = await rejectionOf(() => readOpenBody(directory));

    expect(error).toBeInstanceOf(CommandExit);
    expect((error as CommandExit).message).toStartWith(`❌ --body-file cannot read "${directory}": `);
  });

  it('refuses an empty file, and one holding nothing but whitespace', async () => {
    const empty = bodyFile('');
    const blank = bodyFile(' \n\t\n');

    const errors = [await rejectionOf(() => readOpenBody(empty)), await rejectionOf(() => readOpenBody(blank))];

    expect(errors.map(refusalOf)).toEqual([
      [1, `❌ --body-file "${empty}" is empty, and a pull request is not opened with no body\nUsage: ${USAGE}`],
      [1, `❌ --body-file "${blank}" is empty, and a pull request is not opened with no body\nUsage: ${USAGE}`],
    ]);
  });
});

describe('the base warning', () => {
  it('is null for a pull request this run opened, whatever its base', () => {
    expect(baseWarning(result({ pull: summary({ baseRefName: 'main' }) }))).toBeNull();
  });

  it('is null for one already open into the same base', () => {
    expect(baseWarning(result({ opened: false }))).toBeNull();
  });

  it('names both bases for one already open into another', () => {
    const warning = baseWarning(result({ opened: false, pull: summary({ baseRefName: 'main' }) }));

    expect(warning).toBe(`#41 is open from "${HEAD}" into "main", not into "${BASE}"`);
  });
});

describe('the one line', () => {
  it('says opened for a pull request this run opened', () => {
    expect(renderOpen(result())).toBe(`✅ Opened #41 ${TITLE} (${HEAD} → ${BASE}) https://github.com/open-tomato/rafa/pull/41`);
  });

  it('says already open for one it found', () => {
    expect(renderOpen(result({ opened: false }))).toBe(
      `✅ Already open, so none was opened: #41 ${TITLE} (${HEAD} → ${BASE}) https://github.com/open-tomato/rafa/pull/41`,
    );
  });
});
