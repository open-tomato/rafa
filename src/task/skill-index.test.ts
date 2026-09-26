/**
 * Unit tests for `renderSkillIndex`: the line format, the `prevents` and
 * description fallback, the per-line and whole-index cuts with their
 * order and tail, and what is left out.
 */
import type { TierPin } from '../config-sections.js';
import type { InventoryKind, InventoryState } from '../inventory/record.js';
import type { SkillTier } from '../schema/tiers.js';
import type { Resolution, TierSettings } from '../tiers/resolve.js';

import { describe, expect, it } from 'bun:test';

import { resolveTiers } from '../tiers/resolve.js';

import { INDEX_LIMIT, LINE_LIMIT, moreLine, renderSkillIndex } from './skill-index.js';

interface Row {
  readonly kind: InventoryKind;
  readonly name: string;
  readonly source: SkillTier;
  readonly path: string;
  readonly tags: readonly string[];
  readonly prevents: string | null;
  readonly summary: string;
  readonly state?: InventoryState;
}

const SETTINGS: TierSettings = {
  settingSources: ['user', 'project', 'local'],
  tiersRafa: 'on',
  tiersSkills: new Map(),
  tiersAgents: new Map(),
};

function row(name: string, fields: Partial<Row> = {}): Row {
  const source = fields.source ?? 'project';
  const kind = fields.kind ?? 'skill';
  return {
    kind,
    name,
    source,
    path: `/${source}/${kind}/${name}/SKILL.md`,
    tags: [],
    prevents: null,
    summary: '',
    ...fields,
  };
}

/** Each path its own bytes, so two holders of one name always differ. */
function resolve(rows: readonly Row[], skills: ReadonlyMap<string, TierPin> = new Map()): Resolution {
  return resolveTiers(rows, { ...SETTINGS, tiersSkills: skills }, (path) => new TextEncoder().encode(path));
}

describe('renderSkillIndex line format', () => {
  it('writes name, tags and prevents, joined by an em dash', () => {
    const index = renderSkillIndex(resolve([
      row('git-workflow', { tags: ['git', 'pr'], prevents: 'a push to main', summary: 'Use when pushing' }),
    ]));

    expect(index).toBe('git-workflow — git, pr — a push to main');
  });

  it('falls back to the description when there is no prevents', () => {
    const index = renderSkillIndex(resolve([row('docs', { tags: ['doc'], summary: 'Use when writing docs' })]));

    expect(index).toBe('docs — doc — Use when writing docs');
  });

  it('drops an empty part with its separator', () => {
    const index = renderSkillIndex(resolve([
      row('a', { prevents: 'drift' }),
      row('b', { tags: ['x'] }),
      row('c'),
    ]));

    expect(index.split('\n')).toEqual(['a — drift', 'b — x', 'c']);
  });

  it('collapses whitespace runs in a folded prevents', () => {
    const index = renderSkillIndex(resolve([row('a', { prevents: 'one\n  two\tthree ' })]));

    expect(index).toBe('a — one two three');
  });

  it('cuts a line at 160 characters, counting codepoints', () => {
    const long = row('a', { prevents: '😀'.repeat(300) });
    const [line = ''] = renderSkillIndex(resolve([long])).split('\n');

    expect(Array.from(line)).toHaveLength(LINE_LIMIT);
    expect(line.startsWith('a — 😀')).toBe(true);
    expect(line.endsWith('😀')).toBe(true);
  });

  it('leaves a line of exactly 160 characters whole', () => {
    const exact = 'x'.repeat(LINE_LIMIT - 'a — '.length);

    expect(renderSkillIndex(resolve([row('a', { prevents: exact })]))).toBe(`a — ${exact}`);
  });
});

