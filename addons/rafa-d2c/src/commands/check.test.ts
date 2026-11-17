import { afterEach, describe, expect, it } from 'bun:test';

import { makeTestProject, TempDirs, testContext, writeConfigFile } from '../testing.js';

import { checkCommand } from './check.js';

const temp = new TempDirs();
afterEach(() => temp.clean());

describe('the check command', () => {
  it('prints the run line and finishes when nothing is missing', async () => {
    const project = await makeTestProject(temp, { storeKind: 'local-dir' });
    await writeConfigFile(project);
    const { context, printed } = testContext(project.root);
    await checkCommand.run(context);

    expect(printed.error).toEqual([]);
    expect(printed.info.join('\n')).toContain('this run will seed');
  });

  it('prints each gap as an error and refuses', async () => {
    const project = await makeTestProject(temp, { storeKind: 'local-dir', runner: { kind: 'container' } });
    await writeConfigFile(project);
    const { context, printed } = testContext(project.root);

    expect(checkCommand.run(context)).rejects.toThrow('check: 1 gap');
    expect(printed.error.join('\n')).toContain('cut 2');
  });

  it('prints every config problem and refuses', async () => {
    const project = await makeTestProject(temp, { storeKind: 'local-dir' });
    await Bun.write(project.loaded.file, 'visual:\n  suite: {}\n');
    const { context, printed } = testContext(project.root);

    expect(checkCommand.run(context)).rejects.toThrow('d2c config');
    expect(printed.error.length).toBeGreaterThan(1);
  });
});
