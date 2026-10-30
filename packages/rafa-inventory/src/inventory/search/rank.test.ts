/**
 * Tests for the search ranker.
 *
 * The fixture corpus under `testdata/corpus/` is six skill files read
 * from disk through {@link readRankCandidate}'s default reader, so the
 * frontmatter and body reading is measured against real files; the
 * records are built from each file's own frontmatter the way the tree
 * readers build them. Weight, tie and limit cases use in-memory
 * candidates, where one field at a time can be set.
 *
 * Every "is not ranked" reading is paired with a control question that
 * does rank the same file, so an absence cannot pass because the file
 * failed to load.
 */
import type { InventoryRecord } from '../record.js';
import type { RankCandidate } from './rank.js';

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { readInventoryText, summarize } from '../record.js';

import {
  FIELD_WEIGHTS,
  questionWords,
  rankCandidates,
  readRankCandidate,
  scoreCandidate,
  SEARCH_LIMIT,
  wordsMatch,
} from './rank.js';

const CORPUS = join(import.meta.dir, 'testdata', 'corpus');

/** A record with filler fields, `overrides` applied. */
function record(overrides: Partial<InventoryRecord>): InventoryRecord {
  return {
    kind: 'skill',
    name: 'filler',
    source: 'project',
    path: '/project/.claude/skills/filler/SKILL.md',
    summary: '',
    whenToUse: null,
    prevents: null,
    stack: [],
    tags: [],
    check: 'pass',
    state: 'enabled',
    visibleToLoop: true,
    ...overrides,
  };
}

/** An in-memory candidate with no text but `overrides`. */
function candidate(
  overrides: Partial<InventoryRecord>,
  description: string | null = null,
  body = '',
): RankCandidate {
  return { record: record(overrides), description, body };
}

/** The fixture corpus as records, in directory-name order. */
function corpusRecords(): readonly InventoryRecord[] {
  return [...readdirSync(CORPUS)].sort((a, b) => a.localeCompare(b)).map((name) => {
    const path = join(CORPUS, name, 'SKILL.md');
    const front = readInventoryText(readFileSync(path, 'utf8'));
    return record({
      name,
      path,
      summary: summarize(front.description),
      whenToUse: front.whenToUse,
      prevents: front.prevents,
      tags: front.tags,
      stack: front.stack,
    });
  });
}

/** The corpus ranked by `question`, as names. */
function rankCorpus(question: string): readonly string[] {
  const candidates = corpusRecords().map((item) => readRankCandidate(item));
  return rankCandidates(question, candidates).map((ranked) => ranked.record.name);
}

describe('questionWords', () => {
  test('lowercases, drops stop words and short words, and keeps the first of a repeat', () => {
    expect(questionWords('Which skill writes the Changelog, a changelog NOTE?'))
      .toEqual(['writes', 'changelog', 'note']);
  });

  test('keeps letters outside ASCII inside one word', () => {
    expect(questionWords('résumé formatting')).toEqual(['résumé', 'formatting']);
  });

  test('answers no word for a question of stop words only', () => {
    expect(questionWords('what is the agent for?')).toEqual([]);
  });
});

describe('wordsMatch', () => {
  test('matches equal words and a prefix of four letters or more', () => {
    expect(wordsMatch('test', 'test')).toBe(true);
    expect(wordsMatch('test', 'testing')).toBe(true);
    expect(wordsMatch('documentation', 'document')).toBe(true);
  });

  test('does not match a prefix shorter than four letters', () => {
    expect(wordsMatch('doc', 'docker')).toBe(false);
    expect(wordsMatch('ci', 'cider')).toBe(false);
  });
});

describe('scoreCandidate', () => {
  test('scores each field its own weight', () => {
    const words = ['gates'];
    expect(scoreCandidate(candidate({ tags: ['gates'] }), words).score).toBe(FIELD_WEIGHTS.tags);
    expect(scoreCandidate(candidate({ prevents: 'skipped gates' }), words).score)
      .toBe(FIELD_WEIGHTS.prevents);
    expect(scoreCandidate(candidate({ whenToUse: 'before the gates' }), words).score)
      .toBe(FIELD_WEIGHTS.whenToUse);
    expect(scoreCandidate(candidate({}, 'Runs the gates'), words).score)
      .toBe(FIELD_WEIGHTS.description);
    expect(scoreCandidate(candidate({}, null, 'the gates run'), words).score)
      .toBe(FIELD_WEIGHTS.body);
  });

  test('weights a tag above prevents and when_to_use, those above description, and that above the body', () => {
    expect(FIELD_WEIGHTS.tags).toBeGreaterThan(FIELD_WEIGHTS.prevents);
    expect(FIELD_WEIGHTS.prevents).toBe(FIELD_WEIGHTS.whenToUse);
    expect(FIELD_WEIGHTS.whenToUse).toBeGreaterThan(FIELD_WEIGHTS.description);
    expect(FIELD_WEIGHTS.description).toBeGreaterThan(FIELD_WEIGHTS.body);
  });

  test('scores a word once per field however often the field repeats it', () => {
    const once = scoreCandidate(candidate({}, null, 'gates'), ['gates']);
    const often = scoreCandidate(candidate({}, null, 'gates gates gates gates'), ['gates']);
    expect(often.score).toBe(once.score);
  });

  test('reports the matched words in question order and the fields in weight order', () => {
    const ranked = scoreCandidate(
      candidate({ tags: ['lint'] }, null, 'run lint, then tests'),
      ['tests', 'lint', 'docker'],
    );
    expect(ranked.words).toEqual(['tests', 'lint']);
    expect(ranked.fields).toEqual(['tags', 'body']);
    expect(ranked.score).toBe(FIELD_WEIGHTS.tags + 2 * FIELD_WEIGHTS.body);
  });

  test('does not score the item\'s name', () => {
    expect(scoreCandidate(candidate({ name: 'gates' }), ['gates']).score).toBe(0);
  });
});

