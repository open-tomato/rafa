/**
 * Tests for the change fragment format (`src/release/fragment.ts`):
 * the parser and its four refusals, the optional `package` key, the
 * serialiser, and the name allocation. Everything is driven from string literals; the module
 * opens no file.
 *
 * Things here that would pass while wrong:
 *
 *  - A parser that refused everything satisfies every refusal case, so
 *    each refusal is paired with the same text made valid by the one
 *    change the refusal is about, and that control has to parse.
 *  - A serialiser that wrote whatever the parser happened to accept
 *    could still drop a note or reorder fields, so its output is read
 *    back and compared to the input whole, and one case pins the exact
 *    bytes.
 *  - An allocation that counted the names up from `-2` without looking
 *    would pass a set holding `-2` only, so one case leaves a gap
 *    (`.md` and `-3` taken, `-2` free) and asserts the gap is used.
 *  - A serialiser that wrote `package: null` for a root fragment would
 *    still read back equal if the parser read the word as null, so the
 *    three-field round trip compares the written bytes to the original
 *    text, not only the parsed fragment.
 */
import type { Fragment } from './fragment.js';

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { allocateFragmentName, parseFragment, serializeFragment } from './fragment.js';

const VALID = [
  '---',
  'plan: rafa-247',
  'title: rafa next --roadmap',
  'level: minor',
  '---',
  '',
  '- next: one hop to a blocker\'s epic',
  '- board: the roadmap shows blockers',
  '',
].join('\n');

const VALID_FRAGMENT: Fragment = {
  plan: 'rafa-247',
  title: 'rafa next --roadmap',
  level: 'minor',
  package: null,
  notes: ['- next: one hop to a blocker\'s epic', '- board: the roadmap shows blockers'],
};

/** VALID with its `level:` line replaced by `line`, or dropped for null. */
function withLevelLine(line: string | null): string {
  return VALID.split('\n')
    .flatMap((each) => (
      each.startsWith('level:')
        ? (line === null
          ? []
          : [line])
        : [each]
    ))
    .join('\n');
}

function reasonOf(text: string): string {
  const reading = parseFragment(text);
  return reading.ok
    ? 'ok'
    : reading.reason;
}

