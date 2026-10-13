/**
 * Reading the sixth group of `rafa cleanup`: the branches that exist
 * only on `origin` and are not merged into the base, each row carrying
 * its name, the date of its tip, how many commits it holds past the
 * base and how many of those have no patch-equal copy there.
 *
 * This module prints nothing, deletes nothing and fetches nothing. It
 * reaches git only through the {@link GitRunner} it is handed and the
 * open pull requests only through the provider's `list`, so a unit test
 * scripts both. It reads the remote-tracking refs as the last fetch
 * left them: `./index.ts` runs `git fetch --prune` before the readers
 * when `rafa cleanup` asks for it.
 *
 * ## Which branches are listed
 *
 * A branch is listed when every one of these holds, read in this order
 * so the cheap readings come first:
 *
 *   1. `refs/remotes/origin/<name>` exists and is no symbolic ref. The
 *      one symbolic ref there is `origin/HEAD`, which is a name for
 *      another branch and not a branch.
 *   2. No `refs/heads/<name>` exists. A branch with a local copy is the
 *      three branch groups' to list (`./groups.ts`).
 *   3. It is not the base, not the branch `origin/HEAD` names
 *      (`readRemoteHead` of `./branches.ts`), not a `cleanup.keep` match
 *      (`isKept`, the same reading the local branches get) and not under
 *      {@link STRETCH_PREFIX}.
 *   4. `origin/<base>` does not reach its tip. A branch the base reaches
 *      is merged, and is not listed here at all.
 *   5. It is not the head of an open pull request.
 *   6. It is not a claim branch (`feat/rafa-<n>`, `../claims/git.ts`)
 *      whose claim another store holds.
 *
 * Every row starts UNticked: {@link RemoteOnlyRow.ticked} is the
 * literal `false`. Nothing here says a row's work is merged, so nothing
 * here may offer its removal as the default.
 *
 * ## The two counts
 *
 * Both come from one `git cherry origin/<base> origin/<name>` per row.
 * Git writes one line per commit the branch holds past the base: `- `
 * and the sha when the base holds a commit with the same patch, `+ `
 * when it holds none. {@link RemoteOnlyRow.commits} is the number of
 * lines and {@link RemoteOnlyRow.uncopied} the number of `+` lines.
 *
 * Merge commits are in neither count. Measured on git 2.53.0 under
 * Linux with `LC_ALL=C` (2026-10-13), in a clone of a bare remote: a
 * branch holding two commits and the merge that joins them, three by
 * `rev-list --count origin/main..origin/<name>`, answered two `+` lines;
 * a branch of two commits, the first cherry-picked onto the base,
 * answered `- <sha>` then `+ <sha>`. So a row can count no commit at all
 * while the base still does not reach it, and its reason then says
 * {@link remoteOnlyReason}'s third wording rather than claiming a copy.
 *
 * ## The open pull requests, and their two absences
 *
 * The head of an open pull request is work somebody has put up for
 * review, so the group cannot be read without them. With no provider
 * (`pr.provider: none`), or with one that throws, the open pull requests
 * are unknown: no row is listed, and ONE note says so and how many
 * branches it withheld ({@link openUnknownNote}, {@link openUnreadNote}).
 *
 * The provider is asked only when a branch has passed rules 1 to 4.
 * A repository with no branch only on `origin`, which is most of them
 * most of the time, therefore costs no provider call and carries no
 * note, whatever its provider: there is nothing withheld to speak of.
 *
 * `list` answers what the provider answers. At this commit the `gh`
 * provider asks for 30 rows (`LIST_LIMIT`, `../pr/gh.ts`), so in a
 * repository with more open pull requests than that, a head past the
 * limit is not seen here and its branch is listed.
 *
 * ## A claim branch
 *
 * A claim branch is read with `readClaimBranch`, off its
 * remote-tracking ref and with no fetch of its own. `holdsClaim`
 * (`../claims/device.ts`) decides whose it is:
 *
 *   - held by another store: not listed, and nothing is said. It is
 *     somebody's work in progress.
 *   - held, and {@link RemoteOnlySettings.device} is null because this
 *     device's store names no id: not listed either. Nothing proves the
 *     claim is this device's.
 *   - held by this device, released, or carrying no claim commit: read
 *     on like any other branch.
 *   - unreadable: not listed, with a note ({@link claimUnreadNote}).
 *
 * ## What is a note and what is a failure
 *
 * The two listings, `for-each-ref` over `refs/remotes/origin` and over
 * `refs/heads`, answer {@link RemoteOnlyUnread} when git refuses them or
 * writes a line this module cannot read: with no listing there is no
 * group. That is the shape `./branches.ts` answers, so `rafa doctor`
 * prints a row rather than crashing. Every later refusal withholds rows
 * and is a note, never a failure:
 *
 *   - `origin/<base>` cannot be read ({@link remoteBaseUnreadNote}).
 *     Measured in the same session: `git for-each-ref
 *     --merged=refs/remotes/origin/nope` exits 128 with `fatal: malformed
 *     object name refs/remotes/origin/nope`. A base that was never
 *     pushed is an ordinary state, and with no base nothing is merged or
 *     unmerged against it.
 *   - one row's `git cherry` fails ({@link copiesUnreadNote}): that row
 *     is left out and the others stay.
 *
 * A repository with no `origin` answers an empty first listing with
 * exit 0 (same measurement), so it reads as no row and no note, after
 * one git call.
 */
