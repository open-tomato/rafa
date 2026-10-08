/**
 * Tests for the `board.project` section: `board.project.template` and
 * `board.project.number`, the two keys naming the GitHub project a board
 * is mirrored to — the template it is copied from, by URL, and the
 * copy's number — and the five limits on how the project is refreshed,
 * `retries`, `retryWaitSeconds`, `progressSeconds`, `writeBatchSize` and
 * `writePauseMs`.
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
 *
 * Each limit is read at its edges: the least and the most it accepts,
 * one below and one above, `0` and `-1`, and `false`, which only
 * `retries` and `progressSeconds` accept. `writePauseMs` is the one key
 * whose least is `0`, so for it `0` is the accepting edge and `-1` the
 * refusal beside it.
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

  it('warns of an unknown key under board.project, naming the seven it knows', () => {
    const resolved = resolveConfig({ file: parseConfigText(projectFile('id: 6'), PATH) });

    expect(resolved.warnings).toEqual([
      `rafa config: unknown key "board.project.id" in ${PATH} has no effect in this version `
        + '(known keys under board.project: template, number, retries, retryWaitSeconds, '
        + 'progressSeconds, writeBatchSize, writePauseMs)',
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

/** One `board.project` limit, every fact about it spelled out. */
interface Limit {
  setting: ConfigSetting;
  name: string;
  fallback: number;
  least: number;
  most: number;
  takesFalse: boolean;
  expected: string;
}

/** The five limits, as the plan's table names them. */
const LIMITS: readonly Limit[] = [
  {
    setting: 'boardProjectRetries',
    name: 'retries',
    fallback: 3,
    least: 1,
    most: 10,
    takesFalse: true,
    expected: 'expected false or a whole number from 1 to 10',
  },
  {
    setting: 'boardProjectRetryWaitSeconds',
    name: 'retryWaitSeconds',
    fallback: 2,
    least: 1,
    most: 60,
    takesFalse: false,
    expected: 'expected a whole number from 1 to 60',
  },
  {
    setting: 'boardProjectProgressSeconds',
    name: 'progressSeconds',
    fallback: 10,
    least: 1,
    most: 300,
    takesFalse: true,
    expected: 'expected false or a whole number from 1 to 300',
  },
  {
    setting: 'boardProjectWriteBatchSize',
    name: 'writeBatchSize',
    fallback: 20,
    least: 1,
    most: 100,
    takesFalse: false,
    expected: 'expected a whole number from 1 to 100',
  },
  {
    setting: 'boardProjectWritePauseMs',
    name: 'writePauseMs',
    fallback: 1000,
    least: 0,
    most: 60_000,
    takesFalse: false,
    expected: 'expected a whole number from 0 to 60000',
  },
];

/** `[name, limit]` rows, so a case title names the key it reads. */
const LIMIT_ROWS = LIMITS.map((limit): [string, Limit] => [limit.name, limit]);

/** The limits that read `false` as off. */
const OFF_ROWS = LIMIT_ROWS.filter(([, limit]) => limit.takesFalse);

/** The limits that refuse `false`. */
const NO_OFF_ROWS = LIMIT_ROWS.filter(([, limit]) => !limit.takesFalse);

/** The limits whose least is above zero, so `0` is a refusal. */
const ABOVE_ZERO_ROWS = LIMIT_ROWS.filter(([, limit]) => limit.least > 0);

/** The refusal of `shown` under `limit`, as `readAs` labels it. */
function limitRefusal(limit: Limit, shown: string) {
  return {
    value: undefined,
    problems: [`F: board.project.${limit.name} is ${shown}, ${limit.expected}`],
    extras: [],
  };
}

/** An accepting reading of `value`. */
function acceptedAs(value: unknown) {
  return { value, problems: [], extras: [] };
}

describe('board.project limits in the schema', () => {
  it.each(LIMIT_ROWS)('spells %s under board.project, file-only', (name, limit) => {
    expect(SETTINGS[limit.setting].key).toBe(`board.project.${name}`);
    expect(SETTINGS[limit.setting].cli).toBe(false);
    expect(isCommandLineSetting(limit.setting)).toBe(false);
  });

  it.each(LIMIT_ROWS)('defaults %s to the plan\'s value, in the defaults and a resolution naming nothing', (_name, limit) => {
    const resolved = resolveConfig();

    expect(CONFIG_DEFAULTS[limit.setting]).toBe(limit.fallback);
    expect(resolved.config[limit.setting]).toBe(limit.fallback);
    expect(resolved.sources[limit.setting]).toBe('default');
  });
});

