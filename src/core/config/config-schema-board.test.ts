/**
 * Tests for `board.relationships`, the key naming where a board's epics
 * and blockers live: `labels` (the default) or `native`.
 *
 * The key is driven through the spec `SETTINGS` holds for it, so what is
 * proved is the reader the schema wires to the key, not a reader of the
 * same name. Every refusal sits beside an accepting control of the same
 * spec, so a reader that refused everything fails here. The key, the
 * default and each refusal are SPELLED, never read off the module, so a
 * module that renames the key or moves the default fails rather than
 * agreeing with itself.
 *
 * The layer cases go through `parseConfigText` and `resolveConfig`: the
 * default when nothing names the key, the user file over the default,
 * the project file over the user file, and no command-line spelling.
 * A refused value is reported with a `ConfigError` naming it and, read
 * as silence, leaves the setting at its default.
 */
import type { ConfigSetting } from './config-schema.js';
import type { ConfigOverrides } from './config.js';

import { describe, expect, it } from 'bun:test';

import { isCommandLineSetting, SETTINGS } from './config-schema.js';
import {
  BOARD_RELATIONSHIP_MODES,
  CONFIG_DEFAULTS,
  ConfigError,
  parseConfigText,
  resolveConfig,
} from './config.js';

/** The label every project-file case parses under. No file is read at it. */
const PATH = '/repo/.rafa/config.yaml';

/** The label every user-file case parses under. */
const USER_PATH = '/home/me/.rafa/config.yaml';

/** The setting under test, as a field of the resolved config. */
const SETTING: ConfigSetting = 'boardRelationships';

/** The words every refusal of the key ends in. */
const EXPECTED = 'expected one of: labels, native';

/** Reads `raw` through the spec `SETTINGS` holds for the key. */
function readAs(raw: unknown) {
  const { key } = SETTINGS[SETTING];
  return SETTINGS[SETTING].read(raw, { label: `F: ${key}`, key });
}

/** A file that sets the key to `value`, as a person would write it. */
function boardFile(value: string): string {
  return `board:\n  relationships: ${value}\n`;
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

describe('board.relationships in the schema', () => {
  it('spells the setting as board.relationships, file-only', () => {
    expect(SETTINGS.boardRelationships.key).toBe('board.relationships');
    expect(SETTINGS.boardRelationships.cli).toBe(false);
    expect(isCommandLineSetting('boardRelationships')).toBe(false);
  });

  it('names the two modes, labels first', () => {
    expect([...BOARD_RELATIONSHIP_MODES]).toEqual(['labels', 'native']);
  });

  it('defaults to labels, in the defaults and in a resolution naming nothing', () => {
    const resolved = resolveConfig();

    expect(CONFIG_DEFAULTS.boardRelationships).toBe('labels');
    expect(resolved.config.boardRelationships).toBe('labels');
    expect(resolved.sources.boardRelationships).toBe('default');
  });
});

describe('board.relationships validation', () => {
  it.each(['labels', 'native'])('accepts %s', (raw) => {
    expect(readAs(raw)).toEqual({ value: raw, problems: [], extras: [] });
  });

  it.each(['Native', 'LABELS', 'sub-issues', 'github', ''])('refuses %p', (raw) => {
    expect(readAs(raw)).toEqual({
      value: undefined,
      problems: [`F: board.relationships is ${JSON.stringify(raw)}, ${EXPECTED}`],
      extras: [],
    });
  });

  it.each([
    [true, 'true'],
    [1, '1'],
    [['native'], 'a list'],
    [{ mode: 'native' }, 'a mapping'],
  ])('refuses %p, not a mode name', (raw, shown) => {
    expect(readAs(raw)).toEqual({
      value: undefined,
      problems: [`F: board.relationships is ${shown}, ${EXPECTED}`],
      extras: [],
    });
  });

  it('reports an unknown mode in a file, naming the file and the value', () => {
    expect(refusal(() => parseConfigText(boardFile('sub-issues'), PATH)).problems).toEqual([
      `${PATH}: board.relationships is "sub-issues", ${EXPECTED}`,
    ]);
  });

  it('reads a usable mode in a file, as the control, with no problem', () => {
    expect(parseConfigText(boardFile('native'), PATH).values.boardRelationships).toBe('native');
  });

  it('leaves the setting at its default when the file value is refused and read as silence', () => {
    const { values } = parseConfigText('', PATH);
    const file = { values: { ...values, boardRelationships: readAs('sub-issues').value }, extras: [], path: PATH };
    const resolved = resolveConfig({ file });

    expect(resolved.config.boardRelationships).toBe('labels');
    expect(resolved.sources.boardRelationships).toBe('default');
  });
});

describe('board.relationships across the layers', () => {
  it('answers the project file over the default', () => {
    const resolved = resolveConfig({ file: parseConfigText(boardFile('native'), PATH) });

    expect(resolved.config.boardRelationships).toBe('native');
    expect(resolved.sources.boardRelationships).toBe('file');
  });

  it('answers the user file over the default', () => {
    const resolved = resolveConfig({ user: parseConfigText(boardFile('native'), USER_PATH) });

    expect(resolved.config.boardRelationships).toBe('native');
    expect(resolved.sources.boardRelationships).toBe('user');
  });

  it('answers the project file over the user file', () => {
    const resolved = resolveConfig({
      file: parseConfigText(boardFile('labels'), PATH),
      user: parseConfigText(boardFile('native'), USER_PATH),
    });

    expect(resolved.config.boardRelationships).toBe('labels');
    expect(resolved.sources.boardRelationships).toBe('file');
  });

  it('keeps the default beside a board section that names only trustedAuthors', () => {
    const file = parseConfigText('board:\n  trustedAuthors: [octocat]\n', PATH);
    const resolved = resolveConfig({ file });

    expect(resolved.config.boardTrustedAuthors).toEqual(['octocat']);
    expect(resolved.config.boardRelationships).toBe('labels');
    expect(resolved.sources.boardRelationships).toBe('default');
  });

  it('warns of no unknown key for board.relationships in a file', () => {
    expect(resolveConfig({ file: parseConfigText(boardFile('native'), PATH) }).warnings).toEqual([]);
  });

  it('reads no command-line override, as the key is file-only', () => {
    const cli = { boardRelationships: 'native' } as ConfigOverrides;
    const resolved = resolveConfig({ cli });

    expect(resolved.config.boardRelationships).toBe('labels');
    expect(resolved.sources.boardRelationships).toBe('default');
  });

  it('reads a command-line setting passed the same way, as the control', () => {
    const resolved = resolveConfig({ cli: { store: 'ndjson' } });

    expect(resolved.config.store).toBe('ndjson');
    expect(resolved.sources.store).toBe('cli');
  });
});
