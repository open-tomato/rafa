/**
 * Tests for the changelog half of a release
 * (`src/release/changelog.ts`): the heading rendered from the
 * configured template, the notes grouped by area beneath it, and
 * where in a changelog the two get inserted.
 *
 * Everything here is driven from string literals, since the module
 * opens no file. The one exception reads this repository's own
 * `CHANGELOG.md`, read-only: the module's note makes a claim about
 * that file's shape — a first heading with a paragraph of prose under
 * it, then the newest version's heading — and a case that replicated
 * the shape in a literal would keep passing after the real file
 * stopped having it.
 *
 * The heading template is taken from `CONFIG_DEFAULTS.releaseHeading`
 * rather than spelled here, so a default changed in
 * `src/config-schema.ts` without this module hearing of it turns
 * these cases red rather than leaving them green against a template
 * nothing uses.
 *
 * Several things here would pass while wrong:
 *
 *  - A renderer that dropped every unknown placeholder satisfies
 *    every case using the default template, so one case renders a
 *    template holding `{ticket}` and asserts it survives, with the
 *    three known fields in the same template as the control.
 *  - A separator rule that ran unconditionally satisfies every empty
 *    value case, so a title ending in a colon is asserted to keep it
 *    when nothing rendered empty.
 *  - An insert placed on the line after the first heading satisfies
 *    any file with no preamble, so the preamble cases assert the line
 *    ABOVE the entry as well as the line below it.
 *  - An insert that rebuilt the file rather than splicing it
 *    satisfies every assertion about the entry, so each case takes
 *    the inserted lines back out and compares the remainder to the
 *    original byte for byte, and the files carry both
 *    trailing-newline states.
 *  - A date formatted through `toISOString` is INDISTINGUISHABLE from
 *    the local one under `bun test`, which runs with `TZ` unset and a
 *    zero offset whatever the host is set to (measured 2026-09-20 on
 *    a host in `Europe/Madrid`: `process.env.TZ` is undefined and
 *    `getTimezoneOffset()` is 0, while the same expression under
 *    `bun -e` answers -60). So the two date cases set `TZ`
 *    themselves, one zone east of UTC and one west, and each carries
 *    its own control: the instant's `toISOString` day is asserted to
 *    be the OTHER day, which is what a UTC formatter would answer.
 *    Each restores the zone in a `finally` and then asserts the
 *    offset is 0 again, since a `delete process.env.TZ` does NOT
 *    restore it — measured the same day, the deleted case kept
 *    answering in the zone last set, so the restore has to name `UTC`
 *    outright.
 *
 * Eight mutations of `changelog.ts` were driven on 2026-09-20, one at
 * a time over `bun test src/release/changelog.test.ts`, the module
 * restored from a scratch copy and its `shasum` compared to the
 * original after the run. 49 pass clean, and each count below is that
 * run's own:
 *
 *  - an unknown placeholder rendered empty rather than kept: 1 fail.
 *  - the gap left by an empty value keeping its separators: 2 fail,
 *    the missing version and the missing title.
 *  - the insert placed on the line after the first heading: 5 fail,
 *    every case with a preamble, the repository's own changelog
 *    included.
 *  - the fence tracking dropped from the heading scan: 2 fail, both
 *    fenced cases.
 *  - a `none` note kept as a line: 3 fail.
 *  - the unnamed group placed first: 2 fail.
 *  - a repeated note kept as a second line: 3 fail.
 *  - the date formatted through `toISOString`: 2 fail, one per zone.
 */
import type { ChangelogNote } from './changelog.js';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { CONFIG_DEFAULTS } from '../config-schema.js';

import {
  RELEASE_HEADING_FIELDS,
  changelogDate,
  groupChangeNotes,
  insertChangelogEntry,
  renderChangelogEntry,
  renderNoteLines,
  renderReleaseHeading,
} from './changelog.js';

/** The template a project gets when it configures none. */
const TEMPLATE = CONFIG_DEFAULTS.releaseHeading;

