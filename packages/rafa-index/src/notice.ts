/**
 * The fallback when vector search is off: {@link fallbackRequest} turns a
 * `vector` or `hybrid` request into an `fts` one when the index answered
 * `vector: false`, and writes one notice naming why through the writer it
 * is handed:
 *
 * `hub index: vector search is off on this hub (<why>); answering with full text`
 *
 * The notice is written once per process, whatever the writer, so a
 * caller answering many searches tells its reader once. A request is
 * left alone, the same object, when vector search is on or when it
 * already asks for `fts`; neither writes the notice.
 */
import type { IndexSearchRequest } from './search.js';

/** Where the notice is written: one line, without its newline. */
export type NoticeWriter = (line: string) => void;

/** Whether vector search is on, and why not when it is off. */
export interface VectorState {
  readonly vector: boolean;
  readonly why: string | null;
}

/** The why a notice names when the index gave none. */
export const UNKNOWN_WHY = 'no reason given';

/** Whether this process has written the notice. */
let noticeWritten = false;

/** The notice line for a why. */
export function noticeLine(why: string | null): string {
  return `hub index: vector search is off on this hub (${why ?? UNKNOWN_WHY}); answering with full text`;
}

/**
 * The request a search should run: `request` itself when vector search is
 * on or it asks for `fts`, else a copy asking for `fts`, the notice
 * written through `write` the first time this process falls back.
 */
export function fallbackRequest(
  request: IndexSearchRequest,
  state: VectorState,
  write: NoticeWriter,
): IndexSearchRequest {
  if (state.vector || request.mode === 'fts') {
    return request;
  }
  if (!noticeWritten) {
    noticeWritten = true;
    write(noticeLine(state.why));
  }
  return { ...request, mode: 'fts' };
}
