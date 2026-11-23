/**
 * Tests for `loadAtlasConfig` and `withAtlasTargets` over config files
 * written in a tmpdir: no file reads as every target null, both keys
 * read back, `null` is no target, and every bad value, unknown key or
 * non-JSON file is refused with each problem named. The targets reach
 * `pm.budget-burn` as its goal, and nothing else changes.
 */
import type { MetricDefinition } from '@open-tomato/atlas-data/contract';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { AtlasConfigError, atlasConfigPathOf, BUDGET_METRIC, DEFAULT_ATLAS_CONFIG, loadAtlasConfig, withAtlasTargets } from './config.js';
import { METRIC_CATALOGUE } from './metrics/catalogue.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-config-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

let roots = 0;

/** A fresh root whose config file holds `text`. */
function rootWith(text: string): string {
  roots += 1;
  const root = join(scope, `root-${roots}`);
  const file = atlasConfigPathOf(root);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return root;
}

/** The problems `loadAtlasConfig` refuses `text` with. */
async function problemsOf(text: string): Promise<readonly string[]> {
  const refusal = await loadAtlasConfig(rootWith(text)).then(() => null, (error: unknown) => error);
  expect(refusal).toBeInstanceOf(AtlasConfigError);
  return (refusal as AtlasConfigError).problems;
}

describe('loadAtlasConfig', () => {
  it('reads every target as null when there is no file', async () => {
    expect(await loadAtlasConfig(join(scope, 'nothing'))).toEqual({ budget: { tokensPerWeek: null }, wipLimit: null });
  });

  it('reads both targets back from <root>/.rafa/atlas/config.json', async () => {
    const root = rootWith(JSON.stringify({ budget: { tokensPerWeek: 18_000_000 }, wipLimit: 3 }));

    expect(atlasConfigPathOf(root)).toBe(join(root, '.rafa', 'atlas', 'config.json'));
    expect(await loadAtlasConfig(root)).toEqual({ budget: { tokensPerWeek: 18_000_000 }, wipLimit: 3 });
  });

  it('reads null, an empty object and an absent key as no target', async () => {
    expect(await loadAtlasConfig(rootWith('{"budget":{"tokensPerWeek":null},"wipLimit":null}'))).toEqual(DEFAULT_ATLAS_CONFIG);
    expect(await loadAtlasConfig(rootWith('{}'))).toEqual(DEFAULT_ATLAS_CONFIG);
    expect(await loadAtlasConfig(rootWith('{"wipLimit":2}'))).toEqual({ budget: { tokensPerWeek: null }, wipLimit: 2 });
  });

  it.each([0, -1, 2.5, '3'])('refuses %p as a target, naming the key', async (value) => {
    expect(await problemsOf(JSON.stringify({ wipLimit: value }))).toEqual([
      `wipLimit is ${JSON.stringify(value)}, expected a whole number above zero, or null for no target`,
    ]);
  });

  it('names every problem at once: unknown keys and bad values', async () => {
    const problems = await problemsOf(JSON.stringify({ budget: { tokensPerWeek: -5, usd: 10 }, wip: 3 }));

    expect(problems).toEqual([
      'wip is not a key Atlas reads; it reads budget and wipLimit',
      'budget.usd is not a key Atlas reads; it reads budget.tokensPerWeek',
      'budget.tokensPerWeek is -5, expected a whole number above zero, or null for no target',
    ]);
  });

  it('refuses a file that is not JSON, or not an object', async () => {
    expect((await problemsOf('{ budget'))[0]).toStartWith('the file is not JSON: ');
    expect(await problemsOf('[1]')).toEqual(['the file is not a JSON object']);
    expect(await problemsOf('{"budget":7}')).toEqual(['budget is 7, expected an object holding tokensPerWeek']);
  });

  it('names the file in the refusal', async () => {
    const root = rootWith('[]');

    await expect(loadAtlasConfig(root)).rejects.toThrow(`atlas: ${atlasConfigPathOf(root)} holds 1 problem`);
  });
});

describe('withAtlasTargets', () => {
  const metrics: ReadonlyMap<string, MetricDefinition> = new Map(METRIC_CATALOGUE.map((metric) => [metric.id, metric]));

  it('sets the weekly budget as the goal of pm.budget-burn alone, in a new map', () => {
    const targeted = withAtlasTargets(metrics, { budget: { tokensPerWeek: 18_000_000 }, wipLimit: null });

    expect(targeted).not.toBe(metrics);
    expect(targeted.get(BUDGET_METRIC)?.goal).toBe(18_000_000);
    expect(metrics.get(BUDGET_METRIC)?.goal).toBeUndefined();
    expect([...targeted.keys()]).toEqual([...metrics.keys()]);
    for (const [id, metric] of targeted) if (id !== BUDGET_METRIC) expect(metric).toBe(metrics.get(id) as MetricDefinition);
  });

  it('control: hands the metrics back as they were with no budget set', () => {
    expect(withAtlasTargets(metrics, DEFAULT_ATLAS_CONFIG)).toBe(metrics);
  });
});
