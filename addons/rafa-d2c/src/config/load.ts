/**
 * Finds and reads `.rafa/d2c.yaml` at a project root, and warns when git
 * tracks a file that describes the person's local setup.
 */

import type { ProcessRunner } from '../process.js';
import type { D2cConfig } from './read.js';

import { join } from 'node:path';

import { readD2cConfig } from './read.js';

/** The config file, from the project root. */
export const D2C_CONFIG_FILE = '.rafa/d2c.yaml';

/** The README section the tracked-config warning points to. */
export const DISCLAIMER_SECTION = '"Before you publish visual tests" in the rafa-d2c README';

/** A config as read, with where it came from and what it warns about. */
export interface LoadedConfig {
  readonly config: D2cConfig;
  /** The absolute path of the file read. */
  readonly file: string;
  /** The project root the file was found under. */
  readonly root: string;
  readonly warnings: readonly string[];
}

/** True when the config names a local folder or a host. */
function namesLocalSetup(config: D2cConfig): boolean {
  return config.visual.store.kind !== 'same-repo' || config.visual.runner.kind === 'remote';
}

/**
 * Reads the config under `root`. Throws naming the file when it is
 * missing or does not parse, and a `D2cConfigError` when it reads wrong.
 */
export async function loadD2cConfig(root: string, run: ProcessRunner): Promise<LoadedConfig> {
  const file = join(root, D2C_CONFIG_FILE);
  const source = Bun.file(file);
  if (!(await source.exists())) throw new Error(`no d2c config at ${file}; write one as the rafa-d2c README shows`);
  let raw: unknown;
  try {
    raw = Bun.YAML.parse(await source.text());
  } catch (error) {
    throw new Error(`${D2C_CONFIG_FILE} does not parse: ${error instanceof Error
      ? error.message
      : String(error)}`, { cause: error });
  }
  const config = readD2cConfig(raw);
  const tracked = await run(['git', 'ls-files', '--error-unmatch', D2C_CONFIG_FILE], { cwd: root });
  const warnings = tracked.exitCode === 0 && namesLocalSetup(config)
    ? [`${D2C_CONFIG_FILE} is tracked by git and names a local folder or host; see ${DISCLAIMER_SECTION}`]
    : [];
  return Object.freeze({ config, file, root, warnings: Object.freeze(warnings) });
}
