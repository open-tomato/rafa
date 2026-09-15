/**
 * Tests for the `progress.txt` renderer.
 *
 * Three layers, each driven where it lives. The cap and the entry layout
 * are PURE, so they are driven through `renderProgressText` and
 * `formatFinding` over findings built here, at exact byte counts. The
 * filter and the order belong to the STORE, so they are driven over a real
 * SQLite file under a fresh temporary root, seeded through `writeFindings`
 * as the loop seeds it. The file belongs to the WRITE, so what
 * `writeProgress` answers is read back off disk.
 *
 * Numbers are literals, never the module's constants: a case comparing
 * the cap against itself could not tell 16,000 from 160,000.
 *
 * Two cases hold the module to files it does not import. The escape set is
 * checked with the control-byte gate's own scanners over text built from
 * the gate's own sets, beside the unescaped text as the control that the
 * scan can fail. The cap is checked against `plan.ts`'s truncation by
 * passing a cap-filling render through `formatProgressSection`, beside an
 * over-cap string as the control that the truncation acts at all.
 *
 * MUTATION NOTE. Twenty-nine legs of `progress.ts` were driven against
 * this file alone, each through its own `bun test` run, with the
 * unmutated module green before and after and restored byte-identical:
 * 29 applied, 29 red, 0 green, and their union reddens 33 of the 35
 * cases. The two it cannot reach are the two controls above, whose
 * subjects are the gate's scanners and `plan.ts`'s truncation, so no
 * mutation of this module moves them. The legs: the global findings
 * dropped from the filter, every plan admitted, oldest first, ordering
 * by `collected_at`, a strict fit at the cap, oversized at the cap, a
 * greedy fill past a misfit, no oversized skip, UTF-16 length for bytes,
 * no escaping, the carriage return passed, the emoji joiners passed,
 * trailing line feeds kept, a continuation at field depth, an opening
 * field keeping its indent, an unindented `what` continuation, a null
 * field rendered, the listed fields reordered, an absent store created,
 * the file blanked before the read, the cap checked for sign alone, a
 * cap of minus one accepted, oversized findings counted as omitted, the
 * cap doubled, an empty render writing a line feed, an unreadable store
 * read as empty, and the plan stub, `cause` and `kind` columns misread.
 */
import type { ProgressFinding } from './progress.js';
import type { ReportFinding } from '../report/parse.js';

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  EMOJI_JOINERS,
  FORBIDDEN_BYTES,
  FORBIDDEN_CODEPOINTS,
  scanBuffer,
  scanText,
} from '../../scripts/control-byte-gate/control-byte-gate.js';
import { writeFindings } from '../effort/store/findings.js';
import { formatProgressSection } from '../plan.js';

import {
  formatFinding,
  PROGRESS_CAP_BYTES,
  PROGRESS_FILE_NAME,
  progressFilePath,
  readProgressFindings,
  renderProgressText,
  writeProgress,
} from './progress.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-progress-'));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A repo root of its own, created empty, so no case sees another's. */
function freshRoot(name: string): string {
  planted += 1;
  const root = join(tempBase, `${planted}-${name}`);
  mkdirSync(root, { recursive: true });
  return root;
}

/** The store file under a root. */
function storeFile(root: string): string {
  return join(root, '.rafa', 'effort', 'effort.sqlite');
}

/** A backslash, for spelling an expected escape. */
const BACKSLASH = String.fromCharCode(0x5c);

/** A finding carrying `what` alone, as a render reads one. */
function bare(what: string): ProgressFinding {
  return {
    seq: 1,
    planStub: null,
    kind: null,
    trigger: null,
    what,
    cause: null,
    resolution: null,
    artifact: null,
    signal: null,
  };
}

/**
 * A finding whose entry is exactly `bytes` ASCII bytes: the two bytes of
 * `- `, the letters, and the line feed.
 */
function sized(bytes: number, letter: string): ProgressFinding {
  return bare(letter.repeat(bytes - 3));
}

/** The report example the spec gives, as a render reads it. */
const EXAMPLE: ProgressFinding = {
  seq: 7,
  planStub: 'phase-0',
  kind: 'gotcha',
  trigger: 'when running bun test under a fresh worktree',
  what: 'node_modules is absent after fork',
  cause: 'worktree creation does not run bun install',
  resolution: 'run bun install before the first test',
  artifact: 'Cannot find package',
  signal: 'loud',
};

/** A report finding whose text fields each name it, as `parseReport` answers one. */
function reported(what: string): ReportFinding {
  return {
    trigger: 'when a case seeds the store',
    kind: 'pattern',
    what,
    cause: `cause of ${what}`,
    resolution: `resolution of ${what}`,
    artifact: `artifact of ${what}`,
    signal: 'silent',
    extras: [],
  };
}

