/**
 * Where a resolved setting came from: the record `ResolvedConfig`
 * carries beside its values, `provenance` (`config.ts`).
 *
 * ## An origin
 *
 * A {@link SettingOrigin} names the file that answered one setting and
 * the entry of that file that last set it, zero-based, as
 * `@open-tomato/define-config` counts a module file's entries. A YAML
 * file is one entry, so every setting it answers is entry 0. A setting
 * the command line or a default answered has no origin: no file set it.
 *
 * `resolveConfig` ranks four files, two per scope: the project's local
 * file, the project's file, the user scope's local file and the user
 * scope's file, highest first. {@link originOf} takes the FILE that
 * answered a setting, never a source name, so the two user files, which
 * both report source `user`, each name their own path, as the project's
 * local file (`local`) and its other file (`file`) do. `cli` and
 * `default` name no file and answer none. A map setting merged across
 * several files names the highest of them, the file its source names.
 *
 * A setting a template answered (`template`) names the file whose
 * `templates` key named it, which is the file that answered, since a
 * file's templates are laid under its own keys, with the entry of that
 * file that last set `templates`, and carries the template's name as
 * `template`. An origin a file's own key gave carries no `template`.
 *
 * No file of a scope shadows another: each scope is read from its
 * module file and its YAML file over it (`config-load.ts`), so no
 * record here names a file left unread.
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

/**
 * The origin of `setting`, read off the file that answered it; see the
 * module note.
 *
 * @param source - The layer that answered the setting.
 * @param setting - The setting.
 * @param answeredBy - The file that answered it, or null where the
 *   command line or a default did.
 * @returns The file and entry, or null for the command line, a default,
 *   or a template the file records none for.
 */
export function originOf(
  source: ConfigSource,
  setting: ConfigSetting,
  answeredBy: ConfigFile | null,
): SettingOrigin | null {
  if (answeredBy === null || source === 'cli' || source === 'default') return null;
  if (source !== 'template') return Object.freeze({ file: answeredBy.path, entry: answeredBy.entries?.get(setting) ?? 0 });
  const template = answeredBy.templates?.get(setting);
  if (template === undefined) return null;
  return Object.freeze({ file: answeredBy.path, entry: answeredBy.entries?.get('templates') ?? 0, template });
}
