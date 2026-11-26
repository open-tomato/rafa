/**
 * `rafa effort sync` run by the real CLI: `bun src/rafa.ts` spawned
 * through `./cli-capture.ts` in a scratch project, under no hub:
 *
 *   - `effort.sync: local` exits 0 and prints the one line saying there is
 *     nothing to sync;
 *   - `effort.sync: service` with a `hub.url` nothing listens on exits 0
 *     and prints the one offline line, naming the url.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { expectExit, plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';

/** This suite's own temporary directory, removed once every case has run. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-effort-sync-spawned-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long one case may take: a spawned run is a few seconds. */
const CASE_TIMEOUT_MS = 60_000;

/** The sync-service package, the module whose `service` strategy the project loads. */
const SYNC_SERVICE_PACKAGE = join(import.meta.dir, '..', '..', 'packages', 'rafa-sync-service');

/** A url nothing listens on: the discard port, refused at once. */
const UNREACHABLE_URL = 'http://127.0.0.1:9';

/** The lines a spawned run wrote to either stream, blanks dropped. */
function linesOf(run: { readonly stdout: string; readonly stderr: string }): string[] {
  return `${run.stdout}\n${run.stderr}`.split('\n').map((line) => line.trim())
    .filter((line) => line !== '');
}

describe('rafa effort sync, spawned', () => {
  it('exits 0 and prints the one nothing-to-sync line under effort.sync: local', () => {
    const scratch = plantScratchRepo(tempBase, { project: false });
    plantProjectConfig(scratch.repo, 'effort:\n  sync: local\n');

    const run = runRafa(scratch, scratch.repo, ['effort', 'sync']);

    expectExit(run, 0, scratch);
    const lines = linesOf(run).filter((line) => line.includes('effort sync'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('effort sync: effort.sync is "local", which syncs with no hub; nothing to sync');
  }, CASE_TIMEOUT_MS);

  it('exits 0 and prints the one offline line for a hub.url nothing listens on', () => {
    const scratch = plantScratchRepo(tempBase, { project: false });
    plantProjectConfig(scratch.repo, [
      'effort:',
      '  sync: service',
      'hub:',
      `  url: ${UNREACHABLE_URL}`,
      '  project: scratch',
      '  tokenSecret: scratch-token',
      'modules:',
      `  - path: ${SYNC_SERVICE_PACKAGE}`,
      'allowList:',
      '  - "@open-tomato/rafa-sync-service"',
      '',
    ].join('\n'));

    const secretsFile = join(scratch.home, 'secrets.json');
    writeFileSync(secretsFile, JSON.stringify({ rafa: { 'scratch-token': 'fixture-token' } }), 'utf8');

    const run = runRafa(scratch, scratch.repo, ['effort', 'sync'], { RAFA_TEST_SECRETS_FILE: secretsFile });

    expectExit(run, 0, scratch);
    const lines = linesOf(run).filter((line) => line.includes('effort sync'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`effort sync: the hub at ${UNREACHABLE_URL} is unreachable (`);
    expect(lines[0]).toContain('this command used the local store, and its rows sync on the next contact');
  }, CASE_TIMEOUT_MS);
});
