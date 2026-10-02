/**
 * The `stretch` operator script's actions, run through `run` over a fake
 * {@link Io}: the files a stretch leaves, and recorded answers from git,
 * rafa, gh and claude. Only `data-check` touches the disk, for a scratch
 * store in a temporary directory.
 */
import type { ExecResult, Io } from '../bundled/operators/scripts/io.js';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';

import { run } from '../bundled/operators/scripts/stretch.js';

/** A fake machine: files by path, and an answer per command line. */
function fakeIo(files: Record<string, string>, answers: Record<string, Partial<ExecResult>>, calls: string[] = []): Io {
  return {
    exec(command) {
      const line = command.join(' ');

      calls.push(line);
      const key = Object.keys(answers).find((prefix) => line.startsWith(prefix));
      const answer = key === undefined
        ? {}
        : answers[key];

      return { code: answer?.code ?? 0, stdout: answer?.stdout ?? '', stderr: answer?.stderr ?? '' };
    },
    read: (path) => files[path],
    list: (dir) => [...new Set(Object.keys(files).filter((path) => path.startsWith(`${dir}/`))
      .map((path) => path.slice(dir.length + 1).split('/')[0] ?? ''))],
    mtime: (path) => (files[path] === undefined && !Object.keys(files).some((file) => file.startsWith(`${path}/`))
      ? undefined
      : Date.parse('2026-10-02T12:00:00Z')),
    now: () => Date.parse('2026-10-02T12:10:00Z'),
    home: () => '/home/op',
    platform: () => 'linux',
    sleep: () => undefined,
  };
}

/** The root and stretch folder the fixtures use. */
const ROOT = '/work/rafa';
const DIR = `${ROOT}/.rafa/stretch/1`;
const WORKTREE = `${ROOT}/.rafa/worktrees/rafa-485-green-main`;
const AGENT = JSON.stringify({ sessionId: 'eng-1', startedAt: '2026-10-01' });

describe('readings', () => {
  const files = {
    [`${DIR}/agent.json`]: AGENT,
    [`${DIR}/loop-485.log`]: 'rafa· task 1/2 done   3m  10k tokens\nrafa· task 2/2 done   631m  20k tokens\n',
    [`${ROOT}/.rafa/runs/r1.json`]: JSON.stringify({ planStub: 'rafa-485-green-main', startedAt: '2026-10-01T19:04:04Z', worktree: WORKTREE, steps: [{ scope: 'full', summary: '[294s]' }] }),
    [`/home/op/.claude/projects/${WORKTREE.replace(/[/.]/g, '-')}/a.jsonl`]: '{"timestamp":"2026-10-01T19:09:01Z"}\n{"timestamp":"2026-10-01T19:11:56Z"}',
    [`/home/op/.claude/projects/${WORKTREE.replace(/[/.]/g, '-')}/b.jsonl`]: '{"timestamp":"2026-10-01T21:08:56Z"}\n{"timestamp":"2026-10-02T07:39:41Z"}',
  };
  const journal = '2026-10-01T23:09:18+02:00 h kernel: PM: suspend entry (s2idle)\n2026-10-02T09:34:59+02:00 h kernel: PM: suspend exit';

  it('reports awake work per item with the overnight suspend taken out', () => {
    const outcome = run(['readings', '--stretch=1', '--item=485', `--root=${ROOT}`], fakeIo(files, { journalctl: { stdout: journal } }));

    expect(outcome.code).toBe(0);
    expect(outcome.text).toContain('#485: 2 tasks done, 8 min awake work');
    expect(outcome.text).toContain('test steps: 4.9 min, 1 full (4.9 min)');
  });

  it('warns that minutes are wall time when the suspend log cannot be read', () => {
    const outcome = run(['readings', '--stretch=1', '--item=485', `--root=${ROOT}`], fakeIo(files, { journalctl: { code: 2 } }));

    expect(outcome.text).toContain('suspends unknown (journalctl exited 2)');
  });

  it('refuses without --item, with the usage', () => {
    const outcome = run(['readings', '--stretch=1', `--root=${ROOT}`], fakeIo(files, {}));

    expect(outcome.code).toBe(2);
    expect(outcome.text).toContain('readings needs --item=<issue>');
  });
});

