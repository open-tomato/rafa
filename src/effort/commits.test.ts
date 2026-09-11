/**
 * Tests for the commit effort collector.
 *
 * Every fixture is a PLANTED `git log` capture, so the parse is
 * exercised over merges, binary files, empty commits, a rename and a
 * truncated tail without a repository holding any of them.
 *
 * The plants are anchored rather than invented. {@link RECORDED_LOG}
 * is a verbatim capture taken from this repo with the module's own
 * argv, and it is what says the hand-built plants below describe the
 * shape git actually emits — including the one nobody predicts, that
 * a MERGE emits its header with no blank line after it at all, so two
 * consecutive merges give two adjacent header lines. Its lines are
 * deliberately left unwrapped: a recorded capture that was reflowed to
 * fit a column would no longer be the thing it is cited as.
 *
 * The marker is spelled as a LITERAL here and cross-read against the
 * module's export in a case of its own. Building the plants from the
 * export instead would make the capture and the parser move together,
 * and a marker changed to something a numstat line can begin with
 * would stay green through the whole file.
 *
 * Two cases run REAL git. No planted capture can say the format string
 * is one git accepts — a typo there produces a capture nobody would
 * ever compare against — so the first takes its own capture through
 * {@link commitLogArgs} and requires the module's parse of it to equal
 * what {@link readCommitLog} answers.
 *
 * The second reads a repository this file PLANTS rather than the
 * checkout it runs in. Reading the checkout asserts a property of the
 * ENVIRONMENT, not of the module: CI clones at `fetch-depth: 1`, where
 * one commit is reachable and a `--max-count=3` read correctly answers
 * a single row. The planted repository holds four commits, so the
 * three rows it answers say the cap actually holds rather than that
 * the checkout happened to be deep enough to hide a missing one.
 *
 * Twenty-two module mutations were driven against this file and
 * TWENTY-ONE reddened at least one case, with the restored module
 * green either side and byte-identical: dropping `--source` from the
 * argv, dropping `--numstat`, moving the revision range ahead of the
 * option flags, matching a header without checking the marker, taking
 * the subject as one field instead of the rejoined tail, accepting a
 * truncated header, accepting a marker line carrying no sha, counting
 * a binary file as zero files, refusing a binary file outright,
 * attributing a stat line with no header open, counting a blank line,
 * counting a stat line as unparsed as well as folding it, ordering the
 * gaps by log order instead of by time, measuring each gap against the
 * FOLLOWING commit, giving the oldest commit a zero instead of null,
 * keeping an undated row in the ordering, dropping the `refs/heads/`
 * strip, keeping `HEAD` as a branch name, counting a root commit's
 * absent parents as one, splitting parents on a single space so a
 * multi-space list miscounts, and rounding the elapsed gap to one
 * decimal.
 *
 * ONE stayed green and is named rather than dropped, because it is a
 * property of the module rather than a hole in the suite: splitting
 * lines on the bare newline instead of `/\r?\n/`. The parser trims
 * each line before reading it, so a trailing carriage return never
 * reaches a field and the two splits are behaviourally identical. The
 * CRLF case below is therefore a CHARACTERIZATION case, and calling it
 * a guard would overstate it.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  COMMIT_LOG_FORMAT,
  COMMIT_RECORD_MARKER,
  commitLogArgs,
  minutesBetween,
  parseCommitHeader,
  parseCommitLog,
  readCommitLog,
} from './commits.js';

/** The marker as git emits it, spelled independently of the module. */
const MARKER = '@@ralph-commit@@';

/** Field separator, spelled independently for the same reason. */
const TAB = '\t';

/** A verbatim capture of three commits from this repo. */
const RECORDED_LOG = [
  '@@ralph-commit@@\tf55ee6f2bf2db2d380a46afb030a7f353814a80d\t2026-09-08T12:09:17+02:00\t58c20f163ae318a2a0c26b208c495d2aaa2cd971 3c844f6325ecb56c53c072ce2399fec59679c065\tMarcos Tomatti\tmain\tMerge pull request #44 from marcostomatti/chore/loop-implementer-agent',
  '@@ralph-commit@@\t58c20f163ae318a2a0c26b208c495d2aaa2cd971\t2026-09-08T11:50:46+02:00\t432fb24af0c37c65d9576c0fb8ad35d00d3405d6 5f2479c177dad8688fcd0e2a658475a459b1951f\tMarcos Tomatti\tmain\tMerge pull request #43 from marcostomatti/docs/dedupe-lockfile-finding',
  '@@ralph-commit@@\t3c844f6325ecb56c53c072ce2399fec59679c065\t2026-09-08T11:22:45+02:00\t432fb24af0c37c65d9576c0fb8ad35d00d3405d6\tMarcos Tomatti\tmain\tfeat(agents): add loop-implementer, the executor profile nothing covered',
  '',
  '49\t0\t.claude/agents/loop-implementer.md',
  '',
].join('\n');

