/**
 * Tests for check 4 of the readiness gate (`src/board/refs-gate.ts`):
 * the flag read off a command line, the acceptance a run holds, the
 * start-of-run pass line, and what each reference state does to a run —
 * refused, listed, or let through — with and without an acceptance.
 *
 * The targets are read through a fake verifier answering from a table
 * each case fills, and the copies are files under the temp directory,
 * so what the gate writes back is read off disk.
 *
 * ## The controls
 *
 * Every refusal is paired with the same copy passing: under an
 * acceptance, and after one, under none — so the refusal is the state's
 * and not a gate that refuses everything, and the stamps an acceptance
 * writes are the ones the next plain run reads. The pass line is paired
 * with the setting off printing nothing, and the memoised verifier with
 * a count of reads that a double reading would have doubled.
 */
import type { Output } from '../ports/index.js';
import type { LiveReading, RefStamp } from '../refs/stamp.js';
import type { RefVerifier } from '../refs/verify.js';

import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '../cli/command.js';
import { SETTINGS } from '../config-schema.js';
import { ABSENT, blobFingerprint, issueFingerprint, PRESENT, readRefsBlock, UNREADABLE, writeRefsBlock } from '../refs/stamp.js';
import { RefVerifyError } from '../refs/verify.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { BOARD_REFUSAL_EXIT } from './plan-spec.js';
import {
  ACCEPT_REFS_FLAG,
  ACCEPT_STALE_REFS_KEY,
  acceptStaleRefsPassLine,
  announceAcceptStaleRefs,
  enforceRefsGate,
  readAcceptRefsFlag,
  refsAcceptance,
  refsRefusalMessage,
} from './refs-gate.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-refs-gate-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The spec's own issue number, which a resolved row's unblock command names. */
const SPEC = 20;

/** What the refusal calls the spec. */
const SOURCE = `issue #${String(SPEC)}`;

/** Issue 7's body as the spec was first read against it. */
const ISSUE_7_BEFORE = '## Design\n\nOne table.\n\n## Scope\n\nThe gate.\n';

/** Issue 7's body with its `Design` section rewritten. */
const ISSUE_7_DESIGN_CHANGED = '## Design\n\nTwo tables.\n\n## Scope\n\nThe gate.\n';

/** Issue 7's body with both sections rewritten. */
const ISSUE_7_BOTH_CHANGED = '## Design\n\nTwo tables.\n\n## Scope\n\nThe gate and the doctor.\n';

/** The first blob sha of a file, and the one a later commit gave it. */
const BLOB_BEFORE = 'a'.repeat(40);
const BLOB_AFTER = 'b'.repeat(40);

/** An issue's fingerprint over `body`, open unless `state` says otherwise. */
function issue(body: string, state: 'open' | 'closed' = 'open'): LiveReading {
  return issueFingerprint({ title: 'Issue', body, state });
}

/** The lines a gate wrote, by level. */
interface Lines {
  readonly info: string[];
  readonly warn: string[];
}

/** An Output keeping the lines it is handed. */
function capture(): { lines: Lines; output: Output } {
  const lines: Lines = { info: [], warn: [] };
  return {
    lines,
    output: sinkOutput({
      info: (message) => {
        lines.info.push(message);
      },
      warn: (message) => {
        lines.warn.push(message);
      },
    }),
  };
}

/** A verifier answering each `kind text` from `table`, PRESENT for anything else, counting its reads. */
function fakeVerifier(table: Readonly<Record<string, LiveReading>>): { verify: RefVerifier; reads: string[] } {
  const reads: string[] = [];
  const verify: RefVerifier = (ref) => {
    const key = `${ref.kind} ${ref.text}`;
    reads.push(key);
    return Promise.resolve(table[key] ?? PRESENT);
  };
  return { verify, reads };
}

/** Writes a saved copy of `lines` holding `stamps`, or no block when null, and answers its path. */
function plantCopy(name: string, lines: readonly string[], stamps: readonly RefStamp[] | null): string {
  const path = join(tempBase, `${name}.md`);
  writeFileSync(path, writeRefsBlock(lines.join('\n'), stamps));
  return path;
}

