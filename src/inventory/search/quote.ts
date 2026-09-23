/**
 * The quote check: the code step after the block parser that keeps a
 * search match only when the sentence the session says it copied is in
 * the file it names, near the line it gives.
 *
 * The session is told to copy one sentence word for word and give its
 * 1-based line (`src/inventory/search/prompt.ts`). A model can write a
 * plausible sentence the file never held, or cite the right sentence at
 * a line far from it; either way the match is not shown as an answer.
 * The prompt asks, and this module decides.
 *
 * ## What counts as found
 *
 * {@link quoteFound} takes the file's lines from {@link QUOTE_WINDOW}
 * before `line` to {@link QUOTE_WINDOW} after it, clamped to the file,
 * joins them, and asks whether the quote occurs in them once both sides
 * have every run of whitespace collapsed to one space and their ends
 * trimmed. So a quote the session re-wrapped onto one line still counts
 * when the file wraps it across two, and a quote must sit wholly inside
 * the window: a sentence that starts on the window's last line and ends
 * past it does not count. Nothing else is normalized. Case, punctuation
 * and markdown marks are compared as written, since the session was told
 * to copy the sentence word for word. A `line` past the file's end
 * leaves an empty window and drops the match; a blank quote is never
 * found, though the block parser already drops one.
 *
 * ## Which file is read
 *
 * {@link checkQuotes} reads each match's file through the map it is
 * given, from a candidate's name to the path of its file. The runner
 * decides whether that is the original or the scratch copy the session
 * read. A match whose name has no path, or whose file does not read, is
 * dropped with the rest: a quote that cannot be looked up is not found.
 */
import type { SearchMatch } from './block.js';

/** How many lines either side of `line` a quote may sit and still count. */
export const QUOTE_WINDOW = 3;

/** What {@link checkQuotes} answers. */
export interface QuoteCheck {
  /** The matches whose quote was found, in the order given. */
  readonly kept: readonly SearchMatch[];
  /** How many matches were dropped because their quote was not found. */
  readonly dropped: number;
}

/** Collapses every whitespace run to one space and trims the ends. */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * True when `quote` occurs, whitespace-normalized, in `text` within
 * {@link QUOTE_WINDOW} lines of the 1-based `line`. See the module note.
 */
export function quoteFound(text: string, quote: string, line: number): boolean {
  const wanted = normalizeWhitespace(quote);
  if (wanted.length === 0) return false;
  const lines = text.split(/\r?\n/);
  const first = Math.max(0, line - 1 - QUOTE_WINDOW);
  const last = Math.min(lines.length, line + QUOTE_WINDOW);
  const window = lines.slice(first, last).join('\n');
  return normalizeWhitespace(window).includes(wanted);
}

/** The text of the file at `path`, or null when it does not read. */
async function readText(path: string | undefined): Promise<string | null> {
  if (path === undefined) return null;
  try {
    return await Bun.file(path).text();
  } catch {
    return null;
  }
}

/**
 * Keeps each match whose quote is found in its file near its line, and
 * counts the rest. `files` maps a candidate's name to its file's path.
 * Never throws; see the module note for what counts as found.
 */
export async function checkQuotes(
  matches: readonly SearchMatch[],
  files: ReadonlyMap<string, string>,
): Promise<QuoteCheck> {
  const kept: SearchMatch[] = [];
  for (const match of matches) {
    const text = await readText(files.get(match.name));
    if (text !== null && quoteFound(text, match.quote, match.line)) kept.push(match);
  }
  return { kept, dropped: matches.length - kept.length };
}
