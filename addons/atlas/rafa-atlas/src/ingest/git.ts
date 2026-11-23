/**
 * The git ingest: the project root's first-parent history read into
 * `commit_facts` and `stretch_marks`, stamped `local.commits` and
 * `local.marks`. Git is reached only through a {@link GitRunner}, which
 * {@link createGitRunner} makes over the project root (trap 4: never the
 * worktree a command runs from), so every test hands its own.
 *
 * 1. **Base (D12).** The walk starts at `origin/HEAD`'s target, when
 *    `refs/remotes/origin/HEAD` names a commit; otherwise at `HEAD`, and
 *    the ingest answers `fellBack`. No config key names the branch: a
 *    module may not read core's `pr.base`. With neither, as in a folder
 *    that is no repository or one with no commit, nothing is read and
 *    both sources are stamped missing: no rows, `partial`, the reason
 *    naming what git answered. The build goes on.
 * 2. **Commits.** `git log --first-parent --diff-merges=first-parent
 *    --numstat` over the base, one row per commit on the walk, so a merged
 *    pull request is one row and a merge commit's counts are its diff
 *    against its first parent. `committed_at` is the committer time in
 *    UTC, `day` its UTC calendar day. `files_changed`, `insertions` and
 *    `deletions` sum the numstat lines, a binary file adding a file and no
 *    line. `type` is the conventional prefix (`fix(scope)!: …` reads
 *    `fix`) when it is one of {@link CONVENTIONAL_TYPES}, else NULL.
 *    `pr_number` is a trailing `(#n)`, the last one of a subject holding
 *    two, else the number of a `Merge pull request #n from …` subject,
 *    else NULL. `is_merge` is 1 for a commit with two parents or more.
 *    `plan_stub` is left NULL here; `derive.ts` fills it through
 *    `plan_facts.pr_number`.
 * 3. **Release tags (D13).** `git tag --list 'v*'`, an annotated tag
 *    peeled to the commit it points at, sets `release_tag` on that
 *    commit's row, so a release counts on the tagged commit's
 *    `committed_at`. Two tags on one commit keep the higher version
 *    (`--sort=v:refname`, the last one winning). A tag pointing off the
 *    walk sets nothing and is listed in `tagsOffWalk`.
 * 4. **Stretch marks.** Two subject shapes name a stretch offline:
 *    `Stretch <n> (#<pr>)` and `Merge pull request #<pr> from
 *    <owner>/stretch/<n>`. The lane is `M` for a three-digit number and `A`
 *    for one or two digits; a number of another length is skipped and
 *    counted in `unlanedMarks`. A number seen again is its next part, in
 *    walk order from the oldest commit: part 1, then 2. `ended_at` is the
 *    commit's `committed_at`. A third shape, an item subject, carries item
 *    numbers, never a stretch number (trap 5): it is read under `--github`
 *    through `pr_facts.head_ref`, not here.
 *
 * Each stamp's `as_of` is the newest time its rows hold, its `read_at` the
 * build clock.
 */
import type { ReplicaBuild, SourceStamp } from '@open-tomato/atlas-data/replica';

import { dirname } from 'node:path';

import { dayOf, newest } from './columns.js';

/** The `atlas_sources` row `commit_facts` is stamped as. */
export const COMMITS_SOURCE = 'local.commits';

/** The `atlas_sources` row `stretch_marks` is stamped as. */
export const MARKS_SOURCE = 'local.marks';

/** The conventional commit types read as `commit_facts.type`; any other prefix reads NULL. */
export const CONVENTIONAL_TYPES: ReadonlySet<string> = new Set([
  'build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'revert', 'style', 'test',
]);

/** What one git call answered. */
export interface GitResult {
  /** True when git exited 0. */
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs git with the arguments after its name, in the project root. */
export type GitRunner = (args: readonly string[]) => GitResult;

/**
 * The environment variables that point git at a repository other than
 * the one the working directory holds; a hook sets some of them, so the
 * runner drops them all.
 */
const REPOSITORY_VARIABLES: readonly string[] = [
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_PREFIX', 'GIT_CEILING_DIRECTORIES',
];

/** The message of a thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/**
 * The runner over `root`: git spawned with `root` as its working
 * directory, the repository variables of a calling hook dropped, and
 * `GIT_CEILING_DIRECTORIES` set to the root's parent, so git reads the
 * repository the root holds and never one around it. A spawn that throws
 * (no git on `PATH`, no such folder) answers `ok: false` with its message.
 */
export function createGitRunner(root: string, env: Readonly<Record<string, string | undefined>> = process.env): GitRunner {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && !REPOSITORY_VARIABLES.includes(key)) cleaned[key] = value;
  }
  cleaned['GIT_CEILING_DIRECTORIES'] = dirname(root);
  return (args) => {
    try {
      const spawned = Bun.spawnSync(['git', ...args], { cwd: root, env: cleaned, stdout: 'pipe', stderr: 'pipe' });
      return { ok: spawned.exitCode === 0, stdout: spawned.stdout.toString(), stderr: spawned.stderr.toString() };
    } catch (error) {
      return { ok: false, stdout: '', stderr: messageOf(error) };
    }
  };
}

