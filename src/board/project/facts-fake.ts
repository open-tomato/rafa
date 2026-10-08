/**
 * A strict fake of the four `gh api graphql` reads the facts reader
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
 * An issue's labels, closing references and cross-references page the
 * same way, at the `first:` the query asks, the first page in the issues
 * query and each further one in a list query naming its cursor as a
 * variable. An issue planted with {@link FakeFactsIssue.repeatsCursor}
 * answers that list's first `endCursor` on every page with a next page
 * always ahead, the way a cursor that does not move would read.
 *
 * ## Strict
 *
 * Anything but the four reads — another command, a query of another
 * shape, an issue or pull request it does not hold — is refused with `ok`
 * false and a message opening with `fake gh:`, the prefix of every
 * message the fake invents. A missing issue or pull request fails the
 * whole read, as `gh` exited 1 on an alias naming a number the repository
 * did not hold (`../board-cache-native.ts`).
 */
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';

/** The repository the fake answers for when none is given. */
export const FAKE_REPOSITORY = 'open-tomato/rafa';

/** An issue's lists the fake pages, by the name the query asks them. */
export type FakeIssueList = 'labels' | 'closedByPullRequestsReferences' | 'timelineItems';

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
  /** The list whose cursor never moves; see the module note. None when left out. */
  readonly repeatsCursor?: FakeIssueList;
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

/** The `first:` the query asks of `list`, or null when it asks none. */
function firstOf(query: string, list: string): number | null {
  const match = new RegExp(`${list}\\(first: (\\d+)`, 'u').exec(query);
  return match === null
    ? null
    : Number(match[1]);
}

/** The page of `nodes` of `first` entries from the base64 `cursor` on, or from the start when undefined. */
function pageOf(nodes: readonly unknown[], first: number, cursor: string | undefined, repeats: boolean): Json {
  const start = cursor === undefined
    ? 0
    : Number(atob(cursor));
  const end = Math.min(nodes.length, start + first);
  if (repeats) return { pageInfo: { hasNextPage: true, endCursor: btoa(String(Math.min(nodes.length, first))) }, nodes: nodes.slice(start, end) };
  return {
    pageInfo: {
      hasNextPage: end < nodes.length,
      endCursor: end === 0
        ? null
        : btoa(String(end)),
    },
    nodes: nodes.slice(start, end),
  };
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

  /** Every node of each list of `issue`, or the message refusing it. */
  const listsOf = (issue: FakeFactsIssue): Readonly<Record<FakeIssueList, readonly unknown[]>> | string => {
    const missing = [...(issue.closedBy ?? []), ...(issue.mentions ?? []).map(({ pull }) => pull)].find((number) => !pulls.has(number));
    if (missing !== undefined) return `issue #${String(issue.number)} names pull request #${String(missing)}, which is not planted`;
    return {
      labels: (issue.labels ?? []).map((name) => ({ name })),
      closedByPullRequestsReferences: (issue.closedBy ?? []).map((number) => pullFields(pulls.get(number) as FakeFactsPull)),
      timelineItems: [
        ...Array.from({ length: issue.issueMentions ?? 0 }, () => ({ isCrossRepository: false, source: {} })),
        ...(issue.mentions ?? []).map(({ pull, crossRepository }) => {
          const planted = pulls.get(pull) as FakeFactsPull;
          return { isCrossRepository: crossRepository ?? false, source: { ...pullFields(planted), body: planted.body ?? '' } };
        }),
      ],
    };
  };

  const issueNode = (issue: FakeFactsIssue, query: string): Json | string => {
    const lists = listsOf(issue);
    if (typeof lists === 'string') return lists;
    const page = (list: FakeIssueList): Json | string => {
      const first = firstOf(query, list);
      return first === null
        ? `the issues query asks no first: of ${list}`
        : pageOf(lists[list], first, undefined, issue.repeatsCursor === list);
    };
    const [labels, closedBy, timeline] = [page('labels'), page('closedByPullRequestsReferences'), page('timelineItems')];
    if (typeof labels === 'string') return labels;
    if (typeof closedBy === 'string') return closedBy;
    if (typeof timeline === 'string') return timeline;
    return {
      number: issue.number,
      state: issue.state,
      stateReason: issue.stateReason ?? null,
      labels,
      closedByPullRequestsReferences: closedBy,
      timelineItems: timeline,
    };
  };

  const answerIssues = (query: string): GhResult => {
    const answer: Record<string, unknown> = { nameWithOwner: repository };
    for (const [, alias, number] of query.matchAll(/ (i\d+): issue\(number: (\d+)\)/gu)) {
      const issue = issues.get(Number(number));
      if (issue === undefined) return refused(`no issue #${String(number)}`);
      const node = issueNode(issue, query);
      if (typeof node === 'string') return refused(node);
      answer[alias ?? ''] = node;
    }
    return ok(answer);
  };

  const answerListPages = (query: string, fields: ReadonlyMap<string, string>): GhResult => {
    const answer: Record<string, unknown> = {};
    const asked = / (\w+): issue\(number: (\d+)\) \{ (labels|closedByPullRequestsReferences|timelineItems)\(first: (\d+), after: \$(\w+)[,)]/gu;
    for (const [, alias, number, list, first, variable] of query.matchAll(asked)) {
      const issue = issues.get(Number(number));
      if (issue === undefined) return refused(`no issue #${String(number)}`);
      const cursor = fields.get(variable ?? '');
      if (cursor === undefined) return refused(`no value for the cursor $${String(variable)}`);
      const lists = listsOf(issue);
      if (typeof lists === 'string') return refused(lists);
      const name = list as FakeIssueList;
      answer[alias ?? ''] = { [name]: pageOf(lists[name], Number(first), cursor, issue.repeatsCursor === name) };
    }
    return ok(answer);
  };

  const answerFiles = (query: string, fields: ReadonlyMap<string, string>): GhResult => {
    const answer: Record<string, unknown> = {};
    for (const [, alias, number, first] of query.matchAll(/ (p\d+): pullRequest\(number: (\d+)\) \{ files\(first: (\d+),/gu)) {
      const pull = pulls.get(Number(number));
      if (pull === undefined) return refused(`no pull request #${String(number)}`);
      answer[alias ?? ''] = { files: pageOf(pull.files ?? [], Number(first), fields.get(`c${String(number)}`), false) };
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
    if (query.includes(': issue(number:')) return Promise.resolve(answerListPages(query, fields));
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
