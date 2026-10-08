/**
 * The three `gh api graphql` reads the facts reader (`./facts.ts`) sends,
 * as argv: the issues, the files of their pull requests, and the
 * fragment blobs. Split out so the reader holds what the answers mean and
 * this module holds only what is asked, which the fake (`./facts-fake.ts`)
 * reads back the same way.
 *
 * Each read names its subjects by alias in one query, `{owner}` and
 * `{repo}` filled by `gh` from the working directory as
 * `../board-cache-native.ts` does, and every value GitHub wrote — a base
 * branch, a commit, a path — travels as a GraphQL variable, never spliced
 * into the query text. Numbers are spliced, so each is checked first.
 *
 * Shapes measured with `gh` 2.100.0 on 2026-10-06, read-only, against
 * `open-tomato/rafa`; `./facts.ts` holds what each answered.
 */

/** GitHub's largest page for a GraphQL connection, the size of every page read here. */
export const PAGE_SIZE = 100;

/** How many issues one facts query names. */
export const ISSUE_BATCH = 20;

/** How many pull requests one files query names. */
export const PULL_BATCH = 20;

/** How many fragments one blob query names; each takes two aliases. */
export const FRAGMENT_BATCH = 20;

/** The fields every pull request is read with. */
const PULL_FIELDS = 'number state baseRefName headRefOid';

/** What the issues query asks of each issue. */
const ISSUE_SELECTION = [
  'number state stateReason',
  ` labels(first: ${String(PAGE_SIZE)}) { pageInfo { hasNextPage } nodes { name } }`,
  ` closedByPullRequestsReferences(first: ${String(PAGE_SIZE)}, includeClosedPrs: true)`,
  ' { pageInfo { hasNextPage } nodes { ...pull } }',
  ` timelineItems(first: ${String(PAGE_SIZE)}, itemTypes: [CROSS_REFERENCED_EVENT])`,
  ' { pageInfo { hasNextPage } nodes { ... on CrossReferencedEvent',
  ' { isCrossRepository source { ... on PullRequest { ...pull body } } } } }',
].join('');

/** One pull request whose files a files query reads, from `cursor` on, or from the start when null. */
export interface FilesPage {
  readonly number: number;
  readonly cursor: string | null;
}

/** One fragment whose blobs a blob query reads: at the pull request's head, and on its base branch. */
export interface FragmentLookup {
  readonly path: string;
  readonly headRefOid: string;
  readonly baseRefName: string;
}

/** Throws a `RangeError` naming `number` when it is not a positive whole number. */
function checkNumber(number: number): string {
  if (!Number.isSafeInteger(number) || number < 1) throw new RangeError(`not an issue number: ${String(number)}`);
  return String(number);
}

/** The `gh api graphql` argv sending `query` with the string variables `variables`. */
function graphqlArgs(query: string, variables: readonly (readonly [name: string, value: string])[]): readonly string[] {
  return Object.freeze([
    'api',
    'graphql',
    '-F',
    'owner={owner}',
    '-F',
    'repo={repo}',
    ...variables.flatMap(([name, value]) => ['-f', `${name}=${value}`]),
    '-f',
    `query=${query}`,
  ]);
}

/** The issue alias of `number` in an issues query. */
export function issueAlias(number: number): string {
  return `i${checkNumber(number)}`;
}

/** The pull request alias of `number` in a files query. */
export function pullAlias(number: number): string {
  return `p${checkNumber(number)}`;
}

/** The two blob aliases of the `index`th fragment in a blob query: at the head, and on the base. */
export function blobAliases(index: number): { readonly head: string; readonly base: string } {
  return { head: `h${String(index)}`, base: `b${String(index)}` };
}

/** The argv reading the facts of the issues `numbers`, each under {@link issueAlias}. */
export function issuesArgs(numbers: readonly number[]): readonly string[] {
  const issues = numbers.map((number) => ` ${issueAlias(number)}: issue(number: ${String(number)}) { ...facts }`).join('');
  const query = `query($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { nameWithOwner${issues} } }`
    + ` fragment facts on Issue { ${ISSUE_SELECTION} } fragment pull on PullRequest { ${PULL_FIELDS} }`;
  return graphqlArgs(query, []);
}

/** The argv reading one page of files of each pull request of `pages`, each under {@link pullAlias}. */
export function filesArgs(pages: readonly FilesPage[]): readonly string[] {
  const cursors = pages.map(({ number }) => `, $c${checkNumber(number)}: String`).join('');
  const pulls = pages.map(({ number }) => ` ${pullAlias(number)}: pullRequest(number: ${String(number)})`
    + ` { files(first: ${String(PAGE_SIZE)}, after: $c${String(number)})`
    + ' { pageInfo { hasNextPage endCursor } nodes { path changeType } } }').join('');
  const query = `query($owner: String!, $repo: String!${cursors}) { repository(owner: $owner, name: $repo) {${pulls} } }`;
  return graphqlArgs(query, pages.flatMap(({ number, cursor }) => cursor === null
    ? []
    : [[`c${String(number)}`, cursor] as const]));
}

/** The argv reading each fragment of `lookups` at its head and on its base, under {@link blobAliases}. */
export function blobsArgs(lookups: readonly FragmentLookup[]): readonly string[] {
  const aliases = lookups.map((_, index) => blobAliases(index));
  const declared = aliases.map(({ head, base }) => `, $${head}: String!, $${base}: String!`).join('');
  const objects = aliases.map(({ head, base }) => ` ${head}: object(expression: $${head}) { ... on Blob { text } }`
    + ` ${base}: object(expression: $${base}) { ... on Blob { oid } }`).join('');
  const query = `query($owner: String!, $repo: String!${declared}) { repository(owner: $owner, name: $repo) {${objects} } }`;
  return graphqlArgs(query, lookups.flatMap(({ path, headRefOid, baseRefName }, index) => {
    const { head, base } = aliases[index] ?? blobAliases(index);
    return [[head, `${headRefOid}:${path}`], [base, `${baseRefName}:${path}`]] as const;
  }));
}

/** `items` cut into runs of at most `size`, in order. */
export function batchesOf<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}