/** One commit of the walk, as the log answered it. */
export interface CommitRead {
  readonly sha: string;
  readonly committedAt: string;
  readonly subject: string;
  readonly parents: number;
  readonly filesChanged: number;
  readonly insertions: number;
  readonly deletions: number;
}

/** One stretch mark read from a subject. */
export interface StretchMark {
  readonly number: number;
  readonly part: number;
  readonly lane: 'A' | 'M';
  readonly endedAt: string;
  readonly prNumber: number;
}

/** What one git ingest did. */
export interface GitIngest {
  /** False when git gave no history; both sources are then stamped missing. */
  readonly read: boolean;
  /** The commit the walk started from, as the ref it was read through, or null when nothing was read. */
  readonly base: string | null;
  /** True when `origin/HEAD` named no commit and the walk started at `HEAD`. */
  readonly fellBack: boolean;
  readonly commits: number;
  /** The commits a `v*` tag was set on. */
  readonly tagged: number;
  /** The `v*` tags whose commit is not on the walk. */
  readonly tagsOffWalk: readonly string[];
  readonly marks: number;
  /** Stretch subjects whose number has no lane (not one to three digits). */
  readonly unlanedMarks: number;
  /** `local.commits`, then `local.marks`. */
  readonly stamps: readonly SourceStamp[];
}

/** What one git ingest is handed. */
export interface GitIngestOptions {
  /** Git over the project root; {@link createGitRunner} makes the real one. */
  readonly runner: GitRunner;
  /** The build clock, stamped as each source's `read_at`; defaults to the system clock. */
  readonly now?: () => Date;
}

/** The ref D12 walks first. */
const ORIGIN_HEAD = 'refs/remotes/origin/HEAD';

/** Separators of the log format: one before each record, one between its fields. */
const RECORD = '\x1e';
const FIELD = '\x1f';

/** The log format: sha, parents, committer time, subject. */
const LOG_FORMAT = `--format=${RECORD}%H${FIELD}%P${FIELD}%cI${FIELD}%s`;

/** The tag format: name, the object the tag points at, and that object peeled for an annotated tag. */
const TAG_FORMAT = '--format=%(refname:lstrip=2)%09%(objectname)%09%(*objectname)';

/** The first line git wrote to stderr, or `fallback` when it wrote none. */
function firstLine(text: string, fallback: string): string {
  const line = text.split('\n').map((each) => each.trim())
    .find((each) => each !== '');
  return line ?? fallback;
}