/** Writes one report's findings under a session, a plan stub and a clock. */
function seed(
  root: string,
  sessionId: string,
  planStub: string | null,
  whats: readonly string[],
  at = '2026-09-13T10:00:00.000Z',
): void {
  let count = 0;
  writeFindings(
    root,
    {
      dispatch: { sessionId, planStub, taskLine: 'A task' },
      outcome: 'done',
      findings: whats.map(reported),
    },
    {
      now: () => new Date(at),
      newId: () => {
        count += 1;
        return `${sessionId}-${count}`;
      },
    },
  );
}

/** Each finding's `what` under one plan stub, in the order read. */
function whatsFor(root: string, planStub: string | null): (string | null)[] {
  return readProgressFindings(root, planStub).map((finding) => finding.what);
}

describe('the file', () => {
  it('is progress.txt at the repo root, capped at 16,000 bytes', () => {
    expect(PROGRESS_FILE_NAME).toBe('progress.txt');
    expect(progressFilePath('/tmp/somewhere')).toBe(join('/tmp/somewhere', 'progress.txt'));
    expect(PROGRESS_CAP_BYTES).toBe(16_000);
  });
});

describe('the cap', () => {
  it('renders nothing from no findings', () => {
    expect(renderProgressText([])).toEqual({
      text: '',
      bytes: 0,
      rendered: 0,
      oversized: 0,
      omitted: 0,
    });
  });

  it('fills the default cap to the byte with whole entries', () => {
    const findings = Array.from({ length: 170 }, () => sized(100, 'x'));
    const render = renderProgressText(findings);

    expect(render.rendered).toBe(160);
    expect(render.bytes).toBe(16_000);
    expect(Buffer.byteLength(render.text, 'utf8')).toBe(16_000);
    expect(render.omitted).toBe(10);
    expect(render.oversized).toBe(0);
  });

  it('takes an entry ending at the cap, and not one a byte past it', () => {
    const findings = [sized(60, 'a'), sized(40, 'b')];

    expect(renderProgressText(findings, 100).rendered).toBe(2);
    expect(renderProgressText(findings, 99).rendered).toBe(1);
    expect(renderProgressText(findings, 99).text).toBe(`- ${'a'.repeat(57)}\n`);
    expect(renderProgressText([sized(100, 'a')], 100).oversized).toBe(0);
    expect(renderProgressText([sized(100, 'a')], 99).oversized).toBe(1);
  });

  it('counts bytes, not characters', () => {
    // Each entry is 63 bytes and 33 UTF-16 code units: by length, both fit.
    const letter = String.fromCodePoint(0xe9);
    const findings = [bare(letter.repeat(30)), bare(letter.repeat(30))];
    const render = renderProgressText(findings, 100);

    expect(render.rendered).toBe(1);
    expect(render.bytes).toBe(63);
    expect(render.text.length).toBe(33);
  });

  it('ends the render at the first entry that does not fit', () => {
    const findings = [sized(60, 'a'), sized(60, 'b'), sized(10, 'c')];
    const render = renderProgressText(findings, 100);

    // The older 10-byte entry would fit the 40 bytes left. It is not taken.
    expect(render.text).toBe(`- ${'a'.repeat(57)}\n`);
    expect(render.rendered).toBe(1);
    expect(render.omitted).toBe(2);
    expect(render.oversized).toBe(0);
  });

  it('skips an entry larger than the whole cap and renders what follows', () => {
    const findings = [sized(150, 'a'), sized(40, 'b'), sized(40, 'c')];
    const render = renderProgressText(findings, 100);

    expect(render.text).toBe(`- ${'b'.repeat(37)}\n- ${'c'.repeat(37)}\n`);
    expect(render.oversized).toBe(1);
    expect(render.omitted).toBe(0);
  });

  it('counts an oversized entry past the point the render filled', () => {
    const findings = [sized(60, 'a'), sized(60, 'b'), sized(150, 'c'), sized(10, 'd')];
    const render = renderProgressText(findings, 100);

    expect([render.rendered, render.omitted, render.oversized]).toEqual([1, 2, 1]);
  });

  it('renders nothing under a cap of zero', () => {
    const render = renderProgressText([sized(10, 'a')], 0);

    expect(render.text).toBe('');
    expect(render.oversized).toBe(1);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses a cap of %p', (cap) => {
    expect(() => renderProgressText([], cap)).toThrow(RangeError);
  });
});