describe('parseFragment', () => {
  test('reads the three fields and the notes of a valid fragment', () => {
    expect(parseFragment(VALID)).toEqual({ ok: true, fragment: VALID_FRAGMENT });
  });

  test('reads the fields in any order and keeps colons inside the title', () => {
    const text = '---\nlevel: patch\ntitle: fix: a title: with colons\nplan: rafa-9\n---\n- loop: x\n';
    const reading = parseFragment(text);
    expect(reading).toEqual({
      ok: true,
      fragment: { plan: 'rafa-9', title: 'fix: a title: with colons', level: 'patch', package: null, notes: ['- loop: x'] },
    });
  });

  test('reads Windows line endings as plain ones', () => {
    expect(parseFragment(VALID.replace(/\n/g, '\r\n'))).toEqual({ ok: true, fragment: VALID_FRAGMENT });
  });

  test('refuses a missing level, and an empty one, as missing-level', () => {
    expect(reasonOf(withLevelLine(null))).toBe('missing-level');
    expect(reasonOf(withLevelLine('level:'))).toBe('missing-level');
    expect(reasonOf(withLevelLine('level: major'))).toBe('ok');
  });

  test('refuses an unknown level and names it with the four accepted', () => {
    const reading = parseFragment(withLevelLine('level: huge'));
    expect(reading.ok).toBe(false);
    if (reading.ok) return;
    expect(reading.reason).toBe('unknown-level');
    expect(reading.sentence).toBe('The fragment\'s level is "huge", not one of patch, minor, major, none.');
    expect(reasonOf(withLevelLine('level: Minor'))).toBe('unknown-level');
  });

  test('refuses an empty body under patch, minor and major, and accepts it under none', () => {
    const head = (level: string) => `---\nplan: rafa-1\ntitle: t\nlevel: ${level}\n---\n\n  \n`;
    expect(reasonOf(head('patch'))).toBe('empty-body');
    expect(reasonOf(head('minor'))).toBe('empty-body');
    expect(reasonOf(head('major'))).toBe('empty-body');
    expect(parseFragment(head('none'))).toEqual({
      ok: true,
      fragment: { plan: 'rafa-1', title: 't', level: 'none', package: null, notes: [] },
    });
    expect(reasonOf(`${head('patch')}- loop: x\n`)).toBe('ok');
  });

  test('refuses a text with no opening fence, or no closing one', () => {
    expect(reasonOf(VALID.replace(/^---\n/, ''))).toBe('malformed-front-matter');
    expect(reasonOf(`\n${VALID}`)).toBe('malformed-front-matter');
    expect(reasonOf(VALID.replace('level: minor\n---\n', 'level: minor\n'))).toBe('malformed-front-matter');
    expect(reasonOf('')).toBe('malformed-front-matter');
  });

  test('refuses a line that is not key: value, an unknown key and a repeated key', () => {
    const insert = (line: string) => VALID.replace('level: minor\n', `level: minor\n${line}\n`);
    expect(reasonOf(insert('just words'))).toBe('malformed-front-matter');
    expect(reasonOf(insert(': no key'))).toBe('malformed-front-matter');
    expect(reasonOf(insert('area: loop'))).toBe('malformed-front-matter');
    expect(reasonOf(insert('plan: rafa-248'))).toBe('malformed-front-matter');
    expect(reasonOf(insert(''))).toBe('ok');
  });

  test('refuses a missing or unusable plan and a missing title as malformed', () => {
    expect(reasonOf(VALID.replace('plan: rafa-247\n', ''))).toBe('malformed-front-matter');
    expect(reasonOf(VALID.replace('plan: rafa-247', 'plan: rafa 247'))).toBe('malformed-front-matter');
    expect(reasonOf(VALID.replace('plan: rafa-247', 'plan: ../rafa-247'))).toBe('malformed-front-matter');
    expect(reasonOf(VALID.replace('title: rafa next --roadmap\n', ''))).toBe('malformed-front-matter');
    expect(reasonOf(VALID.replace('title: rafa next --roadmap', 'title:   '))).toBe('malformed-front-matter');
  });

  test('reads a package line as the package, and no line as null', () => {
    const text = VALID.replace('level: minor\n', 'level: minor\npackage: @scope/plugin\n');
    expect(parseFragment(text)).toEqual({ ok: true, fragment: { ...VALID_FRAGMENT, package: '@scope/plugin' } });
    expect(parseFragment(VALID)).toEqual({ ok: true, fragment: VALID_FRAGMENT });
  });

  test('refuses an empty package, and one holding whitespace, naming the key', () => {
    const withPackage = (line: string) => VALID.replace('level: minor\n', `level: minor\n${line}\n`);
    const empty = parseFragment(withPackage('package:   '));
    expect(empty).toEqual({
      ok: false,
      reason: 'malformed-front-matter',
      sentence: 'The fragment\'s front matter is malformed: the package is empty.',
    });
    const spaced = parseFragment(withPackage('package: @scope/ plugin'));
    expect(spaced).toEqual({
      ok: false,
      reason: 'malformed-front-matter',
      sentence: 'The fragment\'s front matter is malformed: the package "@scope/ plugin" holds whitespace.',
    });
    expect(reasonOf(withPackage('package: @scope/plugin'))).toBe('ok');
  });

  test('refuses a package key given twice', () => {
    const twice = VALID.replace('level: minor\n', 'level: minor\npackage: a\npackage: a\n');
    const reading = parseFragment(twice);
    expect(reading.ok).toBe(false);
    if (reading.ok) return;
    expect(reading.reason).toBe('malformed-front-matter');
    expect(reading.sentence).toContain('the key package is given twice');
    expect(reasonOf(VALID.replace('level: minor\n', 'level: minor\npackage: a\n'))).toBe('ok');
  });

  test('checks the front matter before the level, so a malformed block is not read as missing-level', () => {
    expect(reasonOf(withLevelLine(null).replace('plan: rafa-247\n', ''))).toBe('malformed-front-matter');
  });
});

