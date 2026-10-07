/**
 * The survey's concept map: the concepts the `context/` pages name, and
 * the files whose module notes or TSDoc name each one. Run from the
 * repository root, `bun scripts/survey/concepts.ts` writes
 * `docs/survey/concepts.json` and `docs/survey/concepts.md`.
 *
 * Concepts are seeded from each tracked `context/*.md` page, three ways:
 *
 *   - `page`: the page itself, named by its first heading and matched by
 *     that heading or by the page's path (`context/inventory.md`);
 *   - `heading`: each heading, at any level;
 *   - `bold`: each `**bold**` span, a span wrapped across lines included.
 *
 * A seed's text loses its markdown (backticks, `\` escapes) and its
 * trailing `.`, `:`, `;` or `,`, then is lower-cased with its whitespace
 * collapsed; a heading also loses a leading `the`, `a` or `an`. Seeds
 * that come out equal, on one page or across pages, are one concept that
 * lists every page and origin it came from. A seed shorter than three
 * characters is dropped. A bold sentence is kept as it is, so it is
 * named only by a comment that repeats it, and usually lands among the
 * concepts no file names.
 *
 * A file names a concept when the text of its `/** … *\/` comments, the
 * module note and every TSDoc block, holds one of the concept's terms
 * between word boundaries. The comment text is read the same way the
 * seeds are: markdown and the leading `*` of each line dropped, lower
 * case, whitespace collapsed. Comments are read from a TypeScript parse,
 * so a `/**` inside a string is not one. Every tracked file in scope is
 * read, tests included.
 *
 * Each concept lists the clusters its files fall in, taken from the same
 * `c<NN>-<stem>` clusters `import-graph.ts` names; `main` builds that graph
 * again rather than reading `docs/survey/import-graph.json`, so the two
 * scripts can run in either order.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

import { coverageLine, listTrackedFiles } from './files';
import {
  OUTPUT_DIR,
  buildImportGraph,
  bunResolver,
  readMetafile,
  stableJson,
  surveyImportGraph,
} from './import-graph';

/** Where a concept was seeded from on a page. */
export type ConceptOrigin = 'bold' | 'heading' | 'page';

/** One `context/` page, as text. */
export interface ContextPage {
  /** The repository-relative path, `context/<name>.md`. */
  readonly path: string;
  /** The page's markdown. */
  readonly text: string;
}

/** One concept, seeded from one or more pages. */
export interface Concept {
  /** The normalized seed: the concept's identity. */
  readonly key: string;
  /** The seed as the first page to give it writes it, markdown dropped. */
  readonly name: string;
  /** The ways it was seeded, sorted. */
  readonly origins: readonly ConceptOrigin[];
  /** The pages that seed it, sorted. */
  readonly pages: readonly string[];
  /** The normalized texts a comment must hold to name it, sorted. */
  readonly terms: readonly string[];
}

/** A concept with the files that name it and the clusters those span. */
export interface MappedConcept extends Concept {
  /** The files whose comments name it, sorted. */
  readonly files: readonly string[];
  /** The clusters those files lie in, sorted. */
  readonly clusters: readonly string[];
}

/** What the map is built from, all of it passed in as data. */
export interface ConceptMapInput {
  /** The `context/` pages. */
  readonly pages: readonly ContextPage[];
  /** The comment text of each file read, as `docComments` returns it. */
  readonly comments: ReadonlyMap<string, string>;
  /** The cluster each file lies in. */
  readonly clusterOf: ReadonlyMap<string, string>;
}

/** The map both outputs show. */
export interface ConceptMap {
  /** Every concept, sorted by key. */
  readonly concepts: readonly MappedConcept[];
  /** The files whose comments were read, sorted. */
  readonly read: readonly string[];
  /** The pages seeded from, sorted. */
  readonly pages: readonly string[];
}

const MIN_TERM_LENGTH = 3;
const LEADING_ARTICLE = /^(?:the|a|an)\s+/;
const TRAILING_PUNCTUATION = /[.:;,]+$/;
const WORD_CHARACTER = 'a-z0-9_';

/**
 * Drops a text's markdown: backticks, `\` escapes and emphasis stars.
 *
 * @param text - Markdown text.
 * @returns The text as a reader sees it.
 */
