/**
 * The two errors of the contract, each answered by its own status.
 *
 * `InvalidParams` is the error the engine and `applyFormula` throw for a
 * meaning error: params that pass the schema but name a field the source
 * lacks, an aggregate the field refuses, or a column a formula cannot
 * read. A handler answers it as 400 `invalid_params` with `details` as the
 * error's details. `ReplicaUnavailable` is the replica reader's, below.
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

/**
 * The error a replica reader throws when it has no replica to answer
 * from: the file is missing, it holds no meta stamps, or it is stamped
 * with another contract major or another replica version. A handler
 * answers it as 503 `replica_unavailable`, and the fix is a rebuild. The
 * message may name the replica's path, so a handler never forwards it.
 */
export class ReplicaUnavailable extends Error {
  override readonly name: string = 'ReplicaUnavailable';
}
