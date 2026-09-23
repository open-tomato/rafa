/**
 * Tests for taking a root (`root-choice.ts`): each candidate as the list
 * shows it, the question, `--yes`'s first candidate, a named path, each
 * kind of answer and the prompt loop, over a scripted prompter; the line
 * prompter itself is tested in `src/cli/prompt/confirm.test.ts`.
 *
 * The candidates are built here, over directories under this file's own
 * temporary root, so each case names exactly the list it reads. One
 * fixture is answered by `rootCandidates` itself, for the home refused as
 * the first candidate, with a git probe answering no repository. A named
 * path is refused and resolved over the disk, and every root answered is
 * asserted to sit under the temporary root.
 */
import type { RootReading } from './root-choice.js';
import type { RootCandidate, RootCandidates } from './roots.js';
import type { Prompter } from '../cli/prompt/confirm.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  candidateLines,
  describeCandidate,
  firstCandidate,
  namedRoot,
  promptForRoot,
  readRootAnswer,
  rootQuestion,
} from './root-choice.js';
import { rootCandidates } from './roots.js';

/** A temporary directory of this file's own, its real path. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-root-choice-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The home every refusal compares against. */
const HOME = join(tempBase, 'home');

/** A monorepo root holding a repository. */
const MONO = join(tempBase, 'mono');

/** The repository, the start of {@link OPEN}. */
const REPO = join(MONO, 'repo');

/** A directory under the repository, named by a relative path. */
const SUB = join(REPO, 'sub');

/** A directory under the repository named by digits alone. */
const DIGITS = join(REPO, '2');

for (const dir of [HOME, SUB, DIGITS]) mkdirSync(dir, { recursive: true });

/** The seams every refusal reads: the home, and the disk. */
const SEAMS = { home: HOME };

/** A candidate a project may take. */
function open(path: string, source: RootCandidate['source'], markers: readonly string[] = []): RootCandidate {
  return { path, source, markers, refusal: null };
}

/** Two candidates, neither refused: the repository, then the monorepo root. */
const OPEN: RootCandidates = {
  start: REPO,
  candidates: [open(REPO, 'git-toplevel'), open(MONO, 'monorepo', ['package.json', 'turbo.json'])],
  warnings: [],
};

/** The candidates `rootCandidates` answers from the home outside a repository: the home, refused. */
const REFUSED_FIRST = rootCandidates(HOME, { home: HOME, gitToplevel: () => null });

/** The reason the home is refused. */
const HOME_REASON = `${HOME} is the home directory, whose .rafa/ is the user scope`;

/** A prompter answering from `answers`, then null, recording what it was told and asked. */
function scripted(answers: readonly string[]): { prompter: Prompter; said: string[]; asked: string[] } {
  const said: string[] = [];
  const asked: string[] = [];
  const queue = [...answers];
  const prompter: Prompter = {
    say: (text) => {
      said.push(text);
    },
    ask: async (question) => {
      asked.push(question);
      return queue.shift() ?? null;
    },
    close: () => undefined,
  };
  return { prompter, said, asked };
}

/** A root reading of `path` from `source`. */
function rootOf(path: string, source: string): RootReading {
  return { root: { path, source } as NonNullable<RootReading['root']>, problem: null };
}

describe('the list', () => {
  it('describes each source, with the markers a candidate holds', () => {
    expect(describeCandidate(open(REPO, 'git-toplevel'))).toBe('the git toplevel');
    expect(describeCandidate(open(REPO, 'directory'))).toBe('this directory, in no git repository');
    expect(describeCandidate(open(MONO, 'monorepo', ['package.json', 'turbo.json'])))
      .toBe('the outermost monorepo root, marked by package.json, turbo.json');
    expect(describeCandidate(open(REPO, 'git-toplevel', ['nx.json']))).toBe('the git toplevel, marked as a monorepo by nx.json');
  });

  it('numbers each candidate from 1 after the start, the paths padded to one column', () => {
    expect(candidateLines(OPEN)).toEqual([
      `Root candidates for a rafa project, from ${REPO}:`,
      `  1) ${REPO}   the git toplevel`,
      `  2) ${MONO.padEnd(REPO.length)}   the outermost monorepo root, marked by package.json, turbo.json`,
    ]);
  });

  it('lists a refused candidate with its number and its reason', () => {
    expect(REFUSED_FIRST.candidates).toHaveLength(1);
    expect(candidateLines(REFUSED_FIRST)).toEqual([
      `Root candidates for a rafa project, from ${HOME}:`,
      `  1) ${HOME}   this directory, in no git repository; refused: ${HOME_REASON}`,
    ]);
  });

  it('shows [1] in the question only when the first candidate can be taken', () => {
    expect(rootQuestion(OPEN)).toBe('Type a candidate\'s number or a path [1]: ');
    expect(rootQuestion(REFUSED_FIRST)).toBe('Type a candidate\'s number or a path: ');
  });
});

