/**
 * The survey's provenance map: for each tracked file in scope, where it
 * came from, read off the git history of the file and the issues its
 * commit subjects link. Run from the repository root,
 * `bun scripts/survey/provenance.ts` writes `docs/survey/provenance.json`
 * and `docs/survey/provenance.md`.
 *
 * Every commit is read once, from one `git log` over the whole history
 * with rename detection, so a file keeps the history it had under an
 * earlier path. A subject links an issue two ways, `rafa-<n>:` and
 * `(#<n>)`; a number counts as an issue only when the one
 * `gh issue list --state all` call holds it, so a pull request number in
 * a squash-merge subject (`rafa-841: … (#845)`) links nothing. A commit is
 * read by the first rule in `RULES` it meets, and the rule gives its class:
 *
 *   - `imported`: the repository's first commit, or a subject matching the
 *     import pattern (by default `Phase 0`, the pull request that brought
 *     `agentic-research`'s `tools/ralph` in);
 *   - `proof-of-concept`: a linked issue labelled `type:spike`, or a
 *     subject naming a spike, a prototype or a proof of concept;
 *   - `bug-sweep`: a linked issue labelled `type:bug` or
 *     `epic:backlog-fixes`, a linked issue titled `Bug sweep …` or
 *     `Sweep …`, or a subject of conventional type `fix`;
 *   - `spec`: a linked issue labelled `type:spec` or any `spec:*` label.
 *
 * A file takes the class of the commit that added it when that commit has
 * one (`readFrom: 'added'`), else of the earliest later commit that has
 * one (`readFrom: 'later'`). A file no commit of whose history meets a
 * rule is `unclassified`, and its record says whether that history names
 * an issue at all.
 *
 * Each file lists the cluster it lies in, taken from the same
 * `c<NN>-<stem>` clusters `import-graph.ts` names; `main` builds that graph
 * again rather than reading `docs/survey/import-graph.json`, so the
 * scripts can run in any order.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { coverageLine, listTrackedFiles } from './files';
import {
  OUTPUT_DIR,
  buildImportGraph,
  bunResolver,
  readMetafile,
  stableJson,
  surveyImportGraph,
} from './import-graph';

/** The four ways a file can have come to be. */
export type ProvenanceClass = 'bug-sweep' | 'imported' | 'proof-of-concept' | 'spec';

/** A file's class: one of the four, or none of them. */
export type FileClass = ProvenanceClass | 'unclassified';

/** The classes in the order the summary's columns show them. */
export const FILE_CLASSES: readonly FileClass[] = ['spec', 'imported', 'proof-of-concept', 'bug-sweep', 'unclassified'];

/** The cluster name a file the import graph does not cluster is listed under. */
export const NO_CLUSTER = '(none)';

/** One issue as the `gh issue list` call returns it, labels by name. */
export interface IssueRecord {
  /** The issue number. */
  readonly number: number;
  /** The issue title. */
  readonly title: string;
  /** Its label names. */
  readonly labels: readonly string[];
}

/** One path a commit touched, as `git log --name-status -M` prints it. */
export interface FileChange {
  /** The status letter: `A`, `M`, `D`, `R`, `C`, `T`. */
  readonly status: string;
  /** The path after the change. */
  readonly path: string;
  /** The path before a rename or copy. */
  readonly from?: string;
}

/** One commit of the log, oldest first in a log. */
export interface LogCommit {
  /** The full hash. */
  readonly sha: string;
  /** The parent hashes; none for a root commit. */
  readonly parents: readonly string[];
  /** The subject line. */
  readonly subject: string;
  /** The paths it touched. */
  readonly changes: readonly FileChange[];
}

/** What the commit subjects of a file's history are matched with. */
export interface ClassifyContext {
  /** The issues by number. */
  readonly issues: ReadonlyMap<number, IssueRecord>;
  /** The subject pattern that reads a commit as an import. */
  readonly importSubject: RegExp;
}

/** One rule a commit's class is read by. */
export interface ProvenanceRule {
  /** The rule's name, as the outputs cite it. */
  readonly id: string;
  /** The class it gives. */
  readonly class: ProvenanceClass;
  /** What it reads, in the words the summary shows. */
  readonly reads: string;
  /** Whether a commit meets it. */
  readonly test: (commit: ReadCommit, context: ClassifyContext) => boolean;
}