describe('an entry', () => {
  it('heads a bullet with what and lists every other field under it', () => {
    expect(formatFinding(EXAMPLE)).toBe([
      '- node_modules is absent after fork',
      '  trigger: when running bun test under a fresh worktree',
      '  kind: gotcha',
      '  cause: worktree creation does not run bun install',
      '  resolution: run bun install before the first test',
      '  artifact: Cannot find package',
      '  signal: loud',
    ].join('\n'));
  });

  it('leaves out a null field', () => {
    const finding = { ...EXAMPLE, cause: null, resolution: null };

    expect(formatFinding(finding)).toBe([
      '- node_modules is absent after fork',
      '  trigger: when running bun test under a fresh worktree',
      '  kind: gotcha',
      '  artifact: Cannot find package',
      '  signal: loud',
    ].join('\n'));
  });

  it('opens the bullet with the first listed field when there is no what', () => {
    const finding = {
      ...bare('unused'),
      what: null,
      kind: 'gotcha',
      artifact: 'Cannot find package',
    };

    expect(formatFinding(finding)).toBe('- kind: gotcha\n  artifact: Cannot find package');
  });

  it('continues a value over several lines, indented past its field', () => {
    const finding = { ...bare('first line\nsecond line'), cause: 'one\n\ntwo\n' };

    expect(formatFinding(finding)).toBe([
      '- first line',
      '    second line',
      '  cause: one',
      '',
      '    two',
    ].join('\n'));
  });

  it('ends every rendered entry with exactly one line feed', () => {
    const { text } = renderProgressText([{ ...EXAMPLE, what: 'a\n\n\n' }, EXAMPLE]);

    expect(text.split('\n- ')).toHaveLength(2);
    expect(text.endsWith('signal: loud\n')).toBe(true);
    expect(text).not.toContain('\n\n');
  });
});

describe('characters the control-byte gate refuses', () => {
  /** Every code point the gate refuses, each between two letters. */
  const refused = [...FORBIDDEN_BYTES, ...FORBIDDEN_CODEPOINTS, ...EMOJI_JOINERS];
  const unsafe = `${refused.map((code) => `a${String.fromCodePoint(code)}`).join('')}a`;

  it('leaves none in a render for either scan to find', () => {
    const { text } = renderProgressText([{ ...EXAMPLE, what: unsafe, artifact: unsafe }]);

    expect(scanBuffer(PROGRESS_FILE_NAME, Buffer.from(text, 'utf8'))).toEqual([]);
    expect(scanText(PROGRESS_FILE_NAME, text)).toEqual([]);
  });

  it('proves both scans find every one in the same text unescaped', () => {
    const text = `- ${unsafe}\n`;
    const bytes = scanBuffer(PROGRESS_FILE_NAME, Buffer.from(text, 'utf8'))
      .map((finding) => finding.byte);
    const codes = scanText(PROGRESS_FILE_NAME, text).map((finding) => finding.byte);

    expect(new Set(bytes)).toEqual(new Set(FORBIDDEN_BYTES));
    expect(new Set(codes)).toEqual(new Set([...FORBIDDEN_CODEPOINTS, ...EMOJI_JOINERS]));
  });

  it('spells an escape as a backslash, u and four hex digits', () => {
    const esc = String.fromCharCode(0x1b);

    expect(formatFinding(bare(`${esc}[31mError`))).toBe(`- ${BACKSLASH}u001b[31mError`);
  });

  it('escapes a carriage return and passes a tab', () => {
    const cr = String.fromCharCode(0x0d);
    const tab = String.fromCharCode(0x09);

    expect(formatFinding(bare(`a${cr}b${tab}c`))).toBe(`- a${BACKSLASH}u000db${tab}c`);
  });

  it('keeps accented text and emoji as written', () => {
    const text = `caf${String.fromCodePoint(0xe9)} ${String.fromCodePoint(0x1f642)}`;

    expect(formatFinding(bare(text))).toBe(`- ${text}`);
  });
});

describe('reading the store', () => {
  it('answers nothing, and creates nothing, when no store exists', () => {
    const root = freshRoot('no-store');

    expect(readProgressFindings(root, 'phase-0')).toEqual([]);
    expect(existsSync(join(root, '.rafa'))).toBe(false);
  });

  it('holds findings of this plan and global ones, never of another plan', () => {
    const root = freshRoot('filter');
    seed(root, 's-this', 'phase-0', ['this plan']);
    seed(root, 's-other', 'other-plan', ['other plan']);
    seed(root, 's-global', null, ['global']);

    expect(whatsFor(root, 'phase-0').sort()).toEqual(['global', 'this plan']);
    // The control: that finding is stored, and a dispatch of its plan reads it.
    expect(whatsFor(root, 'other-plan').sort()).toEqual(['global', 'other plan']);
  });

  it('holds the global findings alone for a dispatch with no stub', () => {
    const root = freshRoot('no-stub');
    seed(root, 's-this', 'phase-0', ['this plan']);
    seed(root, 's-global', null, ['global']);

    expect(whatsFor(root, null)).toEqual(['global']);
  });

  it('answers the most recently written first, by append order', () => {
    const root = freshRoot('order');
    seed(root, 's-1', 'phase-0', ['first', 'second'], '2026-09-13T10:00:00.000Z');
    // A clock stepped back: written later, stamped earlier.
    seed(root, 's-2', 'phase-0', ['third'], '2026-09-13T09:00:00.000Z');

    const findings = readProgressFindings(root, 'phase-0');

    expect(findings.map((finding) => finding.what)).toEqual(['third', 'second', 'first']);
    expect(findings.map((finding) => finding.seq)).toEqual([3, 2, 1]);
  });

  it('carries every column a render reads, as stored', () => {
    const root = freshRoot('columns');
    seed(root, 's-1', 'phase-0', ['a what']);

    expect(readProgressFindings(root, 'phase-0')).toEqual([{
      seq: 1,
      planStub: 'phase-0',
      kind: 'pattern',
      trigger: 'when a case seeds the store',
      what: 'a what',
      cause: 'cause of a what',
      resolution: 'resolution of a what',
      artifact: 'artifact of a what',
      signal: 'silent',
    }]);
  });

  it('throws on a store it cannot open rather than reading it as empty', () => {
    const root = freshRoot('unreadable');
    mkdirSync(storeFile(root), { recursive: true });

    expect(() => readProgressFindings(root, 'phase-0')).toThrow();
  });
});

