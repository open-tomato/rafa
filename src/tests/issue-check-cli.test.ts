/**
 * `rafa issue check <n> --output=json` spawned as `bun src/rafa.ts` over a
 * planted project and a saved copy of issue 151 under `.rafa/specs/`. The
 * copy names only files, so no `gh` read is made. Proves every reference
 * carries `kind`, `line`, `state` and `fingerprint`, and that `--stamp`
 * leaves a copy whose next check reads every reference `ok`.
 */
import type { CliEvent } from '../ports/index.js';

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { plantScratchRepo, runRafa } from './cli-capture.js';

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-issue-check-cli-')));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

const COPY = 'rafa-151-refs-check.md';
const BODY = [
  '# Refs check',
  '',
  'The change lives in `src/present.ts`.',
  'It once touched `src/gone/missing.ts`.',
  '',
].join('\n');

interface Row {
  readonly kind: string;
  readonly line: number;
  readonly state: string;
  readonly fingerprint: string;
}

/** The rows of the terminal result a json run wrote. */
function rowsOf(stdout: string): Row[] {
  const events = stdout.split('\n').filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as CliEvent);
  const result = events.find((event) => event.type === 'result');
  if (result?.type !== 'result' || !result.ok) throw new Error(`no ok result in: ${stdout}`);
  return (result.data as { references: Row[] }).references;
}

function plant(): { scratch: ReturnType<typeof plantScratchRepo>; copy: string } {
  const scratch = plantScratchRepo(tempRoot);
  mkdirSync(join(scratch.repo, 'src'), { recursive: true });
  writeFileSync(join(scratch.repo, 'src/present.ts'), 'export const present = 1;\n');
  const specs = join(scratch.repo, '.rafa/specs');
  mkdirSync(specs, { recursive: true });
  const copy = join(specs, COPY);
  writeFileSync(copy, BODY);
  return { scratch, copy };
}

describe('rafa issue check, spawned', () => {
  it('lists every reference with kind, line, state and fingerprint, exiting 0', () => {
    const { scratch } = plant();
    const run = runRafa(scratch, scratch.repo, ['issue', 'check', '151', '--output=json']);

    expect(run.exitCode).toBe(0);
    const rows = rowsOf(run.stdout);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(typeof row.kind).toBe('string');
      expect(row.kind).not.toBe('');
      expect(Number.isInteger(row.line)).toBe(true);
      expect(row.line).toBeGreaterThan(0);
      expect(typeof row.state).toBe('string');
      expect(row.fingerprint).not.toBe('');
    }
  });

  it('--stamp leaves a copy whose next check reads every reference ok', () => {
    const { scratch, copy } = plant();
    const stamped = runRafa(scratch, scratch.repo, ['issue', 'check', '151', '--stamp', '--output=json']);
    expect(stamped.exitCode).toBe(0);
    expect(readFileSync(copy, 'utf8')).toContain('<!-- rafa:refs');

    const next = runRafa(scratch, scratch.repo, ['issue', 'check', '151', '--output=json']);
    expect(next.exitCode).toBe(0);
    const rows = rowsOf(next.stdout);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.map((row) => row.state)).toEqual(rows.map(() => 'ok'));
  });
});
