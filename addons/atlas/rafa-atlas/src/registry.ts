/**
 * `openAtlasRegistry`: the sources and the metric catalogue the handler
 * serves, over the replica under a project root.
 *
 * The registry opens one replica reader and defines every source of
 * `SOURCE_SPECS` over it, so each call answers from the replica the build
 * last renamed in. It throws `ReplicaUnavailable` when there is no replica
 * to open; the fix is a build. Nothing here builds one.
 */
import type { MetricDefinition } from '@open-tomato/atlas-data/contract';
import type { DataSource, TableSourceOptions } from '@open-tomato/atlas-data/source';

import { openReplica } from '@open-tomato/atlas-data/replica';
import { defineTableSource } from '@open-tomato/atlas-data/source';

import { replicaPathOf } from './build/index.js';
import { METRIC_CATALOGUE } from './metrics/catalogue.js';
import { SOURCE_SPECS } from './sources.js';

/**
 * What the handler serves: the sources and the metrics by id, and the
 * replica's build time. The shape the handler of spec section D1 takes.
 */
export interface AtlasRegistry {
  readonly sources: ReadonlyMap<string, DataSource>;
  readonly metrics: ReadonlyMap<string, MetricDefinition>;
  /** The replica's `built_at` stamp. */
  asOf(): string | null;
  /** Closes the replica reader; a later query throws. */
  close(): void;
}

export interface RegistryOptions {
  /** The project root: the main checkout, which holds the replica. */
  readonly projectRoot: string;
  /** The replica file; defaults to `<projectRoot>/.rafa/atlas/atlas.sqlite`. */
  readonly replicaPath?: string;
  /** Handed to every source: the clock a `last` window counts back from, and the scan cap. */
  readonly sourceOptions?: TableSourceOptions;
}

/** Open the registry over the replica `options` name; throws `ReplicaUnavailable` when there is none. */
export async function openAtlasRegistry(options: RegistryOptions): Promise<AtlasRegistry> {
  const reader = openReplica(options.replicaPath ?? replicaPathOf(options.projectRoot));
  const sources = SOURCE_SPECS.map((spec) => defineTableSource(reader, spec, options.sourceOptions));
  return {
    sources: new Map(sources.map((source) => [source.id, source])),
    metrics: new Map(METRIC_CATALOGUE.map((metric) => [metric.id, metric])),
    asOf: () => reader.read((replica) => replica.meta.builtAt),
    close: () => {
      reader.close();
    },
  };
}
