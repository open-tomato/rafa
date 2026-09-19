/**
 * Tests for what `rafa pr merge` decides about the roadmap tick
 * (`src/commands/pr/merge-tick.ts`): whether there is anything to tick,
 * which issue the roadmap is, and that nothing on the way out throws.
 *
 * Every case drives a `gh` runner of its own, routing on the argument
 * list and keeping every call, so no case spawns a process or reaches
 * GitHub. The rule the tick applies and the retry it makes are
 * `src/board/roadmap-tick.test.ts`'s; what is measured here is the calls
 * SENT, because the way this module passes while wrong is by spending a
 * search on a merge that ticks nothing or by failing a merge that is
 * already done.
 */
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { tickProblemLine, tickRoadmapAfterMerge } from './merge-tick.js';

/** The roadmap body every case plants. */
const ROADMAP = '- [ ] #20 plans from the board\n- [ ] #33 the board setup\n';

/** A recorded `gh` result that succeeded, writing `stdout`. */
function wrote(stdout: string): GhResult {
  return { ok: true, stdout, stderr: '' };
}

/** A runner answering the search, the read and the write, keeping every call. */
function stubGh(options: {
  readonly search?: string;
  readonly body?: string;
  readonly fail?: boolean;
} = {}): { run: GhRunner; calls: () => readonly (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  let stored = options.body ?? ROADMAP;
  const run: GhRunner = (args) => {
    calls.push([...args]);
    if (options.fail === true) return Promise.resolve({ ok: false, stdout: '', stderr: 'gh said no' });
    if (args[0] === 'issue') return Promise.resolve(wrote(options.search ?? '[{"number":31,"title":"Roadmap"}]'));
    const sent = args.find((arg) => arg.startsWith('body='));
    if (sent !== undefined) stored = sent.slice('body='.length);
    return Promise.resolve(wrote(JSON.stringify({ number: 31, body: stored })));
  };
  return { run, calls: () => calls };
}

/** A warn sink keeping every line. */
function sink(): { warn: (message: string) => void; lines: () => readonly string[] } {
  const lines: string[] = [];
  return { warn: (message: string): void => void lines.push(message), lines: () => lines };
}

describe('tickRoadmapAfterMerge', () => {
  it('spends no gh call at all on a pull request whose body closes no issue', async () => {
    const stub = stubGh();
    const warnings = sink();

    const result = await tickRoadmapAfterMerge({
      body: 'A pull request about nothing on the roadmap.',
      configured: 31,
      gh: stub.run,
      warn: warnings.warn,
    });

    expect(result).toBeNull();
    expect(stub.calls()).toEqual([]);
    expect(warnings.lines()).toEqual([]);
  });

  it('ticks the line of the issue the body closes, through the configured roadmap and no search', async () => {
    const stub = stubGh();
    const warnings = sink();

    const result = await tickRoadmapAfterMerge({
      body: 'Closes #20',
      configured: 31,
      gh: stub.run,
      warn: warnings.warn,
    });

    expect(result).toMatchObject({ roadmap: 31, status: 'ticked', ticked: [20], attempts: 1 });
    expect(stub.calls().map((call) => call[0])).toEqual([
      'repos/{owner}/{repo}/issues/31',
      'repos/{owner}/{repo}/issues/31',
    ]);
    expect(stub.calls()[1]).toContain('body=- [x] #20 plans from the board\n- [ ] #33 the board setup\n');
    expect(warnings.lines()).toEqual([]);
  });

  it('searches for the issue titled Roadmap when the config names none', async () => {
    const stub = stubGh();

    const result = await tickRoadmapAfterMerge({
      body: 'Fixes #33',
      configured: null,
      gh: stub.run,
      warn: sink().warn,
    });

    expect(stub.calls()[0]?.slice(0, 2)).toEqual(['issue', 'list']);
    expect(result).toMatchObject({ roadmap: 31, status: 'ticked', ticked: [33] });
  });

  it('warns rather than throwing when no issue is titled Roadmap', async () => {
    const stub = stubGh({ search: '[]' });
    const warnings = sink();

    const result = await tickRoadmapAfterMerge({
      body: 'Closes #20',
      configured: null,
      gh: stub.run,
      warn: warnings.warn,
    });

    expect(result).toBeNull();
    expect(warnings.lines()).toHaveLength(1);
    expect(warnings.lines()[0]).toContain('the roadmap was not ticked');
    expect(warnings.lines()[0]).toContain('no open issue is titled Roadmap');
  });

  it('answers a board that would not be read as a failed tick rather than throwing', async () => {
    const stub = stubGh({ fail: true });
    const warnings = sink();

    const result = await tickRoadmapAfterMerge({
      body: 'Closes #20',
      configured: 31,
      gh: stub.run,
      warn: warnings.warn,
    });

    expect(result).toMatchObject({ status: 'failed', attempts: 2 });
    expect(result?.problem).toContain('gh said no');
    expect(warnings.lines()).toEqual([]);
  });
});

describe('tickProblemLine', () => {
  it('names the tick, so the line is never read as something the merge did', () => {
    expect(tickProblemLine('gh said no')).toBe('the roadmap was not ticked: gh said no');
  });
});
