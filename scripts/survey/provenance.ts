/**
 * Where rafa's own sources came from: `bun scripts/survey/provenance.ts`
 * from the repository root writes `.rafa/survey/provenance.json` and
 * `.rafa/survey/provenance.md` through `survey-io.ts`. An optional
 * `--board <path>` names the board cache to read, for a checkout that
 * keeps none of its own (a worktree reads its main checkout's).
 *
 * ## What it reads
 *
 * Every tracked non-test source file under `src/` and `packages/`, the
 * files `import-graph.ts` clusters, grouped by the cluster
 * `.rafa/survey/import-graph.json` gives each (`none` for a file in no
 * cluster), so `import-graph.ts` runs first. A file's ORIGIN is the
 * commit that added it, read from one `git log --reverse -M` over `HEAD`
 * ({@link parseGitLog}, {@link originsOf}): a rename carries the origin
 * of the file it renamed, and a file deleted and added again takes the
 * later add. A tracked file no commit added, such as one staged and not
 * yet committed, has no origin, and the coverage line names it as missed.
 *
 * ## The four classes
 *
 * The issue numbers of the origin commit's message (`#<n>` and
 * `rafa-<n>`) are resolved against the board cache,
 * `.rafa/cache/board.json`, which holds issues only: a pull request's
 * number resolves to nothing and is listed as unresolved. The subject's
 * numbers are read first; the body's only when the subject's resolve to
 * no issue, since a squash merge's body lists every commit it folded in.
 * {@link classifyCommit} then decides, first rule that holds:
 *
 * 1. **imported**: the commit is a root commit, or its subject names the
 *    import ({@link IMPORT_SUBJECT}: `parity`, `cutover`, `imported`,
 *    `ported`), as Phase 0 brought the loop over from its first home.
 * 2. **spec** or **bug-sweep**: the resolved issues include one labelled
 *    {@link SPEC_LABELS} or {@link BUG_LABEL}. The class more of them
 *    carry wins, and spec wins a tie: a spec run that fixed bugs on the
 *    way is still designed from its spec.
 * 3. **poc**: a resolved issue is labelled {@link SPIKE_LABEL}.
 * 4. **bug-sweep**: no issue decided, and the subject is a conventional
 *    `fix:` or `fix(<scope>):`.
 * 5. **poc**: anything else, a change no spec designed that stayed.
 *
 * Each file keeps the rule that classified it, so a reading that looks
 * wrong can be traced to its commit.
 */
import { realpathSync } from 'node:fs';
import { join } from 'node:path';

import { isSurveyedSource, SURVEY_SCOPE } from './import-graph.js';
import { listTrackedFiles, measureCoverage, writeSurvey } from './survey-io.js';
import { clustersFromGraph, loadImportGraph, NO_CLUSTER } from './test-index.js';

/** Where the board cache sits, relative to the repository root. */
export const BOARD_CACHE_PATH = '.rafa/cache/board.json';

/** The four classes a file's origin falls in. */
export const PROVENANCE_CLASSES = ['spec', 'imported', 'poc', 'bug-sweep'] as const;

/** One of {@link PROVENANCE_CLASSES}. */
export type Provenance = (typeof PROVENANCE_CLASSES)[number];

/** A subject naming the import of the code from its first home. */
export const IMPORT_SUBJECT = /\b(parity|cutover|imported|ported)\b/i;

/** The labels of an issue a change is designed from. */
export const SPEC_LABELS: readonly string[] = ['type:spec', 'type:epic'];

/** The label of a bug. */
export const BUG_LABEL = 'type:bug';

/** The label of a spike, whose code is a PoC. */
export const SPIKE_LABEL = 'type:spike';

/** A conventional `fix:` subject, scoped or not. */
const FIX_SUBJECT = /^fix(\([^)]*\))?!?:/;

