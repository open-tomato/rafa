/**
 * The Postgres connector's requirements page,
 * `packages/rafa-hub-postgres/docs/requirements.md`, held to the code:
 * every backticked `hub.*`, `dangerous.hub.*` and `recall.*` key it
 * writes is one a config reads, and every paragraph or fenced block that
 * names `pg_search` names AGPL-3.0 too.
 *
 * A key is read when the hub's own reader judges it, or when core's
 * registry holds it as a project setting. The hub's reader is asked by
 * writing a value no key takes at that key: a key it reads is refused by
 * name for its value, and one it does not read never is.
 */
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { HubConfigError, parseHubConfig } from '../../packages/rafa-hub/src/config.js';
import { SETTING_BY_KEY } from '../config-registry.js';

const PAGE_PATH = join(import.meta.dir, '..', '..', 'packages', 'rafa-hub-postgres', 'docs', 'requirements.md');

const CONFIG_PATH = '/probe/rafa-hub.yaml';

/** A value no config key takes. */
const PROBE_VALUE = 0;

/** A fenced block, from its opening fence to the closing one. */
const FENCE = /^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm;

/** An inline code span; it may wrap onto a second line. */
const CODE_SPAN = /`([^`]+)`/g;

/** The key a code span opens with, when it is one of the three families. */
const CONFIG_KEY = /^(?:dangerous\.hub|hub|recall)\.[A-Za-z0-9_.*<>-]*[A-Za-z0-9_*>]/;

type Mapping = Readonly<Record<string, unknown>>;

function isMapping(value: unknown): value is Mapping {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A copy of `target` holding `value` at the dotted path `segments`. */
function withValueAt(target: Mapping, segments: readonly string[], value: unknown): Mapping {
  const [head = '', ...rest] = segments;
  const child = target[head];
  return {
    ...target,
    [head]: rest.length === 0
      ? value
      : withValueAt(isMapping(child)
        ? child
        : {}, rest, value),
  };
}

/** Whether the hub's reader reads `key`. */
function hubReads(key: string): boolean {
  // `postgres` is the engine under which every `hub.store` key is read.
  const base = { hub: { repository: 'open-tomato/rafa', store: { engine: 'postgres' } } };
  const text = JSON.stringify(withValueAt(base, key.split('.'), PROBE_VALUE));
  try {
    parseHubConfig(text, CONFIG_PATH);
    return false;
  } catch (error) {
    if (!(error instanceof HubConfigError)) throw error;
    return error.problems.some((problem) => problem.startsWith(`${CONFIG_PATH}: ${key} is `)
      && !problem.startsWith(`${CONFIG_PATH}: ${key} is not a key`));
  }
}

function configReads(key: string): boolean {
  return SETTING_BY_KEY.has(key) || hubReads(key);
}

/** The config keys the inline code spans of `markdown` open with, each once. */
function backtickedKeys(markdown: string): readonly string[] {
  const spans = [...markdown.replace(FENCE, '').matchAll(CODE_SPAN)];
  const keys = spans.flatMap((span) => CONFIG_KEY.exec(span[1] ?? '')?.[0] ?? []);
  return [...new Set(keys)].sort();
}

/** The paragraphs and fenced blocks of `markdown`, a fenced block kept whole. */
function blocksOf(markdown: string): readonly string[] {
  const fences = markdown.match(FENCE) ?? [];
  const paragraphs = markdown.replace(FENCE, '\n').split(/\n[ \t]*\n/);
  return [...paragraphs, ...fences].filter((block) => block.trim() !== '');
}

/** The blocks of `markdown` naming `pg_search` without its licence. */
function unlicensedBlocks(markdown: string): readonly string[] {
  return blocksOf(markdown).filter((block) => block.includes('pg_search') && !block.includes('AGPL-3.0'));
}

const page = await Bun.file(PAGE_PATH).text();

describe('the connector\'s requirements page: config keys', () => {
  it('writes the connector\'s five keys in backticks', () => {
    expect(backtickedKeys(page)).toEqual(expect.arrayContaining([
      'dangerous.hub.maxPayloadRows',
      'hub.index.embedding.model',
      'hub.index.embedding.precision',
      'hub.store.engine',
      'hub.store.postgres.urlVariable',
    ]));
  });

  it('backticks no hub, dangerous.hub or recall key that no config reads', () => {
    expect(backtickedKeys(page).filter((key) => !configReads(key))).toEqual([]);
  });

  it('finds a key of each family, wrapped or followed by a value, outside fences only', () => {
    const sample = [
      'Set `hub.store.engine: postgres` and `recall.limit`, then',
      '`dangerous.hub.maxPayloadRows',
      '= 1`. Not `shared_buffers` or `rafa-hub.sqlite`.',
      '```yaml',
      '# `hub.fenced`',
      '```',
    ].join('\n');

    expect(backtickedKeys(sample)).toEqual(['dangerous.hub.maxPayloadRows', 'hub.store.engine', 'recall.limit']);
  });

  it.each([
    'hub.store.postgres.url',
    'hub.index.embedding.dimension',
    'hub.nothing.here',
    'hub.*',
    'dangerous.hub.index.keepBuilds',
    'recall.nothing',
  ])('reads no %s, so the page could not name it', (key) => {
    expect(configReads(key)).toBe(false);
  });

  it('reads a client key core holds as well as the hub\'s own', () => {
    expect([configReads('hub.url'), configReads('hub.port')]).toEqual([true, true]);
  });
});

describe('the connector\'s requirements page: the pg_search licence', () => {
  it('names pg_search', () => {
    expect(page).toContain('pg_search');
  });

  it('names AGPL-3.0 in every paragraph and fenced block that names pg_search', () => {
    expect(unlicensedBlocks(page)).toEqual([]);
  });

  it('reports a paragraph or a fence whose licence sits only in another block', () => {
    const fence = '```shell\napt-get install pg_search\n```';
    const sample = `\`pg_search\` (AGPL-3.0).\n\nInstall \`pg_search\`.\n\n${fence}\n`;

    expect(unlicensedBlocks(sample)).toEqual(['Install `pg_search`.', fence]);
  });
});