import type { BranchesUnread } from './branches.js';
import type { DeviceStoreIds } from '../claims/device.js';
import type { GitResult, GitRunner } from '../core/git/index.js';
import type { PullRequests } from '../pr/types.js';

import { holdsClaim } from '../claims/device.js';
import { claimBranchIssue, readClaimBranch } from '../claims/git.js';
import { messageOf } from '../core/config/sections.js';
import { gitSaid } from '../core/git/index.js';

import { isKept, readRemoteHead } from './branches.js';

/** The remote whose branches are read. */
const REMOTE = 'origin';

/** Where the remote's branches are kept in this clone. */
const REMOTE_REFS = `refs/remotes/${REMOTE}`;

/**
 * The prefix of a stretch's integration branch, never listed. Spelled
 * here because `STRETCH_BRANCH_PREFIX` lives in
 * `src/commands/stretch/start.ts`, which no file outside `src/commands/`
 * may import (`context/source.md`, "The library boundary").
 */
export const STRETCH_PREFIX = 'stretch/';

/**
 * The `for-each-ref` format every remote branch is read with: its name
 * without `refs/remotes/origin/`, its tip's committer date in seconds,
 * and the ref a symbolic one points at, empty for a branch. Tabs
 * separate the fields, which git refuses in a ref name.
 */
export const REMOTE_BRANCH_FORMAT: string = [
  '%(refname:lstrip=3)',
  '%(committerdate:unix)',
  '%(symref)',
].join('%09');

/** How many tab-separated fields {@link REMOTE_BRANCH_FORMAT} writes on each line. */
const FIELD_COUNT = 3;

/** Milliseconds in the second `%(committerdate:unix)` counts in. */
const MS_PER_SECOND = 1000;

/** What `git cherry` opens a line with for a commit the base holds no copy of. */
const UNCOPIED_MARK = '+ ';

/** What `git cherry` opens a line with for a commit the base holds a patch-equal copy of. */
const COPIED_MARK = '- ';

/** One branch that exists only on `origin` and is not merged into the base. */
export interface RemoteOnlyRow {
  readonly group: 'remote-only';
  /** Its name, without `origin/`. */
  readonly name: string;
  /** The committer date of its tip. */
  readonly lastCommit: Date;
  /** The commits it holds past `origin/<base>`, merge commits left out; see the module note. */
  readonly commits: number;
  /** How many of {@link commits} have no patch-equal copy on `origin/<base>`. */
  readonly uncopied: number;
  /** Always false: no remote-only row starts ticked. */
  readonly ticked: false;
  /** Why it is listed, one line, without the name or the date: {@link remoteOnlyReason}. */
  readonly reason: string;
}

/** What {@link readRemoteOnly} needs besides git and the provider. */
export interface RemoteOnlySettings {
  /** The base the branch groups were read against (`BranchesRead.base`); rows are compared with `origin/<base>`. */
  readonly base: string;
  /** `cleanup.keep`: glob patterns naming branches never listed. */
  readonly keep: readonly string[];
  /** This device's store id and the ids that store replaced, or null when its store names no id. */
  readonly device: Pick<DeviceStoreIds, 'storeId' | 'replacedIds'> | null;
}

