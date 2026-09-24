/**
 * Tests for reading a reference's target (`src/refs/verify.ts`): each
 * kind present, missing and — where its seam can fail — unreadable.
 *
 * Issues are read through fake `gh` runners that record the arguments
 * they were handed. Paths and symbols are read through a real git over
 * a repository planted under the temp directory, and `ts-symbols`
 * through fake outliners and one planted executable. Commands and flags
 * are read against a literal roster and against the core registry's
 * own, and keys against `SETTINGS`.
 *
 * A command, a flag and a key have no unreadable case: the roster and
 * `SETTINGS` are values in the process, and no seam between the
 * verifier and them can fail.
 *
 * ## The controls
 *
 * A blob sha is pinned against `git hash-object`, a second command, so
 * a verifier answering some other object's sha fails here. A path on
 * disk but untracked reads `absent`, which proves the reading is git's
 * and not the filesystem's. A symbol a grep finds and an outline does
 * not reads `absent` under the outline, which proves the outline can
 * refuse what the grep alone would pass.
 */
import type { RefVerifySeams, SymbolOutliner } from './verify.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { DescribeDocument, DescribedAction } from '../cli/describe.js';
import type { GitRunner } from '../pr/git.js';

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { describeRegistry } from '../cli/describe.js';
import { CORE_REGISTRY } from '../commands/index.js';
import { SETTINGS } from '../config-schema.js';
import { createGitRunner } from '../pr/git.js';

