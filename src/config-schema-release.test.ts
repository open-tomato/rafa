/**
 * Tests for the release plan's six keys: `release.fragments`,
 * `release.strategy`, `release.settle`, `release.tag`,
 * `pr.versionCollision` and `dangerous.acceptVersionCollision`.
 *
 * Each key is driven through the spec `SETTINGS` holds for it, so what
 * is proved is the reader the schema actually wires to the key, not a
 * reader of the same name. Every refusal sits beside an accepting
 * control of the same spec, so a reader that refused everything fails
 * here. Every key, default and refusal is SPELLED, never read off the
 * module, so a module that renames a key or moves a default fails
 * rather than agreeing with itself.
 *
 * A refused value reads as no value, which a layer holds as silence,
 * so the setting falls back to its default; the last block drives that
 * through `resolveConfig`, and shows that a file carrying the refused
 * value is reported with a `ConfigError` naming it, as every other
 * unusable value is.
 */
import type { ConfigSetting } from './config-schema.js';

import { describe, expect, it } from 'bun:test';

import {
  DANGEROUS_RELEASE_DEFAULTS,
  PR_DEFAULTS,
  RELEASE_DEFAULTS,
} from './config-schema-release.js';
import { SETTINGS } from './config-schema.js';
import {
  CONFIG_DEFAULTS,
  ConfigError,
  parseConfigText,
  resolveConfig,
} from './config.js';

/** The label every file case parses under. No file is read at it. */
const PATH = '/repo/.rafa/config.yaml';

/** The six settings, their file keys and their defaults, in schema order. */
const SIX: readonly (readonly [ConfigSetting, string, unknown])[] = [
  ['prVersionCollision', 'pr.versionCollision', 'report'],
  ['releaseFragments', 'release.fragments', '.changes'],
  ['releaseStrategy', 'release.strategy', 'semver-by-level'],
  ['releaseSettle', 'release.settle', 'push'],
  ['releaseTag', 'release.tag', 'manual'],
  ['dangerousAcceptVersionCollision', 'dangerous.acceptVersionCollision', false],
];

/** Reads `raw` through the spec `SETTINGS` holds for `setting`. */
function readAs(setting: ConfigSetting, raw: unknown) {
  const { key } = SETTINGS[setting];
  return SETTINGS[setting].read(raw, { label: `F: ${key}`, key });
}

/** Holds `setting` to accepting `raw` as itself, with nothing to report. */
function expectAccepted(setting: ConfigSetting, raw: unknown): void {
  expect(readAs(setting, raw)).toEqual({ value: raw, problems: [], extras: [] });
}