/** The three values, with any of them overridden. */
function values(over: Partial<Record<string, string>> = {}): {
  version: string;
  date: string;
  title: string;
} {
  return {
    version: over['version'] ?? '0.5.0',
    date: over['date'] ?? '2026-09-20',
    title: over['title'] ?? 'phase 2b: changelog and release',
  };
}

/** One note, with its level defaulted to the commonest one. */
function note(area: string | null, summary: string, level: ChangelogNote['level'] = 'minor'): ChangelogNote {
  return { level, area, summary };
}

describe('RELEASE_HEADING_FIELDS', () => {
  it('names the three fields the default template uses', () => {
    expect([...RELEASE_HEADING_FIELDS]).toEqual(['version', 'date', 'title']);
    for (const field of RELEASE_HEADING_FIELDS) {
      expect(TEMPLATE).toContain(`{${field}}`);
    }
  });
});

describe('renderReleaseHeading over the default template', () => {
  it('fills the version, the date and the title', () => {
    expect(renderReleaseHeading(TEMPLATE, values())).toBe(
      '## 0.5.0 — 2026-09-20, phase 2b: changelog and release',
    );
  });

  it('trims a value without touching the separators around it', () => {
    expect(renderReleaseHeading(TEMPLATE, values({ version: '  0.5.0  ' }))).toBe(
      '## 0.5.0 — 2026-09-20, phase 2b: changelog and release',
    );
  });

  it('keeps a separator a title genuinely ends with', () => {
    expect(renderReleaseHeading(TEMPLATE, values({ title: 'phase 2b:' }))).toBe(
      '## 0.5.0 — 2026-09-20, phase 2b:',
    );
  });

  it('collapses a newline in a value so the heading stays one line', () => {
    const rendered = renderReleaseHeading(TEMPLATE, values({ title: 'phase 2b:\n  changelog' }));
    expect(rendered).toBe('## 0.5.0 — 2026-09-20, phase 2b: changelog');
    expect(rendered).not.toContain('\n');
  });
});

describe('renderReleaseHeading with a value that renders empty', () => {
  it('leaves a date heading when there is no version to name', () => {
    expect(renderReleaseHeading(TEMPLATE, values({ version: '' }))).toBe(
      '## 2026-09-20, phase 2b: changelog and release',
    );
  });

  it('reads the same for a version of nothing but space', () => {
    expect(renderReleaseHeading(TEMPLATE, values({ version: '   ' }))).toBe(
      '## 2026-09-20, phase 2b: changelog and release',
    );
  });

  it('drops the comma left behind by a missing title', () => {
    expect(renderReleaseHeading(TEMPLATE, values({ title: '' }))).toBe('## 0.5.0 — 2026-09-20');
  });

  it('closes the gap a missing date leaves between two fields', () => {
    expect(renderReleaseHeading(TEMPLATE, values({ date: '' }))).toBe(
      '## 0.5.0 phase 2b: changelog and release',
    );
  });

  it('answers the marker alone when every value is empty', () => {
    expect(renderReleaseHeading(TEMPLATE, { version: '', date: '', title: '' })).toBe('##');
  });
});

describe('renderReleaseHeading over another template', () => {
  it('leaves a placeholder it does not know exactly as written', () => {
    expect(renderReleaseHeading('## {version} ({ticket}) {date}', values())).toBe(
      '## 0.5.0 ({ticket}) 2026-09-20',
    );
  });

  it('fills a template that repeats a field', () => {
    expect(renderReleaseHeading('## {version} — v{version}', values())).toBe('## 0.5.0 — v0.5.0');
  });

  it('renders a template with no heading marker at all', () => {
    expect(renderReleaseHeading('{date}: {title}', values({ title: 'the release' }))).toBe(
      '2026-09-20: the release',
    );
  });

  it('closes the gap in a template with no heading marker', () => {
    expect(renderReleaseHeading('{version} — {date}', values({ version: '' }))).toBe('2026-09-20');
  });
});