/** An issue number in a message: `#<n>` or `rafa-<n>`. */
const ISSUE_REFERENCE = /(?:#|\brafa-)(\d+)\b/g;

/** How many origin commits each cluster's table lists. */
const TOP_COMMITS = 5;

/** The separators of the `git log` format: one before each record, one between its fields. */
const RECORD = '\x1e';
const FIELD = '\x1f';
const LOG_FORMAT = `${RECORD}%H${FIELD}%P${FIELD}%s${FIELD}%b${FIELD}`;
const SHORT_HASH = 7;

/** One commit as `git log --name-status` read it. */
export interface CommitRecord {
  readonly hash: string;
  readonly parents: readonly string[];
  readonly subject: string;
  readonly body: string;
  /** Each file the commit added or renamed into, in the order git listed them. */
  readonly changes: readonly FileChange[];
}

/** A file a commit added, or renamed from `from`. */
export type FileChange =
  | { readonly kind: 'add'; readonly path: string }
  | { readonly kind: 'rename'; readonly from: string; readonly path: string };

/** One board issue, as far as the classification reads it. */
export interface BoardIssue {
  readonly number: number;
  readonly title: string;
  readonly labels: readonly string[];
}

/** A commit's class and the evidence for it. */
export interface CommitClass {
  readonly provenance: Provenance;
  /** The rule that decided, in words. */
  readonly rule: string;
  /** The issue numbers the decision read that resolved on the board, sorted. */
  readonly issues: readonly number[];
  /** The issue numbers the decision read that resolved to nothing, sorted. */
  readonly unresolved: readonly number[];
}

/** One file's provenance. */
export interface FileProvenance extends CommitClass {
  readonly path: string;
  /** The file's cluster, or {@link NO_CLUSTER}. */
  readonly cluster: string;
  /** The origin commit, shortened. */
  readonly commit: string;
  readonly subject: string;
}

/** How many files of a group fall in each class. */
export type ClassCounts = Readonly<Record<Provenance, number>>;

/** An origin commit and how many of a cluster's files it added. */
export interface OriginCommit {
  readonly commit: string;
  readonly subject: string;
  readonly provenance: Provenance;
  readonly files: number;
}

/** One cluster's files by class. */
export interface ClusterProvenance {
  readonly cluster: string;
  readonly files: number;
  readonly counts: ClassCounts;
  /** The commits that added most of its files, most first. */
  readonly origins: readonly OriginCommit[];
}

/** The reading written under `data` in `provenance.json`. */
export interface ProvenanceData {
  readonly files: readonly FileProvenance[];
  readonly clusters: readonly ClusterProvenance[];
  readonly overall: ClassCounts;
  /** How many board rows the classification resolved numbers against. */
  readonly boardIssues: number;
  /** Every number an origin commit's decision read that the board does not hold, sorted. */
  readonly unresolved: readonly number[];
}

/** Every issue number `text` references, in order, each once. */
export function issueNumbers(text: string): number[] {
  return [...new Set([...text.matchAll(ISSUE_REFERENCE)].map((match) => Number(match[1])))];
}

/** One name-status line as a change, or `null` for one that is neither an add nor a rename. */
function parseChange(line: string): FileChange | null {
  const [status = '', first, second] = line.split('\t');
  if (status === 'A' && first !== undefined) {
    return { kind: 'add', path: first };
  }
  if (status.startsWith('R') && first !== undefined && second !== undefined) {
    return { kind: 'rename', from: first, path: second };
  }
  return null;
}

/** The commits of a `git log` capture written with {@link LOG_FORMAT} and `--name-status`. */
export function parseGitLog(output: string): CommitRecord[] {
  return output
    .split(RECORD)
    .filter((record) => record.trim().length > 0)
    .map((record) => {
      const [hash = '', parents = '', subject = '', body = '', names = ''] = record.split(FIELD);
      return {
        hash,
        parents: parents.split(' ').filter((parent) => parent.length > 0),
        subject,
        body: body.trim(),
        changes: names
          .split('\n')
          .map(parseChange)
          .filter((change) => change !== null),
      };
    });
}

/** Each path's origin commit, from `commits` oldest first: a rename carries the origin along. */
export function originsOf(commits: readonly CommitRecord[]): Map<string, CommitRecord> {
  const origins = new Map<string, CommitRecord>();
  for (const commit of commits) {
    for (const change of commit.changes) {
      if (change.kind === 'add') {
        origins.set(change.path, commit);
        continue;
      }
      origins.set(change.path, origins.get(change.from) ?? commit);
      origins.delete(change.from);
    }
  }
  return origins;
}

/** The numbers of `text`, split into the issues the board holds and the rest. */
function resolveNumbers(text: string, board: ReadonlyMap<number, BoardIssue>): {
  issues: BoardIssue[];
  unresolved: number[];
} {
  const numbers = issueNumbers(text);
  return {
    issues: numbers.flatMap((number) => {
      const issue = board.get(number);
      return issue === undefined
        ? []
        : [issue];
    }),
    unresolved: numbers.filter((number) => !board.has(number)),
  };
}

/** Whether `issue` carries any of `labels`. */
function carries(issue: BoardIssue, labels: readonly string[]): boolean {
  return issue.labels.some((label) => labels.includes(label));
}

/** The class the resolved `issues` decide, or `null` when none of them is a spec, a bug or a spike. */
function classFromIssues(issues: readonly BoardIssue[]): Omit<CommitClass, 'issues' | 'unresolved'> | null {
  const specs = issues.filter((issue) => carries(issue, SPEC_LABELS));
  const bugs = issues.filter((issue) => carries(issue, [BUG_LABEL]));
  const name = (list: readonly BoardIssue[]): string => list.map((issue) => `#${issue.number}`).join(', ');
  if (specs.length > 0 && specs.length >= bugs.length) {
    return { provenance: 'spec', rule: `spec issue ${name(specs)}` };
  }
  if (bugs.length > 0) {
    return { provenance: 'bug-sweep', rule: `bug issue ${name(bugs)}` };
  }
  const spikes = issues.filter((issue) => carries(issue, [SPIKE_LABEL]));
  return spikes.length > 0
    ? { provenance: 'poc', rule: `spike issue ${name(spikes)}` }
    : null;
}

/** The class of `commit`, its issue numbers resolved against `board`; see the module's rules. */
export function classifyCommit(commit: CommitRecord, board: ReadonlyMap<number, BoardIssue>): CommitClass {
  const fromSubject = resolveNumbers(commit.subject, board);
  const read = fromSubject.issues.length > 0
    ? fromSubject
    : resolveNumbers(`${commit.subject}\n${commit.body}`, board);
  const evidence = {
    issues: read.issues.map((issue) => issue.number).sort((a, b) => a - b),
    unresolved: [...read.unresolved].sort((a, b) => a - b),
  };
  if (commit.parents.length === 0) {
    return { provenance: 'imported', rule: 'root commit', ...evidence };
  }
  if (IMPORT_SUBJECT.test(commit.subject)) {
    return { provenance: 'imported', rule: 'subject names the import', ...evidence };
  }
  const decided = classFromIssues(read.issues);
  if (decided !== null) {
    return { ...decided, ...evidence };
  }
  return FIX_SUBJECT.test(commit.subject)
    ? { provenance: 'bug-sweep', rule: 'fix subject, no deciding issue', ...evidence }
    : { provenance: 'poc', rule: 'no spec issue', ...evidence };
}

/** Zero files in every class. */
function emptyCounts(): Record<Provenance, number> {
  return { spec: 0, imported: 0, poc: 0, 'bug-sweep': 0 };
}

/** How many of `files` fall in each class. */
export function countClasses(files: readonly FileProvenance[]): ClassCounts {
  return files.reduce((counts, file) => ({ ...counts, [file.provenance]: counts[file.provenance] + 1 }), emptyCounts());
}

/** The commits that added most of `files`, most first. */
function topOrigins(files: readonly FileProvenance[]): OriginCommit[] {
  const byCommit = new Map<string, OriginCommit>();
  files.forEach((file) => {
    const seen = byCommit.get(file.commit);
    byCommit.set(file.commit, {
      commit: file.commit,
      subject: file.subject,
      provenance: file.provenance,
      files: (seen?.files ?? 0) + 1,
    });
  });
  return [...byCommit.values()]
    .sort((a, b) => b.files - a.files || a.commit.localeCompare(b.commit))
    .slice(0, TOP_COMMITS);
}

/** The cluster order: `c1` to `c8` by number, then {@link NO_CLUSTER}. */
function clusterRank(cluster: string): number {
  return cluster === NO_CLUSTER
    ? Number.MAX_SAFE_INTEGER
    : Number(cluster.slice(1));
}

/**
 * The reading over `paths`, each classified by its origin in `origins`
 * and grouped by `clusterOf`. A path with no origin is left out, and the
 * coverage line names it.
 */
export function readProvenance(
  paths: readonly string[],
  origins: ReadonlyMap<string, CommitRecord>,
  board: ReadonlyMap<number, BoardIssue>,
  clusterOf: ReadonlyMap<string, string>,
): ProvenanceData {
  const classes = new Map<string, CommitClass>();
  const files = [...paths].sort().flatMap((path): FileProvenance[] => {
    const origin = origins.get(path);
    if (origin === undefined) {
      return [];
    }
    const decided = classes.get(origin.hash) ?? classifyCommit(origin, board);
    classes.set(origin.hash, decided);
    return [{
      path,
      cluster: clusterOf.get(path) ?? NO_CLUSTER,
      commit: origin.hash.slice(0, SHORT_HASH),
      subject: origin.subject,
      ...decided,
    }];
  });
  const groups = new Map<string, FileProvenance[]>();
  files.forEach((file) => groups.set(file.cluster, [...(groups.get(file.cluster) ?? []), file]));
  const clusters = [...groups]
    .map(([cluster, members]) => ({
      cluster,
      files: members.length,
      counts: countClasses(members),
      origins: topOrigins(members),
    }))
    .sort((a, b) => clusterRank(a.cluster) - clusterRank(b.cluster));
  return {
    files,
    clusters,
    overall: countClasses(files),
    boardIssues: board.size,
    unresolved: [...new Set([...classes.values()].flatMap((decided) => decided.unresolved))].sort((a, b) => a - b),
  };
}

/** A mapping read from JSON, or `null`. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** One board row as an issue, or `null` for a row without a number. */
function parseRow(value: unknown): BoardIssue | null {
  const row = asRecord(value);
  if (row === null || typeof row.number !== 'number') {
    return null;
  }
  const labels = Array.isArray(row.labels)
    ? row.labels.flatMap((label) => {
      const name = asRecord(label)?.name;
      return typeof name === 'string'
        ? [name]
        : [];
    })
    : [];
  return {
    number: row.number,
    title: typeof row.title === 'string'
      ? row.title
      : '',
    labels,
  };
}

/** The issues of a board cache's JSON, by number; throws when it holds no `rows` list. */
export function parseBoard(json: unknown): Map<number, BoardIssue> {
  const rows = asRecord(json)?.rows;
  if (!Array.isArray(rows)) {
    throw new Error('the board cache holds no rows list');
  }
  return new Map(rows
    .map(parseRow)
    .filter((issue) => issue !== null)
    .map((issue) => [issue.number, issue]));
}

/** The board cache at `path`; throws naming how to fill it when it is absent. */
export async function loadBoard(path: string): Promise<Map<number, BoardIssue>> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`${path} is absent: run rafa roadmap to fill the board cache, or pass --board <path>`);
  }
  return parseBoard(await file.json());
}

