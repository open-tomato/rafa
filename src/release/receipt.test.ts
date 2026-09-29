/**
 * Tests for the release receipt (`receipt.ts`): the comment reader, the
 * sections it attributes receipts to, the adoption boundary, the
 * verdict for one version, and the repository's own `CHANGELOG.md`.
 *
 * Controls that keep a passing reading from passing while wrong:
 *
 *   - the reader is fed what `fragmentsReceipt` writes, so a reader
 *     and a writer that drifted apart redden here rather than at a tag;
 *   - the sections are compared with `changelogVersions` from
 *     `release status` over the same text, a fenced heading included,
 *     so the two readers cannot disagree about which versions exist;
 *   - the repository's changelog passes with no receipt in it, and the
 *     same text with a receipted section and an unreceipted one planted
 *     on top REFUSES the unreceipted one while every existing version
 *     still passes, so the pass is not a check that never refuses.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { changelogVersions } from '../commands/release/status.js';

import {
  adoptionBoundary,
  changelogSections,
  checkReceipt,
  readReceipt,
  receiptProblem,
} from './receipt.js';
import { fragmentsReceipt } from './strategies/semver-by-level.js';

/** This repository's own changelog, as committed. */
const REPOSITORY_CHANGELOG = readFileSync(join(import.meta.dir, '..', '..', 'CHANGELOG.md'), 'utf8');

/** A changelog of `sections`, newest first, each a heading and optional receipt. */
function changelog(...sections: ReadonlyArray<readonly [string, readonly string[] | null]>): string {
  const body = sections.flatMap(([version, ids]) => [
    `## ${version} — 2026-09-29, a release`,
    ...(ids === null
      ? []
      : [fragmentsReceipt(ids)]),
    '',
    '- Loop: a line',
    '',
  ]);
  return ['# Changelog', '', ...body].join('\n');
}

describe('reading a receipt line', () => {
  it('reads back the ids fragmentsReceipt writes, in order', () => {
    expect(readReceipt(fragmentsReceipt(['rafa-247', 'rafa-234']))).toEqual(['rafa-247', 'rafa-234']);
  });

  it('tolerates indentation and extra spaces around the ids', () => {
    expect(readReceipt('  <!--  rafa:fragments   rafa-1  rafa-2   -->  ')).toEqual(['rafa-1', 'rafa-2']);
  });

  it('reads a comment naming no fragment as no receipt', () => {
    expect(readReceipt('<!-- rafa:fragments -->')).toBeNull();
    expect(readReceipt(fragmentsReceipt([]))).toBeNull();
  });

  it('reads a comment inside other text, or another comment, as no receipt', () => {
    expect(readReceipt('see <!-- rafa:fragments rafa-1 --> here')).toBeNull();
    expect(readReceipt('<!-- rafa:plan=rafa-1 -->')).toBeNull();
    expect(readReceipt('- Loop: a line')).toBeNull();
  });
});

describe('the sections of a changelog', () => {
  it('names the same versions release status reads, a fenced heading skipped', () => {
    const text = [
      '# Changelog',
      '',
      '```markdown',
      '## 9.9.9 — an example',
      fragmentsReceipt(['rafa-9']),
      '```',
      '',
      '## 0.5.0 — 2026-09-20, a release',
      '',
      '## 0.4.0 — 2026-09-01, an older one',
      '',
    ].join('\n');

    expect(changelogSections(text).map((section) => section.version)).toEqual([...changelogVersions(text)]);
    expect(changelogSections(text)).toEqual([
      { version: '0.5.0', receipt: null },
      { version: '0.4.0', receipt: null },
    ]);
  });

  it('gives each section the receipt under its own heading and no other', () => {
    const text = changelog(['0.6.0', null], ['0.5.0', ['rafa-5']], ['0.4.0', null]);

    expect(changelogSections(text)).toEqual([
      { version: '0.6.0', receipt: null },
      { version: '0.5.0', receipt: ['rafa-5'] },
      { version: '0.4.0', receipt: null },
    ]);
  });

  it('keeps the first receipt a section carries', () => {
    const text = ['## 0.5.0 — a release', fragmentsReceipt(['rafa-1']), fragmentsReceipt(['rafa-2'])].join('\n');

    expect(changelogSections(text)).toEqual([{ version: '0.5.0', receipt: ['rafa-1'] }]);
  });

  it('reads a receipt above the first version heading as no section\'s', () => {
    const text = [fragmentsReceipt(['rafa-0']), '## 0.5.0 — a release', ''].join('\n');

    expect(changelogSections(text)).toEqual([{ version: '0.5.0', receipt: null }]);
  });
});

describe('the adoption boundary', () => {
  it('is not adopted when no section carries a receipt', () => {
    const sections = changelogSections(changelog(['0.5.0', null], ['0.4.0', null]));

    expect(adoptionBoundary(sections)).toEqual({ adopted: false, version: null });
  });

  it('is the newest section below the OLDEST receipted one', () => {
    const text = changelog(['0.8.0', ['rafa-8']], ['0.7.0', ['rafa-7']], ['0.6.0', null], ['0.5.0', null]);

    expect(adoptionBoundary(changelogSections(text))).toEqual({ adopted: true, version: '0.6.0' });
  });

  it('is null when the oldest receipted section is the bottom one', () => {
    const text = changelog(['0.6.0', null], ['0.5.0', ['rafa-5']]);

    expect(adoptionBoundary(changelogSections(text))).toEqual({ adopted: true, version: null });
  });
});

