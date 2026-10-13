/**
 * `readRemoteOnly` over a scripted git and a provider double: every rule
 * that keeps a branch out of the group first, each beside a branch the
 * same reading lists, then a listed row with its counts, then the notes
 * and the failures. Once over a real clone of a bare remote, so the argv
 * this module spells and the `git cherry` lines its note records are
 * read from git itself rather than from this file's script.
 *
 * The scripted git throws on a call no case scripted. A case that
 * scripts no `git cherry` for a branch therefore also proves none ran
 * for it.
 */
import type { RemoteOnlyRead, RemoteOnlyReading, RemoteOnlySettings } from './remote-only.js';
import type { GitResult, GitRunner } from '../core/git/index.js';
import type { PullRequestSummary } from '../pr/types.js';

import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { formatClaimMessage } from '../claims/record.js';
import { createGitRunner } from '../core/git/index.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';
import { gitIdentityEnv } from '../tests/git-identity.js';

import {
  REMOTE_BRANCH_FORMAT,
  STRETCH_PREFIX,
  claimUnreadNote,
  copiesUnreadNote,
  openUnknownNote,
  openUnreadNote,
  readRemoteOnly,
  remoteBaseUnreadNote,
  remoteOnlyReason,
} from './remote-only.js';

const TIP_SECONDS = 1_790_000_000;
const TIP_DATE = new Date(TIP_SECONDS * 1000);

const REMOTES_CALL = `for-each-ref --format=${REMOTE_BRANCH_FORMAT} refs/remotes/origin`;
const HEADS_CALL = 'for-each-ref --format=%(refname:lstrip=2) refs/heads';
const HEAD_CALL = 'symbolic-ref --quiet --short refs/remotes/origin/HEAD';

const THIS_STORE = 'store-here';
const OTHER_STORE = 'store-elsewhere';
const SETTINGS: RemoteOnlySettings = {
  base: 'main',
  keep: [],
  device: { storeId: THIS_STORE, replacedIds: [] },
};

/** The one branch every exclusion case lists beside the branch it drops. */
const CONTROL = 'work';

function said(stdout: string): GitResult {
  return { ok: true, stdout, stderr: '' };
}

function refused(stderr: string): GitResult {
  return { ok: false, stdout: '', stderr };
}

function mergedCall(base = 'main'): string {
  return `for-each-ref --merged=refs/remotes/origin/${base} --format=%(refname:lstrip=3) refs/remotes/origin`;
}

function cherryCall(name: string, base = 'main'): string {
  return `cherry refs/remotes/origin/${base} refs/remotes/origin/${name}`;
}

/** What a case says git holds; every field has the answer of an ordinary clone. */
interface Script {
  /** The branches under `refs/remotes/origin/`, the base included when the case wants it there. */
  readonly remote: readonly string[];
  /** The branches under `refs/heads/`. */
  readonly local?: readonly string[];
  /** The branch `origin/HEAD` names, or null for a clone where it is not set. */
  readonly remoteHead?: string | null;
  /** The base the `--merged` listing is asked about. */
  readonly base?: string;
  /** The names that listing answers. */
  readonly merged?: readonly string[];
  /** `git cherry`'s stdout by branch; a branch not named here has no answer scripted. */
  readonly cherry?: Readonly<Record<string, string>>;
  /** Any other call, by its argv joined with spaces; laid over the rest. */
  readonly extra?: Readonly<Record<string, GitResult>>;
}

/** A git answering `script`, throwing on every other call, recording each. */
function scriptedGit(script: Script): { git: GitRunner; calls: string[] } {
  const remoteHead = script.remoteHead === undefined
    ? 'main'
    : script.remoteHead;
  const base = script.base ?? 'main';
  const headLines = remoteHead === null
    ? []
    : [`HEAD\t${String(TIP_SECONDS)}\trefs/remotes/origin/${remoteHead}`];
  const answers: Record<string, GitResult> = {
    [REMOTES_CALL]: said([...headLines, ...script.remote.map((name) => `${name}\t${String(TIP_SECONDS)}\t`)].join('\n')),
    [HEADS_CALL]: said((script.local ?? ['main']).join('\n')),
    [HEAD_CALL]: remoteHead === null
      ? refused('')
      : said(`origin/${remoteHead}\n`),
    [mergedCall(base)]: said((script.merged ?? []).join('\n')),
  };
  for (const [name, stdout] of Object.entries(script.cherry ?? {})) {
    answers[cherryCall(name, base)] = said(stdout);
  }
  Object.assign(answers, script.extra ?? {});

  const calls: string[] = [];
  const git: GitRunner = (args) => {
    const call = args.join(' ');
    calls.push(call);
    const answer = answers[call];
    if (answer === undefined) {
      throw new Error(`unscripted git call: ${call}`);
    }
    return answer;
  };
  return { git, calls };
}

