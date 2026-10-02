/**
 * Which store a row came from: the facts a writing open compares to
 * tell whether this file is still the store its origin was minted for,
 * and the decision whether to mint a new one.
 *
 * ## The origin is the store, never the machine
 *
 * A row's origin pair is `(origin_store, origin_seq)`. Two stores that
 * stamp one `origin_store` write colliding pairs as soon as both count
 * past the rows they share, so a store that is a copy of another must
 * stamp a new one. The rule every check here follows: **minting a new
 * origin is always safe, and missing a copy is not.** An extra origin
 * only adds a store id; a missed copy lets two stores write the same
 * pairs. So each doubt resolves towards minting.
 *
 * ## The three facts
 *
 * `store_meta` records three facts when the origin is minted, and
 * {@link decideStoreIdentity} mints again when a writing open finds any
 * one of them different:
 *
 *   - The **host id** ({@link readHostId}). A store opened on another
 *     machine is a copy.
 *   - The store file's **absolute path**, read through its real path
 *     ({@link readStoreFileFacts}), so a symlinked spelling of the same
 *     file is the same path. A store copied to another path is a copy.
 *   - Its **file identity**, device and inode. A `.bak` renamed back
 *     over the store has the path and the host and a new inode, so it
 *     is caught; the host id alone would miss it.
 *
 * A store renamed away and back to its own path keeps all three, and
 * its origin. A copy `rafa effort copy` writes is a new file and gets a
 * new origin, which is harmless. The file `fix-schema`, `migrate` or
 * `rafa effort merge` swaps in over the store is a new file too, but
 * the swap carries the store's identity onto it before the rename
 * (`carryStoreIdentity`, `store-meta.ts`; `rebuild-aside.ts`), so it
 * keeps the store's origin. The backup that swap leaves is a snapshot
 * with an inode of its own and the original's row, so renamed back
 * over the store it mints.
 *
 * Two copies these facts cannot see, measured on 2026-09-29 on tmpfs:
 * a `.bak` restored with `cp` over the existing file is written into
 * the old inode, so all three facts match; and a disk cloned whole
 * matches all three as well. The merge catches both afterwards, since
 * one origin pair holding two contents can only come from a missed
 * copy.
 *
 * ## The host id is a keyed hash
 *
 * `/etc/machine-id` on Linux, the `IOPlatformUUID` that
 * `ioreg -rd1 -c IOPlatformExpertDevice` prints on macOS, and
 * `os.hostname()` anywhere else or when the platform's own source says
 * nothing. `machine-id(5)` asks that the id never be used directly, only
 * through a keyed hash under an application-specific key, and a store
 * travels to other devices, so the host id is {@link hostIdFrom}: an
 * HMAC-SHA256 of the source name and the value. The hash keeps the
 * sources apart, so a hostname can never equal a machine id.
 *
 * ## The project identity
 *
 * {@link readProjectIdentity} reads the root commit and the `origin`
 * remote, which a merge compares to refuse two stores of different
 * projects. The remote is stored normalised (`normalizeRemote`), which
 * strips any credentials a URL carries and makes the spellings two
 * checkouts use for one repository equal. Neither is a copy fact: a
 * remote added later is the same store.
 *
 * ## A read decides nothing
 *
 * An open that only reads never mints, and never asks for the facts:
 * `decideStoreIdentity` takes them as a function it calls on a write
 * alone, so a read spawns no `ioreg`, stats nothing and writes nothing.
 */
import type { StoreAccess } from './schema-plan.js';
import type { GitRunner } from '../../pr/git.js';

import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { hostname, platform as currentPlatform } from 'node:os';

import { createGitRunner } from '../../pr/git.js';
import { normalizeRemote } from '../../schema/project-id.js';

/**
 * The application-specific key `machine-id(5)` asks for. Changing it
 * changes every host id, so every store would mint on its next write.
 */
const HOST_ID_KEY = 'rafa effort store host id';

/** Where the Linux host id is read from. */
const MACHINE_ID_PATH = '/etc/machine-id';