/** The refusal `run` ends with, or a failure when it ends with none. */
async function refusal(run: Promise<unknown>): Promise<CommandExit> {
  try {
    await run;
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('expected check 4 to refuse');
}

/** A spec naming a file on line 5 and issue 7 on line 7. */
const SPEC_LINES = [
  '# Spec',
  '',
  '## Scope',
  '',
  'Touches `src/a.ts`.',
  '',
  'Builds on #7.',
];

/** The stamps a first reading of {@link SPEC_LINES} left, when both targets were there. */
const SPEC_STAMPS: readonly RefStamp[] = [
  { kind: 'path', text: 'src/a.ts', fingerprint: blobFingerprint(BLOB_BEFORE) },
  { kind: 'issue', text: '#7', fingerprint: issueFingerprint({ title: 'Issue', body: ISSUE_7_BEFORE, state: 'open' }) },
];

describe('readAcceptRefsFlag', () => {
  it('reads the bare word, and nothing that only resembles it', () => {
    expect(ACCEPT_REFS_FLAG).toBe('--accept-refs');
    expect(readAcceptRefsFlag(['--issue=20', ACCEPT_REFS_FLAG])).toBe(true);
    expect(readAcceptRefsFlag(['--issue=20'])).toBe(false);
    expect(readAcceptRefsFlag(['--accept-ref', '--accept-refs-all'])).toBe(false);
  });
});

describe('refsAcceptance', () => {
  it('is the flag\'s when typed, the config\'s when only it is on, and none otherwise', () => {
    expect(refsAcceptance(true, false)).toBe('flag');
    expect(refsAcceptance(true, true)).toBe('flag');
    expect(refsAcceptance(false, true)).toBe('config');
    expect(refsAcceptance(false, false)).toBe('none');
  });
});

describe('announceAcceptStaleRefs', () => {
  it('names the setting as SETTINGS spells it', () => {
    expect(ACCEPT_STALE_REFS_KEY).toBe(SETTINGS.dangerousAcceptStaleRefs.key);
    expect(ACCEPT_STALE_REFS_KEY).toBe('dangerous.acceptStaleRefs');
  });

  it('prints one pass line when the setting is on', () => {
    const { lines, output } = capture();
    announceAcceptStaleRefs(true, output);
    expect(lines.warn).toEqual([acceptStaleRefsPassLine()]);
    expect(lines.warn[0]).toContain('dangerous.acceptStaleRefs is on');
    expect(lines.info).toEqual([]);
  });

  it('prints nothing when the setting is off', () => {
    const { lines, output } = capture();
    announceAcceptStaleRefs(false, output);
    expect(lines).toEqual({ info: [], warn: [] });
  });
});

describe('enforceRefsGate, with no acceptance', () => {
  it('lets an ok copy through, printing nothing, and stamps what it read first', async () => {
    const path = plantCopy('ok', SPEC_LINES, null);
    const { verify } = fakeVerifier({ 'path src/a.ts': blobFingerprint(BLOB_BEFORE), 'issue #7': issue(ISSUE_7_BEFORE) });
    const { lines, output } = capture();

    const answer = await enforceRefsGate({ path, issue: SPEC, source: SOURCE, verify, acceptance: 'none', output });

    expect(answer.rows.map((row) => row.state)).toEqual(['ok', 'ok']);
    expect(answer.accepted).toEqual([]);
    expect(answer.restamped).toBe(false);
    expect(lines).toEqual({ info: [], warn: [] });
    expect(readRefsBlock(readFileSync(path, 'utf8')).stamps).toEqual(SPEC_STAMPS);
  });

  it('refuses a dangling path with its line and the two ways past it, at the board refusal exit', async () => {
    const path = plantCopy('dangling', SPEC_LINES, SPEC_STAMPS);
    const { verify } = fakeVerifier({ 'path src/a.ts': ABSENT, 'issue #7': issue(ISSUE_7_BEFORE) });

    const exit = await refusal(enforceRefsGate({ path, issue: SPEC, source: SOURCE, verify, acceptance: 'none', output: capture().output }));

    expect(exit.exitCode).toBe(BOARD_REFUSAL_EXIT);
    expect(exit.message).toBe([
      '❌ issue #20 names references that are missing or changed since the spec was read:',
      '   • dangling src/a.ts (line 5)',
      '   Pass --accept-refs to re-stamp them as reviewed and plan on this run,'
      + ' or edit the issue so the spec names what is there now.',
    ].join('\n'));
  });

  it('refuses a target that does not exist on its first read, and stamps nothing for it', async () => {
    const path = plantCopy('dangling-first', SPEC_LINES, null);
    const { verify } = fakeVerifier({ 'path src/a.ts': ABSENT, 'issue #7': issue(ISSUE_7_BEFORE) });

    const exit = await refusal(enforceRefsGate({ path, issue: SPEC, source: SOURCE, verify, acceptance: 'none', output: capture().output }));

    expect(exit.message).toContain('   • dangling src/a.ts (line 5)');
    expect(readRefsBlock(readFileSync(path, 'utf8')).stamps?.map((stamp) => stamp.text)).toEqual(['#7']);
  });

  it('refuses a suspect issue naming the heading whose text changed', async () => {
    const path = plantCopy('suspect-heading', SPEC_LINES, SPEC_STAMPS);
    const { verify } = fakeVerifier({ 'path src/a.ts': blobFingerprint(BLOB_BEFORE), 'issue #7': issue(ISSUE_7_DESIGN_CHANGED) });

    const exit = await refusal(enforceRefsGate({ path, issue: SPEC, source: SOURCE, verify, acceptance: 'none', output: capture().output }));

    expect(exit.exitCode).toBe(BOARD_REFUSAL_EXIT);
    expect(exit.message).toContain('   • suspect #7: heading "Design" changed (line 7)');
    expect(exit.message).not.toContain('src/a.ts');
  });

  it('names every changed heading of a suspect issue on one line', async () => {
    const path = plantCopy('suspect-headings', SPEC_LINES, SPEC_STAMPS);
    const { verify } = fakeVerifier({ 'path src/a.ts': blobFingerprint(BLOB_BEFORE), 'issue #7': issue(ISSUE_7_BOTH_CHANGED) });

    const exit = await refusal(enforceRefsGate({ path, issue: SPEC, source: SOURCE, verify, acceptance: 'none', output: capture().output }));

    expect(exit.message).toContain('   • suspect #7: headings "Design", "Scope" changed (line 7)');
  });

  it('refuses a suspect file by its line, and lists every refused row', async () => {
    const path = plantCopy('suspect-file', SPEC_LINES, SPEC_STAMPS);
    const { verify } = fakeVerifier({ 'path src/a.ts': blobFingerprint(BLOB_AFTER), 'issue #7': issue(ISSUE_7_DESIGN_CHANGED) });

    const exit = await refusal(enforceRefsGate({ path, issue: SPEC, source: SOURCE, verify, acceptance: 'none', output: capture().output }));

    expect(exit.message.split('\n').filter((line) => line.startsWith('   • '))).toEqual([
      '   • suspect src/a.ts (line 5)',
      '   • suspect #7: heading "Design" changed (line 7)',
    ]);
  });

  it('prints a closed blocker as resolved with the unblock command, and does not refuse', async () => {
    const lines = ['# Spec', '', 'Blocked by: #9'];
    const stamps: RefStamp[] = [{ kind: 'issue', text: '#9', fingerprint: issueFingerprint({ title: 'Issue', body: 'x', state: 'open' }) }];
    const path = plantCopy('resolved', lines, stamps);
    const { verify } = fakeVerifier({ 'issue #9': issue('x', 'closed') });
    const captured = capture();

    const answer = await enforceRefsGate({ path, issue: SPEC, source: SOURCE, verify, acceptance: 'none', output: captured.output });

    expect(answer.rows.map((row) => row.state)).toEqual(['resolved']);
    expect(captured.lines.info).toEqual(['resolved #9 — rafa issue unblock 20']);
  });

  it('lists an unknown cross-repository issue and does not refuse', async () => {
    const path = plantCopy('unknown', ['# Spec', '', 'Builds on acme/tools#3.'], null);
    const { verify } = fakeVerifier({ 'cross-issue acme/tools#3': UNREADABLE });
    const captured = capture();

    const answer = await enforceRefsGate({ path, issue: SPEC, source: SOURCE, verify, acceptance: 'none', output: captured.output });

    expect(answer.rows.map((row) => row.state)).toEqual(['unknown']);
    expect(captured.lines.info).toEqual(['unknown acme/tools#3 (line 3) — its repository could not be read, so it is not checked']);
  });

  it('prints the resolved and unknown rows before a refusal the other rows make', async () => {
    const lines = ['# Spec', '', 'Blocked by: #9', '', 'Touches `src/a.ts` and acme/tools#3.'];
    const stamps: RefStamp[] = [{ kind: 'issue', text: '#9', fingerprint: issueFingerprint({ title: 'Issue', body: 'x', state: 'open' }) }];
    const path = plantCopy('mixed', lines, stamps);
    const { verify } = fakeVerifier({ 'issue #9': issue('x', 'closed'), 'path src/a.ts': ABSENT, 'cross-issue acme/tools#3': UNREADABLE });
    const captured = capture();

    const exit = await refusal(enforceRefsGate({ path, issue: SPEC, source: SOURCE, verify, acceptance: 'none', output: captured.output }));

    expect(captured.lines.info).toEqual([
      'resolved #9 — rafa issue unblock 20',
      'unknown acme/tools#3 (line 5) — its repository could not be read, so it is not checked',
    ]);
    expect(exit.message).toContain('   • dangling src/a.ts (line 5)');
    expect(exit.message).not.toContain('#9');
    expect(exit.message).not.toContain('acme/tools#3');
  });
});

describe('enforceRefsGate, accepting', () => {
  it('re-stamps every reference under --accept-refs, names what it accepted, and the next plain run passes', async () => {
    const path = plantCopy('accept-flag', SPEC_LINES, SPEC_STAMPS);
    const table = { 'path src/a.ts': ABSENT, 'issue #7': issue(ISSUE_7_DESIGN_CHANGED) };
    const plainRefusal = await refusal(enforceRefsGate({
      path, issue: SPEC, source: SOURCE, verify: fakeVerifier(table).verify, acceptance: 'none', output: capture().output,
    }));
    expect(plainRefusal.exitCode).toBe(BOARD_REFUSAL_EXIT);
    const captured = capture();

    const answer = await enforceRefsGate({ path, issue: SPEC, source: SOURCE, verify: fakeVerifier(table).verify, acceptance: 'flag', output: captured.output });

    expect(answer.restamped).toBe(true);
    expect(answer.accepted.map((row) => row.state)).toEqual(['dangling', 'suspect']);
    expect(captured.lines.info).toEqual([
      '🔖 --accept-refs: re-stamped 2 references of issue #20 as reviewed.',
      '   • accepted dangling src/a.ts (line 5)',
      '   • accepted suspect #7: heading "Design" changed (line 7)',
    ]);
    expect(readRefsBlock(readFileSync(path, 'utf8')).stamps).toEqual([
      { kind: 'path', text: 'src/a.ts', fingerprint: ABSENT },
      { kind: 'issue', text: '#7', fingerprint: issueFingerprint({ title: 'Issue', body: ISSUE_7_DESIGN_CHANGED, state: 'open' }) },
    ]);

    const after = await enforceRefsGate({ path, issue: SPEC, source: SOURCE, verify: fakeVerifier(table).verify, acceptance: 'none', output: capture().output });
    expect(after.rows.map((row) => row.state)).toEqual(['ok', 'ok']);
  });

  it('does the same under dangerous.acceptStaleRefs, naming the setting', async () => {
    const path = plantCopy('accept-config', SPEC_LINES, SPEC_STAMPS);
    const { verify } = fakeVerifier({ 'path src/a.ts': ABSENT, 'issue #7': issue(ISSUE_7_BEFORE) });
    const captured = capture();

    const answer = await enforceRefsGate({ path, issue: SPEC, source: SOURCE, verify, acceptance: 'config', output: captured.output });

    expect(answer.accepted.map((row) => row.text)).toEqual(['src/a.ts']);
    expect(captured.lines.info).toEqual([
      '🔖 dangerous.acceptStaleRefs: re-stamped 2 references of issue #20 as reviewed.',
      '   • accepted dangling src/a.ts (line 5)',
    ]);
    expect(readRefsBlock(readFileSync(path, 'utf8')).stamps?.[0]).toEqual({ kind: 'path', text: 'src/a.ts', fingerprint: ABSENT });
  });

  it('still prints the resolved and unknown rows, and keeps no stamp for an unreadable target', async () => {
    const lines = ['# Spec', '', 'Blocked by: #9', '', 'Builds on acme/tools#3.'];
    const stamps: RefStamp[] = [{ kind: 'issue', text: '#9', fingerprint: issueFingerprint({ title: 'Issue', body: 'x', state: 'open' }) }];
    const path = plantCopy('accept-passing', lines, stamps);
    const { verify } = fakeVerifier({ 'issue #9': issue('x', 'closed'), 'cross-issue acme/tools#3': UNREADABLE });
    const captured = capture();

    const answer = await enforceRefsGate({ path, issue: SPEC, source: SOURCE, verify, acceptance: 'flag', output: captured.output });

    expect(answer.accepted).toEqual([]);
    expect(captured.lines.info).toEqual([
      'resolved #9 — rafa issue unblock 20',
      'unknown acme/tools#3 (line 5) — its repository could not be read, so it is not checked',
      '🔖 --accept-refs: re-stamped 1 reference of issue #20 as reviewed.',
    ]);
    expect(readRefsBlock(readFileSync(path, 'utf8')).stamps?.map((stamp) => stamp.text)).toEqual(['#9']);
  });

  it('reads each target once, though it reads the copy twice', async () => {
    const path = plantCopy('accept-memo', SPEC_LINES, SPEC_STAMPS);
    const { verify, reads } = fakeVerifier({ 'path src/a.ts': ABSENT, 'issue #7': issue(ISSUE_7_BEFORE) });

    await enforceRefsGate({ path, issue: SPEC, source: SOURCE, verify, acceptance: 'flag', output: capture().output });

    expect(reads).toEqual(['path src/a.ts', 'issue #7']);
  });
});

describe('enforceRefsGate, when a reference cannot be read', () => {
  it('refuses a board issue gh could not read, with the error\'s words', async () => {
    const path = plantCopy('verify-error', SPEC_LINES, SPEC_STAMPS);
    const verify: RefVerifier = () => Promise.reject(new RefVerifyError('gh issue view 7 failed: HTTP 401'));

    const exit = await refusal(enforceRefsGate({ path, issue: SPEC, source: SOURCE, verify, acceptance: 'none', output: capture().output }));

    expect(exit.exitCode).toBe(BOARD_REFUSAL_EXIT);
    expect(exit.message).toBe('❌ The references of issue #20 could not be read: refs verify: gh issue view 7 failed: HTTP 401');
  });

  it('refuses a refs block the codec will not read, accepting or not', async () => {
    const path = join(tempBase, 'bad-block.md');
    writeFileSync(path, '<!-- rafa:refs\nrefs: [\n\n# Spec\n');

    for (const acceptance of ['none', 'flag'] as const) {
      const exit = await refusal(enforceRefsGate({ path, issue: SPEC, source: SOURCE, verify: fakeVerifier({}).verify, acceptance, output: capture().output }));
      expect(exit.exitCode).toBe(BOARD_REFUSAL_EXIT);
      expect(exit.message).toStartWith('❌ The references of issue #20 could not be read: rafa:refs block:');
    }
  });

  it('lets any other error travel out as it was thrown', async () => {
    const path = plantCopy('other-error', SPEC_LINES, SPEC_STAMPS);
    const thrown = new TypeError('not a verifier error');
    const verify: RefVerifier = () => Promise.reject(thrown);

    let caught: unknown = null;
    try {
      await enforceRefsGate({ path, issue: SPEC, source: SOURCE, verify, acceptance: 'none', output: capture().output });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(thrown);
  });
});

describe('refsRefusalMessage', () => {
  it('lists only the dangling and suspect rows it is handed', () => {
    const row = { kind: 'path', text: 'src/a.ts', line: 3, fingerprint: ABSENT, stamp: null, changedHeadings: [], unblock: null } as const;
    const message = refsRefusalMessage(SOURCE, [
      { ...row, state: 'dangling' },
      { ...row, text: 'src/b.ts', state: 'ok' },
      { ...row, text: '#9', kind: 'issue', state: 'resolved', unblock: 'rafa issue unblock 20' },
    ]);

    expect(message).toContain('   • dangling src/a.ts (line 3)');
    expect(message).not.toContain('src/b.ts');
    expect(message).not.toContain('#9');
  });
});