/** The three calls `readClaimBranch` makes for `branch`, answering `messages` as its claim commits, oldest first. */
function claimCalls(branch: string, messages: readonly string[]): Record<string, GitResult> {
  const tip = 'c'.repeat(40);
  const walked = messages.map((message, index) => `${String(index).repeat(40)}\n${message}`).join('\0');
  return {
    [`rev-parse --verify --quiet refs/remotes/origin/${branch}^{commit}`]: said(`${tip}\n`),
    [`log -1 --format=%ct ${tip}`]: said(`${String(TIP_SECONDS)}\n`),
    [`log -z --reverse --regexp-ignore-case --fixed-strings --grep=rafa-claim --format=%H%n%B ${tip}`]: said(walked),
  };
}

function openPull(number: number, headRefName: string): PullRequestSummary {
  return {
    number,
    title: `pull request ${String(number)}`,
    url: `https://example.test/pull/${String(number)}`,
    state: 'open',
    headRefName,
    baseRefName: 'main',
    author: { login: 'someone', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-10-01T10:00:00Z',
  };
}

/** A provider whose `list` answers `open`, every other member refusing. */
function provider(...open: PullRequestSummary[]): ReturnType<typeof createPullRequestsDouble> {
  return createPullRequestsDouble({ list: () => Promise.resolve(open) });
}

/** The reading, or a throw naming why it was not taken. */
function taken(answer: RemoteOnlyReading): RemoteOnlyRead {
  if (!answer.ok) {
    throw new Error(answer.detail);
  }
  return answer;
}

function names(answer: RemoteOnlyReading): string[] {
  return taken(answer).rows.map((row) => row.name);
}

describe('readRemoteOnly: what is never listed', () => {
  it('leaves out a branch with a local copy, and runs no git cherry for it', async () => {
    const { git, calls } = scriptedGit({
      remote: ['main', 'mine', CONTROL],
      local: ['main', 'mine'],
      cherry: { [CONTROL]: '+ a1\n' },
    });

    const answer = await readRemoteOnly(git, provider().pulls, SETTINGS);

    expect(names(answer)).toEqual([CONTROL]);
    expect(calls.filter((call) => call.startsWith('cherry '))).toEqual([cherryCall(CONTROL)]);
  });

  it('leaves out a branch origin\'s base reaches', async () => {
    const { git } = scriptedGit({
      remote: ['landed', 'main', CONTROL],
      merged: ['HEAD', 'landed', 'main'],
      cherry: { [CONTROL]: '+ a1\n' },
    });

    expect(names(await readRemoteOnly(git, provider().pulls, SETTINGS))).toEqual([CONTROL]);
  });

  it('leaves out the base by its name, whatever the merged listing answers', async () => {
    // The merged listing names nothing and `develop` has no local copy,
    // so only the name rule can drop it.
    const { git } = scriptedGit({
      remote: ['develop', CONTROL],
      local: [],
      remoteHead: null,
      base: 'develop',
      merged: [],
      cherry: { [CONTROL]: '+ a1\n' },
    });

    const answer = await readRemoteOnly(git, provider().pulls, { ...SETTINGS, base: 'develop' });

    expect(names(answer)).toEqual([CONTROL]);
    expect(taken(answer).base).toBe('develop');
  });

  it('leaves out the branch origin/HEAD names beside a base naming another', async () => {
    // `main` is ahead of `develop`, so the merged listing does not name it,
    // and it has no local copy, so only the origin/HEAD rule can drop it.
    const { git } = scriptedGit({
      remote: ['develop', 'main', CONTROL],
      local: [],
      remoteHead: 'main',
      base: 'develop',
      merged: ['develop'],
      cherry: { [CONTROL]: '+ a1\n' },
    });

    expect(names(await readRemoteOnly(git, provider().pulls, { ...SETTINGS, base: 'develop' }))).toEqual([CONTROL]);
  });

  it('leaves out a cleanup.keep match', async () => {
    const { git } = scriptedGit({
      remote: ['main', 'release/1.x', CONTROL],
      cherry: { [CONTROL]: '+ a1\n' },
    });

    expect(names(await readRemoteOnly(git, provider().pulls, { ...SETTINGS, keep: ['release/*'] }))).toEqual([CONTROL]);
  });

  it('leaves out a stretch/* branch', async () => {
    const { git } = scriptedGit({
      remote: ['main', `${STRETCH_PREFIX}9`, CONTROL],
      cherry: { [CONTROL]: '+ a1\n' },
    });

    expect(names(await readRemoteOnly(git, provider().pulls, SETTINGS))).toEqual([CONTROL]);
  });

  it('leaves out the head of an open pull request, and asks the provider once', async () => {
    const { git } = scriptedGit({
      remote: ['main', 'reviewed', CONTROL],
      cherry: { [CONTROL]: '+ a1\n' },
    });
    const double = provider(openPull(41, 'reviewed'));

    expect(names(await readRemoteOnly(git, double.pulls, SETTINGS))).toEqual([CONTROL]);
    expect(double.sent()).toEqual(['list']);
  });

  it('leaves out a claim branch another store holds, with no note', async () => {
    const claimed = 'feat/rafa-12-thing';
    const { git } = scriptedGit({
      remote: [claimed, 'main', CONTROL],
      cherry: { [CONTROL]: '+ a1\n' },
      extra: claimCalls(claimed, [formatClaimMessage({ action: 'claim', issue: 12, store: OTHER_STORE })]),
    });

    const answer = await readRemoteOnly(git, provider().pulls, SETTINGS);

    expect(names(answer)).toEqual([CONTROL]);
    expect(taken(answer).notes).toEqual([]);
  });

  it('lists nothing with no provider, and says so in one note counting what it withheld', async () => {
    // The same script lists `work` under a provider: "a branch only on origin, with its two counts" below.
    const { git, calls } = scriptedGit({ remote: ['main', 'other', CONTROL] });

    const answer = taken(await readRemoteOnly(git, null, SETTINGS));

    expect(answer.rows).toEqual([]);
    expect(answer.notes).toEqual([openUnknownNote(2)]);
    expect(answer.notes).toEqual([
      'no pull request provider, so open pull requests are unknown; 2 branches only on origin are not listed',
    ]);
    expect(calls).toEqual([REMOTES_CALL, HEADS_CALL, HEAD_CALL, mergedCall()]);
  });
});

describe('readRemoteOnly: a listed row', () => {
  it('lists a branch only on origin, with its two counts, its tip date and no tick', async () => {
    const { git, calls } = scriptedGit({
      remote: ['main', 'other', CONTROL],
      cherry: {
        other: '- b1\n- b2\n',
        [CONTROL]: '- a1\n+ a2\n+ a3\n',
      },
    });

    const answer = taken(await readRemoteOnly(git, provider().pulls, SETTINGS));

    expect(answer).toEqual({
      ok: true,
      base: 'main',
      notes: [],
      rows: [
        {
          group: 'remote-only',
          name: 'other',
          lastCommit: TIP_DATE,
          commits: 2,
          uncopied: 0,
          ticked: false,
          reason: 'every commit has a patch-equal copy on origin/main (2 commits)',
        },
        {
          group: 'remote-only',
          name: CONTROL,
          lastCommit: TIP_DATE,
          commits: 3,
          uncopied: 2,
          ticked: false,
          reason: '2 of 3 commits with no patch-equal copy on origin/main',
        },
      ],
    });
    expect(calls).toEqual([REMOTES_CALL, HEADS_CALL, HEAD_CALL, mergedCall(), cherryCall('other'), cherryCall(CONTROL)]);
  });

  it('counts no commit for a branch whose only commits past the base are merges', async () => {
    const { git } = scriptedGit({ remote: ['main', CONTROL], cherry: { [CONTROL]: '' } });

    const [row] = taken(await readRemoteOnly(git, provider().pulls, SETTINGS)).rows;

    expect(row).toMatchObject({ commits: 0, uncopied: 0, ticked: false, reason: 'only merge commits past origin/main' });
  });
});

describe('readRemoteOnly: claim branches', () => {
  const claimed = 'feat/rafa-12-thing';
  const claim = formatClaimMessage({ action: 'claim', issue: 12, store: THIS_STORE });

  function claimScript(messages: readonly string[]): GitRunner {
    return scriptedGit({
      remote: [claimed, 'main'],
      cherry: { [claimed]: '+ a1\n' },
      extra: claimCalls(claimed, messages),
    }).git;
  }

  it('lists one this device holds', async () => {
    expect(names(await readRemoteOnly(claimScript([claim]), provider().pulls, SETTINGS))).toEqual([claimed]);
  });

  it('lists one held under an id this device\'s store replaced', async () => {
    const device = { storeId: 'store-new', replacedIds: [THIS_STORE] };

    expect(names(await readRemoteOnly(claimScript([claim]), provider().pulls, { ...SETTINGS, device }))).toEqual([claimed]);
  });

  it('lists one whose claim another store released', async () => {
    const messages = [
      formatClaimMessage({ action: 'claim', issue: 12, store: OTHER_STORE }),
      formatClaimMessage({ action: 'release', issue: 12, store: OTHER_STORE }),
    ];

    expect(names(await readRemoteOnly(claimScript(messages), provider().pulls, SETTINGS))).toEqual([claimed]);
  });

  it('lists one carrying no claim commit', async () => {
    expect(names(await readRemoteOnly(claimScript([]), provider().pulls, SETTINGS))).toEqual([claimed]);
  });

  it('leaves out a held one when this device\'s store names no id', async () => {
    // Control: the same script and claim are listed with the id, in "lists one this device holds".
    const answer = await readRemoteOnly(claimScript([claim]), provider().pulls, { ...SETTINGS, device: null });

    expect(names(answer)).toEqual([]);
    expect(taken(answer).notes).toEqual([]);
  });

  it('leaves out one git cannot read, with a note, and keeps the other rows', async () => {
    const { git } = scriptedGit({
      remote: [claimed, 'main', CONTROL],
      cherry: { [CONTROL]: '+ a1\n' },
      extra: {
        [`rev-parse --verify --quiet refs/remotes/origin/${claimed}^{commit}`]: refused('fatal: bad object\nmore'),
      },
    });

    const answer = taken(await readRemoteOnly(git, provider().pulls, SETTINGS));

    expect(answer.rows.map((row) => row.name)).toEqual([CONTROL]);
    expect(answer.notes).toEqual([claimUnreadNote(claimed, 'fatal: bad object')]);
    expect(answer.notes).toEqual(['could not read the claim on origin/feat/rafa-12-thing (fatal: bad object); it is not listed']);
  });
});

describe('readRemoteOnly: notes and failures', () => {
  it('asks no provider and writes no note when no branch is only on origin', async () => {
    const { git, calls } = scriptedGit({ remote: ['main', 'mine'], local: ['main', 'mine'] });
    const double = provider();

    for (const pulls of [double.pulls, null]) {
      expect(taken(await readRemoteOnly(git, pulls, SETTINGS))).toEqual({ ok: true, base: 'main', rows: [], notes: [] });
    }
    expect(double.sent()).toEqual([]);
    expect(calls).toEqual([REMOTES_CALL, HEADS_CALL, HEAD_CALL, REMOTES_CALL, HEADS_CALL, HEAD_CALL]);
  });

  it('asks no provider when every branch only on origin is merged', async () => {
    const { git } = scriptedGit({ remote: ['landed', 'main'], merged: ['landed', 'main'] });
    const double = provider();

    expect(taken(await readRemoteOnly(git, double.pulls, SETTINGS))).toEqual({ ok: true, base: 'main', rows: [], notes: [] });
    expect(double.sent()).toEqual([]);
  });

  it('reads a repository with no origin as no row, in one git call', async () => {
    const calls: string[] = [];
    const git: GitRunner = (args) => {
      calls.push(args.join(' '));
      return said('');
    };

    expect(taken(await readRemoteOnly(git, null, SETTINGS))).toEqual({ ok: true, base: 'main', rows: [], notes: [] });
    expect(calls).toEqual([REMOTES_CALL]);
  });

  it('lists nothing when the provider throws, and says so in one note with its first line', async () => {
    const { git } = scriptedGit({ remote: ['main', CONTROL] });
    const double = createPullRequestsDouble({ list: () => Promise.reject(new Error('gh pr list failed\nexit 4')) });

    const answer = taken(await readRemoteOnly(git, double.pulls, SETTINGS));

    expect(answer.rows).toEqual([]);
    expect(answer.notes).toEqual([openUnreadNote(1, 'gh pr list failed')]);
    expect(answer.notes).toEqual(['open pull requests could not be read (gh pr list failed); 1 branch only on origin is not listed']);
  });

  it('lists nothing when origin\'s base cannot be read, and asks no provider', async () => {
    const { git } = scriptedGit({
      remote: [CONTROL],
      remoteHead: null,
      extra: { [mergedCall()]: refused('fatal: malformed object name refs/remotes/origin/main') },
    });
    const double = provider();

    const answer = taken(await readRemoteOnly(git, double.pulls, SETTINGS));

    expect(answer.rows).toEqual([]);
    expect(answer.notes).toEqual([
      remoteBaseUnreadNote('main', 'git for-each-ref --merged failed: fatal: malformed object name refs/remotes/origin/main'),
    ]);
    expect(double.sent()).toEqual([]);
  });

  it('leaves out a row whose git cherry fails, with a note, and keeps the others', async () => {
    const { git } = scriptedGit({
      remote: ['broken', 'garbled', 'main', CONTROL],
      cherry: { garbled: '+ a1\n? a2\n', [CONTROL]: '+ a1\n' },
      extra: { [cherryCall('broken')]: refused('fatal: unknown commit refs/remotes/origin/broken') },
    });

    const answer = taken(await readRemoteOnly(git, provider().pulls, SETTINGS));

    expect(answer.rows.map((row) => row.name)).toEqual([CONTROL]);
    expect(answer.notes).toEqual([
      copiesUnreadNote('broken', 'main', 'git cherry failed: fatal: unknown commit refs/remotes/origin/broken'),
      copiesUnreadNote('garbled', 'main', 'git cherry wrote a line that opens with neither + nor -: "? a2"'),
    ]);
  });

  it('answers unread when a listing fails or writes a line it cannot read', async () => {
    const failing: [string, Record<string, GitResult>, string][] = [
      ['the remote listing', { [REMOTES_CALL]: refused('fatal: not a git repository') }, 'git for-each-ref refs/remotes/origin failed: fatal: not a git repository'],
      ['the local listing', { [HEADS_CALL]: refused('') }, 'git for-each-ref refs/heads failed'],
      ['a line short of a field', { [REMOTES_CALL]: said('work\t1790000000') }, 'git for-each-ref wrote a line with 2 fields, expected 3: "work\\t1790000000"'],
      ['a line with no date', { [REMOTES_CALL]: said('work\t\t') }, 'git for-each-ref wrote no commit date for origin/work: ""'],
    ];

    for (const [what, extra, detail] of failing) {
      const { git } = scriptedGit({ remote: ['main', CONTROL], extra });

      expect([what, await readRemoteOnly(git, provider().pulls, SETTINGS)]).toEqual([what, { ok: false, detail }]);
    }
  });
});

describe('remoteOnlyReason', () => {
  it('names the commits with no copy against the total, in the singular and the plural', () => {
    expect(remoteOnlyReason(1, 1, 'main')).toBe('1 of 1 commit with no patch-equal copy on origin/main');
    expect(remoteOnlyReason(2, 5, 'develop')).toBe('2 of 5 commits with no patch-equal copy on origin/develop');
  });

  it('says every commit has a copy when none lacks one', () => {
    expect(remoteOnlyReason(0, 1, 'main')).toBe('every commit has a patch-equal copy on origin/main (1 commit)');
  });

  it('claims no copy for a branch that counts no commit', () => {
    expect(remoteOnlyReason(0, 0, 'main')).toBe('only merge commits past origin/main');
  });
});

describe('readRemoteOnly over a real clone', () => {
  const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-cleanup-remote-only-')));
  const env = {
    ...process.env,
    LC_ALL: 'C',
    GIT_CONFIG_GLOBAL: '/dev/null',
    ...gitIdentityEnv(),
    GIT_CONFIG_NOSYSTEM: '1',
  };

  afterAll(() => {
    rmSync(tempBase, { recursive: true, force: true });
  });

  function run(cwd: string, args: readonly string[]): string {
    const result = spawnSync('git', [...args], { cwd, encoding: 'utf8', env });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
    return result.stdout.trim();
  }

  it('reads the unmerged, copied and merge-holding branches from git itself, and none of the excluded ones', async () => {
    const remote = join(tempBase, 'remote.git');
    const work = join(tempBase, 'work');
    const commitFile = (name: string): void => {
      writeFileSync(join(work, `${name}.txt`), `${name}\n`);
      run(work, ['add', '--', `${name}.txt`]);
      run(work, ['commit', '-q', '-m', `${name} file`]);
    };
    /** A branch off `main` holding one commit per file, pushed. */
    const pushed = (name: string, ...files: string[]): void => {
      run(work, ['switch', '-q', '-c', name, 'main']);
      files.forEach(commitFile);
      run(work, ['push', '-q', 'origin', name]);
    };
    run(tempBase, ['init', '-q', '--bare', '-b', 'main', remote]);
    run(tempBase, ['clone', '-q', remote, work]);
    commitFile('first');
    run(work, ['push', '-q', '-u', 'origin', 'main']);
    run(work, ['remote', 'set-head', 'origin', 'main']);
    pushed('unmerged', 'b', 'c');
    pushed('copied', 'd');
    pushed('landed', 'e');
    pushed('reviewed', 'f');
    pushed('stretch/9', 'g');
    pushed('kept/x', 'h');
    pushed('mine', 'i');
    // joined: two commits and the merge that joins them, three past main by rev-list.
    pushed('side', 'j');
    run(work, ['switch', '-q', '-c', 'joined', 'main']);
    commitFile('k');
    run(work, ['merge', '-q', '--no-ff', '-m', 'merge side', 'side']);
    run(work, ['push', '-q', 'origin', 'joined']);
    // main: `landed` merged, the first commit of `unmerged` and the one of `copied` picked.
    run(work, ['switch', '-q', 'main']);
    run(work, ['merge', '-q', '--ff-only', 'landed']);
    run(work, ['cherry-pick', 'unmerged~1', 'copied']);
    run(work, ['push', '-q', 'origin', 'main']);
    run(work, ['push', '-q', 'origin', '--delete', 'side']);
    run(work, ['branch', '-q', '-D', 'unmerged', 'copied', 'landed', 'reviewed', 'stretch/9', 'kept/x', 'side', 'joined']);
    run(work, ['fetch', '-q', '--prune']);

    const git = createGitRunner(work);
    const settings: RemoteOnlySettings = { base: 'main', keep: ['kept/*'], device: null };
    const answer = taken(await readRemoteOnly(git, provider(openPull(41, 'reviewed')).pulls, settings));

    expect(run(work, ['rev-list', '--count', 'origin/main..origin/joined'])).toBe('3');
    expect(answer.notes).toEqual([]);
    expect(answer.rows.map(({ name, commits, uncopied, ticked, reason }) => ({ name, commits, uncopied, ticked, reason }))).toEqual([
      { name: 'copied', commits: 1, uncopied: 0, ticked: false, reason: 'every commit has a patch-equal copy on origin/main (1 commit)' },
      { name: 'joined', commits: 2, uncopied: 2, ticked: false, reason: '2 of 2 commits with no patch-equal copy on origin/main' },
      { name: 'unmerged', commits: 2, uncopied: 1, ticked: false, reason: '1 of 2 commits with no patch-equal copy on origin/main' },
    ]);
    const tipSeconds = Number(run(work, ['log', '-1', '--format=%ct', 'origin/unmerged']));
    expect(answer.rows[2]?.lastCommit).toEqual(new Date(tipSeconds * 1000));

    // Control: with nothing kept and no open pull request, the two branches those rules dropped are rows.
    const open = taken(await readRemoteOnly(git, provider().pulls, { ...settings, keep: [] }));
    expect(open.rows.map((row) => row.name)).toEqual(['copied', 'joined', 'kept/x', 'reviewed', 'unmerged']);

    // Control: against a base origin does not hold, the note is git's own refusal.
    const baseless = taken(await readRemoteOnly(git, provider().pulls, { ...settings, base: 'nope' }));
    expect(baseless.rows).toEqual([]);
    expect(baseless.notes).toEqual([
      remoteBaseUnreadNote('nope', 'git for-each-ref --merged failed: fatal: malformed object name refs/remotes/origin/nope'),
    ]);
  });

  it('reads a repository with no origin as no row and no note', async () => {
    const lonely = join(tempBase, 'lonely');
    run(tempBase, ['init', '-q', '-b', 'main', lonely]);
    run(lonely, ['commit', '-q', '--allow-empty', '-m', 'first']);

    const answer = await readRemoteOnly(createGitRunner(lonely), null, { base: 'main', keep: [], device: null });

    expect(answer).toEqual({ ok: true, base: 'main', rows: [], notes: [] });
  });
});
