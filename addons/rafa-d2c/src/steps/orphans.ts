/**
 * `orphans`: the set's files whose story the storybook build no longer
 * has. Read-only; removing them is a later `prune`, run by the person.
 */
import type { LoadedConfig } from '../config/load.js';
import type { SetKey } from '../store/key.js';

import { join } from 'node:path';

import { pngNames } from '../store/files.js';
import { setPaths } from '../store/key.js';
import { orphanFiles, readStoryIndex } from '../suite/storybook-jest.js';

/** The orphans of the set at one key, and how many files the set holds. */
export async function listOrphans(loaded: LoadedConfig, key: SetKey): Promise<{ orphans: readonly string[]; total: number }> {
  const { store, suite } = loaded.config.visual;
  if (store.kind === 'same-repo') throw new Error('orphans needs a store folder; same-repo arrives in a later cut');
  const indexFile = join(loaded.workRoot, suite.package, suite.index);
  let index;
  try {
    index = await readStoryIndex(indexFile);
  } catch (error) {
    throw new Error(`${error instanceof Error
      ? error.message
      : String(error)}; run the storybook build that writes it first`, { cause: error });
  }
  const files = await pngNames(setPaths(store.dir, store.set, key.playwrightVersion, key.runnerKey).snapshotsDir);
  return { orphans: orphanFiles(files, index), total: files.length };
}
