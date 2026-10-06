/**
 * Tests for `board.project.template` and `board.project.number`, the
 * two keys naming the GitHub project a board is mirrored to: the
 * template it is copied from, by URL, and the copy's number.
 *
 * Each key is driven through the spec `SETTINGS` holds for it, so what
 * is proved is the reader the schema wires to the key, not a reader of
 * the same name. Every refusal sits beside an accepting control of the
 * same spec, so a reader that refused everything fails here. The keys,
 * the default URL and each refusal are SPELLED, never read off the
 * module, so a module that renames a key or moves the default fails
 * rather than agreeing with itself.
 *
 * The layer cases go through `parseConfigText` and `resolveConfig`: the
 * default when nothing names a key, a file over the default, the
 * project file over the user file, and no command-line spelling.
 */
import type { ConfigSetting } from './config-schema.js';
import type { ConfigOverrides } from './config.js';

import { describe, expect, it } from 'bun:test';

import { isCommandLineSetting, SETTINGS } from './config-schema.js';
import {
  CONFIG_DEFAULTS,
  ConfigError,
  parseConfigText,
  resolveConfig,
} from './config.js';

/** The label every project-file case parses under. No file is read at it. */
const PATH = '/repo/.rafa/config.yaml';

/** The label every user-file case parses under. */
const USER_PATH = '/home/me/.rafa/config.yaml';

/** The template URL the spec names as the default, spelled out. */
const DEFAULT_TEMPLATE = 'https://github.com/orgs/open-tomato/projects/6';

/** The words every refusal of the template ends in. */
const TEMPLATE_EXPECTED = 'expected a GitHub project URL, '
  + 'https://github.com/orgs/<owner>/projects/<number> or /users/<owner>/…';

/** The words every refusal of the number ends in. */
const NUMBER_EXPECTED = 'expected a project number, a whole number above zero';

/** Reads `raw` through the spec `SETTINGS` holds for `setting`. */
function readAs(setting: ConfigSetting, raw: unknown) {
  const { key } = SETTINGS[setting];
  return SETTINGS[setting].read(raw, { label: `F: ${key}`, key });
}

/** A file whose `board.project` section holds `lines`, as a person would write it. */
function projectFile(...lines: string[]): string {
  return ['board:', '  project:', ...lines.map((line) => `    ${line}`), ''].join('\n');
}

