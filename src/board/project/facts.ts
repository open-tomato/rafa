/**
 * The facts the project's Stage rule (`./rules.ts`) reads of each issue,
 * read off GitHub through the `GhRunner` seam: its state and close
 * reason, its labels, the pull requests that close it — open or merged,
 * with the base branch each went into — the fragment each added under
 * `release.fragments`, and whether that fragment is still on the base
 * branch. {@link readIssueFacts} answers one {@link IssueFacts} per issue,
 * a shape {@link stageOf} takes as it is.
 *
 * ## The pull requests that close an issue
 *
 * GitHub links a pull request to the issues its body closes only when it
 * targets the default branch. Measured with `gh` 2.100.0 on 2026-10-06,
 * read-only, on `open-tomato/rafa`: `#850`, merged into the integration
 * branch `stretch/4` with `Closes #821` in its body, answered
 * `closingIssuesReferences` `[]`, and `#821`'s
 * `closedByPullRequestsReferences` was empty too. The control, `#799`,
 * closed by `#813` into `main`, answered `#813` there. So the reader takes
 * the union of two readings, by pull request number ascending:
 *
 * 1. `closedByPullRequestsReferences`, which also holds a pull request
 *    linked by hand in the issue's Development panel;
 * 2. the issue's `CROSS_REFERENCED_EVENT`s whose source is a pull request
 *    of this repository whose body closes it: one of GitHub's keywords
 *    (`close`, `closes`, `closed`, `fix`, `fixes`, `fixed`, `resolve`,
 *    `resolves`, `resolved`, any case, an optional colon), then `#<n>` or
 *    `<owner>/<name>#<n>` naming this repository. `#821` answered `#850`
 *    this way. `willCloseTarget` is NOT read: it answered false on both
 *    `#850` and `#813`, the latter after it had closed `#799`.
 *
 * A pull request closed without merging is left out, as `StageFacts`
 * asks. A cross-reference whose source is an issue answers `{}` and is
 * passed over, as is one from another repository, whose fragments would
 * live in a tree this reader does not ask about.
 *
 * ## The fragments a pull request added
 *
 * A pull request's files are read page by page, `changeType` beside each
 * `path`; a fragment is a file `ADDED` directly under the fragments
 * directory whose name `fragmentIdOf` (`../../release/fragment-tree.ts`)
 * reads as one. Its text is read at the pull request's `headRefOid`, and
 * whether it is on the base branch by the same path at `baseRefName`;
 * `object(expression:)` answered null, exit 0, both for a path the branch
 * does not hold and for a branch that no longer exists (`stretch/3`,
 * deleted after its merge into `main`). `rafa release settle` deletes
 * each fragment it folds, so `#813`'s seven fragments, settled since,
 * answered null on `main`.
 *
 * The text is parsed with `parseFragment` (`../../release/fragment.ts`).
 * `level: none` is written, never implied, so a fragment whose text does
 * not parse, or could not be read at the head, is not known to ship
 * nothing: it reads as {@link UNREAD_LEVEL}, the least level that ships,
 * with the reason kept in {@link FactsFragment.problem}.
 *
 * A pull request can add several fragments: one merging an integration
 * branch into `main` brings every fragment of that branch (`#813` added
 * seven). {@link FactsPullRequest.fragments} holds every one, by path, and
 * {@link FactsPullRequest.fragment} the one Stage reads — the first that
 * ships and is still on the base, else the first that ships, else the
 * first — so the rule's "its fragment ships and is still on the base"
 * holds of the pull request exactly when it holds of one of them.
 *
 * ## Every list read to its end
 *
 * An issue's labels, closing references and cross-references are each
 * read {@link PAGE_SIZE} to a page, GitHub's cap, and followed past the
 * first page by its `endCursor`, as a pull request's files are. The
 * issues query carries every first page, so only an issue holding more
 * than one page of a list costs more requests: one per further page,
 * batched across issues. Measured on 2026-10-07 over rafa's own
 * repository, `#485` held 116 cross-references, so a reader stopping at
 * one page would have answered it short by sixteen, any of them the pull
 * request the Stage turns on.
 *
 * ## Refusals
 *
 * A failed `gh` call, an answer that is not the recorded shape, and a
 * list whose next page names a cursor it has already read THROW, naming
 * the issue and the list: a cursor that repeats would read the same page
 * forever, and a dropped entry would answer facts that read as complete
 * and are short by the one pull request the Stage turns on.
 */