describe('the verdict for one version', () => {
  const ADOPTED = changelog(['0.8.0', null], ['0.7.0', ['rafa-7']], ['0.6.0', null], ['0.5.0', null]);

  it('accepts a receipted section, naming its ids', () => {
    expect(checkReceipt(ADOPTED, '0.7.0')).toEqual({ kind: 'receipted', ids: ['rafa-7'] });
  });

  it('accepts versions at and below the boundary as legacy', () => {
    expect(checkReceipt(ADOPTED, '0.6.0').kind).toBe('legacy');
    expect(checkReceipt(ADOPTED, '0.5.0').kind).toBe('legacy');
  });

  it('refuses an unreceipted version above the boundary', () => {
    expect(checkReceipt(ADOPTED, '0.8.0')).toEqual({
      kind: 'unreceipted',
      boundary: { adopted: true, version: '0.6.0' },
    });
  });

  it('compares by semver precedence, so a prerelease of the boundary is below it', () => {
    const text = changelog(['0.7.0', ['rafa-7']], ['0.6.0', null], ['0.6.0-rc.1', null]);

    expect(checkReceipt(text, '0.6.0-rc.1').kind).toBe('legacy');
  });

  it('refuses every unreceipted version when nothing sits below the oldest receipted section', () => {
    const text = changelog(['0.6.0', null], ['0.5.0', ['rafa-5']]);

    expect(checkReceipt(text, '0.6.0')).toEqual({ kind: 'unreceipted', boundary: { adopted: true, version: null } });
  });

  it('accepts every version when settle was never adopted', () => {
    expect(checkReceipt(changelog(['0.5.0', null], ['0.4.0', null]), '0.5.0').kind).toBe('legacy');
  });

  it('answers absent for a version no section names', () => {
    expect(checkReceipt(ADOPTED, '1.0.0')).toEqual({ kind: 'absent' });
  });

  it('reads the upper of two sections naming one version', () => {
    const text = changelog(['0.6.0', ['rafa-6']], ['0.5.0', null], ['0.6.0', null]);

    expect(checkReceipt(text, '0.6.0')).toEqual({ kind: 'receipted', ids: ['rafa-6'] });
  });
});

describe('why a version may not be tagged', () => {
  it('says nothing for a receipted or a legacy version', () => {
    expect(receiptProblem({ kind: 'receipted', ids: ['rafa-1'] }, '0.5.0', 'CHANGELOG.md')).toBeNull();
    expect(receiptProblem({ kind: 'legacy', boundary: { adopted: false, version: null } }, '0.5.0', 'CHANGELOG.md'))
      .toBeNull();
  });

  it('names the file, the version, the boundary and settle for an unreceipted version', () => {
    const problem = receiptProblem(
      { kind: 'unreceipted', boundary: { adopted: true, version: '0.6.0' } },
      '0.8.0',
      'CHANGELOG.md',
    );

    expect(problem).toBe('the CHANGELOG.md section for 0.8.0 carries no <!-- rafa:fragments --> receipt, and only'
      + ' versions at or below 0.6.0, released before settle, may go without one; release it with rafa release settle');
  });

  it('says no section was released before settle when the boundary is null', () => {
    const problem = receiptProblem(
      { kind: 'unreceipted', boundary: { adopted: true, version: null } },
      '0.6.0',
      'CHANGELOG.md',
    );

    expect(problem).toContain('no section below the oldest settled one was released before settle');
  });

  it('names the missing section for an absent version', () => {
    expect(receiptProblem({ kind: 'absent' }, '1.0.0', 'CHANGELOG.md'))
      .toBe('CHANGELOG.md has no section for 1.0.0, so no receipt names it');
  });
});

describe('this repository\'s CHANGELOG.md', () => {
  const versions = changelogVersions(REPOSITORY_CHANGELOG);

  it('has sections to audit, the same ones release status reads', () => {
    expect(versions.length).toBeGreaterThan(0);
    expect(changelogSections(REPOSITORY_CHANGELOG).map((section) => section.version)).toEqual([...versions]);
  });

  it('passes the audit for every version it names', () => {
    const problems = versions
      .map((version) => receiptProblem(checkReceipt(REPOSITORY_CHANGELOG, version), version, 'CHANGELOG.md'))
      .filter((problem) => problem !== null);

    expect(problems).toEqual([]);
  });

  it('refuses an unreceipted section planted above a settled one, and still passes its own', () => {
    const newest = versions[0] ?? '';
    const planted = REPOSITORY_CHANGELOG.replace(
      `## ${newest} `,
      ['## 99.1.0 — unreceipted', '', '## 99.0.0 — settled', fragmentsReceipt(['rafa-99']), '', `## ${newest} `].join('\n'),
    );

    expect(checkReceipt(planted, '99.1.0')).toEqual({ kind: 'unreceipted', boundary: { adopted: true, version: newest } });
    expect(checkReceipt(planted, '99.0.0').kind).toBe('receipted');
    for (const version of versions) expect(checkReceipt(planted, version).kind).toBe('legacy');
  });
});