/** A commit as the map reads it: its links and the rule it meets. */
export interface ReadCommit {
  /** The full hash. */
  readonly sha: string;
  /** Whether it has no parent. */
  readonly root: boolean;
  /** The subject line. */
  readonly subject: string;
  /** The numbers its subject names that are issues, sorted. */
  readonly issues: readonly number[];
  /** The numbers its subject names that are not issues, sorted. */
  readonly otherRefs: readonly number[];
}

/** The commit a file's class was read from. */
export interface ClassifyingCommit {
  /** The full hash. */
  readonly sha: string;
  /** The subject line. */
  readonly subject: string;
  /** The rule it met. */
  readonly rule: string;
}

/** One file's provenance. */
export interface FileProvenance {
  /** The repository-relative path. */
  readonly path: string;
  /** The cluster it lies in, or `NO_CLUSTER`. */
  readonly cluster: string;
  /** Its class. */
  readonly class: FileClass;
  /** The commit its class was read from, or `null` when unclassified. */
  readonly by: ClassifyingCommit | null;
  /** Whether the class came from the adding commit or a later one. */
  readonly readFrom: 'added' | 'later' | null;
  /** The hash of the commit that added it, under this or an earlier path. */
  readonly added: string;
  /** How many commits its history holds. */
  readonly commits: number;
  /** The issues its history links, sorted. */
  readonly issues: readonly number[];
  /** How many commits of its history each rule's class reads. */
  readonly touches: Readonly<Record<ProvenanceClass, number>>;
}

/** One cluster's count of files per class. */
export interface ClusterProvenance {
  /** The cluster name. */
  readonly name: string;
  /** How many files of it were read. */
  readonly files: number;
  /** How many of those fall in each class. */
  readonly classes: Readonly<Record<FileClass, number>>;
}

/** How often one rule fired. */
export interface RuleCount {
  /** The rule's name. */
  readonly id: string;
  /** The class it gives. */
  readonly class: ProvenanceClass;
  /** What it reads. */
  readonly reads: string;
  /** How many commits it read. */
  readonly commits: number;
  /** How many files took their class from it. */
  readonly files: number;
}

/** What the map is built from, all of it passed in as data. */
export interface ProvenanceInput {
  /** The log, oldest first, as `parseGitLog` returns it. */
  readonly log: readonly LogCommit[];
  /** The issues of the one `gh issue list --state all` call. */
  readonly issues: readonly IssueRecord[];
  /** The tracked files in scope. */
  readonly files: readonly string[];
  /** The cluster each file lies in. */
  readonly clusterOf: ReadonlyMap<string, string>;
  /** The subject pattern that reads a commit as an import; `IMPORT_SUBJECT` by default. */
  readonly importSubject?: RegExp;
}

/** The map both outputs show. */
export interface ProvenanceMap {
  /** Each file read, sorted by path. */
  readonly files: readonly FileProvenance[];
  /** Each cluster, sorted by name. */
  readonly clusters: readonly ClusterProvenance[];
  /** The issues the files' histories link, sorted by number. */
  readonly issues: readonly IssueRecord[];
  /** Each rule, in the order commits are read by them. */
  readonly rules: readonly RuleCount[];
  /** How many commits the log holds. */
  readonly commits: number;
  /** The files read, sorted. */
  readonly read: readonly string[];
}

/** The default import pattern: Phase 0 imported `agentic-research`'s loop (PR #1). */
export const IMPORT_SUBJECT = /^Phase 0(?![\w])/;

const RAFA_LINK = /\brafa-(\d+):/g;
const HASH_LINK = /\(#(\d+)\)/g;
const SPIKE_SUBJECT = /\b(?:spike|prototype|proof of concept|poc)\b/i;
const FIX_SUBJECT = /^fix(?:\([^)]*\))?!?:/;
const SWEEP_TITLE = /^(?:bug )?sweep\b/i;
const BUG_LABELS: ReadonlySet<string> = new Set(['epic:backlog-fixes', 'type:bug']);

/**
 * The issues a commit links, as records.
 *
 * @param commit - The read commit.
 * @param context - The issues by number.
 * @returns Each linked issue.
 */
function linkedIssues(commit: ReadCommit, context: ClassifyContext): IssueRecord[] {
  return commit.issues
    .map((number) => context.issues.get(number))
    .filter((issue): issue is IssueRecord => issue !== undefined);
}

