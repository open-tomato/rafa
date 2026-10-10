/**
 * The project's field writes: setting and clearing the values of items
 * (`.rafa/specs/rafa-791-github-project-each-repository.md`), batched
 * into one `gh api graphql` request of several aliased mutations, and
 * paced between requests. {@link writeProjectFields} sends them through
 * the `GhRunner` seam (`src/adapters/tracker/github.ts`), as the port's
 * adapter in `./gh.ts` does, so no case reaches GitHub.
 *
 * ## Batches and pace
 *
 * The writes go {@link ProjectWritesOptions.batchSize} to a request, in
 * the order given, with a pause of {@link ProjectWritesOptions.pauseMs}
 * between two requests and none before the first or after the last. The
 * two are `board.project.writeBatchSize` and `board.project.writePauseMs`,
 * which every caller reads off its config and passes; a size that is not
 * a whole number from 1 or a pause that is not one from 0 throws a
 * `RangeError` with nothing sent. Each write is one
 * aliased mutation, `w0` to `w<n>`, naming its item, field and value as
 * GraphQL variables, never spliced into the mutation text. Every write is
 * checked before the first request goes, so a write GitHub could not hold
 * throws a `RangeError` with nothing sent.
 *
 * ## What `gh` and the schema answered
 *
 * Read off the schema by introspection with `gh` 2.100.0 on 2026-10-06,
 * read-only: `updateProjectV2ItemFieldValue` takes `projectId`, `itemId`,
 * `fieldId` and a `value` of `ProjectV2FieldValue`, whose
 * `singleSelectOptionId` and `text` are `String` and `number` is `Float`;
 * `clearProjectV2ItemFieldValue` takes the same three ids and no value;
 * both answer `projectV2Item`.
 *
 * `gh api graphql --verbose` the same day showed `-F n=2` sent as the
 * integer `2` and `-F n=1.5` as the string `"1.5"`: `gh` turns only a
 * whole number into a number. A number write is therefore a whole number,
 * as every Rank is, and any other throws a `RangeError`.
 *
 * The request {@link writeBatchArgs} builds — a set of each kind and a
 * clear — was sent the same day with one variable more, declared and
 * unused, so GitHub refused it at validation and ran nothing: the one
 * error it answered was that variable's `variableNotUsed`. The control,
 * the same request with the number's variable declared `Boolean!`,
 * answered a `variableMismatch` at `mutation.w1.input.value.number`
 * beside it, so validation reports more than its first error.
 *
 * No mutation was sent to GitHub, and no rate limit was hit, so the
 * answers below are NOT readings: they are GitHub's documentation, which
 * says a GraphQL request over the primary limit answers an error of
 * `type` `RATE_LIMITED`, and one over a secondary limit an HTTP 403 or
 * 429 naming the secondary rate limit, which `gh` writes on stderr.
 *
 * ## A rate-limit refusal
 *
 * A failed request whose answer holds an error of `type` `RATE_LIMITED`,
 * or whose stderr names a rate limit, stops the writes: no later request
 * goes, and the result names how many issues were not updated — the
 * items with at least one write that did not land, those of that request
 * and every later one — with {@link ProjectWritesResult.rateLimited} set
 * and what `gh` wrote kept. A write the refused request's data answers
 * anyway counts as written. It is never thrown, so a caller tells the
 * user to run `rafa board sync` rather than failing its own command.
 *
 * Any other failed request, or an answer that is not the shape above,
 * rejects with a `ProjectPortError` keeping what `gh` wrote, as the
 * port's reads do, so the caller can tell a missing `project` scope apart.
 *
 * ## Progress
 *
 * Given {@link ProjectWritesOptions.progress}, the writes are the
 * `writing fields` phase (`./progress.ts`): its total is the writes
 * given, it advances by the writes sent after each request, a pause
 * between two requests is a wait line only when it is at least
 * `board.project.progressSeconds` long (so none for the default pause,
 * and none with `progressSeconds: false`), and its end counts the writes GitHub answered and, as refused, those a
 * rate-limit refusal left unwritten. A rejection ends no phase.
 */
import type { ProgressFeed } from './progress.js';
import type { GhRunner } from '../../adapters/tracker/github.js';

import { isMapping } from '../../config-sections.js';

import {
  graphqlArgs,
  parsed,
  readMapping,
  readString,
  requireNodeId,
  written,
} from './gh.js';
import { ProjectPortError } from './port.js';
import { openPhase } from './progress.js';

/** The value a set writes, by the kind of its field. */
export type ProjectWriteValue =
  | { readonly kind: 'option'; readonly optionId: string }
  | { readonly kind: 'number'; readonly number: number }
  | { readonly kind: 'text'; readonly text: string };

/** One write of one item's field: a value set, or the value cleared. */
export type ProjectFieldWrite =
  | { readonly kind: 'set'; readonly itemId: string; readonly fieldId: string; readonly value: ProjectWriteValue }
  | { readonly kind: 'clear'; readonly itemId: string; readonly fieldId: string };