/** Holds `setting` to refusing `raw` with exactly `problem`, and no value. */
function expectRefused(setting: ConfigSetting, raw: unknown, problem: string): void {
  expect(readAs(setting, raw)).toEqual({ value: undefined, problems: [problem], extras: [] });
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

describe('the six keys', () => {
  it.each(SIX)('spells %s as %s, file-only', (setting, key) => {
    expect(SETTINGS[setting].key).toBe(key);
    expect(SETTINGS[setting].cli).toBe(false);
  });

  it.each(SIX)('resolves %s (%s) to its default when no layer names it', (setting, _key, value) => {
    expect(CONFIG_DEFAULTS[setting]).toEqual(value);
    expect(resolveConfig().config[setting]).toEqual(value);
    expect(resolveConfig().sources[setting]).toBe('default');
  });

  it('keeps each default in its section object, frozen', () => {
    expect(PR_DEFAULTS.prVersionCollision).toBe('report');
    expect(RELEASE_DEFAULTS).toMatchObject({
      releaseFragments: '.changes',
      releaseStrategy: 'semver-by-level',
      releaseSettle: 'push',
      releaseTag: 'manual',
    });
    expect(DANGEROUS_RELEASE_DEFAULTS).toEqual({ dangerousAcceptVersionCollision: false });
    expect(Object.isFrozen(DANGEROUS_RELEASE_DEFAULTS)).toBe(true);
  });
});

describe('release.strategy', () => {
  it('accepts semver-by-level, its only value', () => {
    expectAccepted('releaseStrategy', 'semver-by-level');
  });

  it.each(['semver', 'calver', 'Semver-By-Level', ''])('refuses %p as an unknown strategy', (raw) => {
    expectRefused(
      'releaseStrategy',
      raw,
      `F: release.strategy is ${JSON.stringify(raw)}, expected one of: semver-by-level`,
    );
  });

  it('refuses a value that is not a string', () => {
    expectRefused('releaseStrategy', true, 'F: release.strategy is true, expected one of: semver-by-level');
  });
});

describe('release.settle', () => {
  it.each(['push', 'pr'])('accepts %s', (raw) => {
    expectAccepted('releaseSettle', raw);
  });

  it.each(['merge', 'PR', 'Push'])('refuses %p', (raw) => {
    expectRefused('releaseSettle', raw, `F: release.settle is "${raw}", expected one of: push, pr`);
  });

  it('refuses a list', () => {
    expectRefused('releaseSettle', ['push'], 'F: release.settle is a list, expected one of: push, pr');
  });
});

describe('release.tag', () => {
  it.each(['manual', 'settle'])('accepts %s', (raw) => {
    expectAccepted('releaseTag', raw);
  });

  it.each(['auto', 'Manual'])('refuses %p', (raw) => {
    expectRefused('releaseTag', raw, `F: release.tag is "${raw}", expected one of: manual, settle`);
  });

  it('refuses a boolean', () => {
    expectRefused('releaseTag', true, 'F: release.tag is true, expected one of: manual, settle');
  });
});

describe('release.publishCommand', () => {
  it('spells the key file-only, and defaults to npm publish in its section object', () => {
    expect(SETTINGS.releasePublishCommand.key).toBe('release.publishCommand');
    expect(SETTINGS.releasePublishCommand.cli).toBe(false);
    expect(RELEASE_DEFAULTS.releasePublishCommand).toBe('npm publish');
    expect(resolveConfig().config.releasePublishCommand).toBe('npm publish');
    expect(resolveConfig().sources.releasePublishCommand).toBe('default');
  });

  it.each(['npm publish', 'bun publish', 'pnpm publish --tag next'])('accepts %p as written', (raw) => {
    expectAccepted('releasePublishCommand', raw);
  });

  it.each(['', '   '])('refuses %p, which names no command', (raw) => {
    expectRefused(
      'releasePublishCommand',
      raw,
      `F: release.publishCommand is ${JSON.stringify(raw)}, expected a publish command`,
    );
  });

  it('refuses a value that is not a string', () => {
    expectRefused('releasePublishCommand', true, 'F: release.publishCommand is true, expected a publish command');
  });
});

describe('pr.versionCollision', () => {
  it.each(['allow', 'report', 'ask', 'refuse'])('accepts %s', (raw) => {
    expectAccepted('prVersionCollision', raw);
  });

  it.each(['warn', 'Report', 'deny'])('refuses %p', (raw) => {
    expectRefused(
      'prVersionCollision',
      raw,
      `F: pr.versionCollision is "${raw}", expected one of: allow, report, ask, refuse`,
    );
  });

  it('refuses a boolean', () => {
    expectRefused(
      'prVersionCollision',
      false,
      'F: pr.versionCollision is false, expected one of: allow, report, ask, refuse',
    );
  });
});

describe('dangerous.acceptVersionCollision', () => {
  it.each([true, false])('accepts the YAML boolean %p', (raw) => {
    expectAccepted('dangerousAcceptVersionCollision', raw);
  });

  it.each(['true', 'yes', 1])('refuses %p, a spelling of a boolean', (raw) => {
    const shown = typeof raw === 'string'
      ? JSON.stringify(raw)
      : String(raw);
    expectRefused(
      'dangerousAcceptVersionCollision',
      raw,
      `F: dangerous.acceptVersionCollision is ${shown}, expected true or false`,
    );
  });
});

describe('release.fragments', () => {
  /** Every refusal of the setting ends in these words. */
  const EXPECTED = 'expected a relative directory path not under .rafa/';

  it.each(['.changes', '.changes/', 'docs/changes', './changes', '.rafa-changes', 'changes/.rafa'])(
    'accepts %p, kept as written',
    (raw) => {
      expectAccepted('releaseFragments', raw);
    },
  );

  it.each([
    [2, '2'],
    [['.changes'], 'a list'],
    [{ dir: '.changes' }, 'a mapping'],
    [null, 'null'],
    ['', '""'],
    ['   ', '"   "'],
  ])('refuses %p, not a path', (raw, shown) => {
    expectRefused('releaseFragments', raw, `F: release.fragments is ${shown}, ${EXPECTED}`);
  });

  it.each(['/repo/.changes', '/tmp'])('refuses the absolute path %p', (raw) => {
    expectRefused('releaseFragments', raw, `F: release.fragments is "${raw}", ${EXPECTED}`);
  });

  it.each(['.rafa', '.rafa/', '.rafa/changes', './.rafa/changes', 'changes/../.rafa/changes'])(
    'refuses %p, under the gitignored .rafa/',
    (raw) => {
      expectRefused('releaseFragments', raw, `F: release.fragments is "${raw}", ${EXPECTED}`);
    },
  );
});

describe('an unusable value of the six', () => {
  /** One unusable value per key: the raw value, as a file spells it, and its problem. */
  const UNUSABLE: readonly (readonly [ConfigSetting, unknown, string, string])[] = [
    [
      'prVersionCollision',
      'warn',
      'pr:\n  versionCollision: warn',
      'pr.versionCollision is "warn", expected one of: allow, report, ask, refuse',
    ],
    [
      'releaseFragments',
      '.rafa/changes',
      'release:\n  fragments: .rafa/changes',
      'release.fragments is ".rafa/changes", expected a relative directory path not under .rafa/',
    ],
    [
      'releaseStrategy',
      'calver',
      'release:\n  strategy: calver',
      'release.strategy is "calver", expected one of: semver-by-level',
    ],
    [
      'releaseSettle',
      'merge',
      'release:\n  settle: merge',
      'release.settle is "merge", expected one of: push, pr',
    ],
    [
      'releaseTag',
      'auto',
      'release:\n  tag: auto',
      'release.tag is "auto", expected one of: manual, settle',
    ],
    [
      'dangerousAcceptVersionCollision',
      'yes',
      'dangerous:\n  acceptVersionCollision: yes',
      'dangerous.acceptVersionCollision is "yes", expected true or false',
    ],
  ];

  it.each(UNUSABLE)('leaves %s at its default: a refused reading is silence', (setting, raw) => {
    const { values } = parseConfigText('', PATH);
    const file = { values: { ...values, [setting]: readAs(setting, raw).value }, extras: [], path: PATH };
    const resolved = resolveConfig({ file });

    expect(resolved.config[setting]).toEqual(CONFIG_DEFAULTS[setting]);
    expect(resolved.sources[setting]).toBe('default');
  });

  it('answers the file, as the control, when the value it carries is usable', () => {
    const { values } = parseConfigText('', PATH);
    const file = { values: { ...values, releaseTag: readAs('releaseTag', 'settle').value }, extras: [], path: PATH };
    const resolved = resolveConfig({ file });

    expect(resolved.config.releaseTag).toBe('settle');
    expect(resolved.sources.releaseTag).toBe('file');
  });

  it.each(UNUSABLE)('reports %s in a file the way every unusable value is', (_setting, _raw, text, problem) => {
    expect(refusal(() => parseConfigText(`${text}\n`, PATH)).problems).toEqual([`${PATH}: ${problem}`]);
  });
});