/** The commits of `HEAD` at `repoRoot`, oldest first, with the files each added or renamed. */
export async function readGitLog(repoRoot: string): Promise<CommitRecord[]> {
  const result = await Bun.$`git -c core.quotePath=false log --reverse -M --name-status --diff-filter=AR --format=${LOG_FORMAT} HEAD`
    .cwd(repoRoot)
    .quiet()
    .nothrow();
  if (result.exitCode !== 0) {
    throw new Error(`git log failed in ${repoRoot}: ${result.stderr.toString().trim()}`);
  }
  return parseGitLog(result.stdout.toString());
}

/** A count per class, in the order of {@link PROVENANCE_CLASSES}. */
function countCells(counts: ClassCounts): string {
  return PROVENANCE_CLASSES.map((provenance) => counts[provenance]).join(' | ');
}

/** The markdown summary's body, written after the coverage line. */
export function renderProvenance(data: ProvenanceData): string {
  const header = `| ${PROVENANCE_CLASSES.join(' | ')} |`;
  const rule = PROVENANCE_CLASSES.map(() => '---').join(' | ');
  return [
    '# Provenance',
    '',
    `${data.files.length} source files, each classified by the commit that added it, its issue numbers `
      + `resolved against ${data.boardIssues} board issues: imported (a root commit or one naming the import), `
      + 'spec or bug-sweep (by the resolved issues\' labels, spec winning a tie), poc (a spike, or no spec issue), '
      + 'bug-sweep again for a `fix:` subject no issue decided.',
    '',
    `Numbers that resolved to no board issue (pull requests, mostly): ${data.unresolved.length}`,
    '',
    '## Per cluster',
    '',
    `| Cluster | Files ${header}`,
    `| --- | --- | ${rule} |`,
    ...data.clusters.map((cluster) => `| ${cluster.cluster} | ${cluster.files} | ${countCells(cluster.counts)} |`),
    `| all | ${data.files.length} | ${countCells(data.overall)} |`,
    '',
    '## Origin commits per cluster',
    '',
    ...data.clusters.flatMap((cluster) => [
      `### ${cluster.cluster}`,
      '',
      ...cluster.origins.map((origin) => `- \`${origin.commit}\` ${origin.provenance}, ${origin.files} files: `
        + origin.subject),
      '',
    ]),
  ].join('\n');
}

