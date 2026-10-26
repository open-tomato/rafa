/**
 * The config rows of `rafa doctor`: what the config load warned about
 * and which `dangerous.*` keys it passed, written as soon as the config
 * is loaded and before any item is probed.
 *
 * ```text
 * warn: rafa config: unknown key "nonesuch" in /repo/rafa.config.ts has no effect in this version (known keys: …)
 * Config:
 *   note  dangerous.selfUpdateDuringLoop: true (/repo/rafa.config.ts, entry 0)
 * ```
 *
 * ## The rows
 *
 *   - One `warn` row per config warning the load wrote, in its order and
 *     in its words, written as a warning, as `doctor`'s stretch, release
 *     and install rows are. A key set twice in one file, an unknown key
 *     and a tier pin no tier loads are each one. A scope holding a
 *     module file beside its `.rafa/config.yaml` writes no row for it:
 *     the load reads both, the YAML file over the module file.
 *   - One `note` row per `dangerous.*` key set off its default, under
 *     the `Config:` title as the `Skill tiers` notes sit under theirs
 *     (`./doctor-deep-row.ts`): the key, then its value, file and entry,
 *     the pass line `packages/rafa/src/core/config/dangerous.ts` words. It is a note
 *     and not a warning: the key is a person's consent, given once in a
 *     file, and nothing is wrong with it.
 *
 * A config with no warning and no pass writes nothing, and a YAML
 * project reads `doctor` byte for byte as it did before these rows:
 * `src/tests/fixtures/config-parity/doctor.txt` holds that, its unknown
 * key a `warn` line in the same place.
 *
 * ## Where the rows come from
 *
 * `loadConfig` (`packages/rafa/src/core/config/config-load.ts`) writes every warning,
 * then every pass line, through the sink its caller hands it, and
 * nowhere else. In text mode {@link loadDoctorConfig} hands a sink that
 * holds them, and once the load resolved writes each as its row, so a
 * pass is a note and never also a warning. Every warning opens with
 * `rafa config:` and every pass line with `dangerous.`, which is how
 * {@link doctorConfigRows} tells them apart. Reading the passes off the
 * sink keeps the one listing of dangerous keys in core, behind no
 * barrel a file outside `packages/rafa/src/core/` may import.
 *
 * In json mode the sink is the output's `warn`, as before these rows:
 * every warning and pass line is a `log` event at `warn`, and the
 * `Config:` notes are not written. Nothing here changes `doctor`'s exit
 * code. A config the load refuses is refused by the caller with no row
 * written: the load writes through its sink only once it resolved.
 */
import type { DeepRow } from './doctor-deep-row.js';
import type { RafaContext } from '@open-tomato/rafa/core/command';
import type { ResolvedConfig } from '@open-tomato/rafa/core/config';

import { renderDeepRow } from './doctor-deep-row.js';

/** The title the `note` rows are written under. */
export const CONFIG_ROWS_TITLE = 'Config:';

/** What every pass line `loadConfig` writes opens with. */
const DANGEROUS_PREFIX = 'dangerous.';

/** The rows of one load: the warnings, in the load's words, and the passes. */
export interface DoctorConfigRows {
  /** One line per config warning, each written as a `warn` row. */
  readonly warnings: readonly string[];
  /** One `note` row per `dangerous.*` key set off its default. */
  readonly passes: readonly DeepRow[];
}

/** The `note` row of one pass line, `dangerous.<key>: <value> (<where>)`, named by its key. */
function passRow(line: string): DeepRow {
  const colon = line.indexOf(': ');
  return colon === -1
    ? { status: 'note', name: line, detail: 'set off its default' }
    : { status: 'note', name: line.slice(0, colon), detail: line.slice(colon + 2) };
}

/**
 * The rows of the lines one load wrote through its sink; see the module
 * note.
 *
 * @param written - Every line the load wrote, in its order.
 * @returns The warnings, in the load's order and words, and a `note`
 *   row per pass line.
 */
export function doctorConfigRows(written: readonly string[]): DoctorConfigRows {
  return {
    warnings: written.filter((line) => !line.startsWith(DANGEROUS_PREFIX)),
    passes: written.filter((line) => line.startsWith(DANGEROUS_PREFIX)).map(passRow),
  };
}

/** The lines text mode writes at `info` for `passes`: the title and each row, or none for no pass. */
export function renderDoctorConfigNotes(passes: readonly DeepRow[]): readonly string[] {
  return passes.length === 0
    ? []
    : [CONFIG_ROWS_TITLE, ...passes.flatMap(renderDeepRow)];
}

/**
 * Runs `load` with the sink this mode takes and, in text mode, writes
 * the config rows once it resolved; see the module note.
 *
 * @param context - The invocation's output and mode.
 * @param load - Loads the config through the sink it is handed; a
 *   refusal it throws passes through, with no row written.
 * @returns What `load` resolved.
 */
export async function loadDoctorConfig(
  context: Pick<RafaContext, 'output' | 'outputMode'>,
  load: (warn: (message: string) => void) => Promise<ResolvedConfig>,
): Promise<ResolvedConfig> {
  if (context.outputMode === 'json') {
    return load((message) => {
      context.output.warn(message);
    });
  }
  const written: string[] = [];
  const resolved = await load((message) => {
    written.push(message);
  });
  const rows = doctorConfigRows(written);
  for (const warning of rows.warnings) context.output.warn(warning);
  for (const line of renderDoctorConfigNotes(rows.passes)) context.output.info(line);
  return resolved;
}
