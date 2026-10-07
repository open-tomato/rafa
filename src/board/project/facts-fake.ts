/**
 * A strict fake of the three `gh api graphql` reads the facts reader
 * (`./facts.ts`) sends, behind a {@link GhRunner}: one in-memory
 * repository of issues, pull requests and branch trees, recording every
 * command it is handed. No case that uses it spawns a process or reaches
 * GitHub.
 *
 * This module is a test helper that is not itself a test file, as
 * `src/pr/gh-fake.ts` is: bun runs nothing in it until a `*.test.ts`
 * calls it, and `check-types` reads it.
 *
 * ## What it answers, and from which reading
 *
 * The shapes are the ones `./facts.ts`'s module note records, read off
 * `gh` 2.100.0 on 2026-10-06 against `open-tomato/rafa`: the answer is
 * `{"data":{"repository":{...}}}` with each alias's key in the order the
 * query names it, and no trailing newline, as every `gh api` answer
 * reads. A cross-reference whose source is an issue is `{}`; an
 * `object(expression:)` naming a path or a branch the repository does not
 * hold is null; a files page carries `pageInfo { hasNextPage endCursor }`
 * with the cursor the base64 of the last index read (`Mw` for 3), as
 * `#850`'s first page of three answered.
 *
 * ## Strict
 *
 * Anything but the three reads — another command, a query of another
 * shape, an issue or pull request it does not hold — is refused with `ok`
 * false and a message opening with `fake gh:`, the prefix of every
 * message the fake invents. A missing issue or pull request fails the
 * whole read, as `gh` exited 1 on an alias naming a number the repository
 * did not hold (`../board-cache-native.ts`).
 */
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';

/** The repository the fake answers for when none is given. */
export const FAKE_REPOSITORY = 'open-tomato/rafa';

/** How a planted pull request mentions an issue in the issue's timeline. */
export interface FakeMention {
  /** The pull request whose body mentions the issue. */
  readonly pull: number;
  /** True for a pull request of another repository. False when left out. */
  readonly crossRepository?: boolean;
}

/** One issue the fake holds. */
export interface FakeFactsIssue {
  readonly number: number;
  readonly state: 'OPEN' | 'CLOSED';
  readonly stateReason?: string | null;
  readonly labels?: readonly string[];
  /** The pull requests in `closedByPullRequestsReferences`, by number. */
  readonly closedBy?: readonly number[];
  /** The pull requests whose bodies mention it, in its timeline. */
  readonly mentions?: readonly FakeMention[];
  /** How many issue-sourced cross-references precede the pull requests. */
  readonly issueMentions?: number;
}

/** One file a planted pull request changed. */
export interface FakePullFile {
  readonly path: string;
  readonly changeType: 'ADDED' | 'MODIFIED' | 'DELETED' | 'RENAMED' | 'COPIED' | 'CHANGED';
}

/** One pull request the fake holds. */
export interface FakeFactsPull {
  readonly number: number;
  readonly state: 'OPEN' | 'MERGED' | 'CLOSED';
  readonly baseRefName: string;
  readonly headRefOid: string;
  readonly body?: string;
  readonly files?: readonly FakePullFile[];
}