describe('data-check', () => {
  let scratch = '';

  afterEach(() => {
    if (scratch !== '') {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('exits 1 and names the other machine when the store holds none of this one in the window', () => {
    scratch = mkdtempSync(join(tmpdir(), 'stretch-data-check-'));
    const store = join(scratch, 'effort.sqlite');
    const db = new Database(store);

    db.run('CREATE TABLE sessions (seq INTEGER PRIMARY KEY, session_id TEXT, row_json TEXT)');
    db.run('INSERT INTO sessions (session_id, row_json) VALUES (?, ?)', ['a', JSON.stringify({ filePath: '/Users/one/x.jsonl', lastTimestamp: '2026-09-29T08:51:22Z' })]);
    db.close();
    const outcome = run(['data-check', '--stretch=1', `--root=${ROOT}`, `--store=${store}`], fakeIo({ [`${DIR}/agent.json`]: AGENT }, {}));

    expect(outcome.code).toBe(1);
    expect(outcome.text).toContain('baseline usable: no');
    expect(outcome.text).toContain('/Users/one: 1 sessions, 0 in the window');
  });
});

describe('base-check', () => {
  it('answers OK when the branch holds the integration branch', () => {
    const outcome = run(['base-check', 'feat/rafa-486', '--stretch=1', `--root=${ROOT}`], fakeIo({}, { 'git rev-parse': { stdout: '6205585\n' } }));

    expect(outcome).toMatchObject({ code: 0, text: 'OK: origin/feat/rafa-486 holds origin/stretch/1 (6205585)' });
  });

  it('refuses when behind, and merges and pushes with --fix', () => {
    const behind = { 'git merge-base': { code: 1 }, 'git rev-parse': { stdout: '6205585' } };
    const calls: string[] = [];

    expect(run(['base-check', 'feat/rafa-607', '--stretch=1', `--root=${ROOT}`], fakeIo({}, behind)).code).toBe(1);
    const fixed = run(['base-check', 'feat/rafa-607', '--stretch=1', `--root=${ROOT}`, '--fix'], fakeIo({}, behind, calls));

    expect(fixed.code).toBe(0);
    expect(fixed.text).toContain('FIXED: origin/stretch/1 merged into feat/rafa-607 and pushed');
    expect(calls.some((line) => line.startsWith('git push -q origin HEAD:refs/heads/feat/rafa-607'))).toBe(true);
  });

  it('refuses without a base', () => {
    expect(run(['base-check', 'feat/x', `--root=${ROOT}`], fakeIo({}, {})).text).toContain('needs --stretch=<n> or --base=<branch>');
  });
});

describe('merge-guard', () => {
  const show = (base: string): Partial<ExecResult> => ({ stdout: `{"type":"result","data":{"detail":{"state":"open","headRefName":"feat/rafa-628","baseRefName":"${base}","mergeStateStatus":"CLEAN"}}}` });

  it('refuses a pull request on the wrong base, and never merges it', () => {
    const calls: string[] = [];
    const outcome = run(['merge-guard', '648', 'feat/rafa-628', '--stretch=1', `--root=${ROOT}`, '--merge'], fakeIo({}, { 'rafa pr show': show('main'), 'git branch': { stdout: 'stretch/1' } }, calls));

    expect(outcome).toMatchObject({ code: 1, text: 'REFUSED: #648: its base is main, not stretch/1' });
    expect(calls.some((line) => line.startsWith('rafa pr merge'))).toBe(false);
  });

  it('merges with --merge, adding --skip-checks only when asked', () => {
    const calls: string[] = [];
    const outcome = run(['merge-guard', '648', 'feat/rafa-628', '--stretch=1', `--root=${ROOT}`, '--merge'], fakeIo({}, { 'rafa pr show': show('stretch/1'), 'git branch': { stdout: 'stretch/1' } }, calls));

    expect(outcome.code).toBe(0);
    expect(calls).toContain('rafa pr merge 648 --yes --no-hint');
  });
});

describe('watch', () => {
  const files = {
    [`${DIR}/agent.json`]: AGENT,
    [`${DIR}/loop-486.log`]: 'rafa· task 1/2 start "x"\n',
    '/home/op/.claude/projects/-work-rafa/eng-1.jsonl': '{"timestamp":"2026-10-02T12:08:00Z"}',
  };
  const answers = { 'claude agents': { stdout: '[{"sessionId":"eng-1","status":"busy"}]' }, 'rafa loop list': { stdout: '{"type":"result","data":{"sessions":[{"session":{"planStub":"rafa-486","state":"running"}}]}}' } };

  it('probes the agent, the loop and the hook rule in one call', () => {
    const outcome = run(['watch', '--stretch=1', `--root=${ROOT}`], fakeIo(files, answers));

    expect(outcome.text).toContain('agent: busy, last record 2 min ago (awake)');
    expect(outcome.text).toContain('loops running: rafa-486');
    expect(outcome.text).toContain('hook rule: clear');
  });

  it('times out with exit 3 when nothing fires', () => {
    expect(run(['watch', '--stretch=1', `--root=${ROOT}`, '--until', '--timeout=1', '--every=30'], fakeIo(files, answers)).code).toBe(3);
  });

  it('fires the hook rule at once when a settings file names the hook', () => {
    const outcome = run(['watch', '--stretch=1', `--root=${ROOT}`, '--until', '--timeout=1'], fakeIo({ ...files, [`${ROOT}/.claude/settings.json`]: '{"hooks":"rafa-tooling-hook"}' }, answers));

    expect(outcome.code).toBe(0);
    expect(outcome.text).toContain('hook rule: /work/rafa/.claude/settings.json names rafa-tooling-hook');
  });
});

describe('the entry', () => {
  it('refuses an unknown action with the usage', () => {
    const outcome = run(['sweep'], fakeIo({}, {}));

    expect(outcome.code).toBe(2);
    expect(outcome.text).toContain('unknown action sweep');
    expect(outcome.text).toContain('stretch <action>');
  });

  it('prints the rafa it runs beside for --version', () => {
    expect(run(['--version'], fakeIo({}, { 'rafa --version': { stdout: 'rafa 0.33.0\n' } })).text).toBe('stretch, beside rafa 0.33.0');
  });
});
