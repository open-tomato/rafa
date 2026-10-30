import type { FileMove } from './types';

/**
 * The first decouple item of the monorepo migration (#808), between pass 3
 * and pass 4: the nine files that reach nothing but core and each other,
 * each moved to the same path below `packages/rafa/`, pass 1's path rule
 * for core. Sorted by `from`; each colocated test moves with its file.
 *
 * The back edges the nine end: effort to board (`src/board/naming.ts`,
 * through `src/effort/epic-cost.ts`), effort to pr (`src/triage/doc-only.ts`,
 * through `src/effort/report-doc-bugs.ts`), board to pr
 * (`src/triage/doc-only.ts` and `src/triage/local-paths.ts`), pr to run
 * (`src/start/worktree-dir.ts`), board to release
 * (`src/release/fragment.ts`), and inventory's value imports of effort
 * (`src/schema/frontmatter.ts`, `src/utils/agent-definition.ts`,
 * `src/effort/session-log.ts` and `src/effort/session-log-dirs.ts`).
 */
export const DECOUPLE_1_MOVES: readonly FileMove[] = [
  { from: 'src/board/naming.ts', to: 'packages/rafa/src/board/naming.ts' },
  { from: 'src/effort/session-log-dirs.ts', to: 'packages/rafa/src/effort/session-log-dirs.ts' },
  { from: 'src/effort/session-log.ts', to: 'packages/rafa/src/effort/session-log.ts' },
  { from: 'src/release/fragment.ts', to: 'packages/rafa/src/release/fragment.ts' },
  { from: 'src/schema/frontmatter.ts', to: 'packages/rafa/src/schema/frontmatter.ts' },
  { from: 'src/start/worktree-dir.ts', to: 'packages/rafa/src/start/worktree-dir.ts' },
  { from: 'src/triage/doc-only.ts', to: 'packages/rafa/src/triage/doc-only.ts' },
  { from: 'src/triage/local-paths.ts', to: 'packages/rafa/src/triage/local-paths.ts' },
  { from: 'src/utils/agent-definition.ts', to: 'packages/rafa/src/utils/agent-definition.ts' },
];