/** The remote-only rows, by name, and the notes about readings that could not be taken. */
export interface RemoteOnlyRead {
  readonly ok: true;
  /** The base the rows were compared with, as `origin/<base>`. */
  readonly base: string;
  /** Every listed branch, in the order git wrote them (by name). */
  readonly rows: readonly RemoteOnlyRow[];
  /** One-line notes about rows that were withheld; empty when none was. */
  readonly notes: readonly string[];
}

/** Git refused a listing, or wrote a line this module could not read. */
export type RemoteOnlyUnread = BranchesUnread;

/** What {@link readRemoteOnly} answers. Never a rejection; see the module note. */
export type RemoteOnlyReading = RemoteOnlyRead | RemoteOnlyUnread;

/**
 * A row's reason: how many of its `commits` have no patch-equal copy on
 * `origin/<base>`, against the total. Three wordings: some commit has
 * none; every commit has one; or the branch counts no commit at all,
 * holding merge commits only.
 */
export function remoteOnlyReason(uncopied: number, commits: number, base: string): string {
  const onBase = `${REMOTE}/${base}`;
  if (commits === 0) {
    return `only merge commits past ${onBase}`;
  }
  if (uncopied === 0) {
    return `every commit has a patch-equal copy on ${onBase} (${plural(commits, 'commit')})`;
  }
  return `${String(uncopied)} of ${plural(commits, 'commit')} with no patch-equal copy on ${onBase}`;
}

/** The one line saying no provider is configured, so `withheld` branches are not listed. */
export function openUnknownNote(withheld: number): string {
  return `no pull request provider, so open pull requests are unknown; ${withheldPhrase(withheld)}`;
}

/** The one line saying the provider could not be read, so `withheld` branches are not listed. */
export function openUnreadNote(withheld: number, detail: string): string {
  return `open pull requests could not be read (${detail}); ${withheldPhrase(withheld)}`;
}

/** The one line saying `origin/<base>` could not be read, so no branch only on `origin` is listed. */
export function remoteBaseUnreadNote(base: string, detail: string): string {
  return `could not read which ${REMOTE} branches are merged into ${REMOTE}/${base} (${detail}); no branch only on ${REMOTE} is listed`;
}

/** The one line saying the claim on `branch` could not be read, so it is not listed. */
export function claimUnreadNote(branch: string, detail: string): string {
  return `could not read the claim on ${REMOTE}/${branch} (${detail}); it is not listed`;
}

/** The one line saying `branch` could not be compared with the base, so it is not listed. */
export function copiesUnreadNote(branch: string, base: string, detail: string): string {
  return `could not compare ${REMOTE}/${branch} with ${REMOTE}/${base} (${detail}); it is not listed`;
}

/**
 * The branches that exist only on `origin` and are not merged into
 * `origin/<settings.base>`, by the rules of the module note. Runs two
 * `for-each-ref` listings, the `origin/HEAD` reading, one `--merged`
 * listing, `pulls.list()` once and only when a branch has passed every
 * git rule, the claim reading of each claim branch left, and one
 * `git cherry` per row. `pulls` is null when no provider is configured.
 */
export async function readRemoteOnly(
  git: GitRunner,
  pulls: Pick<PullRequests, 'list'> | null,
  settings: RemoteOnlySettings,
): Promise<RemoteOnlyReading> {
  const unmerged = readUnmerged(git, settings);
  if (!('branches' in unmerged)) {
    return unmerged;
  }
  const { branches } = unmerged;
  const notes = [...unmerged.notes];
  const done = (rows: readonly RemoteOnlyRow[]): RemoteOnlyRead => ({ ok: true, base: settings.base, rows, notes });
  if (branches.length === 0) {
    return done([]);
  }

  const open = await readOpenHeads(pulls);
  if (open.state === 'none') {
    notes.push(openUnknownNote(branches.length));
    return done([]);
  }
  if (open.state === 'unreachable') {
    notes.push(openUnreadNote(branches.length, open.detail));
    return done([]);
  }

  const rows: RemoteOnlyRow[] = [];
  for (const branch of branches.filter(({ name }) => !open.heads.has(name))) {
    const read = readRow(git, branch, settings);
    if ('note' in read) {
      notes.push(...read.note);
    } else {
      rows.push(read.row);
    }
  }
  return done(rows);
}