/** The commit `ref` names, or null. */
function commitOf(runner: GitRunner, ref: string): { readonly sha: string | null; readonly stderr: string } {
  const answered = runner(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  const sha = answered.stdout.trim();
  return { sha: answered.ok && sha !== ''
    ? sha
    : null, stderr: answered.stderr };
}

/** Where the walk starts (D12), or why it cannot. */
type BaseRead =
  | { readonly ok: true; readonly sha: string; readonly ref: string; readonly fellBack: boolean }
  | { readonly ok: false; readonly reason: string };

/** Resolve the walk's base: `origin/HEAD`'s target, else `HEAD`. */
export function resolveBase(runner: GitRunner): BaseRead {
  const origin = commitOf(runner, ORIGIN_HEAD);
  if (origin.sha !== null) {
    const target = runner(['symbolic-ref', '--quiet', ORIGIN_HEAD]);
    const ref = target.ok && target.stdout.trim() !== ''
      ? target.stdout.trim()
      : ORIGIN_HEAD;
    return { ok: true, sha: origin.sha, ref, fellBack: false };
  }
  const head = commitOf(runner, 'HEAD');
  if (head.sha !== null) return { ok: true, sha: head.sha, ref: 'HEAD', fellBack: true };
  return { ok: false, reason: firstLine(head.stderr, 'neither origin/HEAD nor HEAD names a commit') };
}

/** A numstat count: a number, or 0 for a binary file's `-`. */
function lineCount(cell: string | undefined): number {
  const value = Number(cell);
  return Number.isSafeInteger(value)
    ? value
    : 0;
}

/** One log record: its header line, then its numstat lines. */
function parseRecord(record: string): CommitRead | null {
  const lines = record.split('\n');
  const [sha, parents, committed, subject] = (lines[0] ?? '').split(FIELD);
  if (sha === undefined || sha === '' || committed === undefined || Number.isNaN(Date.parse(committed))) return null;
  const stats = lines.slice(1).filter((line) => line.includes('\t'))
    .map((line) => line.split('\t'));
  return {
    sha,
    committedAt: new Date(committed).toISOString(),
    subject: subject ?? '',
    parents: (parents ?? '').split(' ').filter((each) => each !== '').length,
    filesChanged: stats.length,
    insertions: stats.reduce((sum, cells) => sum + lineCount(cells[0]), 0),
    deletions: stats.reduce((sum, cells) => sum + lineCount(cells[1]), 0),
  };
}

/** Parse `git log` output in {@link LOG_FORMAT} with `--numstat`, in the order git wrote it (newest first). */
export function parseLog(stdout: string): readonly CommitRead[] {
  return stdout.split(RECORD).map(parseRecord)
    .filter((commit): commit is CommitRead => commit !== null);
}

/** The conventional type of `subject`, lower case, or null. */
export function commitTypeOf(subject: string): string | null {
  const match = /^([A-Za-z]+)(?:\([^)]*\))?!?:\s/.exec(subject);
  const type = match?.[1]?.toLowerCase();
  return type !== undefined && CONVENTIONAL_TYPES.has(type)
    ? type
    : null;
}

