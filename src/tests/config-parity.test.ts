/**
 * The parity capture for the config-as-code work: what the loader and two
 * commands report over one scratch project and one user-scope file, as the
 * loader reads them at the base of that work.
 *
 * The project's `.rafa/config.yaml` is the text `projectConfigText` writes
 * with `pr.base`, `loop.retries`, `roadmap.issue`, a `tiers.skills` pin and
 * one unknown key uncommented; the user scope's file sets `store` and
 * `output.mode`. Three fixtures under `fixtures/config-parity/` hold what
 * was recorded: `load-config.json` (every setting's value and source,
 * `warnings`, `extras`, `userExtras`), `doctor.txt` and `module-list.txt`
 * (the text lines of `rafa doctor` and `rafa module list`, dispatched
 * in-process through `cli-capture.ts`). Scratch paths are recorded as
 * `<project>` and `<home>`, and the version line as `rafa <version>`, so a
 * release does not move them.
 *
 * Regenerating is opt-in, as `src/cli/help.test.ts` does: with
 * `RAFA_UPDATE_CONFIG_PARITY=1` the fixtures are written before the cases
 * read them, so that run is green by construction and the change is read in
 * the diff. Unset, or set to anything else, nothing is written and the
 * fixtures are read byte for byte. A later task never regenerates them.
 */
import '../adapter-registry.js';

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { loadConfig } from '@open-tomato/rafa/core/config/load';

import { CORE_COMMANDS, CORE_SUBJECTS } from '../commands/index.js';
import { projectConfigText } from '../project/scaffold.js';

import { dispatchInProject, plantProjectConfig } from './cli-capture.js';

/** Set to `1` to write the fixtures afresh before the cases read them. */
const UPDATE_ENV = 'RAFA_UPDATE_CONFIG_PARITY';

/** Where the fixtures live. */
const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/config-parity/', import.meta.url));

/** The user scope's file: the two settings it sets. */
const USER_TEXT = ['store: ndjson', 'output:', '  mode: json', ''].join('\n');

/**
 * Uncomments `section:` and, under it, the line of `key`, giving it
 * `value`. Throws when either line is not in the template.
 */
function uncomment(lines: string[], section: string, key: string, value: string): void {
  const head = lines.indexOf(`# ${section}:`);
  if (head < 0) throw new Error(`no section line for ${section}`);
  const at = lines.findIndex((line, index) => index > head && line.startsWith(`#   ${key}:`));
  if (at < 0) throw new Error(`no ${key} line under ${section}`);
  lines[head] = `${section}:`;
  lines[at] = `  ${key}: ${value}`;
}

/** The project's file: the template with five settings set and one unknown key. */
function parityProjectText(): string {
  const lines = projectConfigText().split('\n');
  uncomment(lines, 'pr', 'base', 'trunk');
  uncomment(lines, 'loop', 'retries', '2');
  uncomment(lines, 'roadmap', 'issue', '42');
  uncomment(lines, 'tiers', 'skills', '{ tdd-workflow: user }');
  return [...lines, 'unknownParityKey: 1', ''].join('\n');
}

let scope = '';
let root = '';
let home = '';

/** The text with the scratch paths replaced by their names. */
function scrubbed(text: string): string {
  return text
    .split(root).join('<project>')
    .split(home)
    .join('<home>')
    .split(scope)
    .join('<scope>')
    .replace(/^rafa \d+\.\d+\.\d+\S*$/gm, 'rafa <version>');
}

/** The loader's result over the scratch project, as the fixture's text. */
async function loadedJson(): Promise<string> {
  const warnings: string[] = [];
  const resolved = await loadConfig({ root, home }, {}, (message) => {
    warnings.push(message);
  });
  const settings = Object.fromEntries(
    Object.keys(resolved.sources).sort()
      .map((name) => [
        name,
        { value: (resolved.config as unknown as Record<string, unknown>)[name], source: resolved.sources[name as keyof typeof resolved.sources] },
      ]),
  );
  const record = {
    settings,
    path: resolved.path,
    userPath: resolved.userPath,
    warnings: resolved.warnings,
    extras: resolved.extras,
    userExtras: resolved.userExtras,
    printedWarnings: warnings,
  };
  return `${scrubbed(JSON.stringify(record, null, 2))}\n`;
}

/** What one command printed, scrubbed, with its exit code on a first line. */
async function commandText(words: readonly string[]): Promise<string> {
  const run = await dispatchInProject(words, CORE_SUBJECTS, CORE_COMMANDS, { root, home });
  return scrubbed(`exit ${String(run.exitCode)}\n--- stdout\n${run.stdout}--- stderr\n${run.stderr}`);
}

/** Each fixture: its file and what it records now. */
const FIXTURES: readonly (readonly [file: string, record: () => string | Promise<string>])[] = [
  ['load-config.json', loadedJson],
  ['doctor.txt', () => commandText(['doctor'])],
  ['module-list.txt', () => commandText(['module', 'list'])],
];

beforeAll(async () => {
  scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-config-parity-')));
  root = join(scope, 'project');
  home = join(scope, 'home');
  plantProjectConfig(root, parityProjectText());
  const userFile = join(home, '.rafa', 'config.yaml');
  mkdirSync(dirname(userFile), { recursive: true });
  writeFileSync(userFile, USER_TEXT, 'utf8');

  if (process.env[UPDATE_ENV] === '1') {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    for (const [file, record] of FIXTURES) writeFileSync(join(FIXTURE_DIR, file), await record(), 'utf8');
  }
});

afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

describe('config parity capture', () => {
  for (const [file, record] of FIXTURES) {
    it(`${file} matches what the loader and the commands report`, async () => {
      expect(await record()).toBe(readFileSync(join(FIXTURE_DIR, file), 'utf8'));
    });
  }

  it('the project file sets what the capture claims', () => {
    const text = parityProjectText();
    for (const line of ['  base: trunk', '  retries: 2', '  issue: 42', '  skills: { tdd-workflow: user }', 'unknownParityKey: 1']) {
      expect(text).toContain(line);
    }
  });
});
