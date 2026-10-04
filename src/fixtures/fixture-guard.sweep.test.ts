/**
 * The last check between the fixture extractors and the repository: it
 * reads every file `git ls-files` lists under a `testdata/` folder or
 * `src/tests/fixtures/` (the paths {@link isFixturePath} names) and fails
 * the suite if any leaks a machine's identity: a home directory path, the
 * host name of the machine running the suite, or an email address. Leaks
 * are read through {@link findLeaks}, the one definition the extractors
 * share, so a version pin such as `zod@3.22.4` is no address.
 *
 * `git ls-files` and not a directory walk, so the check runs over what a
 * commit would ship rather than over scratch files a run left on this
 * machine.
 *
 * The control files in `testdata/leak-controls/` plant one leak each
 * (email, home path, host name), plus a version pin that holds none. The
 * guard must fail on the first three and pass the pin, which keeps a
 * check that always answered `[]` from passing the tree in silence. The
 * host control holds the token `{{HOST}}`, filled with the running host
 * name at read time since a committed file cannot hold it. The folder is
 * left out of the tree pass, since its files leak on purpose.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

import { isFixturePath } from './fixture-path.js';
import { findLeaks } from './scrub.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CONTROLS_DIR = 'src/fixtures/testdata/leak-controls/';
const HOST_TOKEN = '{{HOST}}';

/** Tracked fixture files, repo-relative, blanks dropped. */
function trackedFixtureFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((line) => line !== '' && isFixturePath(line));
}

/** A file's text with the host token filled by the running host name. */
function readFixture(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8').replaceAll(HOST_TOKEN, hostname());
}

/** The leak kinds the guard finds in one file. */
function kindsIn(relativePath: string): string[] {
  return findLeaks(readFixture(relativePath), hostname()).map((leak) => leak.kind);
}

describe('the guard over its planted controls', () => {
  it.each([
    ['email.txt', 'email address'],
    ['home-path.txt', 'home path'],
    ['host-name.txt', 'host name'],
  ])('fails on %s with a %s', (file, kind) => {
    expect(kindsIn(CONTROLS_DIR + file)).toEqual([kind]);
  });

  it('passes the version-pin control', () => {
    expect(kindsIn(`${CONTROLS_DIR}version-pin.txt`)).toEqual([]);
  });

  it('tracks the controls, so the tree pass sees what it must skip', () => {
    expect(trackedFixtureFiles()).toContain(`${CONTROLS_DIR}host-name.txt`);
  });
});

describe('every tracked fixture file', () => {
  it('carries no home path, host name or email address', () => {
    const host = hostname();
    const found = trackedFixtureFiles()
      .filter((path) => !path.startsWith(CONTROLS_DIR))
      .flatMap((path) => findLeaks(readFixture(path), host).map((leak) => ({ file: path, ...leak })));

    expect(found).toEqual([]);
  });
});
