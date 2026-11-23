/**
 * `describe`: the sources the registry serves and the metric ids of each
 * lens, read from the specs and the catalogue the module ships. It opens
 * no replica and reads no store, so it answers before the first build;
 * the build stamps (`asOf`, `partial`) are the API's to serve.
 *
 * `--source=<id>` narrows the answer to one source, with every field it
 * exposes and the metrics drawn from it; an id the registry does not
 * define is refused, naming the ids it does.
 */
import type { Lens, MetricDefinition } from '@open-tomato/atlas-data/contract';
import type { TableSourceSpec } from '@open-tomato/atlas-data/source';
import type { RafaCommand, RafaContext } from '@open-tomato/rafa-core/core/command';

import { METRIC_CATALOGUE } from '../metrics/catalogue.js';
import { SOURCE_SPECS } from '../sources.js';

import { execLine, refusing, SUBJECT } from './shared.js';

/** The four lenses, in the order the demo's tabs show them. */
const LENS_ORDER: readonly Lens[] = ['pm', 'architect', 'developer', 'qa'];

/** What `describe` answers: the source specs' descriptors, and the metric ids by lens. */
export interface AtlasDescription {
  readonly sources: readonly TableSourceSpec['descriptor'][];
  readonly metricsByLens: Readonly<Record<Lens, readonly string[]>>;
}

/** The ids of `metrics` by lens, each lens in catalogue order. */
export function metricsByLens(metrics: readonly MetricDefinition[]): Record<Lens, readonly string[]> {
  const idsOf = (lens: Lens): readonly string[] => metrics.filter((metric) => metric.lenses.includes(lens)).map((metric) => metric.id);
  return { pm: idsOf('pm'), architect: idsOf('architect'), developer: idsOf('developer'), qa: idsOf('qa') };
}

/** The description of every source, or of the one `sourceId` names; null for an id no spec defines. */
export function describeAtlas(sourceId?: string): AtlasDescription | null {
  const specs = sourceId === undefined
    ? SOURCE_SPECS
    : SOURCE_SPECS.filter((spec) => spec.descriptor.id === sourceId);
  if (specs.length === 0) return null;
  const metrics = sourceId === undefined
    ? METRIC_CATALOGUE
    : METRIC_CATALOGUE.filter((metric) => metric.sourceId === sourceId);
  return { sources: specs.map((spec) => spec.descriptor), metricsByLens: metricsByLens(metrics) };
}

/** The lines `describe` prints; with one source, every field of it too. */
export function describeLines(description: AtlasDescription, withFields: boolean): string[] {
  const lines: string[] = [];
  for (const source of description.sources) {
    lines.push(`${source.id}  ${source.title}: ${source.description}`);
    if (withFields) {
      for (const field of source.fields) lines.push(`  ${field.key}  ${field.role} ${field.type}${field.unit === undefined
        ? ''
        : ` (${field.unit})`}`);
    }
  }
  lines.push('metrics by lens:');
  for (const lens of LENS_ORDER) {
    const ids = description.metricsByLens[lens];
    lines.push(`  ${lens}: ${ids.length === 0
      ? 'none'
      : ids.join(', ')}`);
  }
  return lines;
}

/** The `--source` flag's value, or undefined when absent; refuses a bare `--source`. */
function sourceFlagOf(context: RafaContext): string | undefined {
  const value = context.flags['source'];
  if (value === undefined || value === false) return undefined;
  if (value === true || value.trim() === '') throw new Error('--source needs a source id, such as local.tasks');
  return value.trim();
}

export const describeCommand: RafaCommand = {
  name: 'atlas describe',
  subject: SUBJECT,
  action: 'describe',
  summary: 'list the Atlas sources and the metric ids of each lens',
  description: 'Prints every source the Atlas API serves, with its title and description, and the metric ids of each lens. With --source=<id>, prints that source\'s fields and the metrics drawn from it. Reads no store and no replica; exits 1 with an error line on an id no source has.',
  args: [],
  flags: [{ name: 'source', description: 'the one source to describe, such as local.tasks', type: 'string' }],
  examples: [
    { cmd: execLine('describe'), note: 'lists the sources and the metrics of each lens' },
    { cmd: execLine('describe', '--source=local.daily'), note: 'lists the fields of local.daily and the metrics drawn from it' },
  ],
  outputs: ['text', 'json'],
  needsProject: false,
  run: (context) => refusing(context, () => {
    const sourceId = sourceFlagOf(context);
    const description = describeAtlas(sourceId);
    if (description === null) {
      const known = SOURCE_SPECS.map((spec) => spec.descriptor.id).join(', ');
      throw new Error(`atlas: no source ${sourceId ?? ''}; the sources are ${known}`);
    }
    if (context.outputMode === 'json') context.output.result(description);
    else for (const line of describeLines(description, sourceId !== undefined)) context.output.info(line);
    return Promise.resolve();
  }),
};