/**
 * Whether some issue a commit links carries a label the predicate accepts.
 *
 * @param commit - The read commit.
 * @param context - The issues by number.
 * @param accepts - The label test.
 * @returns `true` when one linked issue has such a label.
 */
function linksLabel(commit: ReadCommit, context: ClassifyContext, accepts: (label: string) => boolean): boolean {
  return linkedIssues(commit, context).some((issue) => issue.labels.some(accepts));
}

/** The rules, in the order a commit is read by them: the first it meets gives its class. */
export const RULES: readonly ProvenanceRule[] = [
  {
    class: 'imported',
    id: 'root-commit',
    reads: 'the repository\'s first commit (no parent)',
    test: (commit) => commit.root,
  },
  {
    class: 'imported',
    id: 'import-subject',
    reads: 'a subject matching the import pattern',
    test: (commit, context) => context.importSubject.test(commit.subject),
  },
  {
    class: 'proof-of-concept',
    id: 'spike-label',
    reads: 'a linked issue labelled `type:spike`',
    test: (commit, context) => linksLabel(commit, context, (label) => label === 'type:spike'),
  },
  {
    class: 'proof-of-concept',
    id: 'spike-subject',
    reads: 'a subject naming a spike, a prototype, a proof of concept or a PoC',
    test: (commit) => SPIKE_SUBJECT.test(commit.subject),
  },
  {
    class: 'bug-sweep',
    id: 'bug-label',
    reads: 'a linked issue labelled `type:bug` or `epic:backlog-fixes`',
    test: (commit, context) => linksLabel(commit, context, (label) => BUG_LABELS.has(label)),
  },
  {
    class: 'bug-sweep',
    id: 'sweep-title',
    reads: 'a linked issue titled `Bug sweep …` or `Sweep …`',
    test: (commit, context) => linkedIssues(commit, context).some((issue) => SWEEP_TITLE.test(issue.title)),
  },
  {
    class: 'bug-sweep',
    id: 'fix-subject',
    reads: 'a subject of conventional type `fix` (`fix:`, `fix(<scope>):`)',
    test: (commit) => FIX_SUBJECT.test(commit.subject),
  },
  {
    class: 'spec',
    id: 'spec-label',
    reads: 'a linked issue labelled `type:spec` or `spec:*`',
    test: (commit, context) => linksLabel(commit, context, (label) => label === 'type:spec' || label.startsWith('spec:')),
  },
];

/**
 * The numbers a subject names as `rafa-<n>:` or `(#<n>)`.
 *
 * @param subject - A commit subject.
 * @returns Each number once, sorted ascending.
 */
export function subjectRefs(subject: string): number[] {
  const numbers = [...subject.matchAll(RAFA_LINK), ...subject.matchAll(HASH_LINK)].map((match) => Number(match[1]));
  return [...new Set(numbers)].sort((left, right) => left - right);
}

/**
 * Reads a commit's links, splitting the numbers its subject names into
 * issues and other references.
 *
 * @param commit - A log commit.
 * @param issues - The issues by number.
 * @returns The read commit.
 */
export function readCommit(commit: LogCommit, issues: ReadonlyMap<number, IssueRecord>): ReadCommit {
  const refs = subjectRefs(commit.subject);
  return {
    issues: refs.filter((number) => issues.has(number)),
    otherRefs: refs.filter((number) => !issues.has(number)),
    root: commit.parents.length === 0,
    sha: commit.sha,
    subject: commit.subject,
  };
}

/**
 * The first rule a commit meets.
 *
 * @param commit - The read commit.
 * @param context - The issues and the import pattern.
 * @returns The rule, or `undefined` when it meets none.
 */
export function classifyCommit(commit: ReadCommit, context: ClassifyContext): ProvenanceRule | undefined {
  return RULES.find((rule) => rule.test(commit, context));
}

/**
 * Each path's history, following renames: the hashes of the commits that
 * touched it under this path or an earlier one, oldest first. A path that
 * is deleted and added again starts a new history.
 *
 * @param log - The log, oldest first.
 * @returns The history of each path alive at the log's end.
 */
