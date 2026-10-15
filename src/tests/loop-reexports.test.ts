import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

import * as hops from '../core/loop/hops.js';
import * as loop from '../core/loop/index.js';
import * as sessionRecordParse from '../loop/session-record-parse.js';
import { asHopRecord } from '../next/hop-record.js';
import { asPlace } from '../project/position.js';
import * as sessionEnv from '../utils/session-env.js';

interface CutTable {
  readonly packages: readonly {
    readonly name: string;
    readonly edges: readonly { readonly from: string }[];
  }[];
}

describe('loop group re-exports', () => {
  test('session-env.ts re-exports the loop barrel bindings', () => {
    expect(sessionEnv.sessionPath).toBe(loop.sessionPath);
    expect(sessionEnv.sessionSpawnEnv).toBe(loop.sessionSpawnEnv);
  });

  test('session-record-parse.ts re-exports the loop barrel bindings', () => {
    expect(sessionRecordParse.isPositiveWhole).toBe(loop.isPositiveWhole);
    expect(sessionRecordParse.RECORD_EXTENSION).toBe(loop.RECORD_EXTENSION);
  });

  test('position.ts and hop-record.ts re-export the loop barrel bindings', () => {
    expect(asPlace).toBe(hops.asPlace);
    expect(asHopRecord).toBe(hops.asHopRecord);
  });

  test('suite/run.ts re-exports SuiteFailure as a type only, leaving no runtime name', async () => {
    const run = await import('../suite/run.js');
    expect('SuiteFailure' in run).toBe(false);
  });
});

describe('cut table', () => {
  test('lists no edge of @open-tomato/rafa from src/core/loop/', () => {
    const table = JSON.parse(readFileSync('docs/survey/cut-table.json', 'utf8')) as CutTable;
    const core = table.packages.find((p) => p.name === '@open-tomato/rafa');
    expect(core).toBeDefined();
    const fromLoop = (core?.edges ?? []).filter((e) => e.from.startsWith('src/core/loop/'));
    expect(fromLoop).toEqual([]);
  });
});