/** One branch read to its row, or left out: with a note when a reading failed, with none for a claim held elsewhere. */
type RowReading =
  | { readonly row: RemoteOnlyRow }
  | { readonly note: readonly string[] };

/**
 * The row of `branch`, which passed rules 1 to 5 of the module note:
 * its claim read first, then its two counts.
 */
function readRow(git: GitRunner, branch: RemoteBranch, settings: RemoteOnlySettings): RowReading {
  const { name } = branch;
  const claim = readClaimStanding(git, name, settings.device);
  if (claim.kind === 'elsewhere') {
    return { note: [] };
  }
  if (claim.kind === 'unread') {
    return { note: [claimUnreadNote(name, claim.detail)] };
  }
  const copies = readCopies(git, settings.base, name);
  if (typeof copies === 'string') {
    return { note: [copiesUnreadNote(name, settings.base, copies)] };
  }
  return {
    row: {
      group: 'remote-only',
      name,
      lastCommit: branch.lastCommit,
      commits: copies.commits,
      uncopied: copies.uncopied,
      ticked: false,
      reason: remoteOnlyReason(copies.uncopied, copies.commits, settings.base),
    },
  };
}

/** One branch under `refs/remotes/origin/`, as `for-each-ref` described it. */
interface RemoteBranch {
  readonly name: string;
  readonly lastCommit: Date;
}

/** The branches that passed rules 1 to 4 of the module note, and the notes those rules left. */
interface Unmerged {
  readonly branches: readonly RemoteBranch[];
  readonly notes: readonly string[];
}

/**
 * The branches only on `origin` that no name rule drops and
 * `origin/<base>` does not reach: rules 1 to 4 of the module note. Stops
 * at the first reading that leaves no branch, so a repository with no
 * `origin` runs one git call.
 */
function readUnmerged(git: GitRunner, settings: RemoteOnlySettings): Unmerged | RemoteOnlyUnread {
  const none: Unmerged = { branches: [], notes: [] };
  const remote = readRemoteBranches(git);
  if (typeof remote === 'string') {
    return { ok: false, detail: remote };
  }
  if (remote.length === 0) {
    return none;
  }
  const heads = git(['for-each-ref', '--format=%(refname:lstrip=2)', 'refs/heads']);
  if (!heads.ok) {
    return { ok: false, detail: failure('git for-each-ref refs/heads', heads) };
  }
  const local = new Set(lines(heads.stdout));
  const remoteHead = readRemoteHead(git);
  const named = remote.filter(({ name }) => !local.has(name)
    && name !== settings.base
    && name !== remoteHead
    && !name.startsWith(STRETCH_PREFIX)
    && !isKept(name, settings.keep));
  if (named.length === 0) {
    return none;
  }

  const baseRef = `${REMOTE_REFS}/${settings.base}`;
  const merged = git(['for-each-ref', `--merged=${baseRef}`, '--format=%(refname:lstrip=3)', REMOTE_REFS]);
  if (!merged.ok) {
    const detail = failure('git for-each-ref --merged', merged);
    return { branches: [], notes: [remoteBaseUnreadNote(settings.base, detail)] };
  }
  const reached = new Set(lines(merged.stdout));
  return { branches: named.filter(({ name }) => !reached.has(name)), notes: [] };
}

/**
 * Every branch under `refs/remotes/origin/`, symbolic refs left out, or
 * why the listing could not be read, naming the line.
 */
function readRemoteBranches(git: GitRunner): RemoteBranch[] | string {
  const result = git(['for-each-ref', `--format=${REMOTE_BRANCH_FORMAT}`, REMOTE_REFS]);
  if (!result.ok) {
    return failure(`git for-each-ref ${REMOTE_REFS}`, result);
  }
  const branches: RemoteBranch[] = [];
  for (const line of lines(result.stdout)) {
    const fields = line.split('\t');
    const [name = '', unix = '', symref = ''] = fields;
    if (fields.length !== FIELD_COUNT || name === '') {
      return `git for-each-ref wrote a line with ${String(fields.length)} fields, expected ${String(FIELD_COUNT)}: ${JSON.stringify(line)}`;
    }
    if (symref !== '') {
      continue;
    }
    const seconds = Number(unix);
    if (unix === '' || !Number.isInteger(seconds)) {
      return `git for-each-ref wrote no commit date for ${REMOTE}/${name}: ${JSON.stringify(unix)}`;
    }
    branches.push({ name, lastCommit: new Date(seconds * MS_PER_SECOND) });
  }
  return branches;
}

