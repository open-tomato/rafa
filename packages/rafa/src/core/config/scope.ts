/**
 * One scope's paths, and the project the dispatcher resolved: the
 * shapes `resolveScope` answers in `src/project/scope.ts`, and
 * {@link scopeAt}, which builds a scope from its base directory.
 *
 * The walk itself, `resolveScope` with its refusals and its hint, stays
 * in `src/project/scope.ts`, which imports these names from the config
 * barrel and re-exports them under the same names. Core holds the
 * shapes alone, so `RafaContext` can name the project a command runs in
 * and the session store can find a project's `.rafa` directory without
 * importing a file above core.
 */
import type { ConfigRoots } from './config-load.js';

import { join } from 'node:path';

import { configFilePath } from './config.js';
import { SCOPE_DIR } from './core-section.js';

/** One scope's paths: its `.rafa` directory and its config file. */
export interface Scope {
  /** `<base>/.rafa`. */
  readonly dir: string;
  /**
   * The config file. For a project found, the first of
   * {@link CONFIG_LOOKUP} its root holds; otherwise, and for the user
   * scope, `<base>/.rafa/config.yaml`, the file `rafa init` writes.
   */
  readonly configFile: string;
}

/**
 * The walk found a project. The answer is the `ConfigRoots` for
 * `loadConfig`: `root` is the project root, a real path, and `home` is
 * the home as the caller gave it.
 */
export interface ProjectFound extends ConfigRoots {
  readonly found: true;
  /** The project scope, under `root`. */
  readonly project: Scope;
  /** The user scope, under `home`. */
  readonly user: Scope;
}

/**
 * The scope under `base`: `base` is a project root or a home directory.
 * `configFile` is `file` when given, the lookup name found under
 * `base`, and `<base>/.rafa/config.yaml` otherwise.
 */
export function scopeAt(base: string, file: string = configFilePath(base)): Scope {
  return { dir: join(base, SCOPE_DIR), configFile: file };
}