import { ABSENT, blobFingerprint, issueFingerprint, PRESENT, UNREADABLE } from './stamp.js';
import { createRefVerifier, ghIssueReader, RefVerifyError, tsSymbolsOutliner, verifyRef } from './verify.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-refs-verify-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** Runs git in `cwd`, throwing on failure: the planting's own git, not the seam under test. */
function plantGit(cwd: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

/** Writes `text` at `path` under `root`, making its directories. */
function plant(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** The files the planted repository commits. */
const COMMITTED: Readonly<Record<string, string>> = {
  'src/alpha.ts': [
    'export const alphaValue = 1;',
    'export function makeThing(): AlphaShape {',
    '  return {};',
    '}',
    'interface AlphaShape {}',
    '// export const commentedName = 1;',
    '',
  ].join('\n'),
  'src/report/record.ts': 'export const RECORD_KIND = \'record\';\n',
  'src/one/index.ts': 'export {};\n',
  'src/two/index.ts': 'export {};\n',
  'docs/guide.md': '# Guide\n',
  'README.md': '# Planted\n',
};

/** A repository holding {@link COMMITTED}, one file staged and never committed, and one untracked. */
function plantRepository(name: string): string {
  const root = join(tempBase, name);
  mkdirSync(root, { recursive: true });
  plantGit(root, ['init', '--quiet', '--initial-branch=main']);
  plantGit(root, ['config', 'user.email', 'rafa@example.test']);
  plantGit(root, ['config', 'user.name', 'rafa test']);
  for (const [path, text] of Object.entries(COMMITTED)) plant(root, path, text);
  plantGit(root, ['add', '--all']);
  plantGit(root, ['commit', '--quiet', '--message', 'planted']);
  plant(root, 'src/fresh.ts', 'export const freshName = 1;\n');
  plantGit(root, ['add', 'src/fresh.ts']);
  plant(root, 'notes.txt', 'untracked\n');
  return root;
}

const repo = plantRepository('repo');

/** A directory that is no git repository. */
const notARepo = join(tempBase, 'not-a-repo');
mkdirSync(notARepo, { recursive: true });

/** A `gh` answer. */
function gh(ok: boolean, stdout: string, stderr = ''): GhResult {
  return { ok, stdout, stderr };
}

/** A fake `gh` answering `answer` to every command, recording each command's arguments. */
function fakeGh(answer: GhResult): { readonly runner: GhRunner; readonly calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const runner: GhRunner = (args) => {
    calls.push(args);
    return Promise.resolve(answer);
  };
  return { runner, calls };
}

/** An action as the roster describes it, with every field it leaves out empty. */
function action(name: string, extra: Partial<DescribedAction> = {}): DescribedAction {
  return {
    name,
    summary: '',
    description: '',
    args: [],
    flags: [],
    examples: [],
    outputs: ['text'],
    aliases: [],
    deprecated: null,
    module: null,
    spends: null,
    ...extra,
  };
}

/** A flag as the roster describes it. */
function flag(name: string, aliases: readonly string[] = []): DescribedAction['flags'][number] {
  return { name, description: '', type: 'boolean', required: false, default: null, aliases };
}

/** A small roster: two subjects with aliases, a mounted action, and two top-level commands. */
const ROSTER: DescribeDocument = {
  schemaVersion: 2,
  binary: 'rafa',
  version: '0.0.0-test',
  subjects: [
    {
      name: 'plan',
      summary: '',
      actions: [
        action('create', { aliases: ['plan'], flags: [flag('issue'), flag('model')] }),
        action('list'),
      ],
    },
    {
      name: 'loop',
      summary: '',
      actions: [action('start', { aliases: ['start'], flags: [flag('session-id', ['s'])] })],
    },
    {
      name: 'module',
      summary: '',
      actions: [action('exec'), action('exec linear next', { module: 'linear' })],
    },
  ],
  commands: [action('describe'), action('next', { flags: [flag('yes')] })],
};

/** Seams over the planted repository, with a `gh` that is never meant to be reached. */
function seams(overrides: Partial<RefVerifySeams> = {}): RefVerifySeams {
  return {
    issues: ghIssueReader(fakeGh(gh(false, '', 'gh: not expected here')).runner),
    git: createGitRunner(repo),
    outline: null,
    roster: ROSTER,
    ...overrides,
  };
}

/** A payload `gh issue view --json title,body,state` answers. */
function issuePayload(state: string): string {
  return JSON.stringify({ title: 'A title', body: '## Design\n\nText.\n', state });
}

describe('an issue on the board', () => {
  it('reads a present issue through gh issue view, fingerprinted from its title, body and state', async () => {
    const fake = fakeGh(gh(true, issuePayload('OPEN')));
    const verify = createRefVerifier(seams({ issues: ghIssueReader(fake.runner) }));

    const reading = await verify({ kind: 'issue', text: '#7' });

    expect(reading).toEqual(issueFingerprint({ title: 'A title', body: '## Design\n\nText.\n', state: 'open' }));
    expect(fake.calls).toEqual([['issue', 'view', '7', '--json', 'title,body,state']]);
  });

  it('reads rafa-<n> as issue <n>', async () => {
    const fake = fakeGh(gh(true, issuePayload('OPEN')));

    await verifyRef({ kind: 'issue', text: 'rafa-151' }, seams({ issues: ghIssueReader(fake.runner) }));

    expect(fake.calls).toEqual([['issue', 'view', '151', '--json', 'title,body,state']]);
  });

  it('reads CLOSED and a pull request\'s MERGED as closed', async () => {
    for (const state of ['CLOSED', 'MERGED']) {
      const issues = ghIssueReader(fakeGh(gh(true, issuePayload(state))).runner);
      const reading = await verifyRef({ kind: 'issue', text: '#7' }, seams({ issues }));
      expect(reading.kind === 'issue' && reading.state).toBe('closed');
    }
  });

  it('reads an issue number nothing holds as absent', async () => {
    const stderr = 'GraphQL: Could not resolve to an issue or pull request with the number of 999999. (repository.issue)\n';
    const issues = ghIssueReader(fakeGh(gh(false, '', stderr)).runner);

    expect(await verifyRef({ kind: 'issue', text: '#999999' }, seams({ issues }))).toEqual(ABSENT);
  });

  it('rejects when gh cannot read the board, naming what gh said', async () => {
    const issues = ghIssueReader(fakeGh(gh(false, '', 'To get started with GitHub CLI, please run:  gh auth login\n')).runner);

    const reading = verifyRef({ kind: 'issue', text: '#7' }, seams({ issues }));

    await expect(reading).rejects.toBeInstanceOf(RefVerifyError);
    await expect(reading).rejects.toThrow('could not read issue #7: To get started with GitHub CLI');
  });

  it('rejects when gh answers JSON of another shape', async () => {
    const issues = ghIssueReader(fakeGh(gh(true, JSON.stringify({ title: 'A title', state: 'OPEN' }))).runner);

    await expect(verifyRef({ kind: 'issue', text: '#7' }, seams({ issues }))).rejects.toThrow('answered no title, body and state');
  });
});

describe('an issue on another repository', () => {
  it('reads a present issue with --repo on the same reader', async () => {
    const fake = fakeGh(gh(true, issuePayload('CLOSED')));

    const reading = await verifyRef({ kind: 'cross-issue', text: 'cli/cli#12' }, seams({ issues: ghIssueReader(fake.runner) }));

    expect(reading).toEqual(issueFingerprint({ title: 'A title', body: '## Design\n\nText.\n', state: 'closed' }));
    expect(fake.calls).toEqual([['issue', 'view', '12', '--json', 'title,body,state', '--repo', 'cli/cli']]);
  });

  it('reads every failure as unreadable: no issue, no repository, no access, and JSON of another shape', async () => {
    const answers = [
      gh(false, '', 'GraphQL: Could not resolve to an issue or pull request with the number of 12. (repository.issue)'),
      gh(false, '', 'GraphQL: Could not resolve to a Repository with the name \'someone/private\'. (repository)'),
      gh(false, '', 'could not run gh in /repo: not found on PATH "" (ENOENT)'),
      gh(true, 'not json'),
    ];
    for (const answer of answers) {
      const issues = ghIssueReader(fakeGh(answer).runner);
      expect(await verifyRef({ kind: 'cross-issue', text: 'someone/private#12' }, seams({ issues }))).toEqual(UNREADABLE);
    }
  });

  it('asks gh nothing for a repository named . or ..', async () => {
    const fake = fakeGh(gh(true, issuePayload('OPEN')));

    const reading = await verifyRef({ kind: 'cross-issue', text: '../repo#1' }, seams({ issues: ghIssueReader(fake.runner) }));

    expect(reading).toEqual(UNREADABLE);
    expect(fake.calls).toEqual([]);
  });
});

describe('a path', () => {
  /** The blob sha `git hash-object` answers for a committed file: the control on `rev-parse`. */
  const hashOf = (path: string): string => plantGit(repo, ['hash-object', path]).trim();

  it('reads a tracked file as its blob sha at HEAD', async () => {
    expect(await verifyRef({ kind: 'path', text: 'src/alpha.ts' }, seams())).toEqual(blobFingerprint(hashOf('src/alpha.ts')));
  });

  it('drops a leading ./', async () => {
    expect(await verifyRef({ kind: 'path', text: './docs/guide.md' }, seams())).toEqual(blobFingerprint(hashOf('docs/guide.md')));
  });

  it('reads a directory, with or without its slash, as present', async () => {
    const verify = createRefVerifier(seams());

    expect(await verify({ kind: 'path', text: 'src/report' })).toEqual(PRESENT);
    expect(await verify({ kind: 'path', text: 'src/report/' })).toEqual(PRESENT);
  });

  it('reads a path written short as the one tracked file it ends', async () => {
    const verify = createRefVerifier(seams());

    expect(await verify({ kind: 'path', text: 'report/record.ts' })).toEqual(blobFingerprint(hashOf('src/report/record.ts')));
    expect(await verify({ kind: 'path', text: 'guide.md' })).toEqual(blobFingerprint(hashOf('docs/guide.md')));
    expect(await verify({ kind: 'path', text: 'report/' })).toEqual(PRESENT);
  });

  it('reads a short path several files end as present', async () => {
    expect(await verifyRef({ kind: 'path', text: 'index.ts' }, seams())).toEqual(PRESENT);
  });

  it('reads a file staged and never committed as present', async () => {
    expect(await verifyRef({ kind: 'path', text: 'src/fresh.ts' }, seams())).toEqual(PRESENT);
  });

  it('reads a missing path as absent, and an untracked file on disk too', async () => {
    const verify = createRefVerifier(seams());

    expect(await verify({ kind: 'path', text: 'src/gone.ts' })).toEqual(ABSENT);
    expect(await verify({ kind: 'path', text: 'nowhere/' })).toEqual(ABSENT);
    expect(await verify({ kind: 'path', text: 'notes.txt' })).toEqual(ABSENT);
  });

  it('reads a file deleted and committed as absent', async () => {
    const root = plantRepository('deleted');
    const before = await verifyRef({ kind: 'path', text: 'src/alpha.ts' }, seams({ git: createGitRunner(root) }));
    plantGit(root, ['rm', '--quiet', 'src/alpha.ts']);
    plantGit(root, ['commit', '--quiet', '--message', 'delete']);

    const after = await verifyRef({ kind: 'path', text: 'src/alpha.ts' }, seams({ git: createGitRunner(root) }));

    expect(before.kind).toBe('blob');
    expect(after).toEqual(ABSENT);
  });

  it('lists the tracked files once per verifier', async () => {
    const real = createGitRunner(repo);
    const listings: string[] = [];
    const git: GitRunner = (args) => {
      if (args[0] === 'ls-files') listings.push(args.join(' '));
      return real(args);
    };
    const verify = createRefVerifier(seams({ git }));

    await verify({ kind: 'path', text: 'src/alpha.ts' });
    await verify({ kind: 'path', text: 'src/gone.ts' });

    expect(listings).toEqual(['ls-files -z']);
  });

  it('rejects when git cannot list the tracked files', async () => {
    const reading = verifyRef({ kind: 'path', text: 'src/alpha.ts' }, seams({ git: createGitRunner(notARepo) }));

    await expect(reading).rejects.toBeInstanceOf(RefVerifyError);
    await expect(reading).rejects.toThrow('git ls-files failed: fatal: not a git repository');
  });
});

describe('a symbol', () => {
  /** An outliner answering `names` per file, recording each file it was asked for. */
  function fakeOutline(names: Readonly<Record<string, readonly string[] | null>>): { readonly outline: SymbolOutliner; readonly asked: string[] } {
    const asked: string[] = [];
    const outline: SymbolOutliner = (file) => {
      asked.push(file);
      return Promise.resolve(Object.hasOwn(names, file)
        ? names[file] ?? null
        : []);
    };
    return { outline, asked };
  }

  it('reads a name an export line names as present, with no ts-symbols', async () => {
    const verify = createRefVerifier(seams());

    expect(await verify({ kind: 'symbol', text: 'alphaValue' })).toEqual(PRESENT);
    expect(await verify({ kind: 'symbol', text: 'RECORD_KIND' })).toEqual(PRESENT);
    expect(await verify({ kind: 'symbol', text: 'freshName' })).toEqual(PRESENT);
  });

  it('reads a name no export line names as absent: missing, commented out, or a prefix of an export', async () => {
    const verify = createRefVerifier(seams());

    expect(await verify({ kind: 'symbol', text: 'missingName' })).toEqual(ABSENT);
    expect(await verify({ kind: 'symbol', text: 'commentedName' })).toEqual(ABSENT);
    expect(await verify({ kind: 'symbol', text: 'alphaVal' })).toEqual(ABSENT);
  });

  it('reads a name only an export line\'s type names as present by the grep alone', async () => {
    expect(await verifyRef({ kind: 'symbol', text: 'AlphaShape' }, seams())).toEqual(PRESENT);
  });

  it('confirms a grep hit through the outline, outlining only the candidate files', async () => {
    const fake = fakeOutline({ 'src/alpha.ts': ['alphaValue', 'makeThing'] });

    expect(await verifyRef({ kind: 'symbol', text: 'alphaValue' }, seams({ outline: fake.outline }))).toEqual(PRESENT);
    expect(fake.asked).toEqual(['src/alpha.ts']);
  });

  it('reads a grep hit the outline does not list as exported as absent', async () => {
    const fake = fakeOutline({ 'src/alpha.ts': ['alphaValue', 'makeThing'] });

    expect(await verifyRef({ kind: 'symbol', text: 'AlphaShape' }, seams({ outline: fake.outline }))).toEqual(ABSENT);
  });

  it('counts a candidate ts-symbols could not outline as the grep found it', async () => {
    const fake = fakeOutline({ 'src/alpha.ts': null });

    expect(await verifyRef({ kind: 'symbol', text: 'AlphaShape' }, seams({ outline: fake.outline }))).toEqual(PRESENT);
  });

  it('reads a name that is no identifier as absent, grepping nothing', async () => {
    const git: GitRunner = () => {
      throw new Error('git must not run');
    };

    expect(await verifyRef({ kind: 'symbol', text: 'a.b' }, seams({ git }))).toEqual(ABSENT);
  });

  it('rejects when git cannot grep', async () => {
    const reading = verifyRef({ kind: 'symbol', text: 'alphaValue' }, seams({ git: createGitRunner(notARepo) }));

    await expect(reading).rejects.toBeInstanceOf(RefVerifyError);
    await expect(reading).rejects.toThrow('git grep for alphaValue failed');
  });
});

describe('the ts-symbols outliner', () => {
  /** A bin directory holding a `ts-symbols` that runs `script` as its body. */
  function plantTsSymbols(name: string, script: string): string {
    const bin = join(tempBase, name);
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'ts-symbols'), `#!/bin/sh\n${script}\n`);
    chmodSync(join(bin, 'ts-symbols'), 0o755);
    return bin;
  }

  it('is null when ts-symbols is not on PATH', () => {
    const empty = join(tempBase, 'empty-bin');
    mkdirSync(empty, { recursive: true });

    expect(tsSymbolsOutliner({ cwd: repo, env: { PATH: empty } })).toBeNull();
    expect(tsSymbolsOutliner({ cwd: repo, env: {} })).toBeNull();
  });

  it('answers the exported top-level names outline --json lists', async () => {
    const payload = JSON.stringify({
      file: 'src/alpha.ts',
      symbols: [
        { name: 'alphaValue', exported: true },
        { name: 'AlphaShape', exported: false },
        { name: 'makeThing', exported: true, children: [{ name: 'inner', exported: true }] },
      ],
    });
    const bin = plantTsSymbols('bin-ok', [
      'if [ "$1" != outline ] || [ "$2" != src/alpha.ts ] || [ "$3" != --json ]; then exit 2; fi',
      `printf '%s' '${payload}'`,
    ].join('\n'));

    const outline = tsSymbolsOutliner({ cwd: repo, env: { PATH: bin } });

    expect(outline).not.toBeNull();
    expect(await outline?.('src/alpha.ts')).toEqual(['alphaValue', 'makeThing']);
    expect(await outline?.('src/other.ts')).toBeNull();
  });

  it('answers null for output that is not an outline', async () => {
    const outline = tsSymbolsOutliner({ cwd: repo, env: { PATH: plantTsSymbols('bin-junk', 'printf \'%s\' \'not json\'') } });

    expect(await outline?.('src/alpha.ts')).toBeNull();
  });
});

