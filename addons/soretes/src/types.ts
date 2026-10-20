/**
 * The data contract lives in `contract/types.ts`; this file adds the rafa
 * producer's own node shape, the fields `configs/rafa.ts` binds to.
 */
export type { GraphEdge, GraphNode, Snapshot } from './contract/types.ts';

export type EntityType = string;
export type EdgeKind = string;

export interface FindingRef {
  readonly kind: string;
  readonly what: string;
  readonly plan: string;
}

export interface NodeStats {
  readonly files: number;
  readonly tests: number;
  readonly loc: number;
  readonly findings: number;
  readonly gotchas: number;
  readonly patterns: number;
  readonly bugs: number;
  readonly blockers: number;
  readonly changes: number;
  readonly plans: number;
}

/** A type alias, not an interface, so it fits the contract's open `[field: string]: unknown`. */
export type RafaNode = {
  readonly id: string;
  readonly label: string;
  readonly type: 'package' | 'module' | 'bucket' | 'store';
  readonly group: string;
  readonly path: string;
  readonly legend: string;
  readonly stats: NodeStats;
  readonly externalDeps: readonly string[];
  readonly docs: readonly string[];
  readonly plans: readonly string[];
  readonly hotFiles: readonly { readonly path: string; readonly count: number }[];
  readonly topFindings: readonly FindingRef[];
  readonly topBugs: readonly FindingRef[];
  readonly lastTouched: string | null;
};