describe('groupChangeNotes', () => {
  it('groups the notes of one area together', () => {
    const grouped = groupChangeNotes([
      note('loop', 'the loop waits for the commit'),
      note('cli', 'rafa release status lists the pending notes'),
      note('loop', 'a paused loop says which task it is holding'),
    ]);
    expect(grouped.groups).toEqual([
      { area: 'loop', summaries: ['the loop waits for the commit', 'a paused loop says which task it is holding'] },
      { area: 'cli', summaries: ['rafa release status lists the pending notes'] },
    ]);
  });

  it('keeps the areas in the order their first note arrived', () => {
    const grouped = groupChangeNotes([
      note('store', 'a change note is stored per session'),
      note('loop', 'the loop waits for the commit'),
    ]);
    expect(grouped.groups.map((group) => group.area)).toEqual(['store', 'loop']);
  });

  it('puts the notes that named no area last, however early they came', () => {
    const grouped = groupChangeNotes([
      note(null, 'a line with no area'),
      note('loop', 'the loop waits for the commit'),
      note('   ', 'a line whose area is blank'),
    ]);
    expect(grouped.groups).toEqual([
      { area: 'loop', summaries: ['the loop waits for the commit'] },
      { area: null, summaries: ['a line with no area', 'a line whose area is blank'] },
    ]);
  });

  it('leaves out a note at level none and counts it', () => {
    const grouped = groupChangeNotes([
      note('loop', 'a refactor no user would notice', 'none'),
      note('loop', 'the loop waits for the commit', 'patch'),
    ]);
    expect(grouped.groups).toEqual([{ area: 'loop', summaries: ['the loop waits for the commit'] }]);
    expect(grouped.noneNotes).toBe(1);
    expect(grouped.duplicateNotes).toBe(0);
  });

  it('keeps a note at every level that is not none', () => {
    const grouped = groupChangeNotes([
      note('a', 'one', 'patch'),
      note('b', 'two', 'minor'),
      note('c', 'three', 'major'),
    ]);
    expect(grouped.groups.map((group) => group.area)).toEqual(['a', 'b', 'c']);
    expect(grouped.noneNotes).toBe(0);
  });

  it('leaves out a repeat of an earlier area and summary', () => {
    const grouped = groupChangeNotes([
      note('loop', 'the loop waits for the commit'),
      note('loop', 'the loop waits for the commit'),
    ]);
    expect(grouped.groups).toEqual([{ area: 'loop', summaries: ['the loop waits for the commit'] }]);
    expect(grouped.duplicateNotes).toBe(1);
  });

  it('keeps the same summary reported under another area', () => {
    const grouped = groupChangeNotes([
      note('loop', 'the wait is now for the commit'),
      note('cli', 'the wait is now for the commit'),
    ]);
    expect(grouped.groups).toEqual([
      { area: 'loop', summaries: ['the wait is now for the commit'] },
      { area: 'cli', summaries: ['the wait is now for the commit'] },
    ]);
    expect(grouped.duplicateNotes).toBe(0);
  });

  it('collapses the whitespace of a summary before comparing it', () => {
    const grouped = groupChangeNotes([
      note('loop', 'the loop waits\n  for the commit'),
      note('loop', 'the loop waits for the commit'),
    ]);
    expect(grouped.groups).toEqual([{ area: 'loop', summaries: ['the loop waits for the commit'] }]);
    expect(grouped.duplicateNotes).toBe(1);
  });

  it('counts a note with no summary apart from a repeat', () => {
    const grouped = groupChangeNotes([note('loop', '   '), note('loop', 'the loop waits')]);
    expect(grouped.groups).toEqual([{ area: 'loop', summaries: ['the loop waits'] }]);
    expect(grouped.blankNotes).toBe(1);
    expect(grouped.duplicateNotes).toBe(0);
  });

  it('answers no group at all for no notes', () => {
    expect(groupChangeNotes([])).toEqual({
      groups: [],
      noneNotes: 0,
      duplicateNotes: 0,
      blankNotes: 0,
    });
  });
});