import type { FilesPage, FragmentLookup, IssueList, ListPage } from './facts-query.js';
import type { StageFacts, StageFragment, StagePullRequest } from './rules.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { PlanReleaseLevel } from '../../plan/parse.js';
import type { BoardIssueState } from '../roadmap-board.js';

import { describeValue, isMapping } from '../../config-sections.js';
import { directoryPrefix, fragmentIdOf } from '../../release/fragment-tree.js';
import { parseFragment } from '../../release/fragment.js';

import {
  batchesOf,
  blobAliases,
  blobsArgs,
  filesArgs,
  FRAGMENT_BATCH,
  ISSUE_BATCH,
  issueAlias,
  ISSUE_LISTS,
  issuesArgs,
  LIST_BATCH,
  listAlias,
  listPagesArgs,
  PAGE_SIZE,
  PULL_BATCH,
  pullAlias,
} from './facts-query.js';
import { ships } from './rules.js';

export { PAGE_SIZE } from './facts-query.js';

/** The level a fragment that could not be read counts as: the least that ships. See the module note. */
export const UNREAD_LEVEL: PlanReleaseLevel = 'patch';

/** What every refusal opens with. */
const PREFIX = 'board project facts';

/** The `changeType` of a file a pull request added. */
const ADDED = 'ADDED';

/** GitHub's closing keywords, then a reference: group 1 the repository, group 2 the number. */
const CLOSING_REFERENCE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/giu;

/** One fragment a pull request added, as the facts read it. */
export interface FactsFragment extends StageFragment {
  /** Its path from the repository root, e.g. `.changes/rafa-821.md`. */
  readonly path: string;
  /** Why its level could not be read, or null when it parsed; see the module note. */
  readonly problem: string | null;
}

/** One pull request that closes an issue, open or merged. */
export interface FactsPullRequest extends StagePullRequest {
  readonly number: number;
  /** The branch it targets: the default branch, or an integration branch. */
  readonly baseRefName: string;
  /** Every fragment it added, by path. */
  readonly fragments: readonly FactsFragment[];
  /** The one Stage reads, or null when it added none; see the module note. */
  readonly fragment: FactsFragment | null;
}

/** The facts of one issue. */
export interface IssueFacts extends StageFacts {
  readonly number: number;
  /** The pull requests that close it, open or merged, by number ascending. */
  readonly pullRequests: readonly FactsPullRequest[];
}

/** What {@link readIssueFacts} is made with. */
export interface FactsReaderOptions {
  readonly gh: GhRunner;
  /** The fragments directory, as `release.fragments` reads it: `.changes` by default. */
  readonly fragments: string;
}

/** A pull request as the issues query read it, before its files. */
interface ReadPull {
  readonly number: number;
  readonly state: StagePullRequest['state'];
  readonly baseRefName: string;
  readonly headRefOid: string;
}

/** An issue as the issues query read it. */
interface ReadIssue extends Pick<IssueFacts, 'number' | 'state' | 'stateReason' | 'labels'> {
  readonly pulls: readonly ReadPull[];
}

/** A mapping of answer keys. */
type Answer = Readonly<Record<string, unknown>>;

/** Refuses an answer, naming where it went wrong and what was there. */
function refuse(problem: string): never {
  throw new Error(`${PREFIX}: ${problem}`);
}

function readMapping(value: unknown, where: string): Answer {
  if (!isMapping(value)) refuse(`${where} is ${describeValue(value)}, expected a mapping`);
  return value;
}

function readString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value === '') refuse(`${where} is ${describeValue(value)}, expected a non-empty string`);
  return value;
}

function readNumber(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    refuse(`${where} is ${describeValue(value)}, expected a positive whole number`);
  }
  return value;
}

function readList(value: unknown, where: string): readonly unknown[] {
  if (!Array.isArray(value)) refuse(`${where} is ${describeValue(value)}, expected a list`);
  return value;
}

/** One page of a connection: its nodes, and the cursor of the next page, or null on the last. */
interface ConnectionPage {
  readonly nodes: readonly unknown[];
  readonly next: string | null;
}

/** The page of the connection at `where`. */
function readPage(value: unknown, where: string): ConnectionPage {
  const connection = readMapping(value, where);
  const pageInfo = readMapping(connection['pageInfo'], `${where}.pageInfo`);
  const nodes = readList(connection['nodes'], `${where}.nodes`);
  const more = pageInfo['hasNextPage'];
  if (more === false) return { nodes, next: null };
  if (more !== true) refuse(`${where}.pageInfo.hasNextPage is ${describeValue(more)}, expected true or false`);
  return { nodes, next: readString(pageInfo['endCursor'], `${where}.pageInfo.endCursor`) };
}

