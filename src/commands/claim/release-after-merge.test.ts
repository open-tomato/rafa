/**
 * `rafa claim release <n>` after `rafa effort merge` rebuilt the device's
 * store, over a real bare remote and a clone of it standing for the device.
 *
 * The device mints its store, claims the issue on the remote under that
 * store id, merges another store of the same project into its own, and
 * writes once. The release then reads the real store, with the command's
 * store id seam left at its default, `readDeviceStoreId`, and succeeds as
 * the owner: the merge moved no store id.
 *
 * The control comes first: the printed backup, a copy that is not the
 * store its id was minted for, is renamed back over the merged store
 * before the write, which mints a new store id, so the same
 * release is refused as another store's claim and pushes nothing. A
 * command that released for every store, or for none, fails one case.
 *
 * Every case writes once before the command reads the store id, since a
 * read never mints and a read-only check passes while wrong.
 */
import type { StoreIdentitySeams } from '../../effort/store/store-meta.js';
import type { GitRunner } from '../../pr/index.js';
import type { RuntimeIdentity } from '../../runtime/identity.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { readDeviceStoreId } from '../../claims/device.js';
import { makeOwnershipCommit, pushNewClaimBranch } from '../../claims/git.js';
import { parseClaimMessage } from '../../claims/record.js';
import { bringForward } from '../../effort/store/bring-forward.js';
import { sqliteStorePath, withSqliteStore } from '../../effort/store/sqlite.js';
import { readHostId } from '../../effort/store/store-identity.js';
import { readStoreMeta } from '../../effort/store/store-meta.js';
import { createGitRunner } from '../../pr/index.js';
import { dispatchInProject, plantProject } from '../../tests/cli-capture.js';
import { createMergeCommand } from '../effort/merge.js';

import { createClaimReleaseCommand } from './release.js';

const ISSUE = 7;
const BRANCH = 'feat/rafa-7-release';
const NOW = new Date('2026-10-02T12:00:00.000Z');
const COLLECTED_AT = '2026-10-02T10:00:00.000Z';
const ORIGIN = 'store-local';
const RESTORED = 'store-restored';
const OTHER_ORIGIN = 'store-other';
const PROJECT = { rootCommit: 'a1b2c3d4', remote: null };
const INSTALLED: RuntimeIdentity = { kind: 'installed', entry: '/home/u/.rafa/runtime/0.24.1/cli.js' };
const SUBJECTS = [{ name: 'effort', summary: 'the effort store' }, { name: 'claim', summary: 'claims' }];
/** This machine's host id: the rebuild's carry reads it itself, so the mints record it too. */
const HOST = readHostId();
const BACKUP_LINE = /kept (?:whole )?at (\S+\.bak)/;

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-claim-after-merge-')));

afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** The device: a bare remote, a clone of it, a project, and the store minted under {@link ORIGIN}. */
interface Device {
  readonly origin: GitRunner;
  readonly git: GitRunner;
  readonly project: PlantedProject;
  readonly storePath: string;
  readonly otherPath: string;
}