/** One header line from its six fields, in the order git emits them. */
function headerLine(
  sha: string,
  timestamp: string,
  parents: string,
  author: string,
  source: string,
  subject: string,
): string {
  return [MARKER, sha, timestamp, parents, author, source, subject]
    .join(TAB);
}

/** One `--numstat` line; both counters read `-` for a binary file. */
function statLine(added: string, removed: string, path: string): string {
  return [added, removed, path].join(TAB);
}

/** A capture from its lines, with the trailing newline git writes. */
function capture(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}

/** A single ordinary commit with whatever stat lines are given. */
function oneCommit(
  sha: string,
  timestamp: string,
  stats: readonly string[],
): string {
  const header = headerLine(
    sha,
    timestamp,
    'aaaa111',
    'A Dev',
    'refs/heads/feat/x',
    `subject for ${sha}`,
  );
  return capture(stats.length === 0
    ? [header]
    : [header, '', ...stats]);
}

describe('the record marker and the log format', () => {
  it('exports the marker the plants are written against', () => {
    expect(COMMIT_RECORD_MARKER).toBe(MARKER);
  });

  it('cannot be mistaken for a numstat line', () => {
    expect(COMMIT_RECORD_MARKER).not.toMatch(/^[\d-]/);
    expect(COMMIT_RECORD_MARKER).not.toContain(TAB);
  });

  it('names every header field in the order the parser reads them', () => {
    expect(COMMIT_LOG_FORMAT).toBe(
      [MARKER, '%H', '%aI', '%P', '%an', '%S', '%s'].join('%x09'),
    );
  });
});

describe('commitLogArgs', () => {
  it('always asks for the source ref and the numstat', () => {
    expect(commitLogArgs()).toEqual([
      'log',
      '--source',
      `--format=${COMMIT_LOG_FORMAT}`,
      '--numstat',
    ]);
  });

  it('adds only the bounds it was given', () => {
    expect(commitLogArgs({ since: '2026-09-01' })).toContain(
      '--since=2026-09-01',
    );
    expect(commitLogArgs({ maxCount: 5 })).toContain('--max-count=5');
    expect(commitLogArgs({ since: '2026-09-01' }))
      .not.toContain('--max-count=5');
  });

  it('puts the revision range last, where a revision belongs', () => {
    const args = commitLogArgs({ revisionRange: 'main..HEAD', maxCount: 2 });

    expect(args[args.length - 1]).toBe('main..HEAD');
    expect(args).toContain('--max-count=2');
  });
});

