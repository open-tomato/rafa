/**
 * Where rafa's own concepts live in its code: `bun scripts/survey/concepts.ts`
 * from the repository root writes `.rafa/survey/concepts.json` and
 * `.rafa/survey/concepts.md` through `survey-io.ts`.
 *
 * ## Seeds
 *
 * A CONCEPT is seeded from the tracked `context/*.md` pages, the docs
 * that already name what rafa is made of ({@link seedConcepts}):
 *
 * - every heading of every page, fenced code left out ({@link parseHeadings});
 * - every defined term of `context/terminology.md`, a bold span opening a
 *   line and followed by `is` or `are` ({@link parseTerms}).
 *
 * A heading that names a procedure rather than a thing ({@link PROCEDURE_HEADING}:
 * "What a test's HOME must hold", "Adding a notice") and a seed with no
 * searchable term are listed as skipped, never dropped silently. Two
 * seeds with one name are one concept holding both pages.
 *
 * ## Locating
 *
 * A seed's SEARCH TERMS ({@link searchTerms}) are its prose segments,
 * split at `:`, `,`, parentheses, dashes, `and` and `or`, with articles
 * left out, plus each of its code spans. Each term matches a source
 * file's path or text in any spelling a name takes ({@link termPattern}):
 * `Copy detection` finds `copyDetection`, `copy-detection.ts`,
 * `COPY_DETECTION` and the prose words, a trailing plural `s` optional.
 * A term shorter than {@link MIN_TERM_LETTERS} letters, or a single word
 * that every source file spells ({@link GENERIC_WORDS}: `import`,
 * `export`, …), is no term.
 *
 * The files searched are the ones `import-graph.ts` clusters, every
 * tracked non-test source under `src/` and `packages/`, grouped by the
 * cluster `.rafa/survey/import-graph.json` gives each ({@link NO_CLUSTER}
 * for a file in none), so `import-graph.ts` runs first.
 *
 * ## Concept boundaries apart from logic boundaries
 *
 * A cluster is a LOGIC boundary, drawn from the import graph; a concept
 * is a boundary drawn by the docs. The reading keeps the two apart: it
 * never renames a cluster after a concept nor assigns a concept to one
 * cluster. It writes the concept-by-cluster matrix (files per cell) and
 * reads each concept's {@link ConceptBoundary} from it: `absent` from
 * the code, `within` one cluster, or `crosses` several, with the share
 * its home cluster holds. A concept that crosses is one a cut along the
 * clusters would split.
 *
 * ## Coverage
 *
 * The files the script was meant to read are the context pages and the
 * source files. A file that is not valid UTF-8 cannot be read as text;
 * it is listed as unreadable and the coverage line names it as missed.
 */
import { realpathSync } from 'node:fs';
import { join } from 'node:path';

import { isSurveyedSource, SURVEY_SCOPE } from './import-graph.js';
import { listTrackedFiles, measureCoverage, writeSurvey } from './survey-io.js';
import { clustersFromGraph, loadImportGraph, NO_CLUSTER } from './test-index.js';

/** The folder of the context pages, relative to the repository root. */
export const CONTEXT_DIR = 'context';

/** The context page whose defined terms are seeds. */
export const TERMINOLOGY_PAGE = 'context/terminology.md';

/** A heading naming a procedure rather than a thing. */
export const PROCEDURE_HEADING = /^(what|how|where|why|when|adding|changing|for|tests?)\b/i;

/** The fewest letters a search term holds. */
export const MIN_TERM_LETTERS = 3;

/** The fewest letters a word holds for its trailing `s` to read as a plural (`rules`, never `bus`). */
const MIN_PLURAL_LETTERS = 5;

/** Single words every source file spells, never a term on their own. */
export const GENERIC_WORDS: ReadonlySet<string> = new Set([
  'import', 'imports', 'export', 'exports', 'type', 'types', 'default', 'return', 'function', 'class',
  'const', 'test', 'tests', 'string', 'true', 'false', 'null', 'from',
]);

/** Words left out of a term. */
const ARTICLES: ReadonlySet<string> = new Set(['the', 'a', 'an', 'its', 'their']);

/** Where a heading's prose splits into terms. */
const SEGMENT_BREAK = /[:,;()—–]|\s-\s|\band\b|\bor\b/i;

/** A code span. */
const CODE_SPAN = /`([^`]+)`/g;

/** A markdown heading. */
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/** A fence opening or closing a code block. */
const FENCE = /^\s*(```|~~~)/;

/** A defined term: a bold span opening a line, followed by `is` or `are`. */
const DEFINED_TERM = /^\*\*([^*]+)\*\*\s+(?:is|are)\b/;