describe('a command', () => {
  it('reads a subject, its plural, its actions, a mounted action\'s start and a top-level command as present', async () => {
    const verify = createRefVerifier(seams());
    const present = ['rafa plan', 'rafa plan create', 'rafa plans list', 'rafa loop start', 'rafa module exec', 'rafa describe'];

    for (const text of present) expect(await verify({ kind: 'command', text })).toEqual(PRESENT);
  });

  it('reads an alias, and a top-level command or alias followed by its argument, as present', async () => {
    const verify = createRefVerifier(seams());

    expect(await verify({ kind: 'command', text: 'rafa start' })).toEqual(PRESENT);
    expect(await verify({ kind: 'command', text: 'rafa next soon' })).toEqual(PRESENT);
    expect(await verify({ kind: 'command', text: 'rafa start now' })).toEqual(PRESENT);
  });

  it('reads an action its subject does not hold, an unknown word and another program as absent', async () => {
    const verify = createRefVerifier(seams());
    const absent = ['rafa plan bogus', 'rafa loop create', 'rafa bogus', 'rafa', 'git status'];

    for (const text of absent) expect(await verify({ kind: 'command', text })).toEqual(ABSENT);
  });

  it('reads the core roster', async () => {
    const verify = createRefVerifier(seams({ roster: describeRegistry(CORE_REGISTRY, '0.0.0-test') }));

    expect(await verify({ kind: 'command', text: 'rafa plan create' })).toEqual(PRESENT);
    expect(await verify({ kind: 'command', text: 'rafa issue unblock' })).toEqual(PRESENT);
    expect(await verify({ kind: 'command', text: 'rafa issue no-such-action' })).toEqual(ABSENT);
  });
});

