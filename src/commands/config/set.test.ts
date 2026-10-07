/**
 * `rafa config set` dispatched in planted projects under the temp
 * directory. `withConfigSetting`'s own cases (`src/config-set.test.ts`)
 * hold the three edits and every refusal reason, so these hold what the
 * command adds: the argument it splits, the file it reads and writes,
 * the old and new values it prints, json mode, and that a refusal writes
 * nothing. `pr.base` is the first key, the one a stretch points at its
 * integration branch.
 *
 * A refusal reads the config's bytes before and after and finds them
 * equal; the first case finds them changed, so a reading that could not
 * tell the two apart would fail there.
 */
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { parseConfigText } from '../../config.js';
import { projectConfigText } from '../../project/scaffold.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { createConfigSetCommand, formatValue, NOT_SET, splitAssignment } from './set.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-config-set-command-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** The subject the command sits under, declared for the registry the test dispatches over. */
const CONFIG_SUBJECT = { name: 'config', summary: 'the project config' };

/** A config setting `pr.base` with a trailing comment, and a comment line of its own. */
const BASE_CONFIG = 'version: 1\n# the pull request settings\npr:\n  base: main   # where a PR opens\n  provider: gh\n';

/** A project planted with `text` as its config. */
function plant(text: string): PlantedProject {
  return plantProject(realpathSync(mkdtempSync(join(scope, 'case-'))), text);
}

/** The project's config file. */
function configOf(project: PlantedProject): string {
  return join(project.root, '.rafa', 'config.yaml');
}

/** The project's config text. */
function textOf(project: PlantedProject): string {
  return readFileSync(configOf(project), 'utf8');
}

/** Dispatches `config set` with `words` in `project`. */
async function run(project: PlantedProject, words: readonly string[]): Promise<CapturedRun> {
  return dispatchInProject(['config', 'set', ...words], [CONFIG_SUBJECT], [createConfigSetCommand()], project);
}

describe('rafa config set', () => {
  it('sets pr.base in place, prints its old and new values and keeps every comment', async () => {
    const project = plant(BASE_CONFIG);

    const outcome = await run(project, ['pr.base=stretch/9']);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain(`✅ Set pr.base in ${configOf(project)}.`);
    expect(outcome.stdout).toContain('   was: main');
    expect(outcome.stdout).toContain('   now: stretch/9');
    expect(textOf(project)).toBe(BASE_CONFIG.replace('base: main', 'base: stretch/9'));
    expect(parseConfigText(textOf(project), 'config.yaml').values.prBase).toBe('stretch/9');
  });

  it('appends pr.base below the commented template rafa init writes, printing it as not set before', async () => {
    const template = projectConfigText();
    const project = plant(template);

    const outcome = await run(project, ['pr.base=stretch/9']);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain(`   was: ${NOT_SET}`);
    expect(outcome.stdout).toContain('   now: stretch/9');
    expect(textOf(project)).toBe(`${template}pr:\n  base: stretch/9\n`);
  });

  it('leaves a file already reading the value byte-identical, and says so', async () => {
    const project = plant(BASE_CONFIG);

    const outcome = await run(project, ['pr.base=main']);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain(`✅ ${configOf(project)} already reads pr.base: main; left as it was.`);
    expect(textOf(project)).toBe(BASE_CONFIG);
  });

  it('gives the key, the file, both values and whether it changed as the json result', async () => {
    const project = plant(BASE_CONFIG);

    const outcome = await run(project, ['pr.base=stretch/9', '--output=json']);

    const last = eventsOf(outcome.stdout).at(-1) as unknown as { data: Record<string, unknown> };
    expect(outcome.exitCode).toBe(0);
    expect(last.data).toEqual({ key: 'pr.base', path: configOf(project), before: 'main', after: 'stretch/9', changed: true });
  });

  it('sets a top-level key too', async () => {
    const project = plant('version: 1\n');

    const outcome = await run(project, ['store=ndjson']);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('   now: ndjson');
    expect(textOf(project)).toBe('version: 1\nstore: ndjson\n');
  });
});

describe('rafa config set: refusals write nothing', () => {
  /** Each case: what it refuses, the config, the words, and a part of the message. */
  const CASES: readonly (readonly [string, string, readonly string[], string])[] = [
    ['an unknown key', BASE_CONFIG, ['pr.nope=x'], 'unknown key "pr.nope"'],
    ['a word with no "="', BASE_CONFIG, ['pr.base'], 'expected <key>=<value>, got "pr.base" with no "="'],
    ['a word with no key before "="', BASE_CONFIG, ['=stretch/9'], 'with no key before "="'],
    ['an empty value', BASE_CONFIG, ['pr.base='], 'pr.base needs a value'],
    ['no argument', BASE_CONFIG, [], 'Expected one argument, got none'],
    ['two arguments', BASE_CONFIG, ['pr.base=a', 'store=ndjson'], 'Expected one argument, got 2'],
    ['a key set on two lines', 'version: 1\npr:\n  base: main\n  base: dev\n', ['pr.base=stretch/9'], 'sets pr.base on 2 lines'],
    ['a section in flow style', 'version: 1\npr: {base: main}\n', ['pr.base=stretch/9'], 'flow style'],
  ];

  it.each(CASES)('refuses %s with exit code 1, the usage, and the file byte-identical', async (_what, text, words, message) => {
    const project = plant(text);

    const outcome = await run(project, words);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(message);
    expect(outcome.stderr).toContain('Usage: rafa config set <key>=<value>');
    expect(textOf(project)).toBe(text);
  });
});

describe('splitAssignment and formatValue', () => {
  it('splits at the first "=", keeping a later one in the value', () => {
    expect(splitAssignment('pr.base=a=b')).toEqual({ key: 'pr.base', value: 'a=b' });
  });

  it('prints a string as written, null as not set, and anything else as JSON', () => {
    expect(formatValue('stretch/9')).toBe('stretch/9');
    expect(formatValue(null)).toBe(NOT_SET);
    expect(formatValue(3)).toBe('3');
    expect(formatValue(['a', 'b'])).toBe('["a","b"]');
  });
});
