/**
 * Tests for the pull request provider (`src/pr/provider.ts`).
 *
 * The remote probe is a seam, so every case but one hands over its own
 * `readRemote` and no case reads the checkout this suite runs in. The
 * exception is the pair measuring the DEFAULT seam, which is a spawn
 * and so is measured by spawning: a scratch repository under
 * `mkdtemp`, its `origin` added by `git remote add`, with global and
 * system git config pointed at `/dev/null`, and a scratch directory no
 * repository holds as its control. Neither touches the real home, a
 * network or GitHub.
 *
 * The reading this file exists for is the one the module note calls the
 * shared refusal: two refusals with different causes carry the same
 * string, so a later edit that helpfully names the cause reddens here.
 */
import type { PrProviderReading } from './provider.js';

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '../cli/command.js';

import {
  isGitHubRemote,
  PR_NEEDS_GH,
  PR_REFUSAL_EXIT,
  remoteHost,
  requireGhProvider,
  resolvePrProvider,
} from './provider.js';

/** Every scratch directory made here, removed when the file is done. */
const scratchDirs: string[] = [];

/** A directory of this file's own, under the system temporary directory. */
function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rafa-pr-provider-'));
  scratchDirs.push(dir);
  return dir;
}

/** A probe answering `url` for every directory. */
function remoteOf(url: string | null): (dir: string) => string | null {
  return () => url;
}

/** The reading for `dir`, with `origin` answered by `remoteOf`. */
function readingFor(configured: 'gh' | 'none' | null, url: string | null): PrProviderReading {
  return resolvePrProvider({ configured, dir: '/nowhere', readRemote: remoteOf(url) });
}

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

describe('reading a host off a remote', () => {
  it('reads the host of each spelling git takes for the same repository', () => {
    expect(remoteHost('https://github.com/open-tomato/rafa.git')).toBe('github.com');
    expect(remoteHost('git@github.com:open-tomato/rafa.git')).toBe('github.com');
    expect(remoteHost('ssh://git@ssh.github.com:443/open-tomato/rafa')).toBe('ssh.github.com');
    expect(remoteHost('git://github.com/open-tomato/rafa')).toBe('github.com');
    expect(remoteHost('https://user:token@github.com/open-tomato/rafa')).toBe('github.com');
  });

  it('answers null for a filesystem remote, whatever it is called', () => {
    expect(remoteHost('/srv/git/rafa.git')).toBeNull();
    expect(remoteHost('../mirrors/github.com/rafa')).toBeNull();
    expect(remoteHost('file:///srv/git/rafa.git')).toBeNull();
    expect(remoteHost('')).toBeNull();
    expect(remoteHost('   ')).toBeNull();
  });

  it('answers null for a host with no dot in it, which names no site', () => {
    expect(remoteHost('git@localhost:rafa.git')).toBeNull();
  });
});

describe('whether a remote is a GitHub one', () => {
  it('accepts every spelling of a github.com remote, in any case', () => {
    expect(isGitHubRemote('https://github.com/open-tomato/rafa.git')).toBe(true);
    expect(isGitHubRemote('git@github.com:open-tomato/rafa.git')).toBe(true);
    expect(isGitHubRemote('https://GitHub.com/open-tomato/rafa')).toBe(true);
    expect(isGitHubRemote('ssh://git@ssh.github.com:443/open-tomato/rafa')).toBe(true);
  });

  it('refuses another host, an Enterprise one included', () => {
    expect(isGitHubRemote('git@gitlab.com:open-tomato/rafa.git')).toBe(false);
    expect(isGitHubRemote('https://github.example.com/open-tomato/rafa')).toBe(false);
    expect(isGitHubRemote('https://notgithub.com/open-tomato/rafa')).toBe(false);
    expect(isGitHubRemote('/srv/git/rafa.git')).toBe(false);
    expect(isGitHubRemote('')).toBe(false);
  });
});

describe('resolving the provider with nothing configured', () => {
  it('answers gh for a GitHub origin, naming the remote and its host', () => {
    const reading = readingFor(null, 'git@github.com:open-tomato/rafa.git');

    expect(reading.provider).toBe('gh');
    expect(reading.source).toBe('remote');
    expect(reading.remote).toBe('git@github.com:open-tomato/rafa.git');
    expect(reading.host).toBe('github.com');
  });

  it('answers none for an origin on another host, which is the control', () => {
    const reading = readingFor(null, 'git@gitlab.com:open-tomato/rafa.git');

    expect(reading.provider).toBe('none');
    expect(reading.source).toBe('remote');
    expect(reading.host).toBe('gitlab.com');
  });

  it('answers none with no origin at all, and names neither remote nor host', () => {
    const reading = readingFor(null, null);

    expect(reading.provider).toBe('none');
    expect(reading.source).toBe('remote');
    expect(reading.remote).toBeNull();
    expect(reading.host).toBeNull();
  });
});