describe('firstCandidate and namedRoot', () => {
  it('takes the first candidate, and answers its reason when it is refused', () => {
    expect(firstCandidate(OPEN)).toEqual(rootOf(REPO, 'git-toplevel'));
    expect(firstCandidate(REFUSED_FIRST)).toEqual({ root: null, problem: HOME_REASON });
  });

  it('resolves a relative path against the start and answers it with the source given', () => {
    expect(namedRoot('sub', REPO, 'root-flag', SEAMS)).toEqual(rootOf(SUB, 'root-flag'));
    expect(namedRoot('.', SUB, 'typed', SEAMS)).toEqual(rootOf(SUB, 'typed'));
    expect(namedRoot(MONO, SUB, 'typed', SEAMS)).toEqual(rootOf(MONO, 'typed'));
  });

  it('answers the real path of a root named through a link', () => {
    const link = join(tempBase, 'link-to-sub');
    symlinkSync(SUB, link);

    const reading = namedRoot(link, tempBase, 'root-flag', SEAMS);

    expect(reading).toEqual(rootOf(SUB, 'root-flag'));
    expect(reading.root?.path).not.toBe(link);
  });

  it('answers the reason for the home, for /, and for a path that does not resolve', () => {
    const missing = join(tempBase, 'missing');

    expect(namedRoot(HOME, REPO, 'root-flag', SEAMS)).toEqual({ root: null, problem: HOME_REASON });
    expect(namedRoot('/', REPO, 'root-flag', SEAMS)).toEqual({ root: null, problem: '/ is the filesystem root' });
    expect(namedRoot('missing', tempBase, 'typed', SEAMS).problem)
      .toStartWith(`${missing} does not resolve, so no project tree can be written under it (`);
  });
});

describe('readRootAnswer', () => {
  it('takes the first candidate for an empty answer, and names what to type when it is refused', () => {
    expect(readRootAnswer('', OPEN, SEAMS)).toEqual(rootOf(REPO, 'git-toplevel'));
    expect(readRootAnswer('   ', OPEN, SEAMS)).toEqual(rootOf(REPO, 'git-toplevel'));
    expect(readRootAnswer('', REFUSED_FIRST, SEAMS)).toEqual({ root: null, problem: 'type a candidate\'s number or a path' });
  });

  it('takes the candidate a number names, trimmed, and refuses a number naming none', () => {
    expect(readRootAnswer(' 2 ', OPEN, SEAMS)).toEqual(rootOf(MONO, 'monorepo'));
    expect(readRootAnswer('3', OPEN, SEAMS)).toEqual({ root: null, problem: 'no candidate is numbered 3; type 1 to 2, or a path' });
    expect(readRootAnswer('0', OPEN, SEAMS)).toEqual({ root: null, problem: 'no candidate is numbered 0; type 1 to 2, or a path' });
  });

  it('answers the reason for the number of a refused candidate', () => {
    expect(readRootAnswer('1', REFUSED_FIRST, SEAMS)).toEqual({ root: null, problem: HOME_REASON });
  });

  it('reads anything else as a path from the start, digits reached through ./', () => {
    expect(readRootAnswer('sub', OPEN, SEAMS)).toEqual(rootOf(SUB, 'typed'));
    expect(readRootAnswer('./2', OPEN, SEAMS)).toEqual(rootOf(DIGITS, 'typed'));
    expect(readRootAnswer(HOME, OPEN, SEAMS)).toEqual({ root: null, problem: HOME_REASON });
  });
});

describe('promptForRoot', () => {
  it('lists the candidates, says each problem and asks again until an answer names a root', async () => {
    const script = scripted(['7', HOME, 'sub']);

    const root = await promptForRoot(OPEN, script.prompter, SEAMS);

    expect(root).toEqual({ path: SUB, source: 'typed' });
    expect(script.said).toEqual([
      candidateLines(OPEN).join('\n'),
      'no candidate is numbered 7; type 1 to 2, or a path',
      HOME_REASON,
    ]);
    expect(script.asked).toEqual(Array.from({ length: 3 }, () => rootQuestion(OPEN)));
  });

  it('answers null once the input ends, after listing the candidates and asking once', async () => {
    const script = scripted([]);

    const root = await promptForRoot(REFUSED_FIRST, script.prompter, SEAMS);

    expect(root).toBeNull();
    expect(script.said).toEqual([candidateLines(REFUSED_FIRST).join('\n')]);
    expect(script.asked).toEqual([rootQuestion(REFUSED_FIRST)]);
  });
});
