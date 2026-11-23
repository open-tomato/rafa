/**
 * Tests for the `describe` command: with no flag it lists every source
 * spec and the metric ids of each lens, with `--source` one source's
 * fields and the metrics drawn from it, json mode hands the description
 * to `output.result`, and an unknown id refuses naming the known ones.
 * It reads no store, so no fixture project is built.
 */
import { describe, expect, it } from 'bun:test';

import { METRIC_CATALOGUE } from '../metrics/catalogue.js';
import { SOURCE_SPECS } from '../sources.js';

import { describeAtlas, describeCommand } from './describe.js';
import { testContext } from './testdata/context.js';

describe('the describe command', () => {
  it('lists every source and the metric ids of each lens', async () => {
    const { context, printed } = testContext();

    await describeCommand.run(context);

    for (const spec of SOURCE_SPECS) expect(printed.info).toContain(`${spec.descriptor.id}  ${spec.descriptor.title}: ${spec.descriptor.description}`);
    expect(printed.info).toContain('metrics by lens:');
    const pmLine = printed.info.find((line) => line.startsWith('  pm: '));
    expect(pmLine).toContain('pm.budget-burn');
    expect(printed.info.some((line) => line.startsWith('  task_facts'))).toBe(false);
    expect(printed.error).toEqual([]);
  });

  it('counts every catalogue metric under each lens it names', () => {
    const description = describeAtlas();
    const listed = Object.values(description?.metricsByLens ?? {}).flat();

    const expected = METRIC_CATALOGUE.flatMap((metric) => metric.lenses.map(() => metric.id));

    expect([...listed].sort()).toEqual([...expected].sort());
  });

  it('lists one source with its fields and the metrics drawn from it under --source', async () => {
    const { context, printed } = testContext({ flags: { source: 'local.daily' } });

    await describeCommand.run(context);

    expect(printed.info[0]).toStartWith('local.daily  Days: ');
    expect(printed.info).toContain('  tokens_total  measure integer (tokens)');
    expect(printed.info.some((line) => line.startsWith('local.tasks'))).toBe(false);
    const daily = METRIC_CATALOGUE.filter((metric) => metric.sourceId === 'local.daily').map((metric) => metric.id);
    const listed = printed.info.filter((line) => /^ {2}(pm|architect|developer|qa): /.test(line)).join(' ');
    for (const id of daily) expect(listed).toContain(id);
    expect(listed).not.toContain('qa.bugs-by-kind');
  });

  it('hands the description to output.result in json mode', async () => {
    const { context, printed } = testContext({ outputMode: 'json' });

    await describeCommand.run(context);

    expect(printed.info).toEqual([]);
    expect(printed.results).toEqual([describeAtlas()]);
  });

  it('refuses an id no source has, naming the ones there are', async () => {
    const { context, printed } = testContext({ flags: { source: 'local.nope' } });

    await expect(describeCommand.run(context)).rejects.toThrow('atlas: no source local.nope');
    expect(printed.error).toHaveLength(1);
    expect(printed.error[0]).toContain('local.tasks, local.daily');
  });

  it('refuses a bare --source', async () => {
    const { context, printed } = testContext({ flags: { source: true } });

    await expect(describeCommand.run(context)).rejects.toThrow('--source needs a source id');
    expect(printed.error).toHaveLength(1);
  });
});
