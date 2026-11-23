/**
 * A fixture board cache for the board ingest's tests, written under a
 * tmpdir root at `.rafa/cache/board.json` in the cache's version 1 shape:
 * labels as `{ name }` objects, every title and body invented. Named
 * without `.test` so bun never runs it alone.
 *
 * | # | State | Labels | Body | Stage |
 * |---|---|---|---|---|
 * | 40 | open | `type:epic`, `epic:atlas-notes`, `horizon:now` | none | none (an epic) |
 * | 42 | open | `type:spec`, `spec:ready`, `epic:atlas-notes` | none | Ready |
 * | 7 | closed, completed | `type:spec`, `rafa:in-development` | none | Done |
 * | 50 | open | `type:bug`, `rafa:in-development`, `module:notes`, `priority:high` | a `## Plan` block | In development |
 * | 51 | closed, not planned | `bug`, `module:cli-gap` | a follow-ups comment | Cancelled |
 * | 52 | open | `type:bug`, `rafa:claimed`, `priority:low`, `epic:atlas-notes` | no plan | Claimed |
 * | 53 | open | `epic:lost-slug` | none | Backlog |
 *
 * Issue 42 and 7 are the issues of the effort fixture's plans
 * (`FIXTURE_PLAN`'s tracker names issue 42, the derive test's done plan
 * issue 7), so `plan_facts.epic_slug` reads `atlas-notes` for the first
 * and NULL for the second. `epic:lost-slug` is carried by no epic, so
 * issue 53 has no parent.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { FIXTURE_PLAN } from './effort-store.fixture.js';

/** The cache's watermark: both board sources' `as_of`. */
export const FIXTURE_WATERMARK = '2026-11-05T08:30:00Z';

/** The fixture's one epic and its slug. */
export const FIXTURE_EPIC = 40;
export const FIXTURE_EPIC_SLUG = 'atlas-notes';

/** The plan the bug with a follow-ups comment names. */
export const FOLLOW_UPS_PLAN = 'atlas-follow-ups';

/** One cache row, as `gh` writes it into the file. */
export interface FixtureRow {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly state: 'OPEN' | 'CLOSED';
  readonly stateReason: string | null;
  readonly labels: readonly { readonly name: string }[];
  readonly updatedAt: string;
}

/** A row of the fixture: `labels` given as names and written as `{ name }` objects. */
export function fixtureRow(
  number: number,
  labels: readonly string[],
  extra: Partial<Pick<FixtureRow, 'body' | 'state' | 'stateReason' | 'title'>> = {},
): FixtureRow {
  return {
    number,
    title: extra.title ?? `Fixture issue ${String(number)}`,
    body: extra.body ?? 'An invented body with no plan named.',
    state: extra.state ?? 'OPEN',
    stateReason: extra.stateReason ?? null,
    labels: labels.map((name) => ({ name })),
    updatedAt: '2026-11-04T10:00:00Z',
  };
}

/** A bug body with a `## Plan` block naming `stub`, then a task block, as the loop files one. */
export function planBlockBody(stub: string): string {
  return ['The notes lose a line.', '', '## Plan', '', '```', stub, '```', '', '## Task', '', '```', 'Mend the notes.', '```', ''].join('\n');
}

/** The fixture's rows, in the order the table above lists them. */
export const FIXTURE_ROWS: readonly FixtureRow[] = [
  fixtureRow(FIXTURE_EPIC, ['type:epic', `epic:${FIXTURE_EPIC_SLUG}`, 'horizon:now'], { title: 'Epic: the atlas notes' }),
  fixtureRow(42, ['type:spec', 'spec:ready', `epic:${FIXTURE_EPIC_SLUG}`], { title: 'Spec: the notes page' }),
  fixtureRow(7, ['type:spec', 'rafa:in-development'], { state: 'CLOSED', stateReason: 'COMPLETED' }),
  fixtureRow(50, ['type:bug', 'rafa:in-development', 'module:notes', 'priority:high'], { body: planBlockBody(FIXTURE_PLAN) }),
  fixtureRow(51, ['bug', 'module:cli-gap'], {
    state: 'CLOSED',
    stateReason: 'NOT_PLANNED',
    body: `The notes command has no flag.\n\n<!-- rafa:follow-ups ${FOLLOW_UPS_PLAN} -->\n`,
  }),
  fixtureRow(52, ['type:bug', 'rafa:claimed', 'priority:low', `epic:${FIXTURE_EPIC_SLUG}`]),
  fixtureRow(53, ['epic:lost-slug']),
];

/** The cache file's text over `rows`, in the version 1 shape. */
export function boardCacheText(rows: readonly unknown[], watermark: string = FIXTURE_WATERMARK): string {
  return JSON.stringify({ version: 1, watermark, rows });
}

/** The cache file under `root`. */
export function boardCachePathOf(root: string): string {
  return join(root, '.rafa', 'cache', 'board.json');
}

/** Write `text` as the cache file under `root`; the fixture's rows when left out. */
export function writeBoardFixture(root: string, text: string = boardCacheText(FIXTURE_ROWS)): void {
  const path = boardCachePathOf(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