describe('a flag', () => {
  it('reads a declared flag, an alias and a negated flag as present', async () => {
    const verify = createRefVerifier(seams());

    for (const text of ['--issue', '--session-id', '--s', '--no-model', '--yes']) {
      expect(await verify({ kind: 'flag', text })).toEqual(PRESENT);
    }
  });

  it('reads the global flags and --help as present though no command declares them', async () => {
    const verify = createRefVerifier(seams());

    for (const text of ['--output', '--verbose', '--version', '--help']) {
      expect(await verify({ kind: 'flag', text })).toEqual(PRESENT);
    }
  });

  it('reads a flag nothing declares, negated or not, as absent', async () => {
    const verify = createRefVerifier(seams());

    for (const text of ['--nope', '--no-nope', 'issue']) {
      expect(await verify({ kind: 'flag', text })).toEqual(ABSENT);
    }
  });

  it('reads the core roster', async () => {
    const verify = createRefVerifier(seams({ roster: describeRegistry(CORE_REGISTRY, '0.0.0-test') }));

    expect(await verify({ kind: 'flag', text: '--issue' })).toEqual(PRESENT);
    expect(await verify({ kind: 'flag', text: '--no-such-flag-here' })).toEqual(ABSENT);
  });
});

describe('a key', () => {
  it('reads every key SETTINGS holds as present', async () => {
    const verify = createRefVerifier(seams());

    for (const setting of Object.values(SETTINGS)) {
      expect(await verify({ kind: 'key', text: setting.key })).toEqual(PRESENT);
    }
  });

  it('reads a key SETTINGS does not hold as absent', async () => {
    const verify = createRefVerifier(seams());

    expect(await verify({ kind: 'key', text: 'specs.nope' })).toEqual(ABSENT);
    expect(await verify({ kind: 'key', text: 'specsDir' })).toEqual(ABSENT);
  });
});
