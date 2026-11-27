/**
 * The area a change entry's session wrote in its report, tidied before
 * the work-done card (C4) and the docs share (C5) group by it: trimmed,
 * lower-cased and merged through `AREA_SYNONYMS`.
 */

/** The area an entry with a NULL or blank area counts under. */
export const NO_AREA = 'no area';

/**
 * Spellings merged into one area, keyed by the lower-cased spelling. The
 * 12-week replica's largest raw areas were tests, docs, loop, internal,
 * documentation, board and testing; a new spelling is one line here.
 */
export const AREA_SYNONYMS: Readonly<Record<string, string>> = {
  'documentation': 'docs',
  'doc': 'docs',
  'testing': 'tests',
  'test': 'tests',
  'effort store': 'effort',
  'loops': 'loop',
  'boards': 'board',
};

/**
 * Tidies a raw area: trims it, lower-cases it and merges it through
 * `AREA_SYNONYMS`, answering `no area` for a NULL or blank one.
 *
 * @param raw - The area as the replica stores it.
 * @returns The tidied area.
 */
export function tidyArea(raw: string | null | undefined): string {
  const spelling = (raw ?? '').trim().toLowerCase();
  if (spelling === '') {
    return NO_AREA;
  }
  return AREA_SYNONYMS[spelling] ?? spelling;
}
