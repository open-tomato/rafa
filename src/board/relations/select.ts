/**
 * Picks the {@link BoardRelations} adapter `board.relationships` names,
 * shaped like `selectEffortStore` (`../../effort/store/index.ts`): a
 * module-local table keyed by mode, and a `TypeError` naming the modes
 * when the configured value is none of them, never a silent fall back to
 * `labels`. It registers no port type in `../../adapters/registry.ts`;
 * the table below is the only place a mode meets its adapter.
 *
 * Selecting makes the adapter and sends nothing: every `gh` call waits
 * for a write the caller makes.
 */
import type { BoardRelations } from './port.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { BoardRelationshipMode } from '../../config-sections.js';
import type { RafaConfig } from '../../config.js';
import type { RoadmapBody } from '../roadmap-tick.js';

import { describeValue } from '../../config-sections.js';

import { createLabelsRelations } from './labels.js';
import { createNativeRelations } from './native.js';

/** What {@link selectBoardRelations} hands the adapter it makes. */
export interface BoardRelationsOptions {
  /** Runs every `gh` command the adapter's writes send. */
  readonly gh: GhRunner;
  /** The board's own repository, `owner/name`; read by `native` only. */
  readonly repository: string;
  /** Reads and writes an epic's body; read by `labels` only, made over `gh` when left out. */
  readonly bodies?: RoadmapBody;
}

/** Each mode's adapter, made from the selection's options. */
const ADAPTERS: Readonly<Record<BoardRelationshipMode, (options: BoardRelationsOptions) => BoardRelations>> = {
  labels: ({ gh, bodies }) => createLabelsRelations(bodies === undefined
    ? { gh }
    : { gh, bodies }),
  native: ({ gh, repository }) => createNativeRelations({ gh, repository }),
};

/**
 * The adapter `config.boardRelationships` names, made with `options`.
 *
 * Throws a `TypeError`, having made nothing, when the value names no
 * mode; the message lists the modes the table holds.
 */
export function selectBoardRelations(
  config: Pick<RafaConfig, 'boardRelationships'>,
  options: BoardRelationsOptions,
): BoardRelations {
  const mode: unknown = config.boardRelationships;
  const make = typeof mode === 'string' && Object.hasOwn(ADAPTERS, mode)
    ? ADAPTERS[mode as BoardRelationshipMode]
    : undefined;
  if (make === undefined) {
    throw new TypeError(
      `board relations: board.relationships is ${describeValue(mode)},`
        + ` expected one of: ${Object.keys(ADAPTERS).join(', ')}`,
    );
  }
  return make(options);
}