/** Where a word may sit inside a name: at a non-letter, or at a camel-case hump. */
const WORD_START = '(?:(?<![A-Za-z0-9])|(?<=[a-z0-9])(?=[A-Z]))';

/** What may stand between two words of a name. */
const WORD_JOIN = '[\\s._/-]*';

/** A whole share's base. */
const PERCENT = 100;

/** Where a concept was seeded. */
export type SeedOrigin = 'heading' | 'term';

/** A concept seeded from the context pages. */
export interface Concept {
  /** The seed's text, code spans kept in backticks. */
  readonly name: string;
  readonly origin: SeedOrigin;
  /** The pages that seed it, sorted. */
  readonly pages: readonly string[];
  /** Its search terms, lowercase words joined by a space. */
  readonly terms: readonly string[];
}

/** A seed that is no concept, and why. */
export interface SkippedSeed {
  readonly name: string;
  readonly page: string;
  readonly reason: 'procedure' | 'no-term';
}

/** How a concept's files fall across the clusters. */
export type ConceptBoundary = 'absent' | 'within' | 'crosses';

/** One concept located in the source files. */
export interface ConceptReading extends Concept {
  /** The source files any of its terms matches, sorted. */
  readonly files: readonly string[];
  /** How many of its files each cluster holds; a cluster holding none is left out. */
  readonly byCluster: Readonly<Record<string, number>>;
  readonly boundary: ConceptBoundary;
  /** The cluster holding most of its files (the lower rank on a tie), or `null` when absent. */
  readonly home: string | null;
  /** The home cluster's share of its files, a whole percentage; 0 when absent. */
  readonly homeShare: number;
}

/** One cluster's concepts. */
export interface ClusterConcepts {
  readonly cluster: string;
  /** How many source files the cluster holds. */
  readonly files: number;
  /** How many concepts reach at least one of its files. */
  readonly concepts: number;
  /** The concepts whose home it is, by name. */
  readonly homed: readonly string[];
}

/** The reading written under `data` in `concepts.json`. */
export interface ConceptsData {
  /** The matrix's columns: `c1` to `c8` by rank, then {@link NO_CLUSTER}, each holding a file. */
  readonly clusters: readonly string[];
  readonly concepts: readonly ConceptReading[];
  readonly clusterConcepts: readonly ClusterConcepts[];
  readonly skipped: readonly SkippedSeed[];
  /** How many source files were searched. */
  readonly sources: number;
}

/** A file read as text. */
export interface TextFile {
  readonly path: string;
  readonly text: string;
}

/** The headings of a markdown page, fenced code left out. */
export function parseHeadings(markdown: string): { level: number; text: string }[] {
  let fenced = false;
  return markdown.split('\n').flatMap((line) => {
    if (FENCE.test(line)) {
      fenced = !fenced;
      return [];
    }
    const match = fenced
      ? null
      : HEADING.exec(line);
    return match === null
      ? []
      : [{ level: match[1]?.length ?? 0, text: match[2] ?? '' }];
  });
}

/** The defined terms of a markdown page: bold spans opening a line and followed by `is` or `are`. */
export function parseTerms(markdown: string): string[] {
  return markdown.split('\n').flatMap((line) => {
    const term = DEFINED_TERM.exec(line)?.[1]?.trim();
    return term === undefined
      ? []
      : [term];
  });
}

/** The lowercase words of `text`, camel-case humps split and articles left out. */
function wordsOf(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0 && !ARTICLES.has(word));
}

/** Whether `words` make a term: enough letters, and not one generic word. */
function isTerm(words: readonly string[]): boolean {
  const letters = words.join('').length;
  return letters >= MIN_TERM_LETTERS && !(words.length === 1 && GENERIC_WORDS.has(words[0] ?? ''));
}

/** The search terms of a seed's text: its prose segments and its code spans, each once. */
export function searchTerms(text: string): string[] {
  const spans = [...text.matchAll(CODE_SPAN)].map((match) => wordsOf(match[1] ?? ''));
  const segments = text
    .replace(/`/g, '')
    .split(SEGMENT_BREAK)
    .map(wordsOf);
  return [...new Set([...segments, ...spans].filter(isTerm).map((words) => words.join(' ')))];
}

/** One word as a pattern: either case at each letter, a trailing plural optional. */
function wordPattern(word: string): string {
  const stem = word.length >= MIN_PLURAL_LETTERS && word.endsWith('s') && !word.endsWith('ss')
    ? word.slice(0, -1)
    : word;
  const letters = [...stem].map((char) => /[a-z]/.test(char)
    ? `[${char}${char.toUpperCase()}]`
    : char).join('');
  return `${letters}(?:[sS]|[eE][sS])?`;
}

/**
 * The pattern matching `term` in any spelling a name takes: words joined
 * by nothing, a space, `.`, `_`, `/` or `-`, in any case, each starting
 * at a non-letter or at a camel-case hump and ending before a lowercase
 * letter or digit.
 */
export function termPattern(term: string): RegExp {
  const words = term.split(' ').filter((word) => word.length > 0);
  return new RegExp(`${WORD_START}${words.map(wordPattern).join(WORD_JOIN)}(?![a-z0-9])`);
}

/** The key two seeds share when they name one concept. */
function seedKey(name: string): string {
  return wordsOf(name.replace(/`/g, '')).join(' ');
}

