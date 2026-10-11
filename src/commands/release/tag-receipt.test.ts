/**
 * Tests for the receipt check `rafa release tag` (`tag.ts`) delegates to
 * `../../release/receipt.ts`. They live apart from `./tag.test.ts`,
 * which is past the 800-line cap.
 *
 * The decision is driven from literal readings, as `./tag.test.ts`
 * drives it, and the reading is driven over a real changelog on disk
 * through `readTagInputs` with a git seam answering from a table. The
 * control for the refusal is the same inputs with the verdict turned
 * receipted, which tags: the refusal is the receipt's, not another
 * check's.
 */
import type { TagDecision, TagInputs, TagRefused } from './tag.js';
import type { GitResult, GitRunner } from '../../pr/index.js';
import type { ReleaseTag } from '../../release/status-readings.js';

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { fragmentsReceipt } from '../../release/strategies/semver-by-level.js';
import { parseSemanticVersion } from '../../release/version.js';

import { decideTag, DEFAULT_RELEASE_BRANCH, readTagInputs } from './tag.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-tag-receipt-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The version the cases are about to tag. */
const VERSION = '0.8.0';

/** The commit the readings say set {@link VERSION}. */
const SET_COMMIT = '7db04a24932a061f36518918f1e776a67cd601f8';

/** The unreceipted verdict: settle adopted at 0.7.0, the boundary 0.6.0. */
const UNRECEIPTED = { kind: 'unreceipted', boundary: { adopted: true, version: '0.6.0' } } as const;

/** A release tag, as `release status` reads one. */
function tag(raw: string): ReleaseTag {
  const bare = raw.slice(1);
  const parsed = parseSemanticVersion(bare);
  if (parsed === null) throw new Error(`the case wrote no version: ${raw}`);
  return { tag: raw, version: bare, parsed };
}

/** Readings that all agree and carry a receipt, narrowed by `over`. */
function inputs(over: Partial<TagInputs> = {}): TagInputs {
  return {
    releaseBranch: DEFAULT_RELEASE_BRANCH,
    branch: { branch: DEFAULT_RELEASE_BRANCH, problem: null },
    version: { path: 'package.json', text: null, version: VERSION, problem: null },
    changelog: { path: 'CHANGELOG.md', version: VERSION, problem: null },
    tags: { tags: [tag('v0.7.0')], latest: tag('v0.7.0'), problem: null },
    release: { commit: SET_COMMIT, ahead: 0, problem: null },
    receipt: { kind: 'receipted', ids: ['rafa-8'] },
    ...over,
  };
}

/** The refusal `decision` is, or a throw naming what it was instead. */
function refusalOf(decision: TagDecision): TagRefused {
  if (decision.kind !== 'refused') throw new Error(`the case expected a refusal, got ${decision.kind}`);
  return decision;
}

describe('the receipt check in the tag decision', () => {
  it('tags a receipted version, the control for every refusal below', () => {
    expect(decideTag(inputs()).kind).toBe('ready');
  });

  it('tags a legacy version at or below the boundary', () => {
    const legacy = { kind: 'legacy', boundary: { adopted: false, version: null } } as const;

    expect(decideTag(inputs({ receipt: legacy })).kind).toBe('ready');
  });

  it('refuses an unreceipted version above the boundary with the receipt reason', () => {
    const refusal = refusalOf(decideTag(inputs({ receipt: UNRECEIPTED })));

    expect(refusal.reason).toBe('receipt');
    expect(refusal.message).toContain(`the CHANGELOG.md section for ${VERSION} carries no`);
    expect(refusal.message).toContain('rafa release settle');
  });

  it('refuses when the receipt was never read, rather than passing', () => {
    const refusal = refusalOf(decideTag(inputs({ receipt: null })));

    expect(refusal).toEqual({
      kind: 'refused',
      reason: 'receipt',
      message: `CHANGELOG.md was not read for the receipt of ${VERSION}`,
    });
  });

  it('refuses for the changelog disagreement before the receipt', () => {
    const refusal = refusalOf(decideTag(inputs({
      changelog: { path: 'CHANGELOG.md', version: '0.7.0', problem: null },
      receipt: UNRECEIPTED,
    })));

    expect(refusal.reason).toBe('changelog');
  });

  it('refuses for the receipt before the release commit, which is only about where the tag goes', () => {
    const refusal = refusalOf(decideTag(inputs({
      receipt: UNRECEIPTED,
      release: { commit: null, ahead: 0, problem: { reason: 'git', message: 'the history could not be read' } },
    })));

    expect(refusal.reason).toBe('receipt');
  });
});

describe('reading the receipt off the changelog on disk', () => {
  /** A git seam answering `main` for the branch and success with no output for the rest. */
  const git: GitRunner = (args): GitResult => (args[0] === 'rev-parse'
    ? { ok: true, stdout: `${DEFAULT_RELEASE_BRANCH}\n`, stderr: '' }
    : { ok: true, stdout: '', stderr: '' });

  /** The readings over a project whose changelog is `text`. */
  function readingsOver(name: string, text: string): TagInputs {
    const dir = mkdtempSync(join(tempBase, `${name}-`));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: VERSION }));
    writeFileSync(join(dir, 'CHANGELOG.md'), text);
    return readTagInputs(dir, git, {
      versionFile: 'package.json',
      changelog: 'CHANGELOG.md',
      releaseBranch: DEFAULT_RELEASE_BRANCH,
    });
  }

  /** A changelog whose newest section names {@link VERSION}, with `receipt` under it or none. */
  function changelogWith(receipt: string | null): string {
    return [
      '# Changelog',
      '',
      `## ${VERSION} — 2026-09-29, the newest`,
      ...(receipt === null
        ? []
        : [receipt]),
      '',
      '## 0.7.0 — 2026-09-28, the first settled',
      fragmentsReceipt(['rafa-7']),
      '',
      '## 0.6.0 — 2026-09-27, written by hand',
      '',
    ].join('\n');
  }

  it('reads the receipt of the version the version file declares', () => {
    const readings = readingsOver('receipted', changelogWith(fragmentsReceipt(['rafa-8'])));

    expect(readings.receipt).toEqual({ kind: 'receipted', ids: ['rafa-8'] });
  });

  it('reads an unreceipted section above the boundary as the refusal', () => {
    const readings = readingsOver('unreceipted', changelogWith(null));

    expect(readings.receipt).toEqual(UNRECEIPTED);
    expect(refusalOf(decideTag({ ...readings, release: inputs().release })).reason).toBe('receipt');
  });
});
