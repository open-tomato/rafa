/**
 * What each workspace package is made of, measured on 2026-11-02 by walking
 * the member folders (node_modules, dist and .tsbuild skipped): lines of
 * source (.ts/.tsx/.js/.css/.html), tests (*.test.ts and tests/ folders),
 * docs (markdown and docs/), config (json, toml, yaml, mjs and the rest) and
 * fixtures (fixtures/, snapshots, stubs). `deps` counts external runtime
 * dependencies declared by the package itself (most are hoisted to the root).
 */
import type { ChartTone, RoseSlice, SunburstNode } from '@open-tomato/charts';

import { LAYER_OF, LAYER_TONES } from './graph.js';

export interface PackageComposition {
  id: string;
  source: number;
  tests: number;
  docs: number;
  config: number;
  fixtures: number;
  deps: number;
}

export const PACKAGE_COMPOSITION: PackageComposition[] = [
  { id: 'rafa-core', source: 50_381, tests: 44_383, docs: 45, config: 45_517, fixtures: 27, deps: 0 },
  { id: 'rafa-board', source: 50_989, tests: 41_187, docs: 120, config: 123, fixtures: 0, deps: 0 },
  { id: 'rafa-run', source: 32_607, tests: 34_637, docs: 0, config: 115, fixtures: 0, deps: 0 },
  { id: 'rafa-pr', source: 24_694, tests: 24_707, docs: 373, config: 8_256, fixtures: 0, deps: 0 },
  { id: 'rafa-inventory', source: 18_066, tests: 15_186, docs: 58, config: 141, fixtures: 0, deps: 0 },
  { id: 'rafa-release', source: 14_287, tests: 12_536, docs: 426, config: 567, fixtures: 0, deps: 0 },
  { id: 'rafa-effort', source: 8_364, tests: 6_101, docs: 0, config: 77, fixtures: 0, deps: 0 },
  { id: 'rafa-hub', source: 3_037, tests: 3_066, docs: 93, config: 119, fixtures: 0, deps: 0 },
  { id: 'rafa-sync-service', source: 1_116, tests: 1_144, docs: 145, config: 83, fixtures: 0, deps: 0 },
  { id: 'rafa-eslint-config', source: 0, tests: 184, docs: 0, config: 476, fixtures: 0, deps: 14 },
  { id: 'atlas-data', source: 65, tests: 0, docs: 11, config: 55, fixtures: 0, deps: 2 },
  { id: 'rafa-typescript-config', source: 0, tests: 59, docs: 0, config: 64, fixtures: 0, deps: 0 },
  { id: 'atlas-transport', source: 31, tests: 0, docs: 10, config: 56, fixtures: 0, deps: 0 },
  { id: 'rafa-atlas', source: 9, tests: 0, docs: 11, config: 66, fixtures: 0, deps: 0 },
  { id: 'atlas-demo', source: 3, tests: 0, docs: 11, config: 67, fixtures: 0, deps: 2 },
  { id: 'atlas-visualization', source: 3, tests: 0, docs: 11, config: 66, fixtures: 0, deps: 0 },
];

export const COMPONENT_KINDS = ['source', 'tests', 'docs', 'config', 'fixtures'] as const;
export type ComponentKind = typeof COMPONENT_KINDS[number];

export const COMPONENT_TONES: Record<ComponentKind, ChartTone> = {
  source: 'series-1',
  tests: 'series-3',
  docs: 'series-5',
  config: 'series-4',
  fixtures: 'series-7',
};

export function totalLines(pkg: PackageComposition): number {
  return pkg.source + pkg.tests + pkg.docs + pkg.config + pkg.fixtures;
}

/** One slice per package, radius by total lines, tone by layer. */
export const SIZE_ROSE: RoseSlice[] = PACKAGE_COMPOSITION
  .filter((pkg) => totalLines(pkg) >= 1_000)
  .map((pkg) => ({ id: pkg.id, label: pkg.id.replace(/^rafa-/, ''), value: totalLines(pkg), group: LAYER_OF[pkg.id] ?? 'addon' }));

export const SIZE_ROSE_TONES: Record<string, ChartTone> = LAYER_TONES;

/** Inner ring: the packages; outer ring: what each one is made of. */
export const COMPOSITION_SUNBURST: SunburstNode[] = PACKAGE_COMPOSITION
  .filter((pkg) => totalLines(pkg) >= 1_000)
  .map((pkg) => ({
    id: pkg.id,
    label: pkg.id.replace(/^rafa-/, ''),
    group: LAYER_OF[pkg.id] ?? 'addon',
    children: COMPONENT_KINDS
      .filter((kind) => pkg[kind] > 0)
      .map((kind) => ({ id: `${pkg.id}/${kind}`, label: kind, value: pkg[kind], group: kind })),
  }));

export const COMPOSITION_TONES: Record<string, ChartTone> = { ...LAYER_TONES, ...COMPONENT_TONES };