describe('renderNoteLines', () => {
  it('prefixes each line with its area', () => {
    const lines = renderNoteLines(groupChangeNotes([
      note('loop', 'the loop waits for the commit'),
      note('cli', 'release status lists the pending notes'),
    ]));
    expect(lines).toEqual([
      '- loop: the loop waits for the commit',
      '- cli: release status lists the pending notes',
    ]);
  });

  it('writes a line with no area without a prefix', () => {
    const lines = renderNoteLines(groupChangeNotes([note(null, 'a line with no area')]));
    expect(lines).toEqual(['- a line with no area']);
  });
});

describe('renderChangelogEntry', () => {
  it('puts the heading over the lines, one blank line between', () => {
    const entry = renderChangelogEntry({
      template: TEMPLATE,
      values: values(),
      notes: [note('loop', 'the loop waits for the commit'), note('cli', 'release status lists the notes')],
    });
    expect(entry.text).toBe([
      '## 0.5.0 — 2026-09-20, phase 2b: changelog and release',
      '',
      '- loop: the loop waits for the commit',
      '- cli: release status lists the notes',
    ].join('\n'));
    expect(entry.heading).toBe('## 0.5.0 — 2026-09-20, phase 2b: changelog and release');
    expect(entry.lines).toHaveLength(2);
    expect(entry.text.endsWith('\n')).toBe(false);
  });

  it('answers the heading alone when every note was skipped', () => {
    const entry = renderChangelogEntry({
      template: TEMPLATE,
      values: values(),
      notes: [note('loop', 'a refactor no user would notice', 'none')],
    });
    expect(entry.text).toBe('## 0.5.0 — 2026-09-20, phase 2b: changelog and release');
    expect(entry.lines).toEqual([]);
    expect(entry.noneNotes).toBe(1);
  });

  it('carries the counts of what it left out', () => {
    const entry = renderChangelogEntry({
      template: TEMPLATE,
      values: values(),
      notes: [
        note('loop', 'the loop waits for the commit'),
        note('loop', 'the loop waits for the commit'),
        note('loop', 'a refactor no user would notice', 'none'),
        note('loop', ''),
      ],
    });
    expect(entry.lines).toEqual(['- loop: the loop waits for the commit']);
    expect(entry.duplicateNotes).toBe(1);
    expect(entry.noneNotes).toBe(1);
    expect(entry.blankNotes).toBe(1);
  });

  it('answers the groups it rendered from', () => {
    const entry = renderChangelogEntry({
      template: TEMPLATE,
      values: values(),
      notes: [note('loop', 'one'), note(null, 'two')],
    });
    expect(entry.groups).toEqual([
      { area: 'loop', summaries: ['one'] },
      { area: null, summaries: ['two'] },
    ]);
  });
});

/** The entry every insertion case inserts. */
const ENTRY = ['## 0.5.0 — 2026-09-20, the release', '', '- loop: the loop waits'].join('\n');

/**
 * `text` with the inserted entry, and the blank line the insert added
 * beside it, taken back out. What is left has to be the file as it
 * was, byte for byte, which is the assertion an insert that rebuilt
 * the file rather than splicing it would fail.
 */
function withoutEntry(text: string): string {
  const shapes = [`${ENTRY}\n\n`, `\n\n${ENTRY}`, `${ENTRY}\n`, `\n${ENTRY}`, ENTRY];
  const found = shapes.find((shape) => text.includes(shape));
  return found === undefined
    ? text
    : text.replace(found, '');
}

