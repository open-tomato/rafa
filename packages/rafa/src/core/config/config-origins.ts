/**
 * Where a resolved setting came from, and which file a scope left
 * unread: the two records `ResolvedConfig` carries beside its values,
 * `provenance` and `shadowed` (`config.ts`).
 *
 * ## An origin
 *
 * A {@link SettingOrigin} names the file that answered one setting and
 * the entry of that file that last set it, zero-based, as
 * `@open-tomato/define-config` counts a module file's entries. A YAML
 * file is one entry, so every setting it answers is entry 0. A setting
 * the command line or a default answered has no origin: no file set it.
 *
 * {@link originOf} reads the origin off the layer `resolveConfig`
 * ranked first, so it follows `sources` exactly: `file` names the
 * project's file, `user` the user scope's, and `cli` and `default` name
 * none. A map setting merged across both files names the project's,
 * the file its source names.
 *
 * A setting a template answered (`template`) names the file whose
 * `templates` key named it, the project's where the project's template
 * answered and the user's otherwise, with the entry of that file that
 * last set `templates`, and carries the template's name as `template`.
 * An origin a file's own key gave carries no `template`.
 *
 * ## A shadowed file
 *
 * A scope is read from one file, the first of `rafa.config.ts`,
 * `rafa.config.mjs` and its `.rafa/config.yaml` that is a file
 * (`config-load.ts`). A {@link ShadowedFile} is a YAML file a module
 * file of its scope left unread, named so the warning and `rafa doctor`
 * can say which keys stopped applying.
 */
import type { ConfigFile, ConfigSetting, ConfigSource } from './config.js';

/** The two scopes a config file is read in. */
export type ConfigScopeName = 'user' | 'project';

/** The file and entry that answered one setting. */
export interface SettingOrigin {
  /** The file, as its layer names it. */
  readonly file: string;
  /**
   * The zero-based entry of that file that last set the setting, or for
   * a template's setting the entry that last set the file's `templates`.
   */
  readonly entry: number;
  /** The template that answered the setting, by name; absent for a file's own key. */
  readonly template?: string;
}

/** A YAML file left unread because a module file holds its scope. */
export interface ShadowedFile {
  /** The scope both files sit in. */
  readonly layer: ConfigScopeName;
  /** The YAML file left unread. */
  readonly path: string;
  /** The module file read in its place. */
  readonly by: string;
}

/** The file whose template answered `setting`: the project's where its template did, else the user's. */
function templateLayerOf(setting: ConfigSetting, file: ConfigFile | null, user: ConfigFile | null): ConfigFile | null {
  return file?.templates?.has(setting) === true
    ? file
    : user?.templates?.has(setting) === true
      ? user
      : null;
}

/**
 * The origin of `setting`, answered by the layer `source` names; see
 * the module note.
 *
 * @param source - The layer that answered the setting.
 * @param setting - The setting.
 * @param file - The project's file, or null when there was none.
 * @param user - The user scope's file, or null when there was none.
 * @returns The file and entry, or null for the command line or a default.
 */
export function originOf(
  source: ConfigSource,
  setting: ConfigSetting,
  file: ConfigFile | null,
  user: ConfigFile | null,
): SettingOrigin | null {
  const layer = source === 'file'
    ? file
    : source === 'user'
      ? user
      : source === 'template'
        ? templateLayerOf(setting, file, user)
        : null;
  if (layer === null) return null;
  const template = source === 'template'
    ? layer.templates?.get(setting)
    : undefined;
  if (template === undefined) return Object.freeze({ file: layer.path, entry: layer.entries?.get(setting) ?? 0 });
  return Object.freeze({ file: layer.path, entry: layer.entries?.get('templates') ?? 0, template });
}