describe('renderSkillIndex leaves out', () => {
  it('a skill switched off in tiers.skills, as a control lists it when on', () => {
    const rows = [row('kept'), row('gone')];

    expect(renderSkillIndex(resolve(rows))).toBe('gone\nkept');
    expect(renderSkillIndex(resolve(rows, new Map([['gone', false]])))).toBe('kept');
  });

  it('a winner whose own state reads disabled', () => {
    const index = renderSkillIndex(resolve([
      row('kept', { state: 'enabled' }),
      row('gone', { state: 'disabled:disable-model-invocation' }),
    ]));

    expect(index).toBe('kept');
  });

  it('agents, which the routing section covers', () => {
    const index = renderSkillIndex(resolve([row('reviewer', { kind: 'agent', prevents: 'x' }), row('skill')]));

    expect(index).toBe('skill');
  });

  it('collisions and names no loaded tier holds', () => {
    const index = renderSkillIndex(resolveTiers(
      [row('clash'), row('clash', { source: 'rafa' }), row('home', { source: 'user' }), row('ok')],
      { ...SETTINGS, settingSources: ['project', 'local'] },
      (path) => new TextEncoder().encode(path),
    ));

    expect(index).toBe('ok');
  });

  it('nothing served renders as the empty string', () => {
    expect(renderSkillIndex(resolve([]))).toBe('');
  });
});

describe('renderSkillIndex order and cap', () => {
  it('writes project, then rafa, then user, each by name', () => {
    const index = renderSkillIndex(resolve([
      row('a', { source: 'user' }),
      row('b', { source: 'rafa' }),
      row('z'),
      row('c', { source: 'rafa' }),
      row('m'),
    ]));

    expect(index.split('\n')).toEqual(['m', 'z', 'b', 'c', 'a']);
  });

  it('keeps every line with no tail when the index fits', () => {
    const rows = Array.from({ length: 40 }, (_, at) => row(`s${String(at).padStart(2, '0')}`, {
      prevents: 'p'.repeat(150),
    }));
    const index = renderSkillIndex(resolve(rows));

    expect(Array.from(index).length).toBeLessThanOrEqual(INDEX_LIMIT);
    expect(index.split('\n')).toHaveLength(40);
    expect(index).not.toContain('rafa skill list');
  });

  it('cuts past 8,000 characters, keeping tier then name order, and ends with the tail', () => {
    const tiers: readonly SkillTier[] = ['user', 'rafa', 'project'];
    const rows = Array.from({ length: 90 }, (_, at) => row(`s${String(at).padStart(2, '0')}`, {
      source: tiers[at % 3],
      prevents: 'p'.repeat(200),
    }));
    const index = renderSkillIndex(resolve(rows));
    const lines = index.split('\n');
    const kept = lines.slice(0, -1);

    expect(Array.from(index).length).toBeLessThanOrEqual(INDEX_LIMIT);
    expect(kept.every((line) => line.length === LINE_LIMIT)).toBe(true);
    // 49 lines of 160 and their newlines fill 7,888; a 50th would pass 8,000.
    expect(kept).toHaveLength(49);
    expect(lines.at(-1)).toBe(moreLine(41));
    expect(lines.at(-1)).toBe('41 more: rafa skill list');
    const names = kept.map((line) => line.split(' — ')[0]);
    const project = rows.filter((one) => one.source === 'project').map((one) => one.name)
      .sort();
    const rafa = rows.filter((one) => one.source === 'rafa').map((one) => one.name)
      .sort();
    expect(names).toEqual([...project, ...rafa].slice(0, 49));
  });

  it('gives up a line to make room for the tail', () => {
    // 63 lines of 126 and 62 newlines are exactly 8,000: all fit with no tail.
    const fits = Array.from({ length: 63 }, (_, at) => row(`s${String(at).padStart(2, '0')}`, {
      prevents: 'p'.repeat(126 - 'sNN — '.length),
    }));
    const whole = renderSkillIndex(resolve(fits));
    expect(Array.from(whole).length).toBe(INDEX_LIMIT);
    expect(whole.split('\n')).toHaveLength(63);

    // One more line forces the tail, which 63 lines leave no room for.
    const over = renderSkillIndex(resolve([...fits, row('zz')]));
    const lines = over.split('\n');
    expect(Array.from(over).length).toBeLessThanOrEqual(INDEX_LIMIT);
    expect(lines).toHaveLength(63);
    expect(lines.at(-1)).toBe('2 more: rafa skill list');
  });
});
