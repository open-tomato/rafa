/**
 * Tests for the reader of the `dangerous` section
 * (`config-dangerous.ts`): `dangerous.hub.maxPayloadRows`'s default,
 * `unlimited`, each value refused, unknown keys refused, which caps the
 * start warns about, and the reading reaching `parseHubConfig`.
 *
 * Each refusal sits beside an accepting control of the same key, so a
 * reader that refused everything, or a check that never fired, fails
 * here rather than passing. Every refusal is spelled, never built from
 * the module's own constants. A section is handed in as the YAML a
 * config file would hold at its top level under `dangerous`.
 */
import type { DangerousReading } from './config-dangerous.js';

import { describe, expect, it } from 'bun:test';

import { isDangerousPayloadCap, readDangerousConfig } from './config-dangerous.js';
import { HubConfigError, parseHubConfig } from './config.js';

/** The config file's path, as a refusal names it. */
const PATH = '/srv/hub/hub.yaml';

/** What `dangerous.hub.maxPayloadRows` says it expected. */
const CAP_EXPECTED = 'expected a whole number from 1 up, such as 50000, or unlimited';

/** The section `lines` spell, as YAML parses it; undefined for no lines, a section left out. */
function dangerous(...lines: string[]): DangerousReading {
  const raw: unknown = lines.length === 0
    ? undefined
    : Bun.YAML.parse(lines.join('\n'));
  return readDangerousConfig(PATH, raw);
}

/** The reading of `dangerous.hub.maxPayloadRows` written as `value`. */
function cap(value: string): DangerousReading {
  return dangerous('hub:', `  maxPayloadRows: ${value}`);
}

describe('dangerous.hub.maxPayloadRows', () => {
  it('is 50000 when the section, dangerous.hub or the key is left out', () => {
    for (const reading of [dangerous(), dangerous('hub: {}'), dangerous('{}')]) {
      expect(reading).toEqual({ value: { maxPayloadRows: 50_000 }, problems: [] });
      expect(Object.isFrozen(reading.value)).toBe(true);
    }
  });

  it('keeps a whole number from 1 up as written, the default and above it included', () => {
    for (const [written, read] of [['1', 1], ['49999', 49_999], ['50000', 50_000], ['50001', 50_001], ['1000000', 1_000_000]] as const) {
      expect(cap(written)).toEqual({ value: { maxPayloadRows: read }, problems: [] });
    }
  });

  it('reads unlimited, spelled out, as no cap', () => {
    expect(cap('unlimited')).toEqual({ value: { maxPayloadRows: null }, problems: [] });
  });

  it('refuses 0, -1 and every other number below 1, naming the key and what it takes', () => {
    for (const written of ['0', '-1', '-50000']) {
      expect(cap(written).problems).toEqual([`${PATH}: dangerous.hub.maxPayloadRows is ${written}, ${CAP_EXPECTED}`]);
    }
  });

  it('refuses a fraction and a number past the safe integers', () => {
    expect(cap('1.5').problems).toEqual([`${PATH}: dangerous.hub.maxPayloadRows is 1.5, ${CAP_EXPECTED}`]);
    expect(cap('50000.5').problems).toEqual([`${PATH}: dangerous.hub.maxPayloadRows is 50000.5, ${CAP_EXPECTED}`]);
    expect(cap('9007199254740993').problems).toHaveLength(1);
  });

  it('refuses a number written as a string and every other spelling of no cap', () => {
    expect(cap('\'50000\'').problems).toEqual([`${PATH}: dangerous.hub.maxPayloadRows is "50000", ${CAP_EXPECTED}`]);
    expect(cap('Unlimited').problems).toEqual([`${PATH}: dangerous.hub.maxPayloadRows is "Unlimited", ${CAP_EXPECTED}`]);
    expect(cap('none').problems).toEqual([`${PATH}: dangerous.hub.maxPayloadRows is "none", ${CAP_EXPECTED}`]);
    expect(cap('false').problems).toEqual([`${PATH}: dangerous.hub.maxPayloadRows is false, ${CAP_EXPECTED}`]);
    expect(cap('null').problems).toEqual([`${PATH}: dangerous.hub.maxPayloadRows is null, ${CAP_EXPECTED}`]);
  });
});

describe('the dangerous section', () => {
  it('refuses a key under dangerous or dangerous.hub that the hub does not read, keeping a known one beside it', () => {
    expect(dangerous('hub:', '  maxPayloadRow: 10', 'store: {}').problems).toEqual([
      `${PATH}: dangerous.store is not a key the hub reads; expected one of dangerous.hub`,
      `${PATH}: dangerous.hub.maxPayloadRow is not a key the hub reads; expected one of dangerous.hub.maxPayloadRows`,
    ]);
    expect(dangerous('hub:', '  maxPayloadRows: 10').problems).toEqual([]);
  });

  it('refuses a dangerous or dangerous.hub that is no mapping', () => {
    expect(dangerous('true').problems).toEqual([`${PATH}: dangerous is true, expected a mapping holding hub`]);
    expect(dangerous('hub: 10').problems).toEqual([`${PATH}: dangerous.hub is 10, expected a mapping holding maxPayloadRows`]);
  });
});

describe('isDangerousPayloadCap', () => {
  it('is true for no cap and a cap above 50000, false for the default and below', () => {
    expect(isDangerousPayloadCap(null)).toBe(true);
    expect(isDangerousPayloadCap(50_001)).toBe(true);
    expect(isDangerousPayloadCap(50_000)).toBe(false);
    expect(isDangerousPayloadCap(1)).toBe(false);
  });
});

describe('parseHubConfig with a dangerous section', () => {
  /** A config file's text: `hub.repository` set, then `lines` at the top level. */
  function configYaml(...lines: string[]): string {
    return ['hub:', '  repository: open-tomato/rafa', ...lines].join('\n');
  }

  it('sets maxPayloadRows from the section beside hub, 50000 when it is left out', () => {
    expect(parseHubConfig(configYaml(), PATH).maxPayloadRows).toBe(50_000);
    expect(parseHubConfig(configYaml('dangerous:', '  hub:', '    maxPayloadRows: 100'), PATH).maxPayloadRows).toBe(100);
    expect(parseHubConfig(configYaml('dangerous:', '  hub:', '    maxPayloadRows: unlimited'), PATH).maxPayloadRows).toBeNull();
  });

  it('refuses a refused cap beside every other problem at once', () => {
    let error: unknown = null;
    try {
      parseHubConfig(configYaml('  port: 0', 'dangerous:', '  hub:', '    maxPayloadRows: 0'), PATH);
    } catch (thrown) {
      error = thrown;
    }

    expect(error).toBeInstanceOf(HubConfigError);
    expect((error as HubConfigError).problems).toEqual([
      `${PATH}: hub.port is 0, expected a whole number from 1 to 65535, such as 7373`,
      `${PATH}: dangerous.hub.maxPayloadRows is 0, ${CAP_EXPECTED}`,
    ]);
  });
});