describe('insertChangelogEntry into a changelog with a preamble', () => {
  const changelog = [
    '# Changelog',
    '',
    'One section per released version, newest first.',
    '',
    '## 0.4.0 — 2026-09-19, phase 3',
    '',
    '- pull requests',
    '',
  ].join('\n');

  it('lands between the preamble and the newest section', () => {
    const inserted = insertChangelogEntry(changelog, ENTRY);
    expect(inserted.point).toBe('before-next-heading');
    expect(inserted.text).toBe([
      '# Changelog',
      '',
      'One section per released version, newest first.',
      '',
      '## 0.5.0 — 2026-09-20, the release',
      '',
      '- loop: the loop waits',
      '',
      '## 0.4.0 — 2026-09-19, phase 3',
      '',
      '- pull requests',
      '',
    ].join('\n'));
  });

  it('reports the line its heading now sits on', () => {
    const inserted = insertChangelogEntry(changelog, ENTRY);
    expect(inserted.text.split('\n')[inserted.line - 1]).toBe('## 0.5.0 — 2026-09-20, the release');
  });

  it('leaves the rest of the file byte for byte', () => {
    const inserted = insertChangelogEntry(changelog, ENTRY);
    expect(withoutEntry(inserted.text)).toBe(changelog);
  });

  it('never writes above the first heading', () => {
    const inserted = insertChangelogEntry(changelog, ENTRY);
    expect(inserted.text.startsWith('# Changelog\n')).toBe(true);
    expect(inserted.line).toBeGreaterThan(1);
  });
});

describe('insertChangelogEntry and the blank lines around it', () => {
  it('adds the blank line a file with none of its own needs', () => {
    const changelog = ['# Changelog', '## 0.4.0 — 2026-09-19, phase 3', '- pull requests', ''].join('\n');
    const inserted = insertChangelogEntry(changelog, ENTRY);
    expect(inserted.text).toBe([
      '# Changelog',
      '',
      '## 0.5.0 — 2026-09-20, the release',
      '',
      '- loop: the loop waits',
      '',
      '## 0.4.0 — 2026-09-19, phase 3',
      '- pull requests',
      '',
    ].join('\n'));
  });

  it('adds none where the file already has one on each side', () => {
    const changelog = ['# Changelog', '', '## 0.4.0 — 2026-09-19, phase 3', ''].join('\n');
    const inserted = insertChangelogEntry(changelog, ENTRY);
    expect(inserted.text).toBe([
      '# Changelog',
      '',
      '## 0.5.0 — 2026-09-20, the release',
      '',
      '- loop: the loop waits',
      '',
      '## 0.4.0 — 2026-09-19, phase 3',
      '',
    ].join('\n'));
  });
});

describe('insertChangelogEntry into a changelog with one heading', () => {
  it('lands at the end when there is no second heading', () => {
    const changelog = ['# Changelog', '', 'Nothing released yet.', ''].join('\n');
    const inserted = insertChangelogEntry(changelog, ENTRY);
    expect(inserted.point).toBe('file-end');
    expect(inserted.text).toBe([
      '# Changelog',
      '',
      'Nothing released yet.',
      '',
      '## 0.5.0 — 2026-09-20, the release',
      '',
      '- loop: the loop waits',
      '',
    ].join('\n'));
  });

  it('keeps a file that ends without a newline ending without one', () => {
    const changelog = ['# Changelog', '', 'Nothing released yet.'].join('\n');
    const inserted = insertChangelogEntry(changelog, ENTRY);
    expect(inserted.text.endsWith('- loop: the loop waits')).toBe(true);
    expect(withoutEntry(inserted.text)).toBe(changelog);
  });

  it('keeps a file that ends with a newline ending with one', () => {
    const changelog = ['# Changelog', '', 'Nothing released yet.', ''].join('\n');
    const inserted = insertChangelogEntry(changelog, ENTRY);
    expect(inserted.text.endsWith('\n')).toBe(true);
  });
});

describe('insertChangelogEntry into a file with no heading', () => {
  it('prepends to a file that holds prose only', () => {
    const changelog = 'Nothing released yet.\n';
    const inserted = insertChangelogEntry(changelog, ENTRY);
    expect(inserted.point).toBe('file-top');
    expect(inserted.line).toBe(1);
    expect(inserted.text).toBe(`${ENTRY}\n\nNothing released yet.\n`);
  });

  it('writes the entry alone into an empty file', () => {
    const inserted = insertChangelogEntry('', ENTRY);
    expect(inserted.point).toBe('file-top');
    expect(inserted.text).toBe(`${ENTRY}\n`);
  });
});