export function fileHistories(log: readonly LogCommit[]): Map<string, string[]> {
  const histories = new Map<string, string[]>();
  for (const commit of log) {
    for (const change of commit.changes) {
      const letter = change.status.charAt(0);
      if (letter === 'D') {
        histories.delete(change.path);
        continue;
      }
      if (letter === 'R' && change.from !== undefined) {
        const earlier = histories.get(change.from) ?? [];
        histories.delete(change.from);
        histories.set(change.path, [...earlier, commit.sha]);
        continue;
      }
      const prior = letter === 'A' || letter === 'C'
        ? []
        : histories.get(change.path) ?? [];
      histories.set(change.path, [...prior, commit.sha]);
    }
  }
  return histories;
}

/**
 * Parses `git log --name-status -M` output written with
 * `--format=%x1e%H%x1f%P%x1f%s` and `core.quotePath=false`.
 *
 * @param text - The log text.
 * @returns The commits, in the order the log printed them.
 */
export function parseGitLog(text: string): LogCommit[] {
  return text
    .split('\x1e')
    .filter((record) => record.trim() !== '')
    .map((record) => {
      const [header = '', ...rest] = record.split('\n');
      const [sha = '', parents = '', subject = ''] = header.split('\x1f');
      const changes = rest
        .filter((line) => line.includes('\t'))
        .map((line): FileChange => {
          const [status = '', first = '', second] = line.split('\t');
          return second === undefined
            ? { path: first, status }
            : { from: first, path: second, status };
        });
      return {
        changes,
        parents: parents.split(' ').filter((parent) => parent !== ''),
        sha,
        subject,
      };
    });
}

/**
 * Parses the JSON of `gh issue list --json number,title,labels`.
 *
 * @param text - The JSON text.
 * @returns The issues, labels by name.
 * @throws When the text is not a list of issues.
 */
export function parseIssueList(text: string): IssueRecord[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error('gh issue list did not return a JSON list');
  }
  return parsed.map((entry: unknown) => {
    const issue = entry as { number?: unknown; title?: unknown; labels?: unknown };
    if (typeof issue.number !== 'number' || typeof issue.title !== 'string' || !Array.isArray(issue.labels)) {
      throw new Error(`gh issue list returned an entry without number, title and labels: ${JSON.stringify(entry)}`);
    }
    const labels = (issue.labels as { name?: unknown }[])
      .map((label) => label.name)
      .filter((name): name is string => typeof name === 'string')
      .sort();
    return { labels, number: issue.number, title: issue.title };
  });
}

/**
 * A record with every class at zero.
 *
 * @param classes - The classes to key.
 * @returns The zeroed record.
 */
function zeroed<Key extends string>(classes: readonly Key[]): Record<Key, number> {
  return Object.fromEntries(classes.map((key) => [key, 0])) as Record<Key, number>;
}

const COMMIT_CLASSES: readonly ProvenanceClass[] = ['bug-sweep', 'imported', 'proof-of-concept', 'spec'];

/**
 * Builds the provenance map. Pure: the caller reads the log, the issues,
 * the tracked files and the clusters (see `main`). A tracked file the log
 * holds no history for is not read, and the coverage line names it.
 *
 * @param input - The log, the issues, the files and their clusters.
 * @returns The map, every list sorted.
 */