describe('parseCommitHeader', () => {
  it('reads the six fields with the counters zeroed', () => {
    const line = headerLine(
      'abc123',
      '2026-09-08T12:00:00+02:00',
      'dad111 dad222',
      'A Dev',
      'refs/heads/feat/x',
      'feat: a thing',
    );

    expect(parseCommitHeader(line)).toEqual({
      sha: 'abc123',
      timestamp: '2026-09-08T12:00:00+02:00',
      subject: 'feat: a thing',
      author: 'A Dev',
      branch: 'feat/x',
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
      parentCount: 2,
      minutesSincePrevious: null,
    });
  });

  it('keeps a subject that contains a tab whole', () => {
    const subject = `feat: before${TAB}after`;
    const line = headerLine(
      'abc',
      '2026-09-08T12:00:00Z',
      'p',
      'A',
      'r',
      subject,
    );

    expect(parseCommitHeader(line)?.subject).toBe(subject);
  });

  it('answers null for a line that is not a header', () => {
    expect(parseCommitHeader(statLine('3', '1', 'src/a.ts'))).toBeNull();
    expect(parseCommitHeader('')).toBeNull();
    expect(parseCommitHeader('Merge branch main')).toBeNull();
  });

  it('answers null for a header missing its subject field', () => {
    const short = [MARKER, 'abc', 'ts', 'p', 'A', 'refs/heads/x'].join(TAB);

    expect(parseCommitHeader(short)).toBeNull();
  });

  it('answers null for a marker line carrying no sha', () => {
    const line = headerLine('', 'ts', 'p', 'A', 'r', 'subject');

    expect(parseCommitHeader(line)).toBeNull();
  });

  it('normalises the source ref to a branch, or to null', () => {
    function branchOf(source: string): string | null | undefined {
      return parseCommitHeader(
        headerLine('abc', 'ts', 'p', 'A', source, 's'),
      )?.branch;
    }

    expect(branchOf('refs/heads/feat/q19')).toBe('feat/q19');
    expect(branchOf('main')).toBe('main');
    expect(branchOf('HEAD')).toBeNull();
    expect(branchOf('')).toBeNull();
  });

  it('counts parents, including none at the root commit', () => {
    function parentsOf(parents: string): number | undefined {
      return parseCommitHeader(
        headerLine('abc', 'ts', parents, 'A', 'r', 's'),
      )?.parentCount;
    }

    expect(parentsOf('')).toBe(0);
    expect(parentsOf('aaa111')).toBe(1);
    expect(parentsOf('aaa111 bbb222')).toBe(2);
    expect(parentsOf('aaa111  bbb222   ccc333')).toBe(3);
  });
});

describe('parseCommitLog over the recorded capture', () => {
  const result = parseCommitLog(RECORDED_LOG);

  it('answers one row per commit, in log order', () => {
    expect(result.rows.map((row) => row.sha.slice(0, 7)))
      .toEqual(['f55ee6f', '58c20f1', '3c844f6']);
  });

  it('reads a merge as zero files with two parents', () => {
    const merge = result.rows[0];

    expect(merge?.parentCount).toBe(2);
    expect(merge?.filesChanged).toBe(0);
    expect(merge?.insertions).toBe(0);
    expect(merge?.deletions).toBe(0);
  });

  it('attributes the stat block to the commit it follows', () => {
    const commit = result.rows[2];

    expect(commit?.parentCount).toBe(1);
    expect(commit?.filesChanged).toBe(1);
    expect(commit?.insertions).toBe(49);
    expect(commit?.deletions).toBe(0);
  });

  it('takes the branch from the source ref git was given', () => {
    expect(result.rows.map((row) => row.branch))
      .toEqual(['main', 'main', 'main']);
  });

  it('leaves nothing unparsed and counts no blank line', () => {
    expect(result.unparsedLineCount).toBe(0);
    expect(result.lineCount).toBe(4);
  });

  it('keeps rows + files + unparsed === lineCount', () => {
    const files = result.rows.reduce((n, row) => n + row.filesChanged, 0);

    expect(result.rows.length + files + result.unparsedLineCount)
      .toBe(result.lineCount);
  });
});

describe('parseCommitLog stat handling', () => {
  it('sums insertions and deletions across a commit', () => {
    const text = oneCommit('aaa', '2026-09-08T12:00:00Z', [
      statLine('10', '2', 'src/a.ts'),
      statLine('4', '7', 'src/b.ts'),
    ]);
    const row = parseCommitLog(text).rows[0];

    expect(row?.filesChanged).toBe(2);
    expect(row?.insertions).toBe(14);
    expect(row?.deletions).toBe(9);
  });

  it('counts a binary file but adds nothing to either counter', () => {
    const text = oneCommit('aaa', '2026-09-08T12:00:00Z', [
      statLine('5', '1', 'src/a.ts'),
      statLine('-', '-', 'docs/diagram.png'),
    ]);
    const row = parseCommitLog(text).rows[0];

    expect(row?.filesChanged).toBe(2);
    expect(row?.insertions).toBe(5);
    expect(row?.deletions).toBe(1);
  });

  it('counts a rename as the one file git reports it as', () => {
    const text = oneCommit('aaa', '2026-09-08T12:00:00Z', [
      statLine('0', '0', 'src/{old => new}/a.ts'),
    ]);
    const row = parseCommitLog(text).rows[0];

    expect(row?.filesChanged).toBe(1);
  });

  it('reads an empty commit as zero files with one parent', () => {
    const row = parseCommitLog(
      oneCommit('aaa', '2026-09-08T12:00:00Z', []),
    ).rows[0];

    expect(row?.filesChanged).toBe(0);
    expect(row?.parentCount).toBe(1);
  });
});