function plainText(text: string): string {
  return text.replace(/\\(.)/g, '$1').replace(/[`*]/g, '');
}

/**
 * Brings a seed or a comment to the form terms are matched in: markdown
 * dropped, lower case, whitespace collapsed, trailing punctuation dropped.
 *
 * @param text - A seed or a comment's text.
 * @returns The normalized text.
 */
export function normalizeTerm(text: string): string {
  return plainText(text)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(TRAILING_PUNCTUATION, '')
    .trim();
}

/** One seed read off a page, before seeds are merged. */
interface Seed {
  readonly key: string;
  readonly name: string;
  readonly origin: ConceptOrigin;
  readonly page: string;
  readonly terms: readonly string[];
}

/**
 * Reads the seeds of one page: the page, its headings and its bold spans.
 * Lines inside a fenced code block are skipped.
 *
 * @param page - The page.
 * @returns Its seeds, in page order; the page's own seed first.
 */
export function pageSeeds(page: ContextPage): Seed[] {
  const prose: string[] = [];
  let inFence = false;
  for (const line of page.text.split('\n')) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) {
      prose.push(line);
    }
  }
  const headings = prose
    .map((line) => /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1])
    .filter((heading): heading is string => heading !== undefined);
  const stem = page.path.replace(/^.*\//, '').replace(/\.md$/, '');
  const title = headings[0] ?? stem;
  const seeds: Seed[] = [{
    key: normalizeTerm(title).replace(LEADING_ARTICLE, ''),
    name: plainText(title).trim(),
    origin: 'page',
    page: page.path,
    terms: [normalizeTerm(page.path)],
  }];
  for (const heading of headings) {
    seeds.push({
      key: normalizeTerm(heading).replace(LEADING_ARTICLE, ''),
      name: plainText(heading).trim(),
      origin: 'heading',
      page: page.path,
      terms: [],
    });
  }
  for (const match of prose.join('\n').matchAll(/\*\*([^*]+?)\*\*/g)) {
    const bold = match[1] ?? '';
    seeds.push({
      key: normalizeTerm(bold),
      name: plainText(bold)
        .replace(/\s+/g, ' ')
        .trim(),
      origin: 'bold',
      page: page.path,
      terms: [],
    });
  }
  return seeds.filter((seed) => seed.key.length >= MIN_TERM_LENGTH);
}

/**
 * Seeds the concepts of every page and merges seeds with one key.
 *
 * @param pages - The `context/` pages, in any order.
 * @returns The concepts, sorted by key, every list in each sorted.
 */
export function seedConcepts(pages: readonly ContextPage[]): Concept[] {
  const byKey = new Map<string, { name: string; origins: Set<ConceptOrigin>; pages: Set<string>; terms: Set<string> }>();
  const sortedPages = [...pages].sort((left, right) => compareText(left.path, right.path));
  for (const page of sortedPages) {
    for (const seed of pageSeeds(page)) {
      const concept = byKey.get(seed.key) ?? { name: seed.name, origins: new Set(), pages: new Set(), terms: new Set([seed.key]) };
      concept.origins.add(seed.origin);
      concept.pages.add(seed.page);
      seed.terms.forEach((term) => concept.terms.add(term));
      byKey.set(seed.key, concept);
    }
  }
  return [...byKey]
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, concept]) => ({
      key,
      name: concept.name,
      origins: [...concept.origins].sort(),
      pages: [...concept.pages].sort(),
      terms: [...concept.terms].sort(),
    }));
}

/**
 * The text of a source file's `/** … *\/` comments, the module note and
 * every TSDoc block, normalized as terms are. Comments are found through a
 * parse, so comment-like text in a string or a template is not read.
 *
 * @param path - The file's path; its extension picks the parser's script kind.
 * @param text - The file's source text.
 * @returns The comments' text, joined by a blank, normalized.
 */
export function docComments(path: string, text: string): string {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false);
  const seen = new Map<number, string>();
  const collect = (position: number): void => {
    for (const range of ts.getLeadingCommentRanges(text, position) ?? []) {
      const body = text.slice(range.pos, range.end);
      if (body.startsWith('/**') && !seen.has(range.pos)) {
        seen.set(range.pos, body);
      }
    }
  };
  const visit = (node: ts.Node): void => {
    collect(node.pos);
    ts.forEachChild(node, visit);
  };
  visit(source);
  collect(source.endOfFileToken.pos);
  const bodies = [...seen]
    .sort(([left], [right]) => left - right)
    .map(([, body]) => body
      .replace(/^\/\*\*/, '')
      .replace(/\*\/$/, '')
      .replace(/^\s*\*/gm, ''));
  return normalizeTerm(bodies.join(' '));
}

/**
 * Whether a normalized comment holds a term between word boundaries.
 *
 * @param comments - Text from `docComments`.
 * @param term - A normalized term.
 * @returns `true` when the term is there, not inside a longer word.
 */
export function namesTerm(comments: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![${WORD_CHARACTER}])${escaped}(?![${WORD_CHARACTER}])`).test(comments);
}

/**
 * Maps every concept the pages seed to the files whose comments name it,
 * and the clusters those files lie in. Pure: the caller reads the pages,
 * the comments and the clusters (see `main`).
 *
 * @param input - The pages, each file's comment text, and each file's cluster.
 * @returns The map, every list sorted.
 */
export function mapConcepts(input: ConceptMapInput): ConceptMap {
  const read = [...input.comments.keys()].sort();
  const concepts = seedConcepts(input.pages).map((concept) => {
    const files = read.filter((path) => {
      const comments = input.comments.get(path) ?? '';
      return concept.terms.some((term) => namesTerm(comments, term));
    });
    const clusters = [...new Set(files.map((path) => input.clusterOf.get(path) ?? ''))]
      .filter((cluster) => cluster !== '')
      .sort();
    return { ...concept, clusters, files };
  });
  const pages = input.pages.map((page) => page.path).sort();
  return { concepts, pages, read };
}

/**
 * Compares two strings by UTF-16 code unit, the order `sort` gives.
 *
 * @param left - One string.
 * @param right - The other.
 * @returns A negative, zero or positive number.
 */
function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right
    ? -1
    : 1;
}

/**
 * The map as `docs/survey/concepts.json` holds it.
 *
 * @param map - The concept map.
 * @returns The JSON text: sorted keys, two-space indent, a closing newline.
 */
export function renderConceptsJson(map: ConceptMap): string {
  return stableJson({
    concepts: map.concepts,
    pages: map.pages,
    read: map.read,
  });
}

/**
 * Escapes a pipe so a value stays in its markdown table cell.
 *
 * @param text - A cell's text.
 * @returns The text with every `|` escaped.
 */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

/**
 * The map as `docs/survey/concepts.md` holds it: the coverage line, the
 * concepts some file names, most files first, with the clusters they span,
 * and the concepts no file names.
 *
 * @param map - The concept map.
 * @param tracked - The tracked files in scope, for the coverage line.
 * @returns The markdown text, ending in a newline.
 */
export function renderConceptsMarkdown(map: ConceptMap, tracked: readonly string[]): string {
  const named = map.concepts
    .filter((concept) => concept.files.length > 0)
    .sort((left, right) => right.files.length - left.files.length || compareText(left.key, right.key));
  const unnamed = map.concepts.filter((concept) => concept.files.length === 0);
  const pageCell = (concept: Concept): string => concept.pages.map((page) => `\`${page}\``).join(', ');
  const lines = [
    '# Concepts',
    '',
    coverageLine(map.read, tracked),
    '',
    `${map.concepts.length} concepts seeded from ${map.pages.length} \`context/\` pages (each page, its headings and its `
    + `bold terms); ${named.length} are named by the module note or TSDoc of at least one file, ${unnamed.length} by none.`,
    '',
    '## Concepts by file count',
    '',
    '| Concept | Files | Clusters | Pages |',
    '| --- | --- | --- | --- |',
    ...named.map((concept) => `| ${cell(concept.name)} | ${concept.files.length} | ${concept.clusters.length}: `
      + `${concept.clusters.map((cluster) => `\`${cluster}\``).join(', ')} | ${pageCell(concept)} |`),
    '',
    '## Concepts named by no file',
    '',
    '| Concept | Origin | Pages |',
    '| --- | --- | --- |',
    ...unnamed.map((concept) => `| ${cell(concept.name)} | ${concept.origins.join(', ')} | ${pageCell(concept)} |`),
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * The tracked `context/*.md` pages of a repository, sorted.
 *
 * @param root - The repository root.
 * @returns Their repository-relative paths.
 * @throws When `git ls-files` cannot run or exits non-zero.
 */
export function listContextPages(root: string): string[] {
  const result = Bun.spawnSync(['git', 'ls-files', '-z', '--', 'context'], { cwd: root, stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`git ls-files failed in ${root} (exit ${result.exitCode}): ${result.stderr.toString().trim()}`);
  }
  return result.stdout
    .toString()
    .split('\0')
    .filter((path) => /^context\/[^/]+\.md$/.test(path))
    .sort();
}

/**
 * Reads the repository at `root` and writes both outputs under
 * `docs/survey/`. The clusters come from the import graph, built here
 * as `import-graph.ts` builds it.
 *
 * @param root - The repository root.
 * @returns The paths written, relative to `root`.
 */
export async function main(root: string): Promise<string[]> {
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
  const comments = new Map([...sources].map(([path, text]) => [path, docComments(path, text)]));
  const pages: ContextPage[] = [];
  for (const path of listContextPages(root)) {
    pages.push({ path, text: await Bun.file(join(root, path)).text() });
  }
  const map = mapConcepts({ clusterOf, comments, pages });
  mkdirSync(join(root, OUTPUT_DIR), { recursive: true });
  const jsonPath = `${OUTPUT_DIR}/concepts.json`;
  const markdownPath = `${OUTPUT_DIR}/concepts.md`;
  writeFileSync(join(root, jsonPath), renderConceptsJson(map));
  writeFileSync(join(root, markdownPath), renderConceptsMarkdown(map, tracked.all));
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