export function surveyProvenance(input: ProvenanceInput): ProvenanceMap {
  const issues = new Map(input.issues.map((issue) => [issue.number, issue]));
  const context: ClassifyContext = { importSubject: input.importSubject ?? IMPORT_SUBJECT, issues };
  const commits = new Map(input.log.map((commit) => {
    const read = readCommit(commit, issues);
    return [commit.sha, { read, rule: classifyCommit(read, context) }];
  }));
  const histories = fileHistories(input.log);
  const fileRules = new Map<string, number>();
  const files: FileProvenance[] = [];
  for (const path of [...new Set(input.files)].sort()) {
    const history = (histories.get(path) ?? []).flatMap((sha) => {
      const commit = commits.get(sha);
      return commit === undefined
        ? []
        : [commit];
    });
    const first = history[0];
    if (first === undefined) {
      continue;
    }
    const classifying = history.find((commit) => commit.rule !== undefined);
    const touches = zeroed(COMMIT_CLASSES);
    history.forEach((commit) => {
      if (commit.rule !== undefined) {
        touches[commit.rule.class] += 1;
      }
    });
    if (classifying?.rule !== undefined) {
      fileRules.set(classifying.rule.id, (fileRules.get(classifying.rule.id) ?? 0) + 1);
    }
    files.push({
      added: first.read.sha,
      by: classifying?.rule === undefined
        ? null
        : { rule: classifying.rule.id, sha: classifying.read.sha, subject: classifying.read.subject },
      class: classifying?.rule?.class ?? 'unclassified',
      cluster: input.clusterOf.get(path) ?? NO_CLUSTER,
      commits: history.length,
      issues: [...new Set(history.flatMap((commit) => commit.read.issues))].sort((left, right) => left - right),
      path,
      readFrom: classifying === undefined
        ? null
        : classifying === first
          ? 'added'
          : 'later',
      touches,
    });
  }
  const clusterNames = [...new Set(files.map((file) => file.cluster))].sort();
  const clusters = clusterNames.map((name) => {
    const members = files.filter((file) => file.cluster === name);
    const classes = zeroed(FILE_CLASSES);
    members.forEach((file) => {
      classes[file.class] += 1;
    });
    return { classes, files: members.length, name };
  });
  const commitRules = new Map<string, number>();
  for (const { rule } of commits.values()) {
    if (rule !== undefined) {
      commitRules.set(rule.id, (commitRules.get(rule.id) ?? 0) + 1);
    }
  }
  const linked = new Set(files.flatMap((file) => file.issues));
  return {
    clusters,
    commits: input.log.length,
    files,
    issues: [...linked]
      .sort((left, right) => left - right)
      .map((number) => issues.get(number))
      .filter((issue): issue is IssueRecord => issue !== undefined),
    read: files.map((file) => file.path),
    rules: RULES.map((rule) => ({
      class: rule.class,
      commits: commitRules.get(rule.id) ?? 0,
      files: fileRules.get(rule.id) ?? 0,
      id: rule.id,
      reads: rule.reads,
    })),
  };
}

/**
 * The map as `docs/survey/provenance.json` holds it.
 *
 * @param map - The provenance map.
 * @returns The JSON text: sorted keys, two-space indent, a closing newline.
 */
export function renderProvenanceJson(map: ProvenanceMap): string {
  return stableJson({
    clusters: map.clusters,
    commits: map.commits,
    files: map.files,
    issues: map.issues,
    read: map.read,
    rules: map.rules,
  });
}

/** The column heading of each class in the summary. */
const CLASS_HEADINGS: Readonly<Record<FileClass, string>> = {
  'bug-sweep': 'Bug-sweep patch',
  imported: 'Imported',
  'proof-of-concept': 'Proof of concept',
  spec: 'Spec',
  unclassified: 'Unclassified',
};

/**
 * The map as `docs/survey/provenance.md` holds it: the coverage line, the
 * class counts, the rule each class was read by, the classes per cluster,
 * and the unclassified files.
 *
 * @param map - The provenance map.
 * @param tracked - The tracked files in scope, for the coverage line.
 * @param importSubject - The import pattern the map was built with, to name it.
 * @returns The markdown text, ending in a newline.
 */