/** The `--board <path>` argument of `argv`, or `null`. */
export function boardArgument(argv: readonly string[]): string | null {
  const at = argv.indexOf('--board');
  if (at === -1) {
    return null;
  }
  const path = argv[at + 1];
  if (path === undefined || path.startsWith('--')) {
    throw new Error('--board needs a path');
  }
  return path;
}

/** Reads, classifies and writes the provenance of the repository at `repoRoot`. */
export async function surveyProvenance(repoRoot: string, boardPath: string | null = null): Promise<ProvenanceData> {
  const realRoot = realpathSync(repoRoot);
  const clusterOf = clustersFromGraph(await loadImportGraph(realRoot));
  const board = await loadBoard(boardPath ?? join(realRoot, BOARD_CACHE_PATH));
  const expected = (await listTrackedFiles(realRoot, SURVEY_SCOPE)).filter(isSurveyedSource);
  const data = readProvenance(expected, originsOf(await readGitLog(realRoot)), board, clusterOf);
  await writeSurvey(realRoot, 'provenance', {
    data,
    markdown: renderProvenance(data),
    coverage: measureCoverage(expected, data.files.map((file) => file.path)),
  });
  return data;
}

if (import.meta.main) {
  try {
    const data = await surveyProvenance(process.cwd(), boardArgument(process.argv.slice(2)));
    const counts = PROVENANCE_CLASSES.map((provenance) => `${data.overall[provenance]} ${provenance}`).join(', ');
    console.log(`[provenance] ${data.files.length} files: ${counts}`);
  } catch (err) {
    console.error(`[provenance] FAIL — ${err instanceof Error
      ? err.message
      : String(err)}`);
    process.exit(1);
  }
}
