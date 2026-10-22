/** One file a codemod pass moves, as repository-relative paths. */
export interface FileMove {
  /** The tracked path the file has before the move. */
  readonly from: string;
  /** The path it has after the move; nothing is there before. */
  readonly to: string;
}
