/**
 * Tests for the local path redaction triage runs before a bug's key and
 * text are built (`src/triage/local-paths.ts`).
 *
 * Every root here is a path that does not exist, so no realpath form is
 * added and each case reads only the text it names; the case with a real
 * directory makes its own under the temporary directory.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { HOME_MARKER, localPathRedactor } from './local-paths.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-local-paths-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const REPO = '/Users/alice/projects/rafa';
const HOME = '/Users/alice';

const redact = localPathRedactor(REPO, HOME);

describe('localPathRedactor', () => {
  it('makes a path under the repository root relative to it', () => {
    expect(redact(`${REPO}/.rafa/plans/PLAN-demo.md: heading missing`))
      .toBe('.rafa/plans/PLAN-demo.md: heading missing');
  });

  it('answers the bare repository root as the current directory', () => {
    expect(redact(`cd ${REPO} && bun test`)).toBe('cd . && bun test');
  });

  it('marks the home directory in a path under it but outside the root', () => {
    expect(redact(`${HOME}/.bun/bin/bun exited 1`)).toBe(`${HOME_MARKER}/.bun/bin/bun exited 1`);
  });

  it('marks any /Users/<name> and /home/<name> home, whoever the home of this run is', () => {
    expect(redact('/home/bob/.cache/x and /Users/carol/y'))
      .toBe(`${HOME_MARKER}/.cache/x and ${HOME_MARKER}/y`);
  });

  it('marks a home directory that follows no pattern when it is the run\'s own', () => {
    const odd = localPathRedactor('/nowhere/repo', '/var/lib/rafa');
    expect(odd('/var/lib/rafa/cache/x')).toBe(`${HOME_MARKER}/cache/x`);
  });

  it('reads every path in the text, in quotes, parentheses and a file URL', () => {
    expect(redact(`"${REPO}/a.ts" (${HOME}/b) file://${HOME}/c`))
      .toBe(`"a.ts" (${HOME_MARKER}/b) file://${HOME_MARKER}/c`);
  });

  it('answers the root followed by a bare slash as the current directory, never as nothing', () => {
    expect(redact(`cd ${REPO}/ && ls`)).toBe('cd ./ && ls');
    expect(redact(`${REPO}/`)).toBe('./');
  });

  it('keeps what follows another user\'s home name: a line number, a comma', () => {
    expect(redact('/Users/bob:12, /home/carol; done')).toBe(`${HOME_MARKER}:12, ${HOME_MARKER}; done`);
  });

  it('marks a home under an absolute prefix: a WSL mount, a macOS data volume', () => {
    expect(redact('/mnt/c/Users/bob/x and /System/Volumes/Data/Users/alice/y'))
      .toBe(`${HOME_MARKER}/x and ${HOME_MARKER}/y`);
  });

  it('reads a path glued to a short flag', () => {
    expect(redact(`-I/Users/bob/inc -I${REPO}/include`)).toBe(`-I${HOME_MARKER}/inc -Iinclude`);
  });

  it('control: a sibling of the root sharing its prefix is not taken as under it', () => {
    expect(redact(`${REPO}-old/src/a.ts`)).toBe(`${HOME_MARKER}/projects/rafa-old/src/a.ts`);
  });

  it('control: a relative path holding home or Users, and a system path, are left as they are', () => {
    const text = 'src/home/user/a.ts docs/Users/bob.md /usr/local/bin/bun /etc/hosts';
    expect(redact(text)).toBe(text);
  });

  it('control: text with no path is left as it is', () => {
    expect(redact('TypeError: lines.at(-1) is undefined')).toBe('TypeError: lines.at(-1) is undefined');
  });

  it('makes a path under the root\'s real location relative too, when the root is a link', () => {
    const real = join(tempBase, 'real-repo');
    const link = join(tempBase, 'linked-repo');
    mkdirSync(real);
    symlinkSync(real, link);

    const viaLink = localPathRedactor(link, '/nowhere/home');

    expect(viaLink(`${realpathSync(real)}/src/a.ts and ${link}/src/b.ts`)).toBe('src/a.ts and src/b.ts');
  });
});