/** What {@link writeProjectFields} answers. */
export interface ProjectWritesResult {
  /** The writes GitHub answered, of those given. */
  readonly written: number;
  /** The issues, as distinct items, with a write that did not land; 0 unless rate-limited. */
  readonly notUpdated: number;
  /** True when a rate-limit refusal stopped the writes. */
  readonly rateLimited: boolean;
  /** What `gh` wrote on the refusal; empty unless rate-limited. */
  readonly detail: string;
}

/** What {@link writeProjectFields} is paced by, and its seam. */
export interface ProjectWritesOptions {
  /** The field writes sent in one request: `board.project.writeBatchSize`. */
  readonly batchSize: number;
  /** The pause between two requests, in milliseconds: `board.project.writePauseMs`. */
  readonly pauseMs: number;
  /** The pause between two requests; `Bun.sleep` when left out. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Hears the `writing fields` phase; silent when left out. See the module note. */
  readonly progress?: ProgressFeed;
}

/** The GraphQL error type GitHub documents for a request over the primary rate limit. */
const RATE_LIMITED = 'RATE_LIMITED';

/** What `gh` writes for a primary or secondary rate limit, by GitHub's documentation. */
const RATE_LIMIT_TEXT = /\brate limit/iu;

/** The mutation of each kind of write. */
const MUTATIONS = Object.freeze({ set: 'updateProjectV2ItemFieldValue', clear: 'clearProjectV2ItemFieldValue' } as const);

/** The `ProjectV2FieldValue` key and GraphQL type of each kind of value. */
const VALUE_INPUTS = Object.freeze({
  option: { key: 'singleSelectOptionId', type: 'String!' },
  number: { key: 'number', type: 'Float!' },
  text: { key: 'text', type: 'String!' },
} as const);

/** The alias of the `index`th write of a request. */
export function writeAlias(index: number): string {
  return `w${String(index)}`;
}

/** Throws a `RangeError` on a write GitHub could not hold; see the module note. */
function requireWrite(write: ProjectFieldWrite): void {
  requireNodeId(write.itemId, 'an item');
  requireNodeId(write.fieldId, 'a field');
  if (write.kind === 'clear') return;
  const { value } = write;
  if (value.kind === 'option') requireNodeId(value.optionId, 'an option');
  if (value.kind === 'number' && !Number.isSafeInteger(value.number)) {
    throw new RangeError(`not a whole number gh sends as one: ${String(value.number)}`);
  }
  if (value.kind === 'text' && value.text === '') throw new RangeError('not a text to set: an empty one, which is a clear');
}

/** The value of a set as `gh` sends it: the number as an integer with `-F`, the rest with `-f`. */
function valueField(value: ProjectWriteValue, name: string): readonly ['-f' | '-F', string, string] {
  if (value.kind === 'number') return ['-F', name, String(value.number)];
  return ['-f', name, value.kind === 'option'
    ? value.optionId
    : value.text];
}

/** The variable declarations, the aliased mutation and the fields of the `index`th write. */
function writePart(write: ProjectFieldWrite, index: number): {
  declarations: string;
  mutation: string;
  fields: readonly (readonly ['-f' | '-F', string, string])[];
} {
  const [item, field, value] = ['item', 'field', 'value'].map((name) => `${name}${String(index)}`) as [string, string, string];
  const ids = `projectId: $project, itemId: $${item}, fieldId: $${field}`;
  const idFields = [['-f', item, write.itemId], ['-f', field, write.fieldId]] as const;
  const payload = '{ projectV2Item { id } }';
  if (write.kind === 'clear') {
    return { declarations: `$${item}: ID!, $${field}: ID!`, mutation: `${writeAlias(index)}: ${MUTATIONS.clear}(input: { ${ids} }) ${payload}`, fields: idFields };
  }
  const input = VALUE_INPUTS[write.value.kind];
  return {
    declarations: `$${item}: ID!, $${field}: ID!, $${value}: ${input.type}`,
    mutation: `${writeAlias(index)}: ${MUTATIONS.set}(input: { ${ids}, value: { ${input.key}: $${value} } }) ${payload}`,
    fields: [...idFields, valueField(write.value, value)],
  };
}

/** The argv of one request sending `batch` to the project `projectId`; throws a `RangeError` on a write GitHub could not hold. */
export function writeBatchArgs(projectId: string, batch: readonly ProjectFieldWrite[]): readonly string[] {
  requireNodeId(projectId, 'a project');
  if (batch.length === 0) throw new RangeError('not a batch of writes: an empty one');
  batch.forEach(requireWrite);
  const parts = batch.map(writePart);
  const declarations = ['$project: ID!', ...parts.map((part) => part.declarations)].join(', ');
  const query = `mutation(${declarations}) { ${parts.map((part) => part.mutation).join(' ')} }`;
  return graphqlArgs(query, [['-f', 'project', projectId], ...parts.flatMap((part) => part.fields)]);
}

