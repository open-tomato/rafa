import type { FileKind } from './files';
import type { ImportGraph } from './import-graph';

import { describe, expect, it } from 'bun:test';

import { importTargets, reach, walkTest } from './test-index-walk';

const KINDS: Readonly<Record<string, FileKind>> = {
  'src/a.test.ts': 'test',
  'src/a.ts': 'source',
  'src/b.ts': 'source',
  'src/c.ts': 'source',
  'src/fixtures/helper.ts': 'test-support',
};

const GRAPH: ImportGraph = {
  nodes: Object.keys(KINDS).sort(),
  edges: [
    { from: 'src/a.test.ts', kind: 'value', to: 'src/a.ts' },
    { from: 'src/a.test.ts', kind: 'value', to: 'src/fixtures/helper.ts' },
    { from: 'src/a.ts', kind: 'type', to: 'src/b.ts' },
    { from: 'src/fixtures/helper.ts', kind: 'value', to: 'src/c.ts' },
  ],
  read: Object.keys(KINDS).sort(),
  unreached: [],
  unresolved: [],
};

const kindOf = (path: string): FileKind => KINDS[path] ?? 'source';

describe('the test walk', () => {
  it('reads each file\'s targets, edges of either kind, in the graph\'s order', () => {
    const next = importTargets(GRAPH);

    expect(next.get('src/a.test.ts')).toEqual(['src/a.ts', 'src/fixtures/helper.ts']);
    expect(next.get('src/a.ts')).toEqual(['src/b.ts']);
    expect(next.has('src/b.ts')).toBe(false);
  });

  it('reaches a file expand refuses but does not walk past it', () => {
    const next = importTargets(GRAPH);

    const stopped = reach(['src/a.test.ts'], next, (path) => path !== 'src/fixtures/helper.ts');
    const open = reach(['src/a.test.ts'], next, () => true);

    expect([...stopped].sort()).toEqual(['src/a.test.ts', 'src/a.ts', 'src/b.ts', 'src/fixtures/helper.ts']);
    expect(open.has('src/c.ts')).toBe(true);
  });

  it('stops the direct walk at a support file', () => {
    const walk = walkTest('src/a.test.ts', importTargets(GRAPH), kindOf);

    expect([...walk.direct].sort()).toEqual(['src/a.test.ts', 'src/a.ts', 'src/b.ts', 'src/fixtures/helper.ts']);
    expect(walk.direct.has('src/c.ts')).toBe(false);
  });

  it('reaches past the support file in the walk through support', () => {
    const walk = walkTest('src/a.test.ts', importTargets(GRAPH), kindOf);

    expect([...walk.throughSupport]).toEqual(['src/c.ts']);
  });

  it('counts a file the test reaches both ways as direct only', () => {
    const graph: ImportGraph = {
      ...GRAPH,
      edges: [...GRAPH.edges, { from: 'src/a.ts', kind: 'value', to: 'src/c.ts' }],
    };

    const walk = walkTest('src/a.test.ts', importTargets(graph), kindOf);

    expect(walk.direct.has('src/c.ts')).toBe(true);
    expect(walk.throughSupport.size).toBe(0);
  });

  it('walks past its start even when the start is a support file', () => {
    const walk = walkTest('src/fixtures/helper.ts', importTargets(GRAPH), kindOf);

    expect(walk.direct.has('src/c.ts')).toBe(true);
  });
});