/** The command whose output holds the macOS platform UUID. */
const IOREG_ARGS = ['-rd1', '-c', 'IOPlatformExpertDevice'] as const;

/** Which source a host id was derived from. */
export type HostIdSource = 'machine-id' | 'platform-uuid' | 'hostname';

/** What {@link readHostId} reads the machine through. */
export interface HostIdSeams {
  /** `process.platform`'s spelling. `os.platform()` when absent. */
  readonly platform?: string;
  /** The Linux machine id, or null when there is none. */
  readonly readMachineId?: () => string | null;
  /** The macOS platform UUID, or null when there is none. */
  readonly readPlatformUuid?: () => string | null;
  /** The hostname, the fallback. `os.hostname()` when absent. */
  readonly readHostname?: () => string;
}

/**
 * The host id stored for `value` read from `source`: the hex
 * HMAC-SHA256 of `<source>:<value>` under this module's key. Never the
 * value itself; see the module note.
 */
export function hostIdFrom(source: HostIdSource, value: string): string {
  return createHmac('sha256', HOST_ID_KEY).update(`${source}:${value}`)
    .digest('hex');
}

/** `/etc/machine-id`, trimmed, or null when it is absent, unreadable or empty. */
function readMachineIdFile(): string | null {
  try {
    const value = readFileSync(MACHINE_ID_PATH, 'utf8').trim();
    return value === ''
      ? null
      : value;
  } catch {
    return null;
  }
}

/**
 * The `IOPlatformUUID` value in `ioreg -rd1 -c IOPlatformExpertDevice`
 * output, or null when no line carries one.
 */
export function parseIoregPlatformUuid(output: string): string | null {
  const match = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(output);
  return match?.[1] ?? null;
}

/** The macOS platform UUID, or null when `ioreg` cannot be run or prints none. */
function readIoregPlatformUuid(): string | null {
  const result = spawnSync('ioreg', [...IOREG_ARGS], { encoding: 'utf8' });
  if (result.error !== undefined || result.status !== 0) return null;
  return parseIoregPlatformUuid(result.stdout);
}

/**
 * This machine's host id: from the machine id on Linux, the platform
 * UUID on macOS, the hostname otherwise or when that source answers
 * nothing. Tests pass every seam and never read the real machine.
 */
export function readHostId(seams: HostIdSeams = {}): string {
  const platform = seams.platform ?? currentPlatform();
  if (platform === 'linux') {
    const machineId = (seams.readMachineId ?? readMachineIdFile)();
    if (machineId !== null) return hostIdFrom('machine-id', machineId);
  }
  if (platform === 'darwin') {
    const platformUuid = (seams.readPlatformUuid ?? readIoregPlatformUuid)();
    if (platformUuid !== null) return hostIdFrom('platform-uuid', platformUuid);
  }
  return hostIdFrom('hostname', (seams.readHostname ?? hostname)());
}

/** Where the store file is and which file it is. */
export interface StoreFileFacts {
  /** The file's real path: absolute, with every symlink resolved. */
  readonly storePath: string;
  /** The device the file is on. A bigint, so no inode is rounded. */
  readonly fileDev: bigint;
  /** The file's inode on that device. */
  readonly fileIno: bigint;
}

/**
 * The absolute path and file identity of the store file at `path`.
 * Throws the filesystem's own error, which names the path, when the
 * file does not exist.
 */
export function readStoreFileFacts(path: string): StoreFileFacts {
  const storePath = realpathSync(path);
  const stats = statSync(storePath, { bigint: true });
  return { storePath, fileDev: stats.dev, fileIno: stats.ino };
}

/** The three facts a writing open compares. */
export interface StoreIdentityFacts extends StoreFileFacts {
  /** {@link readHostId}'s answer. */
  readonly hostId: string;
}

/**
 * The facts of the store file at `path`, with the host id `readHost`
 * answers ({@link readHostId} when absent).
 */
export function observeStore(path: string, readHost: () => string = readHostId): StoreIdentityFacts {
  return { hostId: readHost(), ...readStoreFileFacts(path) };
}