describe('parseCommitLog line accounting', () => {
  it('reads an empty capture as no rows and no lines', () => {
    expect(parseCommitLog('')).toEqual({
      rows: [],
      lineCount: 0,
      unparsedLineCount: 0,
    });
  });

  it('counts a stat line arriving before any header as unparsed', () => {
    const text = capture([
      statLine('3', '1', 'src/orphan.ts'),
      headerLine('aaa', '2026-09-08T12:00:00Z', 'p', 'A', 'r', 's'),
      '',
      statLine('2', '0', 'src/a.ts'),
    ]);
    const result = parseCommitLog(text);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.filesChanged).toBe(1);
    expect(result.unparsedLineCount).toBe(1);
    expect(result.lineCount).toBe(3);
  });

  it('refuses a header-width line that carries no marker', () => {
    const impostor = ['3', '0', 'a', 'b', 'c', 'd', 'e'].join(TAB);
    const text = capture([
      headerLine('aaa', '2026-09-08T12:00:00Z', 'p', 'A', 'r', 's'),
      '',
      impostor,
    ]);
    const result = parseCommitLog(text);

    expect(result.rows.map((row) => row.sha)).toEqual(['aaa']);
    expect(result.rows[0]?.filesChanged).toBe(1);
    expect(result.unparsedLineCount).toBe(0);
  });

  it('counts a line that is neither header nor stat as unparsed', () => {
    const text = capture([
      headerLine('aaa', '2026-09-08T12:00:00Z', 'p', 'A', 'r', 's'),
      '',
      ' 1 file changed, 3 insertions(+)',
      statLine('3', '0', 'src/a.ts'),
    ]);
    const result = parseCommitLog(text);

    expect(result.rows[0]?.filesChanged).toBe(1);
    expect(result.unparsedLineCount).toBe(1);
  });

  it('counts a truncated final header as unparsed, with no row', () => {
    const text = [
      headerLine('aaa', '2026-09-08T12:00:00Z', 'p', 'A', 'r', 's'),
      '',
      statLine('3', '0', 'src/a.ts'),
      `${MARKER}${TAB}bbb${TAB}2026-09`,
    ].join('\n');
    const result = parseCommitLog(text);

    expect(result.rows).toHaveLength(1);
    expect(result.unparsedLineCount).toBe(1);
    expect(result.lineCount).toBe(3);
  });

  it('keeps the arithmetic exact on a mixed capture', () => {
    const text = capture([
      statLine('1', '1', 'orphan.ts'),
      headerLine('aaa', '2026-09-08T12:00:00Z', 'p', 'A', 'r', 's'),
      '',
      statLine('3', '0', 'src/a.ts'),
      'not a line git wrote',
      headerLine('bbb', '2026-09-08T12:30:00Z', 'p q', 'A', 'r', 's'),
    ]);
    const result = parseCommitLog(text);
    const files = result.rows.reduce((n, row) => n + row.filesChanged, 0);

    expect(result.rows).toHaveLength(2);
    expect(result.unparsedLineCount).toBe(2);
    expect(result.rows.length + files + result.unparsedLineCount)
      .toBe(result.lineCount);
  });

  // Characterization, not a guard — see the header on the one
  // mutation this suite does not catch.
  it('reads a CRLF capture the same way', () => {
    const text = [
      headerLine('aaa', '2026-09-08T12:00:00Z', 'p', 'A', 'r', 's'),
      '',
      statLine('3', '0', 'src/a.ts'),
      '',
    ].join('\r\n');
    const result = parseCommitLog(text);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.filesChanged).toBe(1);
    expect(result.unparsedLineCount).toBe(0);
  });
});

