/**
 * A clock reading spelled as a stamp a file name can carry. This is the
 * library half of `../commands/effort/fix-schema.ts`, which keeps the
 * command `rafa effort fix-schema`, its seams, its lines and the
 * identity sentence (`keepsIdLine`) the rebuilding commands share.
 *
 * Nothing here reads a command's context, its arguments or its flags,
 * and nothing here imports from `src/commands/`, so any folder may take
 * {@link fileStamp}: `./sync/file.ts` stamps the parallel and backup
 * files of a pull with it, as `rafa effort fix-schema`, `migrate`,
 * `merge` and `copy` stamp theirs and `rafa issue edit` its two scratch
 * files.
 *
 * ## The spelling
 *
 * The stamp is the ISO 8601 basic form to the second, in UTC:
 * `20260926T101500Z`. It is `Date.prototype.toISOString` with the
 * hyphens, the colons and the milliseconds removed, so it holds no
 * character a file name refuses, it never depends on the machine's time
 * zone, and stamps sort as their instants do. Two readings within the
 * same second spell the same stamp: a caller that needs two files apart
 * names them apart, as the parallel and backup files are.
 */

/**
 * A clock reading as a file-name stamp: `20260926T101500Z`.
 *
 * @param date - The instant to spell.
 * @returns The instant in UTC as `YYYYMMDDTHHMMSSZ`, milliseconds dropped.
 * @throws RangeError when `date` is an invalid date, as `toISOString` does.
 */
export function fileStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}