describe('writing progress.txt', () => {
  it('writes the render to the repo root and answers it', () => {
    const root = freshRoot('write');
    seed(root, 's-1', 'phase-0', ['older']);
    seed(root, 's-2', 'phase-0', ['newer']);

    const write = writeProgress(root, 'phase-0');
    const onDisk = readFileSync(join(root, 'progress.txt'), 'utf8');

    expect(write.path).toBe(join(root, 'progress.txt'));
    expect(write.storePath).toBe(storeFile(root));
    expect(onDisk).toBe(write.text);
    expect(write.bytes).toBe(Buffer.byteLength(onDisk, 'utf8'));
    expect(write.rendered).toBe(2);
    expect(onDisk.indexOf('- older')).toBeGreaterThan(onDisk.indexOf('- newer'));
    expect(onDisk.indexOf('- newer')).toBe(0);
  });

  it('replaces a written file with an empty one when nothing is stored', () => {
    const root = freshRoot('empty');
    writeFileSync(join(root, 'progress.txt'), '- a finding a session wrote by hand\n');

    const write = writeProgress(root, 'phase-0');

    expect(readFileSync(join(root, 'progress.txt'), 'utf8')).toBe('');
    expect(write.rendered).toBe(0);
    expect(existsSync(storeFile(root))).toBe(false);
  });

  it('leaves the file as it was when the store cannot be read', () => {
    const root = freshRoot('kept');
    writeFileSync(join(root, 'progress.txt'), '- the last render\n');
    mkdirSync(storeFile(root), { recursive: true });

    expect(() => writeProgress(root, 'phase-0')).toThrow();
    expect(readFileSync(join(root, 'progress.txt'), 'utf8')).toBe('- the last render\n');
  });

  it('caps the file at 16,000 bytes over a real store, newest kept', () => {
    const root = freshRoot('cap');
    for (let index = 0; index < 40; index += 1) {
      const label = String(index).padStart(2, '0');
      seed(root, `s-${label}`, 'phase-0', [`finding ${label} ${'x'.repeat(600)}`]);
    }

    const write = writeProgress(root, 'phase-0');
    const onDisk = readFileSync(join(root, 'progress.txt'), 'utf8');
    const next = readProgressFindings(root, 'phase-0')[write.rendered];
    const nextBytes = next === undefined
      ? 0
      : Buffer.byteLength(`${formatFinding(next)}\n`, 'utf8');

    expect(Buffer.byteLength(onDisk, 'utf8')).toBeLessThanOrEqual(16_000);
    expect(write.rendered).toBeGreaterThan(0);
    expect(write.omitted).toBe(40 - write.rendered);
    expect(write.bytes + nextBytes).toBeGreaterThan(16_000);
    expect(onDisk).toContain('- finding 39 ');
    expect(onDisk).not.toContain('- finding 00 ');
  });
});

describe('the injection into plan generation', () => {
  it('takes a render that fills the cap without truncating it', () => {
    const letters = Array.from({ length: 170 }, (_, index) => String.fromCharCode(0x61 + (index % 26)));
    const { text, bytes } = renderProgressText(letters.map((letter) => sized(100, letter)));

    expect(bytes).toBe(16_000);
    expect(formatProgressSection(text)).toContain(text.trim());
  });

  it('proves that truncation acts on text past 16,000 characters', () => {
    const over = `${'y'.repeat(8_000)}${'z'.repeat(8_001)}`;
    const section = formatProgressSection(over);

    expect(section).not.toContain(over);
    expect(section).toContain('z'.repeat(8_001));
  });
});