/** Runs git and throws with what it said when it fails: a fixture step, not a reading. */
function must(git: GitRunner, args: readonly string[]): string {
  const result = git(args);
  if (!result.ok) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

/** Seams of one host and project whose store ids come from `ids` in order, and throw when none is left. */
function seamsOf(...ids: readonly string[]): StoreIdentitySeams {
  const queue = [...ids];
  return {
    readHostId: () => HOST,
    readProject: () => PROJECT,
    newStoreId: () => {
      const next = queue.shift();
      if (next === undefined) throw new Error('a write minted a store id the case did not expect');
      return next;
    },
    now: () => NOW,
  };
}

/** One writing open of `path`, answering the store id the open left. */
function writeOpen(path: string, seams: StoreIdentitySeams, create = false): string | undefined {
  return withSqliteStore(path, 'write', create, (db) => readStoreMeta(db)?.storeId, seams);
}

/** Plants a finding for `key` under `origin` in the store at `path`. */
function plantFinding(path: string, origin: string, key: string): void {
  const db = new Database(path, { readwrite: true });
  try {
    db.query(
      'INSERT INTO findings (seq, origin_store, origin_seq, id, session_id, task_line, kind, what, artifact, signal, outcome, collected_at)'
        + ' VALUES (1, ?, 1, ?, ?, ?, \'gotcha\', ?, ?, \'loud\', \'done\', ?)',
    ).run(origin, `id-${key}`, `session-${key}`, `task ${key}`, `what ${key}`, `artifact-${key}`, COLLECTED_AT);
  } finally {
    db.close();
  }
}

/** Plants a device with a minted store, its claim on the remote under that store id, and another store to merge. */
function plantDevice(name: string): Device {
  const root = realpathSync(mkdtempSync(join(scope, `${name}-`)));
  const originPath = join(root, 'origin.git');
  const git = createGitRunner(scope);
  must(git, ['init', '--quiet', '--bare', '--initial-branch=main', originPath]);
  const seedPath = join(root, 'seed');
  must(git, ['clone', '--quiet', originPath, seedPath]);
  const seed = createGitRunner(seedPath);
  must(seed, ['config', 'user.name', 'seed']);
  must(seed, ['config', 'user.email', 'seed@example.invalid']);
  must(seed, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(seedPath, 'kept.txt'), 'kept\n', 'utf8');
  must(seed, ['add', '--all']);
  must(seed, ['commit', '--quiet', '-m', 'root']);
  must(seed, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
  const clonePath = join(root, 'device');
  must(git, ['clone', '--quiet', originPath, clonePath]);
  const device = createGitRunner(clonePath);
  must(device, ['config', 'user.name', 'device']);
  must(device, ['config', 'user.email', 'device@example.invalid']);
  must(device, ['config', 'commit.gpgsign', 'false']);

  const project = plantProject(realpathSync(mkdtempSync(join(root, 'project-'))));
  const storePath = sqliteStorePath(project.root);
  if (writeOpen(storePath, seamsOf(ORIGIN), true) !== ORIGIN) throw new Error('the first write minted nothing');
  plantFinding(storePath, ORIGIN, 'a1');

  const otherPath = join(root, 'device-b', 'effort.sqlite');
  mkdirSync(dirname(otherPath), { recursive: true });
  const other = new Database(otherPath, { create: true, readwrite: true });
  try {
    bringForward(other, otherPath, 'write', 'open', { identity: INSTALLED });
  } finally {
    other.close();
  }
  plantFinding(otherPath, OTHER_ORIGIN, 'b1');

  const made = makeOwnershipCommit(device, 'main', { action: 'claim', issue: ISSUE, store: ORIGIN });
  if (!made.ok) throw new Error(made.reason);
  const pushed = pushNewClaimBranch(device, made.sha, BRANCH);
  if (pushed.outcome !== 'pushed') throw new Error(`claim push: ${pushed.outcome}`);
  return { origin: createGitRunner(originPath), git: device, project, storePath, otherPath };
}

/** Dispatches `rafa effort merge` of the device's other store, answering the backup it printed. */
async function mergeOther(device: Device): Promise<string> {
  const command = createMergeCommand({
    now: () => NOW,
    identity: INSTALLED,
    isAlive: () => false,
    newMergeId: () => 'merge-1',
    readProject: () => PROJECT,
  });
  const run = await dispatchInProject(['effort', 'merge', device.otherPath], SUBJECTS, [command], device.project);
  expect(run.exitCode).toBe(0);
  expect(run.stdout).toContain('Total: 1 added');
  const backup = BACKUP_LINE.exec(run.stdout)?.[1];
  if (backup === undefined) throw new Error(`no backup named in: ${run.stdout}`);
  return backup;
}

/** Dispatches `rafa claim release 7` with the store id seam at its default: the project's real store. */
async function release(device: Device): Promise<{ exitCode: number; text: string }> {
  const command = createClaimReleaseCommand((root, config) => ({
    git: device.git,
    board: null,
    readStoreId: () => readDeviceStoreId(root, config),
  }));
  const run = await dispatchInProject(['claim', 'release', String(ISSUE)], SUBJECTS, [command], device.project);
  return { exitCode: run.exitCode, text: `${run.stdout}${run.stderr}` };
}

/** The remote's tip of the claim branch, and the latest ownership record on it. */
function remoteState(device: Device): { tip: string; record: ReturnType<typeof parseClaimMessage> } {
  return {
    tip: must(device.origin, ['rev-parse', `refs/heads/${BRANCH}`]),
    record: parseClaimMessage(must(device.origin, ['log', '-1', '--format=%B', `refs/heads/${BRANCH}`])),
  };
}

describe('rafa claim release after rafa effort merge', () => {
  it('is refused as another store\'s claim when the store\'s backup was renamed back over it before the write', async () => {
    const device = plantDevice('control');
    const before = remoteState(device);
    const backup = await mergeOther(device);
    renameSync(backup, device.storePath);
    expect(writeOpen(device.storePath, seamsOf(RESTORED))).toBe(RESTORED);

    const run = await release(device);

    expect(run.exitCode).toBe(1);
    expect(run.text).toContain(`#${String(ISSUE)} is claimed by store ${ORIGIN} on ${BRANCH}, not by this device (store ${RESTORED})`);
    expect(remoteState(device)).toEqual(before);
  });

  it('succeeds as the owner when one write followed the merge', async () => {
    const device = plantDevice('owner');
    const before = remoteState(device);
    await mergeOther(device);
    expect(writeOpen(device.storePath, seamsOf())).toBe(ORIGIN);

    const run = await release(device);

    expect(run.exitCode).toBe(0);
    expect(run.text).toContain(`Released the claim on #${String(ISSUE)} (store ${ORIGIN}) on ${BRANCH}`);
    const after = remoteState(device);
    expect(after.tip).not.toBe(before.tip);
    expect(must(device.origin, ['rev-parse', `${after.tip}^`])).toBe(before.tip);
    expect(after.record).toEqual({ kind: 'ownership', record: { action: 'release', issue: ISSUE, store: ORIGIN } });
  });
});
