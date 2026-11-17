/**
 * Tests for the `collaborate` section (`config-schema-collaborate.ts`):
 * the reader of `collaborate.rafa`, the file layer it reads into, the
 * section and its default, and {@link collaborateTarget}.
 *
 * Negative cases come first in each block, and each refusal sits beside
 * an accepting control of the same reader, so a reader that refused
 * everything fails here rather than passing. Every refusal is SPELLED,
 * never built from the module's own text. The file cases register the
 * section alone over an empty registry for their read, whatever an
 * earlier file of the run left active, and put that registry back after.
 */
import type { ConfigFile } from './core/config/index.js';
import type { ValueAt } from './core/config/sections.js';

import { describe, expect, it } from 'bun:test';

import {
  COLLABORATE_DEFAULTS,
  COLLABORATE_SECTION,
  COLLABORATE_TOOLS,
  collaborateRepository,
  collaborateTarget,
} from './config-schema-collaborate.js';
import { ConfigError, parseConfigText } from './core/config/index.js';
import {
  EMPTY_CONFIG_REGISTRY,
  registerConfigSections,
  restoreConfigSections,
} from './core/config/section.js';

/** Where every reader case reads its value. */
const AT: ValueAt = { label: 'F: collaborate.rafa', key: 'collaborate.rafa' };

/** The project file's path, as a refusal names it. */
const PROJECT = '/repo/.rafa/config.yaml';

/** What the reader says it expected. */
const EXPECTED = 'expected a repository as owner/name, such as open-tomato/rafa';

/** `text` read as the project file with the `collaborate` section alone registered. */
function readFile(text: string): ConfigFile {
  const previous = registerConfigSections([]);
  restoreConfigSections(EMPTY_CONFIG_REGISTRY);
  registerConfigSections([COLLABORATE_SECTION]);
  try {
    return parseConfigText(text, PROJECT);
  } finally {
    restoreConfigSections(previous);
  }
}

/** The `ConfigError` `attempt` threw; fails the case when it threw nothing else. */
function refusal(attempt: () => unknown): ConfigError {
  try {
    attempt();
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected a ConfigError, and nothing was thrown');
}

describe('collaborate.rafa, the reader', () => {
  it('refuses a bare name, a third part and a name holding whitespace, naming the key', () => {
    const refused = ['rafa', 'open-tomato/rafa/x', 'open tomato/rafa'].map((raw) => collaborateRepository(raw, AT));

    expect(refused.map((reading) => reading.value)).toEqual([undefined, undefined, undefined]);
    expect(refused.map((reading) => reading.problems)).toEqual([
      [`F: collaborate.rafa is "rafa", ${EXPECTED}`],
      [`F: collaborate.rafa is "open-tomato/rafa/x", ${EXPECTED}`],
      [`F: collaborate.rafa is "open tomato/rafa", ${EXPECTED}`],
    ]);
  });

  it('refuses a blank string, an empty part, padding and anything not a string, coercing none', () => {
    const spellings = ['', '   ', '/rafa', 'open-tomato/', ' open-tomato/rafa', 'open-tomato/rafa ', 42, true, null, ['a/b'], { a: 'b' }];

    expect(spellings.filter((raw) => collaborateRepository(raw, AT).value !== undefined)).toEqual([]);
    expect(collaborateRepository(42, AT).problems).toEqual([`F: collaborate.rafa is 42, ${EXPECTED}`]);
  });

  it('accepts one owner/name, kept as written, the control', () => {
    const names = ['open-tomato/rafa', 'Open-Tomato/app', 'me/my.repo_1'];

    expect(names.map((raw) => collaborateRepository(raw, AT))).toEqual(
      names.map((value) => ({ value, problems: [], extras: [] })),
    );
  });
});

describe('collaborate.rafa in a config file', () => {
  it('refuses a malformed value at load, naming the key and the file', () => {
    expect(refusal(() => readFile('collaborate:\n  rafa: rafa\n')).problems).toEqual([
      `${PROJECT}: collaborate.rafa is "rafa", ${EXPECTED}`,
    ]);
  });

  it('refuses a number at load rather than coercing it', () => {
    expect(refusal(() => readFile('collaborate:\n  rafa: 7\n')).problems).toEqual([
      `${PROJECT}: collaborate.rafa is 7, ${EXPECTED}`,
    ]);
  });

  it('keeps a key under collaborate other than rafa as an unknown key, read into no setting', () => {
    const file = readFile('collaborate:\n  bun: oven-sh/bun\n');

    expect(file.extras.map((extra) => extra.key)).toEqual(['collaborate.bun']);
    expect(file.values.collaborateRafa).toBeUndefined();
  });

  it('says nothing for collaborate.rafa when the file leaves it out', () => {
    expect(readFile('{}\n').values.collaborateRafa).toBeUndefined();
  });

  it('keeps collaborate.rafa: open-tomato/rafa after loading, the control', () => {
    const file = readFile('collaborate:\n  rafa: open-tomato/rafa\n');

    expect([file.values.collaborateRafa, file.extras]).toEqual(['open-tomato/rafa', []]);
  });
});

describe('the collaborate section', () => {
  it('reads null for every key by default, so reporting upstream is off', () => {
    expect(COLLABORATE_DEFAULTS).toEqual({ collaborateRafa: null });
    expect(Object.isFrozen(COLLABORATE_DEFAULTS)).toBe(true);
  });

  it('holds one setting, collaborate.rafa, no command line can name, and no check', () => {
    expect(COLLABORATE_SECTION.package).toBe('collaborate');
    expect(Object.entries(COLLABORATE_SECTION.settings).map(([name, spec]) => [name, spec.key, spec.cli])).toEqual([
      ['collaborateRafa', 'collaborate.rafa', false],
    ]);
    expect(COLLABORATE_SECTION.defaults).toBe(COLLABORATE_DEFAULTS);
    expect(COLLABORATE_SECTION.checks).toEqual([]);
  });

  it('names rafa as its only tool', () => {
    expect(COLLABORATE_TOOLS).toEqual(['rafa']);
  });
});

describe('collaborateTarget', () => {
  it('answers null for a key left out or null, so reporting upstream is off', () => {
    expect(collaborateTarget({}, 'rafa')).toBeNull();
    expect(collaborateTarget({ collaborateRafa: null }, 'rafa')).toBeNull();
    expect(collaborateTarget(COLLABORATE_DEFAULTS, 'rafa')).toBeNull();
  });

  it('answers the owner/name the key holds for its tool, the control', () => {
    expect(collaborateTarget({ collaborateRafa: 'open-tomato/rafa' }, 'rafa')).toBe('open-tomato/rafa');
  });
});