/** What the fake is made with. */
export interface FakeFactsGhOptions {
  readonly repository?: string;
  readonly issues?: readonly FakeFactsIssue[];
  readonly pulls?: readonly FakeFactsPull[];
  /** Each ref's tree, a branch name or a commit, as path to text. */
  readonly trees?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** The fake, and what it recorded. */
export interface FakeFactsGh {
  readonly gh: GhRunner;
  /** Every argv handed over, in order, refused ones included. */
  calls(): readonly (readonly string[])[];
  /** Makes the next call fail with `stderr`, as a refused `gh` would. */
  failNext(stderr: string): void;
}

type Json = Readonly<Record<string, unknown>>;

function ok(value: unknown): GhResult {
  return { ok: true, stdout: JSON.stringify({ data: { repository: value } }), stderr: '' };
}

function refused(message: string): GhResult {
  return { ok: false, stdout: '', stderr: `fake gh: ${message}\n` };
}

/** The `-f`/`-F` fields of `args`, by name, and whether every other argument was the recorded shape. */
function fieldsOf(args: readonly string[]): ReadonlyMap<string, string> | null {
  if (args[0] !== 'api' || args[1] !== 'graphql') return null;
  const fields = new Map<string, string>();
  for (let index = 2; index < args.length; index += 2) {
    const [flag, field] = [args[index], args[index + 1] ?? ''];
    const split = field.indexOf('=');
    if ((flag !== '-f' && flag !== '-F') || split < 1) return null;
    fields.set(field.slice(0, split), field.slice(split + 1));
  }
  return fields;
}

function connection(nodes: readonly unknown[]): Json {
  return { pageInfo: { hasNextPage: false }, nodes };
}

/** Makes the fake; see the module note. */
export function createFakeFactsGh(options: FakeFactsGhOptions = {}): FakeFactsGh {
  const repository = options.repository ?? FAKE_REPOSITORY;
  const issues = new Map((options.issues ?? []).map((issue) => [issue.number, issue]));
  const pulls = new Map((options.pulls ?? []).map((pull) => [pull.number, pull]));
  const trees = options.trees ?? {};
  const recorded: (readonly string[])[] = [];
  let failure: string | null = null;

  const pullFields = (pull: FakeFactsPull): Json => ({
    number: pull.number,
    state: pull.state,
    baseRefName: pull.baseRefName,
    headRefOid: pull.headRefOid,
  });

  const issueNode = (issue: FakeFactsIssue): Json | string => {
    const missing = [...(issue.closedBy ?? []), ...(issue.mentions ?? []).map(({ pull }) => pull)].find((number) => !pulls.has(number));
    if (missing !== undefined) return `issue #${String(issue.number)} names pull request #${String(missing)}, which is not planted`;
    const sources = [
      ...Array.from({ length: issue.issueMentions ?? 0 }, () => ({ isCrossRepository: false, source: {} })),
      ...(issue.mentions ?? []).map(({ pull, crossRepository }) => {
        const planted = pulls.get(pull) as FakeFactsPull;
        return { isCrossRepository: crossRepository ?? false, source: { ...pullFields(planted), body: planted.body ?? '' } };
      }),
    ];
    return {
      number: issue.number,
      state: issue.state,
      stateReason: issue.stateReason ?? null,
      labels: connection((issue.labels ?? []).map((name) => ({ name }))),
      closedByPullRequestsReferences: connection((issue.closedBy ?? []).map((number) => pullFields(pulls.get(number) as FakeFactsPull))),
      timelineItems: connection(sources),
    };
  };

  const answerIssues = (query: string): GhResult => {
    const answer: Record<string, unknown> = { nameWithOwner: repository };
    for (const [, alias, number] of query.matchAll(/ (i\d+): issue\(number: (\d+)\)/gu)) {
      const issue = issues.get(Number(number));
      if (issue === undefined) return refused(`no issue #${String(number)}`);
      const node = issueNode(issue);
      if (typeof node === 'string') return refused(node);
      answer[alias ?? ''] = node;
    }
    return ok(answer);
  };

  const answerFiles = (query: string, fields: ReadonlyMap<string, string>): GhResult => {
    const answer: Record<string, unknown> = {};
    for (const [, alias, number, first] of query.matchAll(/ (p\d+): pullRequest\(number: (\d+)\) \{ files\(first: (\d+),/gu)) {
      const pull = pulls.get(Number(number));
      if (pull === undefined) return refused(`no pull request #${String(number)}`);
      const cursor = fields.get(`c${String(number)}`);
      const start = cursor === undefined
        ? 0
        : Number(atob(cursor));
      const files = pull.files ?? [];
      const end = Math.min(files.length, start + Number(first));
      answer[alias ?? ''] = {
        files: {
          pageInfo: {
            hasNextPage: end < files.length,
            endCursor: end === 0
              ? null
              : btoa(String(end)),
          },
          nodes: files.slice(start, end).map(({ path, changeType }) => ({ path, changeType })),
        },
      };
    }
    return ok(answer);
  };

  const answerBlobs = (query: string, fields: ReadonlyMap<string, string>): GhResult => {
    const answer: Record<string, unknown> = {};
    for (const [, alias, wants] of query.matchAll(/ ([hb]\d+): object\(expression: \$[hb]\d+\) \{ \.\.\. on Blob \{ (text|oid) \} \}/gu)) {
      const expression = fields.get(alias ?? '') ?? '';
      const split = expression.indexOf(':');
      const text = trees[expression.slice(0, split)]?.[expression.slice(split + 1)];
      answer[alias ?? ''] = text === undefined
        ? null
        : wants === 'text'
          ? { text }
          : { oid: `blob-${expression}` };
    }
    return ok(answer);
  };

  const gh: GhRunner = (args) => {
    recorded.push(Object.freeze([...args]));
    if (failure !== null) {
      const stderr = failure;
      failure = null;
      return Promise.resolve({ ok: false, stdout: '', stderr });
    }
    const fields = fieldsOf(args);
    const query = fields?.get('query');
    if (fields === null || query === undefined) return Promise.resolve(refused(`unmodelled command: gh ${args.join(' ')}`));
    if (fields.get('owner') !== '{owner}' || fields.get('repo') !== '{repo}') return Promise.resolve(refused('owner and repo are not the placeholders'));
    if (query.includes('fragment facts on Issue')) return Promise.resolve(answerIssues(query));
    if (query.includes(': pullRequest(number:')) return Promise.resolve(answerFiles(query, fields));
    if (query.includes(': object(expression:')) return Promise.resolve(answerBlobs(query, fields));
    return Promise.resolve(refused(`unmodelled query: ${query}`));
  };

  return {
    gh,
    calls: () => [...recorded],
    failNext: (stderr) => {
      failure = stderr;
    },
  };
}