/** The {@link ConfigError} `run` throws. Fails when it throws none. */
function refusal(run: () => unknown): ConfigError {
  try {
    run();
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected a ConfigError, and nothing was thrown');
}

describe('board.project in the schema', () => {
  it('spells the two settings under board.project, file-only', () => {
    expect(SETTINGS.boardProjectTemplate.key).toBe('board.project.template');
    expect(SETTINGS.boardProjectNumber.key).toBe('board.project.number');
    expect(SETTINGS.boardProjectTemplate.cli).toBe(false);
    expect(SETTINGS.boardProjectNumber.cli).toBe(false);
    expect(isCommandLineSetting('boardProjectTemplate')).toBe(false);
    expect(isCommandLineSetting('boardProjectNumber')).toBe(false);
  });

  it('defaults to open-tomato\'s template and no number, in the defaults and a resolution naming nothing', () => {
    const resolved = resolveConfig();

    expect(CONFIG_DEFAULTS.boardProjectTemplate).toBe(DEFAULT_TEMPLATE);
    expect(CONFIG_DEFAULTS.boardProjectNumber).toBeNull();
    expect(resolved.config.boardProjectTemplate).toBe(DEFAULT_TEMPLATE);
    expect(resolved.config.boardProjectNumber).toBeNull();
    expect(resolved.sources.boardProjectTemplate).toBe('default');
    expect(resolved.sources.boardProjectNumber).toBe('default');
  });
});

describe('board.project.template validation', () => {
  it.each([
    'https://github.com/orgs/acme/projects/2',
    'https://github.com/users/octocat/projects/12',
    'https://github.com/orgs/open-tomato/projects/6',
  ])('accepts %s, kept as written', (raw) => {
    expect(readAs('boardProjectTemplate', raw)).toEqual({ value: raw, problems: [], extras: [] });
  });

  it.each([
    'http://github.com/orgs/acme/projects/2',
    'https://github.com/orgs/acme/projects/2/',
    'https://github.com/orgs/acme/projects/2/views/1',
    'https://github.com/orgs/acme/projects/2?pane=info',
    'https://github.com/orgs/acme/projects/0',
    'https://github.com/orgs/acme/projects/02',
    'https://github.com/teams/acme/projects/2',
    'https://github.com/orgs/-acme/projects/2',
    'https://github.com/orgs/acme/projects/',
    'https://gitlab.com/orgs/acme/projects/2',
    'https://github.com/acme/rafa/projects/2',
    ' https://github.com/orgs/acme/projects/2',
    'acme/2',
    '',
  ])('refuses %p, not a project URL', (raw) => {
    expect(readAs('boardProjectTemplate', raw)).toEqual({
      value: undefined,
      problems: [`F: board.project.template is ${JSON.stringify(raw)}, ${TEMPLATE_EXPECTED}`],
      extras: [],
    });
  });

  it.each([
    [6, '6'],
    [true, 'true'],
    [['https://github.com/orgs/acme/projects/2'], 'a list'],
    [{ url: 'https://github.com/orgs/acme/projects/2' }, 'a mapping'],
  ])('refuses %p, not a string', (raw, shown) => {
    expect(readAs('boardProjectTemplate', raw)).toEqual({
      value: undefined,
      problems: [`F: board.project.template is ${shown}, ${TEMPLATE_EXPECTED}`],
      extras: [],
    });
  });

  it('reports a malformed template in a file, naming the file, the key and the value', () => {
    const text = projectFile('template: https://github.com/orgs/acme/projects/2/views/1');

    expect(refusal(() => parseConfigText(text, PATH)).problems).toEqual([
      `${PATH}: board.project.template is "https://github.com/orgs/acme/projects/2/views/1", ${TEMPLATE_EXPECTED}`,
    ]);
  });

  it('reads a usable template in a file, as the control, with no problem', () => {
    const text = projectFile('template: https://github.com/orgs/acme/projects/2');

    expect(parseConfigText(text, PATH).values.boardProjectTemplate).toBe('https://github.com/orgs/acme/projects/2');
  });
});

describe('board.project.number validation', () => {
  it.each([1, 6, 4096])('accepts %p', (raw) => {
    expect(readAs('boardProjectNumber', raw)).toEqual({ value: raw, problems: [], extras: [] });
  });

  it.each([
    [0, '0'],
    [-1, '-1'],
    [2.5, '2.5'],
    ['6', '"6"'],
    ['#6', '"#6"'],
    [true, 'true'],
    [[6], 'a list'],
  ])('refuses %p, not a project number', (raw, shown) => {
    expect(readAs('boardProjectNumber', raw)).toEqual({
      value: undefined,
      problems: [`F: board.project.number is ${shown}, ${NUMBER_EXPECTED}`],
      extras: [],
    });
  });

  it('reports a malformed number in a file, naming the file, the key and the value', () => {
    expect(refusal(() => parseConfigText(projectFile('number: 0'), PATH)).problems).toEqual([
      `${PATH}: board.project.number is 0, ${NUMBER_EXPECTED}`,
    ]);
  });

  it('reads a usable number in a file, as the control, with no problem', () => {
    expect(parseConfigText(projectFile('number: 6'), PATH).values.boardProjectNumber).toBe(6);
  });

  it('names both keys when a file refuses both, so one run reports every problem', () => {
    const text = projectFile('template: acme/2', 'number: -3');

    expect(refusal(() => parseConfigText(text, PATH)).problems).toEqual([
      `${PATH}: board.project.template is "acme/2", ${TEMPLATE_EXPECTED}`,
      `${PATH}: board.project.number is -3, ${NUMBER_EXPECTED}`,
    ]);
  });
});

describe('board.project across the layers', () => {
  it('answers the project file over the default, key by key', () => {
    const resolved = resolveConfig({ file: parseConfigText(projectFile('number: 6'), PATH) });

    expect(resolved.config.boardProjectNumber).toBe(6);
    expect(resolved.sources.boardProjectNumber).toBe('file');
    expect(resolved.config.boardProjectTemplate).toBe(DEFAULT_TEMPLATE);
    expect(resolved.sources.boardProjectTemplate).toBe('default');
  });

  it('answers the user file over the default', () => {
    const text = projectFile('template: https://github.com/orgs/acme/projects/2');
    const resolved = resolveConfig({ user: parseConfigText(text, USER_PATH) });

    expect(resolved.config.boardProjectTemplate).toBe('https://github.com/orgs/acme/projects/2');
    expect(resolved.sources.boardProjectTemplate).toBe('user');
  });

  it('answers the project file over the user file', () => {
    const resolved = resolveConfig({
      file: parseConfigText(projectFile('number: 6'), PATH),
      user: parseConfigText(projectFile('number: 9'), USER_PATH),
    });

    expect(resolved.config.boardProjectNumber).toBe(6);
    expect(resolved.sources.boardProjectNumber).toBe('file');
  });

  it('reads an empty project section as silence, leaving both defaults', () => {
    const resolved = resolveConfig({ file: parseConfigText('board:\n  project:\n', PATH) });

    expect(resolved.config.boardProjectTemplate).toBe(DEFAULT_TEMPLATE);
    expect(resolved.config.boardProjectNumber).toBeNull();
    expect(resolved.sources.boardProjectNumber).toBe('default');
  });

  it('keeps the other board keys beside a project section', () => {
    const text = 'board:\n  relationships: native\n  project:\n    number: 6\n';
    const resolved = resolveConfig({ file: parseConfigText(text, PATH) });

    expect(resolved.config.boardRelationships).toBe('native');
    expect(resolved.config.boardProjectNumber).toBe(6);
    expect(resolved.warnings).toEqual([]);
  });

  it('warns of an unknown key under board.project, naming the two it knows', () => {
    const resolved = resolveConfig({ file: parseConfigText(projectFile('id: 6'), PATH) });

    expect(resolved.warnings).toEqual([
      `rafa config: unknown key "board.project.id" in ${PATH} has no effect in this version `
        + '(known keys under board.project: template, number)',
    ]);
  });

  it('reads no command-line override, as both keys are file-only', () => {
    const cli = { boardProjectNumber: 6, boardProjectTemplate: 'https://github.com/orgs/acme/projects/2' };
    const resolved = resolveConfig({ cli: cli as unknown as ConfigOverrides });

    expect(resolved.config.boardProjectNumber).toBeNull();
    expect(resolved.config.boardProjectTemplate).toBe(DEFAULT_TEMPLATE);
    expect(resolved.sources.boardProjectNumber).toBe('default');
  });

  it('reads a command-line setting passed the same way, as the control', () => {
    const resolved = resolveConfig({ cli: { store: 'ndjson' } });

    expect(resolved.config.store).toBe('ndjson');
    expect(resolved.sources.store).toBe('cli');
  });
});