export function renderProvenanceMarkdown(
  map: ProvenanceMap,
  tracked: readonly string[],
  importSubject: RegExp = IMPORT_SUBJECT,
): string {
  const totals = zeroed(FILE_CLASSES);
  map.files.forEach((file) => {
    totals[file.class] += 1;
  });
  const later = map.files.filter((file) => file.readFrom === 'later').length;
  const unclassified = map.files.filter((file) => file.class === 'unclassified');
  const silent = unclassified.filter((file) => file.issues.length === 0).length;
  const lines = [
    '# Provenance',
    '',
    coverageLine(map.read, tracked),
    '',
    `${map.files.length} files read over ${map.commits} commits, linking ${map.issues.length} issues: `
    + `${FILE_CLASSES.map((fileClass) => `${totals[fileClass]} ${CLASS_HEADINGS[fileClass].toLowerCase()}`).join(', ')}. `
    + `${later} files took their class from a commit after the one that added them; `
    + `${silent} of the ${unclassified.length} unclassified files have a history that names no issue.`,
    '',
    '## Rules',
    '',
    'A subject links an issue as `rafa-<n>:` or `(#<n>)`, when `gh issue list --state all` holds `<n>`. '
    + 'A commit is read by the first rule below it meets. A file takes the class of the commit that added it, '
    + 'renames followed, or else of the earliest later commit with a class.',
    '',
    `The import pattern is \`${importSubject.source}\`.`,
    '',
    '| Class | Rule | Reads | Commits | Files |',
    '| --- | --- | --- | --- | --- |',
    ...map.rules.map((rule) => `| ${CLASS_HEADINGS[rule.class]} | \`${rule.id}\` | ${rule.reads} | ${rule.commits} | ${rule.files} |`),
    '',
    '## Classes per cluster',
    '',
    `| Cluster | Files | ${FILE_CLASSES.map((fileClass) => CLASS_HEADINGS[fileClass]).join(' | ')} |`,
    `| --- | --- | ${FILE_CLASSES.map(() => '---').join(' | ')} |`,
    ...map.clusters.map((cluster) => `| \`${cluster.name}\` | ${cluster.files} | `
      + `${FILE_CLASSES.map((fileClass) => cluster.classes[fileClass]).join(' | ')} |`),
    '',
    '## Unclassified files',
    '',
    '| File | Cluster | Commits | Issues named |',
    '| --- | --- | --- | --- |',
    ...unclassified.map((file) => `| \`${file.path}\` | \`${file.cluster}\` | ${file.commits} | `
      + `${file.issues.length === 0
        ? 'none'
        : file.issues.map((number) => `#${number}`).join(', ')} |`),
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Runs a command in the repository and returns its standard output.
 *
 * @param root - The repository root.
 * @param command - The command and its arguments.
 * @returns The output text.
 * @throws When the command exits non-zero.
 */
function run(root: string, command: readonly string[]): string {
  const result = Bun.spawnSync([...command], { cwd: root, stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(' ')} failed in ${root} (exit ${result.exitCode}): ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString();
}

/**
 * Reads the whole history of a repository, oldest first, with renames.
 *
 * @param root - The repository root.
 * @returns The commits.
 * @throws When `git log` exits non-zero.
 */
export function readGitLog(root: string): LogCommit[] {
  return parseGitLog(run(root, [
    'git',
    '-c',
    'core.quotePath=false',
    'log',
    '--reverse',
    '--topo-order',
    '-M',
    '--name-status',
    '--format=%x1e%H%x1f%P%x1f%s',
  ]));
}

/** The most issues the one `gh issue list` call asks for. */
export const ISSUE_LIMIT = 10_000;

/**
 * Reads every issue, open or closed, with one `gh issue list` call.
 *
 * @param root - The repository root, whose remote `gh` reads.
 * @returns The issues.
 * @throws When `gh` exits non-zero or prints no issue list.
 */
export function readIssues(root: string): IssueRecord[] {
  return parseIssueList(run(root, [
    'gh',
    'issue',
    'list',
    '--state',
    'all',
    '--limit',
    String(ISSUE_LIMIT),
    '--json',
    'number,title,labels',
  ]));
}

/**
 * Reads the repository at `root` and writes both outputs under
 * `docs/survey/`. The clusters come from the import graph, built here as
 * `import-graph.ts` builds it.
 *
 * @param root - The repository root.
 * @param issues - The issues; read with one `gh issue list` call when left out.
 * @returns The paths written, relative to `root`.
 */
export async function main(root: string, issues?: readonly IssueRecord[]): Promise<string[]> {
  const tracked = listTrackedFiles(root);
  const sources = new Map<string, string>();
  for (const path of tracked.all) {
    sources.set(path, await Bun.file(join(root, path)).text());
  }
  const metafile = await readMetafile(root, tracked.all);
  const graph = surveyImportGraph(
    buildImportGraph({ files: tracked.all, metafile, resolve: bunResolver(root), root, sources }),
  );
  const clusterOf = new Map<string, string>();
  for (const cluster of graph.clusters) {
    cluster.members.forEach((member) => clusterOf.set(member, cluster.name));
  }
  const map = surveyProvenance({
    clusterOf,
    files: tracked.all,
    issues: issues ?? readIssues(root),
    log: readGitLog(root),
  });
  mkdirSync(join(root, OUTPUT_DIR), { recursive: true });
  const jsonPath = `${OUTPUT_DIR}/provenance.json`;
  const markdownPath = `${OUTPUT_DIR}/provenance.md`;
  writeFileSync(join(root, jsonPath), renderProvenanceJson(map));
  writeFileSync(join(root, markdownPath), renderProvenanceMarkdown(map, tracked.all));
  return [jsonPath, markdownPath];
}

if (import.meta.main) {
  try {
    for (const path of await main(process.cwd())) {
      console.log(`wrote ${path}`);
    }
  } catch (err) {
    console.error(err instanceof Error
      ? err.message
      : String(err));
    process.exit(1);
  }
}
