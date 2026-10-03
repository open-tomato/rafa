/**
 * The last check between the fixture extractor and the repository: it
 * reads every file `git ls-files` lists under
 * `src/effort/store/testdata/merge/` — the merge fixtures
 * `fixture-extract.ts` writes and `merge-scenarios.test.ts` reads back —
 * and fails the suite if any of the three shapes a real machine's
 * identity leaks through turns up in one:
 *
 *   - a home directory path (`/home/<name>`, `/Users/<name>` or
 *     `C:\Users\<name>`), which `fixture-extract.ts`'s own doc calls
 *     out as one of the things that must never survive an extract;
 *   - the host name of the machine the suite is running on
 *     ({@link hostname}), so a fixture captured on one device cannot be
 *     told apart from where it was taken;
 *   - an email address.
 *
 * `git ls-files` and not `readdirSync`, so the check runs over what a
 * commit would actually ship rather than over scratch files a run under
 * `tmpdir()` happened to leave beside the fixtures on this machine.
 *
 * {@link findLeaks} is exercised directly first, each planted control
 * varied along exactly one of the three axes and holding the other two
 * clean, so a check that always answered `[]` reddens here before it
 * gets anywhere near the real fixtures — the failure the scan over
 * `testdata/merge/` exists to catch is silent otherwise, since that
 * directory holds nothing yet.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

/** What one leak {@link findLeaks} reports names. */
export interface Leak {
  readonly kind: 'email address' | 'home path' | 'host name';
  readonly match: string;
}

/** A Unix or macOS home directory path naming someone. */
const HOME_PATH_UNIX = /\/(?:home|Users)\/[^\s"'`,]+/g;

/** A Windows home directory path naming someone. */
const HOME_PATH_WINDOWS = /C:\\Users\\[^\s"'`,]+/g;

/** An email address. */
const EMAIL_ADDRESS = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/**
 * Every home path, host name occurrence and email address in `text`, in
 * the order the patterns are checked. `host` is the running machine's
 * {@link hostname}; a blank one (never true of a real machine, but
 * possible for a planted control) matches nothing, since an empty
 * string is a substring of everything.
 */
export function findLeaks(text: string, host: string): Leak[] {
  const leaks: Leak[] = [];
  for (const match of text.matchAll(HOME_PATH_UNIX)) leaks.push({ kind: 'home path', match: match[0] });
  for (const match of text.matchAll(HOME_PATH_WINDOWS)) leaks.push({ kind: 'home path', match: match[0] });
  for (const match of text.matchAll(EMAIL_ADDRESS)) leaks.push({ kind: 'email address', match: match[0] });
  if (host !== '' && text.includes(host)) leaks.push({ kind: 'host name', match: host });
  return leaks;
}

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURES_DIR = join('src', 'effort', 'store', 'testdata', 'merge');

/** Paths `git ls-files` tracks under `FIXTURES_DIR`, repo-relative, blanks dropped. */
function trackedFixtureFiles(): string[] {
  return execFileSync('git', ['ls-files', FIXTURES_DIR], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((line) => line !== '');
}

describe('findLeaks', () => {
  it('reports a Unix home path, and nothing over a path that merely mentions "home"', () => {
    expect(findLeaks('the source sat at /home/alice/.rafa/effort/effort.sqlite', 'irrelevant-host'))
      .toEqual([{ kind: 'home path', match: '/home/alice/.rafa/effort/effort.sqlite' }]);
    expect(findLeaks('a store "home" directory, described in prose', 'irrelevant-host')).toEqual([]);
  });

  it('reports a macOS and a Windows home path', () => {
    expect(findLeaks('/Users/bob/p/effort.sqlite', 'irrelevant-host'))
      .toEqual([{ kind: 'home path', match: '/Users/bob/p/effort.sqlite' }]);
    expect(findLeaks('C:\\Users\\carol\\p\\effort.sqlite', 'irrelevant-host'))
      .toEqual([{ kind: 'home path', match: 'C:\\Users\\carol\\p\\effort.sqlite' }]);
  });

  it('reports the running host name, and nothing when the text never names it', () => {
    expect(findLeaks(`minted on ${hostname()} at boot`, hostname())).toEqual([{ kind: 'host name', match: hostname() }]);
    expect(findLeaks('minted on some other box', hostname())).toEqual([]);
  });

  it('reports an email address', () => {
    expect(findLeaks('author: Alice <alice@example.com>', 'irrelevant-host'))
      .toEqual([{ kind: 'email address', match: 'alice@example.com' }]);
  });

  it('reports all three together, and nothing at all over clean anonymised text', () => {
    const dirty = `host ${hostname()}, path /home/alice/p, contact alice@example.com`;
    expect(findLeaks(dirty, hostname())).toEqual([
      { kind: 'home path', match: '/home/alice/p' },
      { kind: 'email address', match: 'alice@example.com' },
      { kind: 'host name', match: hostname() },
    ]);
    expect(findLeaks('anon:0123456789abcdef01234567, 2026-09-28T10:00:00.000Z, "session_id"', hostname())).toEqual([]);
  });
});

describe('every committed fixture under testdata/merge/', () => {
  it('carries none of the three leaks, over every file git tracks there', () => {
    const files = trackedFixtureFiles();
    const host = hostname();

    const found = files.flatMap((relativePath) => {
      const text = readFileSync(join(REPO_ROOT, relativePath), 'utf8');
      return findLeaks(text, host).map((leak) => ({ file: relativePath, ...leak }));
    });

    expect(found).toEqual([]);
  });
});
