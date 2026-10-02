/**
 * `rafa doctor`, spawned, over a scratch project whose
 * `.rafa/config.yaml` indents a child with a tab: rafa's own tab error,
 * naming the line, is in the output, whatever the bun version's YAML
 * parser would have made of the text.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { configFilePath } from '../config.js';
import { plantScratchRepo, runRafa } from '../tests/cli-capture.js';

const SPAWN_TIMEOUT = 60_000;

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-doctor-tab-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

describe('rafa doctor over a config indented with a tab', () => {
  it('holds rafa\'s own tab error, naming the line, in its output', () => {
    const scratch = plantScratchRepo(tempBase, { project: false });
    const file = configFilePath(scratch.repo);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'plan:\n\tinject: full\n');

    const run = runRafa(scratch, scratch.repo, ['doctor']);

    const output = `${run.stdout}\n${run.stderr}`;
    expect(output).toContain('line 2 is indented with a tab; YAML indents with spaces only');
  }, SPAWN_TIMEOUT);
});