/**
 * The concepts the context `pages` seed: each heading, and each defined
 * term of {@link TERMINOLOGY_PAGE}, with the seeds skipped and why.
 */
export function seedConcepts(pages: readonly TextFile[]): { concepts: Concept[]; skipped: SkippedSeed[] } {
  const seeds = [...pages].sort((a, b) => a.path.localeCompare(b.path)).flatMap((page) => [
    ...parseHeadings(page.text).map((heading) => ({ name: heading.text, origin: 'heading' as const, page: page.path })),
    ...(page.path === TERMINOLOGY_PAGE
      ? parseTerms(page.text).map((term) => ({ name: term, origin: 'term' as const, page: page.path }))
      : []),
  ]);
  const skipped: SkippedSeed[] = [];
  const byKey = new Map<string, Concept>();
  for (const seed of seeds) {
    const terms = searchTerms(seed.name);
    if (seed.origin === 'heading' && PROCEDURE_HEADING.test(seed.name.replace(/`/g, ''))) {
      skipped.push({ name: seed.name, page: seed.page, reason: 'procedure' });
      continue;
    }
    if (terms.length === 0) {
      skipped.push({ name: seed.name, page: seed.page, reason: 'no-term' });
      continue;
    }
    const key = seedKey(seed.name);
    const seen = byKey.get(key);
    byKey.set(key, seen === undefined
      ? { name: seed.name, origin: seed.origin, pages: [seed.page], terms }
      : { ...seen, pages: [...new Set([...seen.pages, seed.page])].sort() });
  }
  return { concepts: [...byKey.values()], skipped };
}

/** The cluster order: `c1` to `c8` by number, then {@link NO_CLUSTER}. */
function clusterRank(cluster: string): number {
  return cluster === NO_CLUSTER
    ? Number.MAX_SAFE_INTEGER
    : Number(cluster.slice(1));
}

/** One concept located in `sources`, each source's cluster read from `clusterOf`. */
function locateConcept(
  concept: Concept,
  sources: readonly TextFile[],
  clusterOf: ReadonlyMap<string, string>,
): ConceptReading {
  const patterns = concept.terms.map(termPattern);
  const files = sources
    .filter((source) => patterns.some((pattern) => pattern.test(source.path) || pattern.test(source.text)))
    .map((source) => source.path)
    .sort();
  const byCluster = files.reduce<Record<string, number>>((counts, path) => {
    const cluster = clusterOf.get(path) ?? NO_CLUSTER;
    return { ...counts, [cluster]: (counts[cluster] ?? 0) + 1 };
  }, {});
  const ranked = Object.entries(byCluster).sort((a, b) => b[1] - a[1] || clusterRank(a[0]) - clusterRank(b[0]));
  const [home] = ranked;
  const touched = ranked.length;
  return {
    ...concept,
    files,
    byCluster,
    boundary: touched === 0
      ? 'absent'
      : touched === 1
        ? 'within'
        : 'crosses',
    home: home?.[0] ?? null,
    homeShare: home === undefined
      ? 0
      : Math.round((PERCENT * home[1]) / files.length),
  };
}

/** The reading of `concepts` located in `sources`, grouped by `clusterOf`. */
export function readConcepts(
  seeded: { concepts: readonly Concept[]; skipped: readonly SkippedSeed[] },
  sources: readonly TextFile[],
  clusterOf: ReadonlyMap<string, string>,
): ConceptsData {
  const concepts = seeded.concepts.map((concept) => locateConcept(concept, sources, clusterOf));
  const sizes = sources.reduce<Map<string, number>>((counts, source) => {
    const cluster = clusterOf.get(source.path) ?? NO_CLUSTER;
    return new Map(counts).set(cluster, (counts.get(cluster) ?? 0) + 1);
  }, new Map());
  const clusters = [...sizes.keys()].sort((a, b) => clusterRank(a) - clusterRank(b));
  return {
    clusters,
    concepts,
    clusterConcepts: clusters.map((cluster) => ({
      cluster,
      files: sizes.get(cluster) ?? 0,
      concepts: concepts.filter((concept) => (concept.byCluster[cluster] ?? 0) > 0).length,
      homed: concepts.filter((concept) => concept.home === cluster).map((concept) => concept.name),
    })),
    skipped: seeded.skipped,
    sources: sources.length,
  };
}

/** A table cell holding `text`, its pipes escaped. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

/** The markdown summary's body, written after the coverage line. */
export function renderConcepts(data: ConceptsData): string {
  const count = (boundary: ConceptBoundary): number => data.concepts.filter((concept) => concept.boundary === boundary).length;
  const crossing = data.concepts
    .filter((concept) => concept.boundary === 'crosses')
    .sort((a, b) => Object.keys(b.byCluster).length - Object.keys(a.byCluster).length || a.homeShare - b.homeShare);
  return [
    '# Concepts',
    '',
    `${data.concepts.length} concepts seeded from the context page headings and the defined terms of `
      + `\`${TERMINOLOGY_PAGE}\`, located in ${data.sources} source files by their search terms. A cluster is `
      + 'a logic boundary, from the import graph; a concept is a boundary the docs draw. Neither is read as the '
      + 'other: the matrix counts the files of each concept in each cluster.',
    '',
    `Absent from the code: ${count('absent')}. Within one cluster: ${count('within')}. `
      + `Crossing clusters: ${count('crosses')}.`,
    '',
    '## Concept by cluster',
    '',
    `| Concept | Pages | Files | ${data.clusters.join(' | ')} | Boundary |`,
    `| --- | --- | --- | ${data.clusters.map(() => '---').join(' | ')} | --- |`,
    ...data.concepts.map((concept) => `| ${cell(concept.name)} | ${concept.pages.map((page) => page.replace(`${CONTEXT_DIR}/`, '')).join(', ')} `
      + `| ${concept.files.length} | ${data.clusters.map((cluster) => concept.byCluster[cluster] ?? 0).join(' | ')} `
      + `| ${concept.boundary} |`),
    '',
    '## Concepts crossing logic boundaries',
    '',
    'Each concept a cut along the clusters would split, the most clusters first: its home cluster and the share '
      + 'of its files there.',
    '',
    ...crossing.map((concept) => `- ${concept.name}: ${Object.keys(concept.byCluster).length} clusters, `
      + `home ${concept.home} with ${concept.homeShare}%`),
    '',
    '## Clusters by concept',
    '',
    '| Cluster | Files | Concepts reaching it | Concepts homed |',
    '| --- | --- | --- | --- |',
    ...data.clusterConcepts.map((cluster) => `| ${cluster.cluster} | ${cluster.files} | ${cluster.concepts} `
      + `| ${cluster.homed.length} |`),
    '',
    '## Seeds skipped',
    '',
    ...data.skipped.map((seed) => `- ${seed.name} (\`${seed.page}\`): ${seed.reason}`),
  ].join('\n');
}

/** The text of each of `paths` under `repoRoot`; a file that is not valid UTF-8 is left out. */
export async function readTextFiles(repoRoot: string, paths: readonly string[]): Promise<TextFile[]> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const files = await Promise.all(paths.map(async (path): Promise<TextFile | null> => {
    try {
      return { path, text: decoder.decode(await Bun.file(join(repoRoot, path)).bytes()) };
    } catch {
      return null;
    }
  }));
  return files.filter((file) => file !== null);
}

/** Seeds, locates and writes the concept map of the repository at `repoRoot`. */
export async function surveyConcepts(repoRoot: string): Promise<ConceptsData> {
  const realRoot = realpathSync(repoRoot);
  const clusterOf = clustersFromGraph(await loadImportGraph(realRoot));
  const pagePaths = (await listTrackedFiles(realRoot, [CONTEXT_DIR])).filter((path) => path.endsWith('.md'));
  if (pagePaths.length === 0) {
    throw new Error(`${CONTEXT_DIR}/ holds no tracked page to seed concepts from`);
  }
  const sourcePaths = (await listTrackedFiles(realRoot, SURVEY_SCOPE)).filter(isSurveyedSource);
  const pages = await readTextFiles(realRoot, pagePaths);
  const sources = await readTextFiles(realRoot, sourcePaths);
  const data = readConcepts(seedConcepts(pages), sources, clusterOf);
  await writeSurvey(realRoot, 'concepts', {
    data,
    markdown: renderConcepts(data),
    coverage: measureCoverage([...pagePaths, ...sourcePaths], [...pages, ...sources].map((file) => file.path)),
  });
  return data;
}

if (import.meta.main) {
  try {
    const data = await surveyConcepts(process.cwd());
    const crossing = data.concepts.filter((concept) => concept.boundary === 'crosses').length;
    console.log(`[concepts] ${data.concepts.length} concepts over ${data.sources} files, ${crossing} crossing clusters`);
  } catch (err) {
    console.error(`[concepts] FAIL — ${err instanceof Error
      ? err.message
      : String(err)}`);
    process.exit(1);
  }
}