describe('board.project limits at their edges', () => {
  it.each(LIMIT_ROWS)('accepts the least %s, kept as written', (_name, limit) => {
    expect(readAs(limit.setting, limit.least)).toEqual(acceptedAs(limit.least));
  });

  it.each(LIMIT_ROWS)('accepts the most %s, kept as written', (_name, limit) => {
    expect(readAs(limit.setting, limit.most)).toEqual(acceptedAs(limit.most));
  });

  it.each(LIMIT_ROWS)('refuses one above the most %s', (_name, limit) => {
    expect(readAs(limit.setting, limit.most + 1)).toEqual(limitRefusal(limit, String(limit.most + 1)));
  });

  it.each(ABOVE_ZERO_ROWS)('refuses 0 for %s, never reading it as off', (_name, limit) => {
    expect(readAs(limit.setting, 0)).toEqual(limitRefusal(limit, '0'));
  });

  it('accepts 0 for writePauseMs, a pause of no time, as the one key whose least is 0', () => {
    expect(readAs('boardProjectWritePauseMs', 0)).toEqual(acceptedAs(0));
  });

  it.each(LIMIT_ROWS)('refuses -1 for %s', (_name, limit) => {
    expect(readAs(limit.setting, -1)).toEqual(limitRefusal(limit, '-1'));
  });

  it.each(OFF_ROWS)('accepts false for %s, as off', (_name, limit) => {
    expect(readAs(limit.setting, false)).toEqual(acceptedAs(false));
  });

  it.each(NO_OFF_ROWS)('refuses false for %s, which has no off', (_name, limit) => {
    expect(readAs(limit.setting, false)).toEqual(limitRefusal(limit, 'false'));
  });

  it.each(LIMIT_ROWS)('refuses true, a fraction, a quoted number, a list and null for %s', (_name, limit) => {
    const quoted = String(limit.least + 1);

    expect(readAs(limit.setting, true)).toEqual(limitRefusal(limit, 'true'));
    expect(readAs(limit.setting, limit.least + 0.5)).toEqual(limitRefusal(limit, String(limit.least + 0.5)));
    expect(readAs(limit.setting, quoted)).toEqual(limitRefusal(limit, JSON.stringify(quoted)));
    expect(readAs(limit.setting, [limit.least])).toEqual(limitRefusal(limit, 'a list'));
    expect(readAs(limit.setting, null)).toEqual(limitRefusal(limit, 'null'));
  });
});

describe('board.project limits in a file and across the layers', () => {
  it('reports every refused limit in a file, naming the file, the key and the value', () => {
    const text = projectFile(
      'retries: 0',
      'retryWaitSeconds: 61',
      'progressSeconds: -1',
      'writeBatchSize: false',
      'writePauseMs: 60001',
    );

    expect(refusal(() => parseConfigText(text, PATH)).problems).toEqual([
      `${PATH}: board.project.retries is 0, expected false or a whole number from 1 to 10`,
      `${PATH}: board.project.retryWaitSeconds is 61, expected a whole number from 1 to 60`,
      `${PATH}: board.project.progressSeconds is -1, expected false or a whole number from 1 to 300`,
      `${PATH}: board.project.writeBatchSize is false, expected a whole number from 1 to 100`,
      `${PATH}: board.project.writePauseMs is 60001, expected a whole number from 0 to 60000`,
    ]);
  });

  it('reads every usable limit in a file, as the control, with no problem', () => {
    const text = projectFile(
      'retries: false',
      'retryWaitSeconds: 60',
      'progressSeconds: false',
      'writeBatchSize: 7',
      'writePauseMs: 0',
    );
    const resolved = resolveConfig({ file: parseConfigText(text, PATH) });

    expect(resolved.config.boardProjectRetries).toBe(false);
    expect(resolved.config.boardProjectRetryWaitSeconds).toBe(60);
    expect(resolved.config.boardProjectProgressSeconds).toBe(false);
    expect(resolved.config.boardProjectWriteBatchSize).toBe(7);
    expect(resolved.config.boardProjectWritePauseMs).toBe(0);
    expect(resolved.sources.boardProjectWritePauseMs).toBe('file');
    expect(resolved.warnings).toEqual([]);
  });

  it('answers the project file over the user file, and the user file over the default, key by key', () => {
    const resolved = resolveConfig({
      file: parseConfigText(projectFile('writeBatchSize: 5'), PATH),
      user: parseConfigText(projectFile('writeBatchSize: 9', 'retries: 4'), USER_PATH),
    });

    expect(resolved.config.boardProjectWriteBatchSize).toBe(5);
    expect(resolved.sources.boardProjectWriteBatchSize).toBe('file');
    expect(resolved.config.boardProjectRetries).toBe(4);
    expect(resolved.sources.boardProjectRetries).toBe('user');
    expect(resolved.config.boardProjectWritePauseMs).toBe(1000);
    expect(resolved.sources.boardProjectWritePauseMs).toBe('default');
  });

  it('reads no command-line override of a limit, as each is file-only', () => {
    const cli = { boardProjectRetries: 9, boardProjectWriteBatchSize: 5 };
    const resolved = resolveConfig({ cli: cli as unknown as ConfigOverrides });

    expect(resolved.config.boardProjectRetries).toBe(3);
    expect(resolved.config.boardProjectWriteBatchSize).toBe(20);
    expect(resolved.sources.boardProjectRetries).toBe('default');
  });
});
