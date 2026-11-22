/**
 * Validation through Standard Schema: a zod, valibot or arktype schema
 * alike, read only through its `~standard` member, so a custom source may
 * bring its own param schema.
 */
import type { StandardSchemaV1 } from '@standard-schema/spec';

/** The value on success, or the schema's issues on failure. */
export type Validated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly StandardSchemaV1.Issue[] };

/** Validates `value` against `schema`, awaiting a schema that answers asynchronously. */
export async function validateStandard<T>(
  schema: StandardSchemaV1<unknown, T>,
  value: unknown,
): Promise<Validated<T>> {
  const result = await schema['~standard'].validate(value);
  if (result.issues !== undefined) {
    return { ok: false, issues: result.issues };
  }
  return { ok: true, value: result.value };
}
