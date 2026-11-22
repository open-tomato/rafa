/**
 * The error the engine and `applyFormula` throw for a meaning error: params
 * that pass the schema but name a field the source lacks, an aggregate the
 * field refuses, or a column a formula cannot read. A handler answers it as
 * 400 `invalid_params` with `details` as the error's details.
 */

/** Field names only: never a path, a value or SQL text. */
export interface InvalidParamsDetails {
  readonly fields: readonly string[];
}

export class InvalidParams extends Error {
  override readonly name: string = 'InvalidParams';
  readonly details: InvalidParamsDetails;

  constructor(message: string, fields: readonly string[] = []) {
    super(message);
    this.details = { fields: [...fields] };
  }
}