describe('resolving the provider with pr.provider named', () => {
  it('answers none over a GitHub origin, because the file outranks the probe', () => {
    const reading = readingFor('none', 'git@github.com:open-tomato/rafa.git');

    expect(reading.provider).toBe('none');
    expect(reading.source).toBe('config');
  });

  it('answers gh over an origin the probe reads as another host', () => {
    const reading = readingFor('gh', 'git@github.example.com:open-tomato/rafa.git');

    expect(reading.provider).toBe('gh');
    expect(reading.source).toBe('config');
  });

  it('still reads the remote, so the host the next preflight item asks about is there', () => {
    const reading = readingFor('gh', 'https://github.example.com/open-tomato/rafa');

    expect(reading.remote).toBe('https://github.example.com/open-tomato/rafa');
    expect(reading.host).toBe('github.example.com');
  });

  it('answers the configured provider with no origin to read', () => {
    const reading = readingFor('gh', null);

    expect(reading.provider).toBe('gh');
    expect(reading.source).toBe('config');
    expect(reading.remote).toBeNull();
  });
});

describe('the default probe, which is a spawn', () => {
  it('reads the origin of the repository it is pointed at', () => {
    const dir = scratchDir();
    const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
    spawnSync('git', ['init', '-q'], { cwd: dir, env });
    spawnSync('git', ['remote', 'add', 'origin', 'git@github.com:open-tomato/rafa.git'], {
      cwd: dir,
      env,
    });

    const reading = resolvePrProvider({ configured: null, dir });

    expect(reading.provider).toBe('gh');
    expect(reading.remote).toBe('git@github.com:open-tomato/rafa.git');
  });

  it('answers none in a directory no repository holds, which is the control', () => {
    const reading = resolvePrProvider({ configured: null, dir: scratchDir() });

    expect(reading.provider).toBe('none');
    expect(reading.remote).toBeNull();
  });
});

describe('the refusal every pr action shares', () => {
  it('passes a gh reading through, narrowed, and throws nothing', () => {
    const reading = readingFor(null, 'https://github.com/open-tomato/rafa.git');
    const gh = requireGhProvider(reading);

    expect(gh.provider).toBe('gh');
    expect(gh.remote).toBe(reading.remote);
    expect(gh.host).toBe(reading.host);
  });

  it('throws CommandExit with exit code 2 for a provider that is not gh', () => {
    let thrown: unknown = null;
    try {
      requireGhProvider(readingFor('none', 'https://github.com/open-tomato/rafa.git'));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CommandExit);
    expect((thrown as CommandExit).exitCode).toBe(PR_REFUSAL_EXIT);
    expect((thrown as CommandExit).exitCode).toBe(2);
    expect((thrown as CommandExit).message).toBe(PR_NEEDS_GH);
  });

  it('says the same thing whether the config or the remote decided', () => {
    const fromConfig = messageOfRefusal(readingFor('none', 'https://github.com/o/r.git'));
    const fromRemote = messageOfRefusal(readingFor(null, 'git@gitlab.com:o/r.git'));
    const withNoOrigin = messageOfRefusal(readingFor(null, null));

    expect(fromConfig).toBe(fromRemote);
    expect(fromRemote).toBe(withNoOrigin);
    expect(fromConfig).toBe(PR_NEEDS_GH);
  });

  it('names the setting, the install page and gh auth login in that one message', () => {
    expect(PR_NEEDS_GH).toContain('pr.provider: gh');
    expect(PR_NEEDS_GH).toContain('https://cli.github.com');
    expect(PR_NEEDS_GH).toContain('gh auth login');
  });
});

/** The message {@link requireGhProvider} refuses `reading` with. Fails when it does not. */
function messageOfRefusal(reading: PrProviderReading): string {
  try {
    requireGhProvider(reading);
  } catch (error) {
    return error instanceof Error
      ? error.message
      : String(error);
  }
  throw new Error('requireGhProvider accepted a reading it had to refuse');
}