describe('insertChangelogEntry and fenced code', () => {
  it('does not read a heading inside a fenced block as the next one', () => {
    const changelog = [
      '# Changelog',
      '',
      'The heading template:',
      '',
      '```text',
      '## {version} — {date}, {title}',
      '```',
      '',
      '## 0.4.0 — 2026-09-19, phase 3',
      '',
    ].join('\n');
    const inserted = insertChangelogEntry(changelog, ENTRY);
    expect(inserted.text.split('\n')[inserted.line]).toBe('');
    expect(inserted.text.split('\n')[inserted.line + 1]).toBe('- loop: the loop waits');
    expect(inserted.text.split('\n')[inserted.line + 3]).toBe('## 0.4.0 — 2026-09-19, phase 3');
    expect(withoutEntry(inserted.text)).toBe(changelog);
  });

  it('does not read a heading inside a fenced block as the first one', () => {
    const changelog = ['```text', '# not a heading', '```', '', 'prose', ''].join('\n');
    const inserted = insertChangelogEntry(changelog, ENTRY);
    expect(inserted.point).toBe('file-top');
    expect(inserted.text.startsWith(ENTRY)).toBe(true);
  });
});

describe('insertChangelogEntry into this repository CHANGELOG.md', () => {
  /** Named from this file, so the case does not read the working directory. */
  const path = join(import.meta.dir, '..', '..', 'CHANGELOG.md');
  const changelog = readFileSync(path, 'utf8');

  it('finds a first heading with prose under it and a section below', () => {
    const lines = changelog.split('\n');
    const headings = lines
      .map((line, index) => ({ line, index }))
      .filter((each) => /^#{1,6} /.test(each.line));
    expect(headings.length).toBeGreaterThan(1);
    const [first, second] = headings;
    expect(first?.line).toBe('# Changelog');
    expect((second?.index ?? 0) - (first?.index ?? 0)).toBeGreaterThan(2);
  });

  it('lands under the prose and above the newest released section', () => {
    const inserted = insertChangelogEntry(changelog, ENTRY);
    const lines = inserted.text.split('\n');
    expect(inserted.point).toBe('before-next-heading');
    expect(lines[inserted.line - 1]).toBe('## 0.5.0 — 2026-09-20, the release');
    expect(lines[inserted.line - 2]).toBe('');
    expect(lines[inserted.line - 3] ?? '').not.toMatch(/^#/);
    expect(lines[inserted.line + 3] ?? '').toMatch(/^## /);
  });

  it('changes not one other byte of it', () => {
    const inserted = insertChangelogEntry(changelog, ENTRY);
    expect(withoutEntry(inserted.text)).toBe(changelog);
  });
});

describe('changelogDate', () => {
  it('writes the calendar date, both parts padded', () => {
    expect(changelogDate(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
    expect(changelogDate(new Date(2026, 10, 30, 12, 0))).toBe('2026-11-30');
  });

  it('dates a release by the local day east of UTC', () => {
    const zone = process.env.TZ;
    try {
      process.env.TZ = 'Asia/Tokyo';
      const justAfterMidnight = new Date('2026-01-05T00:30:00+09:00');
      expect(justAfterMidnight.toISOString().slice(0, 10)).toBe('2026-01-04');
      expect(changelogDate(justAfterMidnight)).toBe('2026-01-05');
    } finally {
      process.env.TZ = zone ?? 'UTC';
    }
    expect(new Date(2026, 0, 5).getTimezoneOffset()).toBe(0);
  });

  it('dates a release by the local day west of UTC', () => {
    const zone = process.env.TZ;
    try {
      process.env.TZ = 'America/Los_Angeles';
      const justBeforeMidnight = new Date('2026-01-05T23:30:00-08:00');
      expect(justBeforeMidnight.toISOString().slice(0, 10)).toBe('2026-01-06');
      expect(changelogDate(justBeforeMidnight)).toBe('2026-01-05');
    } finally {
      process.env.TZ = zone ?? 'UTC';
    }
    expect(new Date(2026, 0, 5).getTimezoneOffset()).toBe(0);
  });
});
