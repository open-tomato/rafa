/**
 * The first `now` epic of a board that is not done: the pick `rafa epics`
 * makes with no number, the fallback of the current place (`./place.ts`)
 * and where `rafa switch <board>` lands (`src/commands/switch.ts`).
 *
 * It was `src/commands/epic/show.ts`'s until `./place.ts` needed it too.
 * `show.ts` reads the current place through `./roadmap-rows.ts`, which
 * imports `./place.ts`, so the three files imported each other in a
 * ring; the pick lives here, beside the listing and the epics it reads,
 * and the command imports it as `./place.ts` does.
 *
 * It reads what it is handed and nothing else: no `gh`, no file.
 */
import type { Epic, Epics } from './epics.js';
import type { BoardIssue } from './roadmap-board.js';
import type { RoadmapLine } from './roadmap.js';

import { isNowEpic } from './epic-walk.js';

/**
 * The first of `lines` naming an epic that is open, `now` and not done,
 * read off `listing` and `epics`; null when none does. Ticked lines are
 * passed, as the walk passes them.
 */
export function firstNowEpic(lines: readonly RoadmapLine[], listing: readonly BoardIssue[], epics: Epics): Epic | null {
  const issues = new Map(listing.map((issue) => [issue.number, issue]));
  const read = new Map(epics.epics.map((epic) => [epic.number, epic]));
  for (const line of lines) {
    const issue = issues.get(line.issue);
    const epic = read.get(line.issue);
    if (line.ticked || issue?.type !== 'epic' || epic === undefined) continue;
    if (issue.state === 'OPEN' && isNowEpic(issue.labels) && epic.state !== 'done') return epic;
  }
  return null;
}