describe('serializeFragment', () => {
  test('writes the exact bytes of the format', () => {
    expect(serializeFragment(VALID_FRAGMENT)).toBe(`${VALID.trimEnd()}\n`);
  });

  test('writes a none fragment with no notes as the front matter alone', () => {
    const text = serializeFragment({ plan: 'rafa-5', title: 'Docs only', level: 'none', package: null, notes: [] });
    expect(text).toBe('---\nplan: rafa-5\ntitle: Docs only\nlevel: none\n---\n');
  });

  test('reads back every level unchanged', () => {
    for (const level of ['patch', 'minor', 'major', 'none'] as const) {
      const fragment: Fragment = { ...VALID_FRAGMENT, level };
      expect(parseFragment(serializeFragment(fragment))).toEqual({ ok: true, fragment });
    }
  });

  test('reads a three-field fragment back to the same bytes, with no package line', () => {
    const reading = parseFragment(VALID);
    if (!reading.ok) throw new Error(reading.sentence);
    expect(reading.fragment.package).toBeNull();
    const written = serializeFragment(reading.fragment);
    expect(written).toBe(VALID);
    expect(written).not.toContain('package');
  });

  test('writes the package line after level, and reads it back', () => {
    const fragment: Fragment = { ...VALID_FRAGMENT, package: '@scope/plugin' };
    const text = serializeFragment(fragment);
    expect(text.split('\n').slice(0, 6)).toEqual([
      '---',
      'plan: rafa-247',
      'title: rafa next --roadmap',
      'level: minor',
      'package: @scope/plugin',
      '---',
    ]);
    expect(parseFragment(text)).toEqual({ ok: true, fragment });
  });

  test('throws on a package that is not one trimmed non-empty word', () => {
    expect(() => serializeFragment({ ...VALID_FRAGMENT, package: '' })).toThrow('the package is empty');
    expect(() => serializeFragment({ ...VALID_FRAGMENT, package: ' padded' })).toThrow('the package " padded"');
    expect(() => serializeFragment({ ...VALID_FRAGMENT, package: 'a b' })).toThrow('the package "a b"');
    expect(() => serializeFragment({ ...VALID_FRAGMENT, package: 'a\nb' })).toThrow('the package "a\\nb"');
    expect(() => serializeFragment({ ...VALID_FRAGMENT, package: 'a' })).not.toThrow();
  });

  test('throws on a fragment the parser would refuse or read back differently', () => {
    expect(() => serializeFragment({ ...VALID_FRAGMENT, notes: [] })).toThrow('level minor carries no notes');
    expect(() => serializeFragment({ ...VALID_FRAGMENT, plan: 'a/b' })).toThrow('the plan id "a/b"');
    expect(() => serializeFragment({ ...VALID_FRAGMENT, title: 'two\nlines' })).toThrow('the title');
    expect(() => serializeFragment({ ...VALID_FRAGMENT, title: ' padded' })).toThrow('the title');
    expect(() => serializeFragment({ ...VALID_FRAGMENT, notes: ['- a', ''] })).toThrow('the note ""');
  });
});

describe('allocateFragmentName', () => {
  test('answers <plan>.md when nothing of the plan waits', () => {
    expect(allocateFragmentName('rafa-247', [])).toBe('rafa-247.md');
    expect(allocateFragmentName('rafa-247', ['rafa-24.md', 'rafa-2470.md'])).toBe('rafa-247.md');
  });

  test('answers -2, then -3, as the earlier names are taken', () => {
    expect(allocateFragmentName('rafa-247', ['rafa-247.md'])).toBe('rafa-247-2.md');
    expect(allocateFragmentName('rafa-247', ['rafa-247.md', 'rafa-247-2.md'])).toBe('rafa-247-3.md');
  });

  test('takes the first free name, a gap included', () => {
    expect(allocateFragmentName('rafa-247', ['rafa-247.md', 'rafa-247-3.md'])).toBe('rafa-247-2.md');
  });

  test('throws on a plan id that cannot name a file or a receipt word', () => {
    expect(() => allocateFragmentName('', [])).toThrow('the plan id is empty');
    expect(() => allocateFragmentName('rafa 1', [])).toThrow('the plan id "rafa 1"');
    expect(() => allocateFragmentName('.hidden', [])).toThrow('the plan id ".hidden"');
  });
});

describe('package key against real and scoped fragments', () => {
  test('every fragment under this repository\'s .changes/ parses with package null', () => {
    const dir = join(import.meta.dir, '..', '..', '.changes');
    const names = readdirSync(dir).filter((name) => name.endsWith('.md'));

    for (const name of names) {
      const reading = parseFragment(readFileSync(join(dir, name), 'utf8'));
      expect(reading.ok).toBe(true);
      if (reading.ok) expect(reading.fragment.package).toBeNull();
    }
  });

  test('a fragment naming @scope/plugin parses to it and serialises with the line after level', () => {
    const text = '---\nplan: p-1\ntitle: T\nlevel: minor\npackage: @scope/plugin\n---\n\n- a note\n';

    const reading = parseFragment(text);

    expect(reading.ok).toBe(true);
    if (!reading.ok) return;
    expect(reading.fragment.package).toBe('@scope/plugin');
    const lines = serializeFragment(reading.fragment).split('\n');
    expect(lines[lines.indexOf('level: minor') + 1]).toBe('package: @scope/plugin');
  });
});
