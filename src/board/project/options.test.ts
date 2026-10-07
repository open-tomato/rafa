/**
 * Tests for the Stage and Horizon option lists (`./options.ts`): that
 * `./rules.ts` and `./port.ts` each load as the first and only import of
 * a fresh process, the reading the module note records failing while the
 * lists lived in `./rules.ts`, and that `src/commands/init.ts`, which
 * reaches both through its project step, loads the same way.
 *
 * Each load is its own `bun` process, since a module loaded once in this
 * one would be read from the cache and prove nothing about the order.
 * The control is a script that throws on load: its exit code and stderr
 * show the reading can fail.
 */
import { describe, expect, it } from 'bun:test';

import { HORIZON_OPTIONS, STAGE_OPTIONS } from './options.js';

/** How long one `bun` process may take to load the graph. */
const LOAD_TIMEOUT = 30_000;

/** What `bun --eval` wrote and exited with, having loaded `script`. */
function evaluated(script: string): { readonly exitCode: number; readonly stderr: string } {
  const run = Bun.spawnSync([process.execPath, '--eval', script], { cwd: import.meta.dir, stderr: 'pipe', stdout: 'pipe' });
  return { exitCode: run.exitCode, stderr: run.stderr.toString() };
}

/** The script that loads `path`, resolved against this directory, and nothing else. */
function loadOnly(path: string): string {
  return `await import(${JSON.stringify(new URL(path, import.meta.url).href)});`;
}

describe('the option lists', () => {
  it('names the template\'s eleven Stage options and five Horizon options, left to right', () => {
    expect(STAGE_OPTIONS).toHaveLength(11);
    expect([STAGE_OPTIONS[0], STAGE_OPTIONS[10]]).toEqual(['Backlog', 'Cancelled']);
    expect(HORIZON_OPTIONS).toEqual(['Later', 'Next', 'Now', 'Done', 'Cancelled']);
  });

  it('lets the rules, the port and rafa init each load first and alone, where a throwing script fails', () => {
    const control = evaluated('throw new Error("loaded and failed");');
    const loads = ['./rules.ts', './port.ts', '../../commands/init.ts'].map((path) => evaluated(loadOnly(path)));

    expect(control.exitCode).not.toBe(0);
    expect(control.stderr).toContain('loaded and failed');
    expect(loads.map((load) => load.exitCode)).toEqual([0, 0, 0]);
    expect(loads.map((load) => load.stderr)).toEqual(['', '', '']);
  }, LOAD_TIMEOUT);
});
