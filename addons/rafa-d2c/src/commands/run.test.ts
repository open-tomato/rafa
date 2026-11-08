import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { makeTestProject, TempDirs, testContext, writeConfigFile, writeIndex } from '../testing.js';

import { runCommand } from './run.js';

const temp = new TempDirs();
afterEach(() => temp.clean());

const FAKE_SUITE = join(import.meta.dir, '..', 'testdata', 'fake-suite.ts');

/** A project whose suite is the fake suite, with its config file written. */
async function project(spec: Record<string, unknown>) {
  const made = await makeTestProject(temp, { storeKind: 'local-dir', command: `${process.execPath} ${FAKE_SUITE}` });
  await writeConfigFile(made);
  await Bun.write(join(made.packageDir, 'fake-suite.json'), JSON.stringify({ shots: {}, counts: {}, writeReport: true, exitCode: 0, ...spec }));
  await writeIndex(made, [['Atoms/A', 'One', 'a']]);
  return made;
}

describe('the run command', () => {
  it('prints the run line before the suite, then the kind of run and the exit', async () => {
    const made = await project({ shots: { 'a--light.png': '1' }, counts: { added: 1, total: 1 } });
    const { context, printed } = testContext(made.root, { argv: ['--', '--ci'] });
    await runCommand.run(context);

    expect(printed.info[0]).toContain('this run will seed');
    expect(printed.info).toContain('seed run: 1 written, 0 compared — not a pass');
    expect(printed.info.at(-1)).toBe('suite exit 0; place ok');
    expect(await Bun.file(join(made.packageDir, 'fake-suite-argv.json')).json()).toEqual(['--ci']);
  });

  it('refuses when the suite fails, after placing', async () => {
    const made = await project({ counts: { added: 0 }, exitCode: 2 });
    const { context, printed } = testContext(made.root);

    expect(runCommand.run(context)).rejects.toThrow('suite exit 2; place ok');
    expect(printed.error).toContain('suite exit 2; place ok');
  });

  it('refuses when place fails, naming why', async () => {
    const made = await project({ writeReport: false });
    const { context } = testContext(made.root);

    expect(runCommand.run(context)).rejects.toThrow('place failed: no jest report');
  });
});