describe('rankCandidates over the fixture corpus', () => {
  test('ranks the tagged changelog skill above a body that mentions the word in passing', () => {
    expect(rankCorpus('how do I write a changelog note')).toEqual(['changelog-notes', 'bare-notes']);
  });

  test('ranks the skill whose prevents names the failure above one whose body mentions the suite', () => {
    expect(rankCorpus('tests fail in the full suite')).toEqual(['test-isolation', 'gate-order']);
  });

  test('over-matches a prefix word: under ranks a body saying understand', () => {
    expect(rankCorpus('under')).toEqual(['test-isolation', 'changelog-notes']);
  });

  test('ranks on when_to_use and tags, and leaves out docker for doc', () => {
    expect(rankCorpus('comment on an exported symbol, doc')).toEqual(['documentation']);
  });

  test('control: a question naming docker does rank the docker file', () => {
    expect(rankCorpus('docker')).toEqual(['docker-images']);
  });

  test('ranks nothing for a question no file answers', () => {
    expect(rankCorpus('kubernetes helm charts')).toEqual([]);
  });

  test('ranks nothing for a question of stop words only', () => {
    expect(rankCorpus('what should I use?')).toEqual([]);
  });
});

describe('rankCandidates order and limit', () => {
  test('keeps the top twelve of more matching candidates', () => {
    const many = Array.from(
      { length: SEARCH_LIMIT + 3 },
      (_, index) => candidate({ name: `item-${index}` }, null, 'gates'),
    );
    expect(SEARCH_LIMIT).toBe(12);
    expect(rankCandidates('gates', many)).toHaveLength(12);
  });

  test('keeps a tie in the order the candidates were given', () => {
    const tied = ['zeta', 'alpha', 'mid'].map((name) => candidate({ name }, null, 'gates'));
    expect(rankCandidates('gates', tied).map((ranked) => ranked.record.name))
      .toEqual(['zeta', 'alpha', 'mid']);
  });

  test('puts a higher score ahead of input order, and drops a zero score', () => {
    const given = [
      candidate({ name: 'body-only' }, null, 'gates'),
      candidate({ name: 'unrelated' }, 'Builds images'),
      candidate({ name: 'tagged', tags: ['gates'] }),
    ];
    expect(rankCandidates('gates', given).map((ranked) => ranked.record.name))
      .toEqual(['tagged', 'body-only']);
  });

  test('honours a smaller limit', () => {
    const many = ['a1', 'b2', 'c3'].map((name) => candidate({ name }, null, 'gates'));
    expect(rankCandidates('gates', many, 2)).toHaveLength(2);
  });
});

describe('readRankCandidate', () => {
  test('reads the whole description, not the cut summary', () => {
    const long = `${'Keeps a very long description going '.repeat(4)}until the word telemetry`;
    const text = `---\ndescription: ${long}\n---\nbody\n`;
    const item = record({ summary: summarize(long) });
    expect(item.summary).not.toContain('telemetry');

    const read = readRankCandidate(item, () => text);
    expect(read.description).toBe(long);
    expect(rankCandidates('telemetry', [read])).toHaveLength(1);
  });

  test('reads a file with no frontmatter as no description and its whole text as the body', () => {
    const path = join(CORPUS, 'bare-notes', 'SKILL.md');
    const read = readRankCandidate(record({ path }));
    expect(read.description).toBeNull();
    expect(read.body).toBe(readFileSync(path, 'utf8'));
  });

  test('ranks a file that does not read on its record and summary, with an empty body', () => {
    const item = record({ path: join(CORPUS, 'absent', 'SKILL.md'), summary: 'Guards the gates' });
    const read = readRankCandidate(item);
    expect(read).toEqual({ record: item, description: 'Guards the gates', body: '' });
    expect(rankCandidates('gates', [read])).toHaveLength(1);
  });

  test('reads an empty summary on a failed read as no description', () => {
    const read = readRankCandidate(record({}), () => {
      throw new Error('EACCES');
    });
    expect(read.description).toBeNull();
  });
});
