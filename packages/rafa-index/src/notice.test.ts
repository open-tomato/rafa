/**
 * The fallback helper (`notice.ts`): a request left alone when vector
 * search is on or it asks for `fts`, then `vector` and `hybrid` turned
 * into `fts` when it is off, and the notice written once per process.
 * The once-only cases run in spawned `bun` children, so each starts
 * with no notice written; a control child shows a fresh process does
 * write it, so a child's silence is the helper's work.
 */
import type { IndexSearchRequest } from './search.js';

import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { fallbackRequest, noticeLine, UNKNOWN_WHY } from './notice.js';

const NOTICE_MODULE = join(import.meta.dir, 'notice.ts');

/** Runs `body` in a fresh bun child with 'fallbackRequest' imported; answers its stdout lines. */
function inChild(body: string): string[] {
  const script = `import { fallbackRequest } from ${JSON.stringify(NOTICE_MODULE)};\nconst w = (l) => console.log(l);\n${body}`;
  const child = Bun.spawnSync([process.execPath, '-e', script]);
  expect(child.exitCode).toBe(0);
  return child.stdout
    .toString()
    .split('\n')
    .filter((line) => line !== '');
}

describe('fallbackRequest', () => {
  it('leaves every mode alone when vector search is on, writing nothing', () => {
    const lines: string[] = [];
    for (const mode of ['fts', 'vector', 'hybrid'] as const) {
      const request: IndexSearchRequest = { mode, query: 'q', limit: 5 };
      expect(fallbackRequest(request, { vector: true, why: null }, (l) => lines.push(l))).toBe(request);
    }
    expect(lines).toEqual([]);
  });

  it('leaves an fts request alone when vector search is off', () => {
    const request: IndexSearchRequest = { mode: 'fts', query: 'q' };
    expect(fallbackRequest(request, { vector: false, why: 'x' }, () => {})).toBe(request);
  });

  it('turns vector and hybrid into fts when vector search is off, keeping the rest', () => {
    for (const mode of ['vector', 'hybrid'] as const) {
      const request: IndexSearchRequest = { mode, query: 'q', limit: 7 };
      const answered = fallbackRequest(request, { vector: false, why: 'x' }, () => {});
      expect(answered).toEqual({ mode: 'fts', query: 'q', limit: 7 });
      expect(request.mode).toBe(mode);
    }
  });

  it('spells the notice line, with a stand-in why when none is given', () => {
    expect(noticeLine('no sqlite-vec')).toBe(
      'hub index: vector search is off on this hub (no sqlite-vec); answering with full text',
    );
    expect(noticeLine(null)).toContain(`(${UNKNOWN_WHY})`);
  });

  it('control: a fresh process writes the notice on its first fallback', () => {
    expect(inChild('fallbackRequest({ mode: "vector", query: "q" }, { vector: false, why: "w1" }, w);'))
      .toEqual([noticeLine('w1')]);
  });

  it('writes the notice once per process, across requests and writers', () => {
    const lines = inChild([
      'fallbackRequest({ mode: "vector", query: "q" }, { vector: false, why: "w1" }, w);',
      'fallbackRequest({ mode: "hybrid", query: "q" }, { vector: false, why: "w2" }, w);',
      'fallbackRequest({ mode: "vector", query: "q" }, { vector: false, why: "w3" }, (l) => console.log("other " + l));',
    ].join('\n'));
    expect(lines).toEqual([noticeLine('w1')]);
  });

  it('writes nothing in a process that never falls back', () => {
    expect(inChild([
      'fallbackRequest({ mode: "fts", query: "q" }, { vector: false, why: "w1" }, w);',
      'fallbackRequest({ mode: "vector", query: "q" }, { vector: true, why: null }, w);',
    ].join('\n'))).toEqual([]);
  });
});