/**
 * The identity a store recorded when its origin was minted. The device
 * and inode may come back from SQLite as numbers.
 */
export interface RecordedIdentity {
  /** The origin the store stamps on the rows it writes. */
  readonly storeId: string;
  /** The host id it was minted on. */
  readonly hostId: string;
  /** The absolute path it was minted at. */
  readonly storePath: string;
  /** The device its file was on. */
  readonly fileDev: bigint | number;
  /** Its file's inode. */
  readonly fileIno: bigint | number;
}

/**
 * Why a writing open mints: the store holds no identity yet, or the
 * host, the path or the file (device or inode) differs from the one
 * recorded.
 */
export type MintReason = 'unminted' | 'host' | 'path' | 'file';

/** What a store open does about its identity. */
export type IdentityDecision =
  /** A read: nothing is minted, compared or observed. */
  | { readonly action: 'none' }
  /** A write to the store the origin was minted for: stamp `storeId`. */
  | { readonly action: 'keep'; readonly storeId: string }
  /** A write that must mint a new origin and record `facts`. */
  | { readonly action: 'mint'; readonly reasons: readonly MintReason[]; readonly facts: StoreIdentityFacts };

/** Each fact of `facts` that differs from `recorded`, in host, path, file order. */
function movedFacts(recorded: RecordedIdentity, facts: StoreIdentityFacts): MintReason[] {
  const sameFile = BigInt(recorded.fileDev) === facts.fileDev && BigInt(recorded.fileIno) === facts.fileIno;
  const moved: [MintReason, boolean][] = [
    ['host', recorded.hostId !== facts.hostId],
    ['path', recorded.storePath !== facts.storePath],
    ['file', !sameFile],
  ];
  return moved.filter(([, differs]) => differs).map(([reason]) => reason);
}

/**
 * What an open with `access` does about the store's identity, given the
 * identity it `recorded` (null when it holds none). A read answers
 * `none` without calling `observe`. A write observes the store once and
 * mints when nothing is recorded or any of the three facts moved, and
 * keeps the recorded origin otherwise.
 */
export function decideStoreIdentity(
  access: StoreAccess,
  recorded: RecordedIdentity | null,
  observe: () => StoreIdentityFacts,
): IdentityDecision {
  if (access === 'read') return { action: 'none' };

  const facts = observe();
  if (recorded === null) return { action: 'mint', reasons: ['unminted'], facts };

  const reasons = movedFacts(recorded, facts);
  return reasons.length === 0
    ? { action: 'keep', storeId: recorded.storeId }
    : { action: 'mint', reasons, facts };
}

/** The project a store belongs to, as a merge compares it. */
export interface ProjectIdentity {
  /** The smallest root commit of `HEAD`, or null outside a repository with commits. */
  readonly rootCommit: string | null;
  /** `origin`'s URL, normalised and without credentials, or null when there is none. */
  readonly remote: string | null;
}

/**
 * The smallest of the root commits git printed, so every clone of a
 * history with several roots names the same one, or null when git
 * failed or printed none.
 */
function smallestRootCommit(git: GitRunner): string | null {
  const result = git(['rev-list', '--max-parents=0', 'HEAD']);
  if (!result.ok) return null;
  const roots = result.stdout.split('\n').map((line) => line.trim())
    .filter((line) => line !== '');
  return [...roots].sort()[0] ?? null;
}

/** `origin`'s URL through `normalizeRemote`, or null when git names none. */
function normalisedRemote(git: GitRunner): string | null {
  const result = git(['remote', 'get-url', 'origin']);
  if (!result.ok) return null;
  const remote = normalizeRemote(result.stdout.trim());
  return remote === ''
    ? null
    : remote;
}

/**
 * The project identity of the repository holding `dir`, read through
 * `git` (a runner in `dir` when absent). Never throws: a part git
 * cannot read is null.
 */
export function readProjectIdentity(dir: string, git: GitRunner = createGitRunner(dir)): ProjectIdentity {
  return { rootCommit: smallestRootCommit(git), remote: normalisedRemote(git) };
}