/** What the provider said about open pull requests: nothing configured, unreadable, or their head branches. */
type OpenHeads =
  | { readonly state: 'none' }
  | { readonly state: 'unreachable'; readonly detail: string }
  | { readonly state: 'read'; readonly heads: ReadonlySet<string> };

/**
 * The head branch of every open pull request `pulls` lists. Null, no
 * provider configured, answers `none`; a provider that throws answers
 * `unreachable` with the first line of what it said. Never rejects.
 */
async function readOpenHeads(pulls: Pick<PullRequests, 'list'> | null): Promise<OpenHeads> {
  if (pulls === null) {
    return { state: 'none' };
  }
  try {
    const open = await pulls.list();
    return { state: 'read', heads: new Set(open.map((pull) => pull.headRefName)) };
  } catch (error) {
    return { state: 'unreachable', detail: firstLine(messageOf(error)) };
  }
}

/** Whether a branch's claim leaves it listable: no live claim elsewhere, one elsewhere, or a claim git could not read. */
type ClaimStanding =
  | { readonly kind: 'free' }
  | { readonly kind: 'elsewhere' }
  | { readonly kind: 'unread'; readonly detail: string };

/**
 * The standing of `name`'s claim, by the module note: `free` for a
 * branch that is no claim branch, or whose claim is released, absent or
 * this device's; `elsewhere` for one another store holds, and for any
 * held claim when `device` is null.
 */
function readClaimStanding(git: GitRunner, name: string, device: RemoteOnlySettings['device']): ClaimStanding {
  if (claimBranchIssue(name) === null) {
    return { kind: 'free' };
  }
  const reading = readClaimBranch(git, name);
  if (reading.state === 'absent') {
    return { kind: 'unread', detail: 'git resolved no tip for it' };
  }
  if (reading.state === 'unreadable') {
    return { kind: 'unread', detail: firstLine(reading.reason) || 'git said nothing' };
  }
  const { ownership } = reading;
  if (ownership.state !== 'held') {
    return { kind: 'free' };
  }
  return device !== null && holdsClaim(device, ownership.owner)
    ? { kind: 'free' }
    : { kind: 'elsewhere' };
}

/** The two counts of one `git cherry`; see the module note. */
interface Copies {
  readonly commits: number;
  readonly uncopied: number;
}

/**
 * How many commits `origin/<name>` holds past `origin/<base>` and how
 * many of them have no patch-equal copy there, or why git could not say.
 */
function readCopies(git: GitRunner, base: string, name: string): Copies | string {
  const result = git(['cherry', `${REMOTE_REFS}/${base}`, `${REMOTE_REFS}/${name}`]);
  if (!result.ok) {
    return failure('git cherry', result);
  }
  const marks = lines(result.stdout);
  const unreadable = marks.find((line) => !line.startsWith(UNCOPIED_MARK) && !line.startsWith(COPIED_MARK));
  if (unreadable !== undefined) {
    return `git cherry wrote a line that opens with neither + nor -: ${JSON.stringify(unreadable)}`;
  }
  return {
    commits: marks.length,
    uncopied: marks.filter((line) => line.startsWith(UNCOPIED_MARK)).length,
  };
}

/** `2 branches only on origin are not listed`, `1 branch only on origin is not listed`. */
function withheldPhrase(withheld: number): string {
  const verb = withheld === 1
    ? 'is'
    : 'are';
  const noun = withheld === 1
    ? 'branch'
    : 'branches';
  return `${String(withheld)} ${noun} only on ${REMOTE} ${verb} not listed`;
}

/** `<what> failed`, with what git said when it said anything. */
function failure(what: string, result: GitResult): string {
  const said = firstLine(gitSaid(result));
  return said === ''
    ? `${what} failed`
    : `${what} failed: ${said}`;
}

/** `1 commit`, `2 commits`. */
function plural(count: number, noun: string): string {
  return count === 1
    ? `1 ${noun}`
    : `${String(count)} ${noun}s`;
}

/** The non-empty lines of `text`. */
function lines(text: string): string[] {
  return text.split('\n').filter((line) => line !== '');
}

/** The first non-empty line of `text`, trimmed, so a note stays one line. */
function firstLine(text: string): string {
  return text.split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '') ?? '';
}
