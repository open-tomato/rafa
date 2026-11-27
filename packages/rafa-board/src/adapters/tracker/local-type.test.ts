/**
 * Tests for the type the `local` Tracker adapter's `editable` reads and
 * `edit` writes (`packages/rafa-board/src/adapters/tracker/local.ts`):
 * the issue file's `type` field.
 *
 * The shared contract case moving an issue from `debt` to `bug` runs in
 * `local.test.ts`, over a temporary directory; these hold what the
 * contract leaves to the adapter: the one field rewritten, every other
 * field of the file kept as it was, and the refusal of a type the port
 * does not name, each beside the write it would otherwise have made.
 * They sit apart from `local.test.ts`, which stands within a few
 * hundred bytes of Bun's 51,200-byte line.
 *
 * One mutation of `local.ts` was driven on 2026-11-27, the module
 * restored byte-identical (sha256) after: the change's type never
 * written reddened every case here, each refusal through the write it
 * makes beside it, and the shared type case in `local.test.ts`.
 */
import type { LocalIssueRecord } from './local.js';
import type { IssueEdit, Tracker } from '@open-tomato/rafa/ports';

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { draftFixture } from './contract.js';
import { createLocalTracker, parseLocalIssue } from './local.js';

/** The instant every tracker here is stamped from. */
const NOW = '2026-11-27T09:00:00Z';

let tempDir = '';
let made = 0;

/** A fresh issues directory under the suite's temporary directory. */
function freshDir(name: string): string {
  made += 1;
  return join(tempDir, `${made}-${name}`);
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'rafa-local-type-'));
});

afterAll(() => {
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

/** A local tracker over `issuesDir`, stamped from {@link NOW}. */
function localTracker(issuesDir: string): Tracker {
  return createLocalTracker({ issuesDir, fallbackReason: null, now: () => NOW });
}

/** Issue `number` under `issuesDir`, read off the disk rather than through a tracker. */
function readIssue(issuesDir: string, number: number): LocalIssueRecord {
  const path = join(issuesDir, `${number}.md`);
  return parseLocalIssue(readFileSync(path, 'utf8'), path);
}

describe('editing a local issue\'s type', () => {
  it('rewrites the type field alone, keeping the module, the cause, the priority and every other field', async () => {
    const dir = freshDir('edit-type');
    const tracker = localTracker(dir);
    const ref = await tracker.create(draftFixture({ type: 'debt', module: 'cli-gap', cause: 'cli:new-context', priority: 'low' }));
    await tracker.comment(ref, 'seen again');
    const before = readIssue(dir, 1);

    await tracker.edit?.(ref, { type: 'bug' });

    expect(before.draft.type).toBe('debt');
    expect(readIssue(dir, 1)).toEqual({ ...before, draft: { ...before.draft, type: 'bug' } });
    expect(readFileSync(join(dir, '1.md'), 'utf8')).toContain('\ntype: bug\n');
  });

  it('answers the type the file holds from editable, and the one an edit wrote, as get answers it', async () => {
    const dir = freshDir('edit-type-read');
    const tracker = localTracker(dir);
    const moved = await tracker.create(draftFixture({ type: 'debt' }));
    const kept = await tracker.create(draftFixture({ type: 'debt' }));

    expect([(await tracker.editable?.(moved))?.type, (await tracker.editable?.(kept))?.type]).toEqual(['debt', 'debt']);
    await tracker.edit?.(moved, { type: 'bug' });

    expect([(await tracker.editable?.(moved))?.type, (await tracker.editable?.(kept))?.type]).toEqual(['bug', 'debt']);
    expect([(await tracker.get(moved)).type, (await tracker.get(kept)).type]).toEqual(['bug', 'debt']);
  });

  it('writes a type beside a priority and a title in one rewrite', async () => {
    const dir = freshDir('edit-type-all');
    const tracker = localTracker(dir);
    const ref = await tracker.create(draftFixture({ type: 'debt', priority: null }));

    await tracker.edit?.(ref, { title: 'Name the flag', priority: 'medium', type: 'bug' });

    expect(await tracker.get(ref)).toMatchObject({ title: 'Name the flag', priority: 'medium', type: 'bug' });
  });

  it.each([
    ['one the port does not name', 'feature', '"feature"'],
    ['a null', null, 'null'],
    ['a number', 1, '1'],
  ])('refuses a type that is %s, leaving the file as it was, beside one it writes', async (_name, type, described) => {
    const dir = freshDir('edit-type-invalid');
    const tracker = localTracker(dir);
    const ref = await tracker.create(draftFixture({ type: 'debt' }));
    const before = readFileSync(join(dir, '1.md'), 'utf8');

    // Cast: each type is one the port's type rules out, as an untyped caller could still hand over.
    const bad = { type } as unknown as IssueEdit;

    await expect(tracker.edit?.(ref, bad)).rejects.toThrow(
      `local tracker: refused to write an invalid issue: type is ${described},`
        + ' expected one of: code, bug, spike, adr, chore, package-api, epic, spec, debt',
    );
    expect(readFileSync(join(dir, '1.md'), 'utf8')).toBe(before);
    await tracker.edit?.(ref, { type: 'bug' });
    expect(readIssue(dir, 1).draft.type).toBe('bug');
  });
});
