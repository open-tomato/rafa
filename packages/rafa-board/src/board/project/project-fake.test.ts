/**
 * Tests for the lagging item listing of the strict fake `gh` in
 * `project-fake.ts`, read through the project port of `gh.ts` and the
 * field writes of `writes.ts`, the two callers a lag is held for.
 *
 * ## The controls
 *
 *  - The project holds an item before the point and each case reads the
 *    listing before the lag too, so a lag hiding every item, or one
 *    hiding none, fails.
 *  - An add before the point sits beside the adds after it, so a lag
 *    counted from the fake's making rather than from the call fails.
 *  - The hidden item's id is read from the add and written to, and the
 *    value is read after the lag ends, so a lag that drops the item
 *    rather than hiding it fails.
 *  - The paged case shows one more item than a page holds and hides one
 *    more, so a page count or a cursor taken over the hidden items fails.
 */
import type { ProjectPort } from './port.js';
import type { FakeProject } from './project-fake.js';

import { describe, expect, it } from 'bun:test';

import { createGhProjectPort } from './gh.js';
import { PROJECT_PAGE_SIZE } from './port.js';
import { createFakeProjectGh, fakeItemId, fakeProjectId } from './project-fake.js';
import { writeProjectFields } from './writes.js';

const REPOSITORY = 'acme/widgets';

/** A project holding issue 1 of {@link REPOSITORY}. */
const HELD: FakeProject = { owner: 'acme', number: 2, items: [{ repository: REPOSITORY, number: 1 }] };

/** A second project, holding nothing. */
const EMPTY: FakeProject = { owner: 'acme', number: 3 };

const ISSUES = [1, 2, 3, 4];

/** The issue numbers the listing of `project` shows, in its order. */
async function listed(port: ProjectPort, project: FakeProject): Promise<readonly number[]> {
  const items = await port.items(fakeProjectId(project));
  return items.map(({ content }) => (content.kind === 'issue'
    ? content.number
    : -1));
}

describe('the lagging item listing', () => {
  it('omits the items added since the point, and shows the ones added before it', async () => {
    const fake = createFakeProjectGh({ projects: [HELD, EMPTY], repositories: [{ nameWithOwner: REPOSITORY, issues: ISSUES }] });
    const port = createGhProjectPort(fake.gh);
    await port.addItem(fakeProjectId(HELD), { repository: REPOSITORY, number: 2 });
    expect(await listed(port, HELD)).toEqual([1, 2]);

    fake.lagItems();
    const third = await port.addItem(fakeProjectId(HELD), { repository: REPOSITORY, number: 3 });
    await port.addItem(fakeProjectId(EMPTY), { repository: REPOSITORY, number: 4 });

    expect(third).toBe(fakeItemId(HELD, 2));
    expect(await listed(port, HELD)).toEqual([1, 2]);
    expect(await listed(port, EMPTY)).toEqual([]);

    fake.showItems();
    expect(await listed(port, HELD)).toEqual([1, 2, 3]);
    expect(await listed(port, EMPTY)).toEqual([4]);
  });

  it('answers the same id for a second add of a hidden item, and lands a field write naming it', async () => {
    const fake = createFakeProjectGh({ projects: [HELD], repositories: [{ nameWithOwner: REPOSITORY, issues: ISSUES }] });
    const port = createGhProjectPort(fake.gh);
    const project = await port.find({ owner: HELD.owner, number: HELD.number });
    const blockedBy = project?.fields.find(({ name }) => name === 'Blocked by')?.id ?? '';
    fake.lagItems();
    const added = await port.addItem(fakeProjectId(HELD), { repository: REPOSITORY, number: 2 });

    const again = await port.addItem(fakeProjectId(HELD), { repository: REPOSITORY, number: 2 });
    const result = await writeProjectFields(
      fake.gh,
      fakeProjectId(HELD),
      [{ kind: 'set', itemId: added, fieldId: blockedBy, value: { kind: 'text', text: '#1' } }],
      { batchSize: 5, pauseMs: 0 },
    );

    expect(again).toBe(added);
    expect(result.written).toBe(1);
    expect(await listed(port, HELD)).toEqual([1]);
    fake.showItems();
    const [, shown] = await port.items(fakeProjectId(HELD));
    expect(shown?.id).toBe(added);
    expect(shown?.values.get('Blocked by')).toEqual({ kind: 'text', text: '#1' });
  });

  it('moves the point on a second mark', async () => {
    const fake = createFakeProjectGh({ projects: [HELD], repositories: [{ nameWithOwner: REPOSITORY, issues: ISSUES }] });
    const port = createGhProjectPort(fake.gh);
    fake.lagItems();
    await port.addItem(fakeProjectId(HELD), { repository: REPOSITORY, number: 2 });
    expect(await listed(port, HELD)).toEqual([1]);

    fake.lagItems();
    await port.addItem(fakeProjectId(HELD), { repository: REPOSITORY, number: 3 });

    expect(await listed(port, HELD)).toEqual([1, 2]);
  });

  it('pages over the items it shows, not the ones it hides', async () => {
    const shown = PROJECT_PAGE_SIZE + 1;
    const numbers = Array.from({ length: shown + PROJECT_PAGE_SIZE + 1 }, (_, index) => index + 1);
    const many: FakeProject = { owner: 'acme', number: 4, items: numbers.slice(0, shown).map((number) => ({ repository: REPOSITORY, number })) };
    const fake = createFakeProjectGh({ projects: [many], repositories: [{ nameWithOwner: REPOSITORY, issues: numbers }] });
    const port = createGhProjectPort(fake.gh);
    fake.lagItems();
    for (const number of numbers.slice(shown)) await port.addItem(fakeProjectId(many), { repository: REPOSITORY, number });
    const before = fake.calls().length;

    expect(await listed(port, many)).toEqual(numbers.slice(0, shown));
    expect(fake.calls().length - before).toBe(2);

    fake.showItems();
    expect(await listed(port, many)).toEqual(numbers);
  });
});