/** Sends `args` and answers the `repository` of the answer, or throws naming what `gh` said. */
async function readRepository(gh: GhRunner, args: readonly string[]): Promise<Answer> {
  const result = await gh(args);
  if (!result.ok) refuse(`gh api graphql failed: ${result.stderr.trim() || result.stdout.trim()}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    refuse(`gh api graphql answered text that is not JSON: ${result.stdout.slice(0, PAGE_SIZE)}`);
  }
  const data = readMapping(readMapping(parsed, 'the answer')['data'], 'data');
  return readMapping(data['repository'], 'data.repository');
}

/** The pull request at `where`, or null for one closed without merging. */
function readPull(value: unknown, where: string): ReadPull | null {
  const pull = readMapping(value, where);
  const state = pull['state'];
  if (state === 'CLOSED') return null;
  if (state !== 'OPEN' && state !== 'MERGED') refuse(`${where}.state is ${describeValue(state)}, expected OPEN, MERGED or CLOSED`);
  return {
    number: readNumber(pull['number'], `${where}.number`),
    state,
    baseRefName: readString(pull['baseRefName'], `${where}.baseRefName`),
    headRefOid: readString(pull['headRefOid'], `${where}.headRefOid`),
  };
}

/** True when `body` closes issue `issue` of `repository` by one of GitHub's keywords. */
export function bodyCloses(body: string, issue: number, repository: string): boolean {
  return [...body.matchAll(CLOSING_REFERENCE)].some(([, named, number]) => Number(number) === issue
    && (named === undefined || named.toLowerCase() === repository.toLowerCase()));
}

/** The pull request a cross-reference at `where` names, when it is one of this repository whose body closes `issue`. */
function crossReferencedPull(value: unknown, where: string, issue: number, repository: string): ReadPull | null {
  const event = readMapping(value, where);
  if (event['isCrossRepository'] !== false) return null;
  const source = readMapping(event['source'], `${where}.source`);
  if (!('number' in source)) return null;
  const body = source['body'];
  if (typeof body !== 'string') refuse(`${where}.source.body is ${describeValue(body)}, expected a string`);
  return bodyCloses(body, issue, repository)
    ? readPull(source, `${where}.source`)
    : null;
}

/** An issue's own fields, as the issues query read them. */
type IssueHead = Pick<IssueFacts, 'number' | 'state' | 'stateReason'>;

/** Every node read so far of each list of one issue. */
type IssueNodes = Readonly<Record<IssueList, readonly unknown[]>>;

/** One issue as the issues query answered it: its fields, and the first page of each list. */
interface IssueFirstPages {
  readonly head: IssueHead;
  readonly repository: string;
  readonly pages: Readonly<Record<IssueList, ConnectionPage>>;
}

/** Where issue `number`'s `list` is named in a refusal. */
function listWhere(number: number, list: IssueList): string {
  return `issue #${String(number)}.${list}`;
}

/** Issue `number` as the issues query answered it under its alias. */
function readIssueFirstPages(answer: Answer, number: number, repository: string): IssueFirstPages {
  const where = `issue #${String(number)}`;
  const issue = readMapping(answer[issueAlias(number)], where);
  const state = issue['state'];
  if (state !== 'OPEN' && state !== 'CLOSED') refuse(`${where}.state is ${describeValue(state)}, expected OPEN or CLOSED`);
  const reason = issue['stateReason'];
  if (reason !== null && typeof reason !== 'string') refuse(`${where}.stateReason is ${describeValue(reason)}, expected a string or null`);
  const pages = Object.fromEntries(ISSUE_LISTS.map((list) => [list, readPage(issue[list], listWhere(number, list))])) as Record<IssueList, ConnectionPage>;
  return { head: { number, state: state satisfies BoardIssueState, stateReason: reason }, repository, pages };
}

/** The key of one issue's list among the pages read. */
function listKey(number: number, list: IssueList): string {
  return `${String(number)}:${list}`;
}

/**
 * Reads every page past the first of each list of `firsts`, a batch of
 * {@link LIST_BATCH} pages to a request, and answers every node of each
 * list by {@link listKey}. Throws on a cursor read before; see the module note.
 */
async function readRemainingPages(gh: GhRunner, firsts: readonly IssueFirstPages[]): Promise<ReadonlyMap<string, readonly unknown[]>> {
  const nodes = new Map<string, unknown[]>();
  const seen = new Map<string, Set<string>>();
  let pending: readonly ListPage[] = firsts.flatMap(({ head: { number }, pages }) => ISSUE_LISTS.flatMap((list) => {
    const page = pages[list];
    nodes.set(listKey(number, list), [...page.nodes]);
    seen.set(listKey(number, list), new Set(page.next === null
      ? []
      : [page.next]));
    return page.next === null
      ? []
      : [{ number, list, cursor: page.next }];
  }));
  while (pending.length > 0) {
    const next: ListPage[] = [];
    for (const batch of batchesOf(pending, LIST_BATCH)) {
      const answer = await readRepository(gh, listPagesArgs(batch));
      for (const { number, list } of batch) {
        const where = listWhere(number, list);
        const page = readPage(readMapping(answer[listAlias(number, list)], `issue #${String(number)}`)[list], where);
        nodes.get(listKey(number, list))?.push(...page.nodes);
        if (page.next === null) continue;
        const cursors = seen.get(listKey(number, list));
        if (cursors?.has(page.next) === true) refuse(`${where} answered the cursor ${JSON.stringify(page.next)} a second time, so its next page would repeat one read before`);
        cursors?.add(page.next);
        next.push({ number, list, cursor: page.next });
      }
    }
    pending = next;
  }
  return nodes;
}

/** The issue from its fields and every node of its lists; see the module note. */
function readIssue(head: IssueHead, lists: IssueNodes, repository: string): ReadIssue {
  const where = `issue #${String(head.number)}`;
  const labels = lists.labels
    .map((label, index) => readString(readMapping(label, `${where}.labels[${String(index)}]`)['name'], `${where}.labels[${String(index)}].name`));
  const linked = lists.closedByPullRequestsReferences
    .map((pull, index) => readPull(pull, `${where}.closedByPullRequestsReferences[${String(index)}]`));
  const mentioned = lists.timelineItems
    .map((event, index) => crossReferencedPull(event, `${where}.timelineItems[${String(index)}]`, head.number, repository));
  const pulls = new Map([...linked, ...mentioned].flatMap((pull) => pull === null
    ? []
    : [[pull.number, pull] as const]));
  return {
    ...head,
    labels,
    pulls: [...pulls.values()].sort((left, right) => left.number - right.number),
  };
}

/** Reads the issues `numbers`, one batch after another, then every further page of their lists. */
async function readIssues(gh: GhRunner, numbers: readonly number[]): Promise<readonly ReadIssue[]> {
  const firsts: IssueFirstPages[] = [];
  for (const batch of batchesOf(numbers, ISSUE_BATCH)) {
    const answer = await readRepository(gh, issuesArgs(batch));
    const repository = readString(answer['nameWithOwner'], 'data.repository.nameWithOwner');
    firsts.push(...batch.map((number) => readIssueFirstPages(answer, number, repository)));
  }
  const nodes = await readRemainingPages(gh, firsts);
  return firsts.map(({ head, repository }) => {
    const lists = Object.fromEntries(ISSUE_LISTS.map((list) => [list, nodes.get(listKey(head.number, list)) ?? []])) as Record<IssueList, readonly unknown[]>;
    return readIssue(head, lists, repository);
  });
}

/** The fragment paths among one page of files at `where`, and the cursor of the next page, if any. */
function readFilesPage(value: unknown, where: string, prefix: string): { paths: readonly string[]; next: string | null } {
  const files = readMapping(readMapping(value, where)['files'], `${where}.files`);
  const pageInfo = readMapping(files['pageInfo'], `${where}.files.pageInfo`);
  const paths = readList(files['nodes'], `${where}.files.nodes`).flatMap((node, index) => {
    const file = readMapping(node, `${where}.files.nodes[${String(index)}]`);
    const path = readString(file['path'], `${where}.files.nodes[${String(index)}].path`);
    const name = path.slice(prefix.length);
    const isFragment = file['changeType'] === ADDED && path.startsWith(prefix) && !name.includes('/') && fragmentIdOf(name) !== null;
    return isFragment
      ? [path]
      : [];
  });
  return {
    paths,
    next: pageInfo['hasNextPage'] === true
      ? readString(pageInfo['endCursor'], `${where}.files.pageInfo.endCursor`)
      : null,
  };
}

/** The fragment paths each pull request of `numbers` added, every page read. */
async function readAddedFragments(gh: GhRunner, numbers: readonly number[], prefix: string): Promise<ReadonlyMap<number, readonly string[]>> {
  const added = new Map<number, string[]>(numbers.map((number) => [number, []]));
  let pending: readonly FilesPage[] = numbers.map((number) => ({ number, cursor: null }));
  while (pending.length > 0) {
    const next: FilesPage[] = [];
    for (const batch of batchesOf(pending, PULL_BATCH)) {
      const answer = await readRepository(gh, filesArgs(batch));
      for (const { number } of batch) {
        const page = readFilesPage(answer[pullAlias(number)], `pull request #${String(number)}`, prefix);
        added.get(number)?.push(...page.paths);
        if (page.next !== null) next.push({ number, cursor: page.next });
      }
    }
    pending = next;
  }
  return added;
}

/** One fragment's two blobs: its text at the head, or null, and whether the base holds it. */
interface FragmentBlobs {
  readonly text: string | null;
  readonly onBase: boolean;
}

/** Reads each lookup's two blobs, in the order of `lookups`. */
async function readBlobs(gh: GhRunner, lookups: readonly FragmentLookup[]): Promise<readonly FragmentBlobs[]> {
  const read: FragmentBlobs[] = [];
  for (const batch of batchesOf(lookups, FRAGMENT_BATCH)) {
    const answer = await readRepository(gh, blobsArgs(batch));
    read.push(...batch.map(({ path }, index) => {
      const { head, base } = blobAliases(index);
      if (!(head in answer) || !(base in answer)) refuse(`the blob read answered no ${head} or ${base} for ${path}`);
      const headBlob = answer[head];
      const text = headBlob === null
        ? null
        : readMapping(headBlob, `${path} at the head`)['text'];
      if (text !== null && typeof text !== 'string') refuse(`${path} at the head has text ${describeValue(text)}, expected a string`);
      return { text, onBase: answer[base] !== null };
    }));
  }
  return read;
}

/** The fragment `path` reads as, from its blobs; see the module note. */
function fragmentOf(path: string, blobs: FragmentBlobs): FactsFragment {
  if (blobs.text === null) {
    return { path, level: UNREAD_LEVEL, onBase: blobs.onBase, problem: 'The fragment could not be read at the head of its pull request.' };
  }
  const reading = parseFragment(blobs.text);
  return reading.ok
    ? { path, level: reading.fragment.level, onBase: blobs.onBase, problem: null }
    : { path, level: UNREAD_LEVEL, onBase: blobs.onBase, problem: reading.sentence };
}

/** The fragment Stage reads among `fragments`; see the module note. */
function decidingFragment(fragments: readonly FactsFragment[]): FactsFragment | null {
  return fragments.find((fragment) => ships(fragment) && fragment.onBase)
    ?? fragments.find((fragment) => ships(fragment))
    ?? fragments[0]
    ?? null;
}

/** The key of one pull request's fragment among the read blobs. */
function blobKey(pull: number, path: string): string {
  return `${String(pull)}:${path}`;
}

/**
 * The facts of each issue of `numbers`, by issue number; a number given
 * twice is read once. Throws on a failed `gh` call or an answer that is
 * not the recorded shape; see the module note.
 */
export async function readIssueFacts(options: FactsReaderOptions, numbers: readonly number[]): Promise<ReadonlyMap<number, IssueFacts>> {
  const { gh } = options;
  const prefix = directoryPrefix(options.fragments);
  const issues = await readIssues(gh, [...new Set(numbers)]);
  const pulls = [...new Map(issues.flatMap(({ pulls: read }) => read.map((pull) => [pull.number, pull] as const))).values()];
  const added = await readAddedFragments(gh, pulls.map(({ number }) => number), prefix);
  const lookups = pulls.flatMap((pull) => (added.get(pull.number) ?? []).map((path) => ({ pull: pull.number, path, headRefOid: pull.headRefOid, baseRefName: pull.baseRefName })));
  const blobs = await readBlobs(gh, lookups);
  const fragments = new Map(lookups.map(({ pull, path }, index) => [blobKey(pull, path), fragmentOf(path, blobs[index] ?? { text: null, onBase: false })]));
  const factsOf = (pull: ReadPull): FactsPullRequest => {
    const own = [...(added.get(pull.number) ?? [])].sort().flatMap((path) => fragments.get(blobKey(pull.number, path)) ?? []);
    return { number: pull.number, state: pull.state, baseRefName: pull.baseRefName, fragments: own, fragment: decidingFragment(own) };
  };
  return new Map(issues.map(({ pulls: read, ...issue }) => [issue.number, { ...issue, pullRequests: read.map(factsOf) }]));
}
