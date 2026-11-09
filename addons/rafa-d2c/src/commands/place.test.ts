import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { makeTestProject, TempDirs, testContext, writeConfigFile, writeReport, writeShots } from '../testing.js';

import { placeCommand } from './place.js';
import { seedCommand } from './seed.js';

const temp = new TempDirs();
afterEach(() => temp.clean());

describe('the place command', () => {
  it('says what kind of run it was and how to promote it', async () => {
    const project = await makeTestProject(temp, { storeKind: 'local-dir' });
    await writeConfigFile(project);
    await seedCommand.run(testContext(project.root).context);
    await writeShots(join(project.packageDir, 'visual', '__image_snapshots__'), { 'a--light.png': '1' });
    await writeReport(project, { added: 1, total: 1 });
    const { context, printed } = testContext(project.root);
    await placeCommand.run(context);

    expect(printed.info).toContain('seed run: 1 written, 0 compared — not a pass');
    expect(printed.info.at(-1)).toMatch(/^staged 1 file; promote with: rafa module exec @open-tomato\/rafa-d2c promote --run=\S+$/);
  });

  it('refuses when no run waits, naming the seed step', async () => {
    const project = await makeTestProject(temp, { storeKind: 'local-dir' });
    await writeConfigFile(project);
    const { context, printed } = testContext(project.root);

    expect(placeCommand.run(context)).rejects.toThrow('waiting to place');
    expect(printed.error.join('\n')).toContain('waiting to place');
  });
});