/** Throws a `RangeError` on a batch size below 1 or a pause below 0, or either not a whole number. */
function requirePace(batchSize: number, pauseMs: number): void {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new RangeError(`not a batch size of writes: ${String(batchSize)}, expected a whole number from 1`);
  }
  if (!Number.isSafeInteger(pauseMs) || pauseMs < 0) {
    throw new RangeError(`not a pause between write requests: ${String(pauseMs)}, expected a whole number from 0`);
  }
}

/** `writes` cut into requests of `batchSize`, in order. */
function batchesOf(writes: readonly ProjectFieldWrite[], batchSize: number): readonly (readonly ProjectFieldWrite[])[] {
  return Array.from({ length: Math.ceil(writes.length / batchSize) }, (_, index) => writes
    .slice(index * batchSize, (index + 1) * batchSize));
}

/** True when a failed request is a rate-limit refusal; see the module note. */
function isRateLimited(stdout: string, stderr: string): boolean {
  const answer = parsed(stdout);
  const errors = isMapping(answer) && Array.isArray(answer['errors'])
    ? answer['errors']
    : [];
  return errors.some((error) => isMapping(error) && error['type'] === RATE_LIMITED) || RATE_LIMIT_TEXT.test(stderr);
}

/** The indexes of the writes a refused request's data answers anyway. */
function landedAnyway(stdout: string, size: number): ReadonlySet<number> {
  const answer = parsed(stdout);
  const data = isMapping(answer) && isMapping(answer['data'])
    ? answer['data']
    : {};
  return new Set(Array.from({ length: size }, (_, index) => index).filter((index) => {
    const alias = data[writeAlias(index)];
    const item = isMapping(alias)
      ? alias['projectV2Item']
      : undefined;
    return isMapping(item) && typeof item['id'] === 'string' && item['id'] !== '';
  }));
}

/** What one request answered: all landed, or the writes landed before a rate-limit refusal. */
type BatchOutcome =
  | { readonly rateLimited: false }
  | { readonly rateLimited: true; readonly landed: ReadonlySet<number>; readonly detail: string };

/** Sends one request of `size` writes; rejects on any failure but a rate limit. */
async function sendBatch(gh: GhRunner, args: readonly string[], size: number): Promise<BatchOutcome> {
  const result = await gh(args);
  if (!result.ok) {
    const detail = written(result.stdout, result.stderr);
    if (isRateLimited(result.stdout, result.stderr)) return { rateLimited: true, landed: landedAnyway(result.stdout, size), detail };
    throw new ProjectPortError(`gh api graphql failed: ${detail}`, detail);
  }
  const answer = parsed(result.stdout);
  if (answer === undefined) throw new ProjectPortError('gh api graphql answered text that is not JSON', result.stdout);
  const data = readMapping(readMapping(answer, 'the answer')['data'], 'data');
  for (let index = 0; index < size; index += 1) {
    const where = `data.${writeAlias(index)}`;
    readString(readMapping(readMapping(data[writeAlias(index)], where)['projectV2Item'], `${where}.projectV2Item`)['id'], `${where}.projectV2Item.id`);
  }
  return { rateLimited: false };
}

/** How many distinct items `writes` names. */
function itemCount(writes: readonly ProjectFieldWrite[]): number {
  return new Set(writes.map((write) => write.itemId)).size;
}

/**
 * Sends `writes` to the project whose node id is `projectId`, batched and
 * paced by `options`, stopping on a rate-limit refusal; see the module note.
 */
export async function writeProjectFields(
  gh: GhRunner,
  projectId: string,
  writes: readonly ProjectFieldWrite[],
  options: ProjectWritesOptions,
): Promise<ProjectWritesResult> {
  const { batchSize, pauseMs } = options;
  requirePace(batchSize, pauseMs);
  const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms));
  const batches = batchesOf(writes, batchSize);
  const requests = batches.map((batch) => writeBatchArgs(projectId, batch));
  const phase = openPhase(options.progress, 'writes', writes.length);
  let sent = 0;
  for (const [index, batch] of batches.entries()) {
    if (index > 0) {
      phase.wait(pauseMs);
      await sleep(pauseMs);
    }
    const outcome = await sendBatch(gh, requests[index] ?? [], batch.length);
    if (outcome.rateLimited) {
      const unwritten = [...batch.filter((_, at) => !outcome.landed.has(at)), ...batches.slice(index + 1).flat()];
      const written = sent + outcome.landed.size;
      phase.end({ done: written, refused: writes.length - written });
      return { written, notUpdated: itemCount(unwritten), rateLimited: true, detail: outcome.detail };
    }
    sent += batch.length;
    phase.advance(sent);
  }
  phase.end({ done: sent, refused: 0 });
  return { written: sent, notUpdated: 0, rateLimited: false, detail: '' };
}
