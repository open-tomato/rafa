/**
 * The walks of the test index along the import graph: each file's import
 * targets ({@link importTargets}), the files reachable from a start
 * ({@link reach}), and a test's two walks, up to its support files and
 * on past them ({@link walkTest}). `test-index.ts` reads each test's
 * folders from them, and the bin's spawned reach in `packageRules`; how
 * those readings count is its module note.
 */

import type { FileKind } from './files';
import type { ImportGraph } from './import-graph';

/**
 * Each file's import targets, edges of either kind, in the graph's order.
 *
 * @param graph - The import graph.
 * @returns The targets of each file that imports one.
 */
export function importTargets(graph: ImportGraph): Map<string, string[]> {
  const next = new Map<string, string[]>();
  for (const edge of graph.edges) {
    next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to]);
  }
  return next;
}

/**
 * Every file reachable from `starts` along `next`, the starts included.
 * A file `expand` refuses is reached but not walked past.
 *
 * @param starts - The files the walk begins at.
 * @param next - Each file's import targets.
 * @param expand - Whether the walk goes on past a file.
 * @returns The files reached.
 */
export function reach(
  starts: Iterable<string>,
  next: ReadonlyMap<string, readonly string[]>,
  expand: (path: string) => boolean,
): Set<string> {
  const seen = new Set(starts);
  const queue = [...seen];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const path = queue[cursor] ?? '';
    if (!expand(path)) {
      continue;
    }
    for (const target of next.get(path) ?? []) {
      if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return seen;
}

/** What one test's two walks reach. */
export interface TestWalk {
  /** Files reached without passing a support file, the test included. */
  readonly direct: ReadonlySet<string>;
  /** Files reached only past a support file. */
  readonly throughSupport: ReadonlySet<string>;
}

/**
 * Walks from a test file: first up to the support files, then on past them.
 *
 * @param test - The test file.
 * @param next - Each file's import targets.
 * @param kindOf - Each file's kind.
 * @returns What the walk reaches directly and only through support files.
 */
export function walkTest(test: string, next: ReadonlyMap<string, readonly string[]>, kindOf: (path: string) => FileKind): TestWalk {
  const direct = reach([test], next, (path) => path === test || kindOf(path) !== 'test-support');
  const support = [...direct].filter((path) => kindOf(path) === 'test-support');
  const past = reach(support, next, () => true);
  return { direct, throughSupport: new Set([...past].filter((path) => !direct.has(path))) };
}