/** The pull request `subject` names: a trailing `(#n)`, else a merge subject's `#n`, else null. */
export function prNumberOf(subject: string): number | null {
  const trailing = /\(#(\d+)\)\s*$/.exec(subject) ?? /^Merge pull request #(\d+) from /.exec(subject);
  return trailing?.[1] === undefined
    ? null
    : Number(trailing[1]);
}

/** The stretch number and pull request of a subject of the two offline shapes, or null. */
export function stretchOf(subject: string): { readonly number: string; readonly prNumber: number } | null {
  const squash = /^Stretch (\d+) \(#(\d+)\)$/.exec(subject.trim());
  if (squash?.[1] !== undefined && squash[2] !== undefined) return { number: squash[1], prNumber: Number(squash[2]) };
  const merge = /^Merge pull request #(\d+) from [^\s/]+\/stretch\/(\d+)$/.exec(subject.trim());
  if (merge?.[1] !== undefined && merge[2] !== undefined) return { number: merge[2], prNumber: Number(merge[1]) };
  return null;
}

/** The lane of a stretch number by its digit count, or null. */
function laneOf(digits: string): 'A' | 'M' | null {
  if (digits.length === 3) return 'M';
  return digits.length === 1 || digits.length === 2
    ? 'A'
    : null;
}

/** The marks of `commits` (newest first, as the log answers them), parts numbered from the oldest. */
export function stretchMarksOf(commits: readonly CommitRead[]): { readonly marks: readonly StretchMark[]; readonly unlaned: number } {
  const parts = new Map<number, number>();
  const marks: StretchMark[] = [];
  let unlaned = 0;
  for (const commit of [...commits].reverse()) {
    const stretch = stretchOf(commit.subject);
    if (stretch === null) continue;
    const lane = laneOf(stretch.number);
    if (lane === null) {
      unlaned += 1;
      continue;
    }
    const number = Number(stretch.number);
    const part = (parts.get(number) ?? 0) + 1;
    parts.set(number, part);
    marks.push({ number, part, lane, endedAt: commit.committedAt, prNumber: stretch.prNumber });
  }
  return { marks, unlaned };
}

/** The `v*` tags by the commit they point at (an annotated tag peeled), the higher version winning; empty when git refuses. */
export function readReleaseTags(runner: GitRunner): ReadonlyMap<string, string> {
  const answered = runner(['tag', '--list', 'v*', '--sort=v:refname', TAG_FORMAT]);
  const byCommit = new Map<string, string>();
  if (!answered.ok) return byCommit;
  for (const line of answered.stdout.split('\n')) {
    const [name, object, peeled] = line.split('\t');
    if (name === undefined || name === '' || object === undefined || object === '') continue;
    byCommit.set(peeled === undefined || peeled === ''
      ? object
      : peeled, name);
  }
  return byCommit;
}

/** The stamp of a source git gave nothing for. */
function missingStamp(source: string, readAt: string, reason: string): SourceStamp {
  return { source, asOf: null, readAt, rows: 0, partial: true, reason: `no git history read: ${reason}` };
}

/** The stamp of a source read whole. */
function readStamp(source: string, readAt: string, rows: number, asOf: string | null): SourceStamp {
  return { source, asOf, readAt, rows, partial: false, reason: null };
}

/** The `commit_facts` columns written, in the order {@link insertCommits} binds them. */
const COMMIT_COLUMNS: readonly string[] = [
  'sha', 'committed_at', 'day', 'subject', 'type', 'pr_number', 'files_changed', 'insertions', 'deletions', 'is_merge', 'release_tag',
];

/** One commit's row, in {@link COMMIT_COLUMNS} order. */
function commitRow(commit: CommitRead, tag: string | null): (string | number | null)[] {
  const isMerge = commit.parents > 1
    ? 1
    : 0;
  return [
    commit.sha, commit.committedAt, dayOf(commit.committedAt), commit.subject, commitTypeOf(commit.subject),
    prNumberOf(commit.subject), commit.filesChanged, commit.insertions, commit.deletions, isMerge, tag,
  ];
}

/** Insert one `commit_facts` row per commit. */
function insertCommits(build: ReplicaBuild, commits: readonly CommitRead[], tags: ReadonlyMap<string, string>): void {
  const insert = build.database.prepare<unknown, (string | number | null)[]>(
    `INSERT INTO commit_facts (${COMMIT_COLUMNS.join(', ')}) VALUES (${COMMIT_COLUMNS.map(() => '?').join(', ')})`,
  );
  build.database.transaction(() => {
    for (const commit of commits) insert.run(...commitRow(commit, tags.get(commit.sha) ?? null));
  })();
}

/** Insert one `stretch_marks` row per mark. */
function insertMarks(build: ReplicaBuild, marks: readonly StretchMark[]): void {
  const insert = build.database.prepare<unknown, [number, number, string, string, number]>(
    'INSERT INTO stretch_marks (number, part, lane, ended_at, pr_number) VALUES (?, ?, ?, ?, ?)',
  );
  build.database.transaction(() => {
    for (const mark of marks) insert.run(mark.number, mark.part, mark.lane, mark.endedAt, mark.prNumber);
  })();
}

/** Read the project root's history into `commit_facts` and `stretch_marks` and stamp both; see the module note. */
export function ingestGit(build: ReplicaBuild, options: GitIngestOptions): GitIngest {
  const readAt = (options.now ?? (() => new Date()))().toISOString();
  const { runner } = options;
  const unread = (reason: string): GitIngest => {
    const stamps = [missingStamp(COMMITS_SOURCE, readAt, reason), missingStamp(MARKS_SOURCE, readAt, reason)];
    stamps.forEach((stamp) => build.stampSource(stamp));
    return { read: false, base: null, fellBack: false, commits: 0, tagged: 0, tagsOffWalk: [], marks: 0, unlanedMarks: 0, stamps };
  };
  const base = resolveBase(runner);
  if (!base.ok) return unread(base.reason);
  const log = runner(['-c', 'log.showSignature=false', 'log', '--first-parent', '--diff-merges=first-parent', '--numstat', LOG_FORMAT, base.sha]);
  if (!log.ok) return unread(firstLine(log.stderr, 'git log failed'));
  const commits = parseLog(log.stdout);
  const tags = readReleaseTags(runner);
  const onWalk = new Set(commits.map((commit) => commit.sha));
  const tagsOffWalk = [...tags].filter(([sha]) => !onWalk.has(sha)).map(([, name]) => name);
  const { marks, unlaned } = stretchMarksOf(commits);
  insertCommits(build, commits, tags);
  insertMarks(build, marks);
  const stamps = [
    readStamp(COMMITS_SOURCE, readAt, commits.length, newest(commits.map((commit) => commit.committedAt))),
    readStamp(MARKS_SOURCE, readAt, marks.length, newest(marks.map((mark) => mark.endedAt))),
  ];
  stamps.forEach((stamp) => build.stampSource(stamp));
  return {
    read: true,
    base: base.ref,
    fellBack: base.fellBack,
    commits: commits.length,
    tagged: commits.filter((commit) => tags.has(commit.sha)).length,
    tagsOffWalk,
    marks: marks.length,
    unlanedMarks: unlaned,
    stamps,
  };
}