describe('minutesBetween', () => {
  it('answers the gap in minutes, to three decimals', () => {
    expect(minutesBetween(
      '2026-09-08T12:00:00Z',
      '2026-09-08T12:30:00Z',
    )).toBe(30);
    expect(minutesBetween(
      '2026-09-08T12:00:00Z',
      '2026-09-08T12:04:40Z',
    )).toBe(4.667);
  });

  it('reads an offset and a Z stamp as the same instant', () => {
    expect(minutesBetween(
      '2026-09-08T12:00:00+02:00',
      '2026-09-08T10:30:00Z',
    )).toBe(30);
  });

  it('answers null when either stamp does not parse', () => {
    expect(minutesBetween('not a date', '2026-09-08T12:00:00Z')).toBeNull();
    expect(minutesBetween('2026-09-08T12:00:00Z', 'not a date')).toBeNull();
  });
});

describe('elapsed minutes across a capture', () => {
  /** Three commits whose LOG order is not their time order. */
  const outOfOrder = capture([
    headerLine('aaa', '2026-09-08T12:00:00Z', 'p', 'A', 'r', 'newest'),
    headerLine('bbb', '2026-09-08T11:00:00Z', 'p', 'A', 'r', 'oldest'),
    headerLine('ccc', '2026-09-08T11:30:00Z', 'p', 'A', 'r', 'middle'),
  ]);

  it('gives the oldest commit in the range no gap at all', () => {
    const rows = parseCommitLog(outOfOrder).rows;

    expect(rows.find((row) => row.sha === 'bbb')?.minutesSincePrevious)
      .toBeNull();
  });

  it('measures each gap against the preceding commit in time order', () => {
    const rows = parseCommitLog(outOfOrder).rows;
    function gapOf(sha: string): number | null | undefined {
      return rows.find((row) => row.sha === sha)?.minutesSincePrevious;
    }

    expect(gapOf('ccc')).toBe(30);
    expect(gapOf('aaa')).toBe(30);
  });

  it('leaves the rows in the order the log emitted them', () => {
    expect(parseCommitLog(outOfOrder).rows.map((row) => row.sha))
      .toEqual(['aaa', 'bbb', 'ccc']);
  });

  it('drops a commit with no usable stamp out of the ordering', () => {
    const text = capture([
      headerLine('aaa', '2026-09-08T12:00:00Z', 'p', 'A', 'r', 'newest'),
      headerLine('bad', 'not a date', 'p', 'A', 'r', 'undated'),
      headerLine('bbb', '2026-09-08T11:00:00Z', 'p', 'A', 'r', 'oldest'),
    ]);
    const rows = parseCommitLog(text).rows;
    function gapOf(sha: string): number | null | undefined {
      return rows.find((row) => row.sha === sha)?.minutesSincePrevious;
    }

    expect(gapOf('bad')).toBeNull();
    expect(gapOf('bbb')).toBeNull();
    expect(gapOf('aaa')).toBe(60);
  });
});

describe('readCommitLog against real git', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'ralph-commits-'));

  afterAll(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  let planted = 0;

  /** A repository holding `count` commits on one linear branch. */
  function plantRepo(count: number): string {
    planted += 1;
    const dir = join(tempRoot, `repo-${planted}`);
    mkdirSync(dir, { recursive: true });
    function git(...args: string[]): string {
      return execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    }

    git('init', '-q', '.');
    git('config', 'user.email', 'loop@example.test');
    git('config', 'user.name', 'Ralph Loop');
    git('config', 'commit.gpgsign', 'false');
    for (let n = 1; n <= count; n += 1) {
      writeFileSync(join(dir, `file-${n}.txt`), `body ${n}\n`, 'utf8');
      git('add', '-A');
      git('commit', '-q', '-m', `commit ${n}`);
    }
    return dir;
  }

  /** Reads back from the repository, never through the module. */
  function inRepo(dir: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  }

  it('parses what the argv it builds actually returns', () => {
    const args = commitLogArgs({ maxCount: 3 });
    const raw = execFileSync('git', args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

    expect(raw).toContain(COMMIT_RECORD_MARKER);
    expect(parseCommitLog(raw).rows)
      .toEqual(readCommitLog({ maxCount: 3 }).rows);
  });

  it('answers HEAD as its first row, with a full sha', () => {
    const dir = plantRepo(4);
    const head = inRepo(dir, 'rev-parse', 'HEAD');
    const rows = readCommitLog({ maxCount: 3, cwd: dir }).rows;

    expect(rows).toHaveLength(3);
    expect(rows[0]?.sha).toBe(head);
    expect(rows[0]?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(rows[0]?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
