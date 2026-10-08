/**
 * Unit tests for the decision sources: the Rejected line shapes, the two
 * tenet shapes, the context rules, the merge of one line read in two
 * places, and a run over a scratch repository with and without
 * `.rafa/specs/`.
 */

import type { IssueBody } from './decision-sources';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import {
  afterRejectedLabel,
  boldLead,
  collectDecisions,
  decisionKey,
  main,
  parseIssues,
  readRejected,
  readRules,
  readTenets,
  splitSentences,
} from './decision-sources';

const JSON_PATH = 'docs/survey/decision-sources.json';
const MARKDOWN_PATH = 'docs/survey/decision-sources.md';
const LOCK_LINE = 'a lock file. A lock is gone when the process exits.';

const SPEC_BODY = [
  '## Design',
  '',
  `**Rejected:** ${LOCK_LINE}`,
  '',
  '- **Rejected:** a second clone per loop. Two stores diverge.',
  '',
  'The rejected path was measured first.',
  '',
  '```',
  '**Rejected:** inside a fence, never read.',
  '```',
  '',
  '| Rejected: | in a table |',
].join('\n');

describe('readRejected', () => {
  it('reads a bold **Rejected:** line and a - **Rejected:** bullet', () => {
    const texts = readRejected(SPEC_BODY).map((reading) => reading.text);
    expect(texts).toEqual([LOCK_LINE, 'a second clone per loop. Two stores diverge.']);
  });

  it('names the line and the section of each reading', () => {
    const placed = readRejected(SPEC_BODY).map((reading) => [reading.line, reading.section]);
    expect(placed).toEqual([[3, 'Design'], [5, 'Design']]);
  });

  it('reads nothing from prose, a fence or a table that only uses the word', () => {
    const control = readRejected('The rejected path was measured.\n\n```\n**Rejected:** x\n```\n| Rejected: | y |');
    expect(control).toEqual([]);
  });

  it('joins a wrapped continuation into one line', () => {
    const texts = readRejected('**Rejected:** a lock file. A lock\nis gone when the process exits.\n\nNext.').map((r) => r.text);
    expect(texts).toEqual(['a lock file. A lock is gone when the process exits.']);
  });

  it('reads the items below a bold label standing alone, up to the next bold heading', () => {
    const body = [
      '**Rejected alternatives**',
      '',
      '- *One agent file:* nothing reusable.',
      '- *A watchtower that restarts:* two writers.',
      '',
      '**Analogies used**',
      '',
      '- A pit stop.',
    ].join('\n');
    const texts = readRejected(body).map((reading) => reading.text);
    expect(texts).toEqual(['*One agent file:* nothing reusable.', '*A watchtower that restarts:* two writers.']);
  });

  it('reads the sub-bullets of a - **Rejected:** bullet standing alone', () => {
    const body = ['- **Rejected:**', '  - *History alone.* A new file has none.', '  - *By hand.* It misses imports.', '- Next item.'].join('\n');
    const texts = readRejected(body).map((reading) => reading.text);
    expect(texts).toEqual(['*History alone.* A new file has none.', '*By hand.* It misses imports.']);
  });

  it('reads the paragraph under a ### Rejected heading', () => {
    const body = ['### Rejected', '', 'One agent file: nothing reusable.', '', '## What can go wrong', '', 'Plenty.'].join('\n');
    expect(readRejected(body).map((reading) => reading.text)).toEqual(['One agent file: nothing reusable.']);
  });

  it('reads a bold lead holding the rejected item, a code span with ** inside it', () => {
    const body = '- **Rejected: running `verify` into `stretch/**`.** It would refuse.';
    expect(readRejected(body).map((reading) => reading.text)).toEqual(['running `verify` into `stretch/**`. It would refuse.']);
  });
});

describe('afterRejectedLabel', () => {
  it('tells a label standing alone, a label holding text and no label apart', () => {
    expect(afterRejectedLabel('**Rejected:**')).toBe('');
    expect(afterRejectedLabel('**Rejected alternatives**: the list above.')).toBe('the list above.');
    expect(afterRejectedLabel('Rejected: a plain one.')).toBe('a plain one.');
    expect(afterRejectedLabel('Rejected by the reviewer.')).toBeUndefined();
    expect(afterRejectedLabel('**Never block.** Text.')).toBeUndefined();
  });
});

describe('boldLead', () => {
  it('closes after a code span, not inside it', () => {
    expect(boldLead('**a `b/**` c.** rest')).toEqual({ after: ' rest', inner: 'a `b/**` c.' });
    expect(boldLead('plain')).toBeNull();
  });
});

describe('readTenets', () => {
  it('splits the list after a tenets line\'s colon, #598\'s shape', () => {
    const body = '- The rafa tenets the agent checks itself against: a shortener of commands, a reminder of steps, a helper and not a hinderer.';
    const titles = readTenets(body).map((reading) => reading.title);
    expect(titles).toEqual(['a shortener of commands', 'a reminder of steps', 'a helper and not a hinderer']);
  });

  it('reads the list below a tenets line ending in its colon, #754\'s shape', () => {
    const body = [
      'These are the project\'s tenets as they apply here:',
      '',
      '1. **Never block.** A suspected copy never refuses a command.',
      '2. **Always tell.** The person sees one warning line.',
      '',
      '## Design',
    ].join('\n');
    const tenets = readTenets(body).map((reading) => [reading.title, reading.text]);
    expect(tenets).toEqual([
      ['Never block', 'A suspected copy never refuses a command.'],
      ['Always tell', 'The person sees one warning line.'],
    ]);
  });
});

describe('readRules', () => {
  it('reads sentences saying never, always or must, and long bold leads', () => {
    const page = [
      '**Every writer of a merged table must be checked.** The sweep reads them.',
      'A read open never writes the row. It is cheap.',
      '',
      '**Exit codes:** two of them.',
      '',
      '- `always`: a mode name in code, not a rule.',
    ].join('\n');
    const texts = readRules(page).map((reading) => reading.text);
    expect(texts).toEqual(['**Every writer of a merged table must be checked.**', 'A read open never writes the row.']);
  });

  it('keeps a bold lead of six words with no rule word as a rule', () => {
    const texts = readRules('**A task session runs a targeted subset.** More.').map((reading) => reading.text);
    expect(texts).toEqual(['**A task session runs a targeted subset.**']);
  });
});

describe('splitSentences', () => {
  it('never splits inside a code span', () => {
    expect(splitSentences('Run `a. B` first. Then stop.')).toEqual(['Run `a. B` first.', 'Then stop.']);
  });
});

describe('collectDecisions', () => {
  const issue: IssueBody = { body: SPEC_BODY, number: 754, title: 'Spec: witness' };

  it('keeps the same Rejected line in an issue and a local spec once, with both sources', () => {
    const sources = collectDecisions({
      contextPages: [],
      issues: [issue],
      localSpecs: [{ path: '.rafa/specs/witness.md', text: `# Witness\n\n- **Rejected:** ${LOCK_LINE.toUpperCase()}` }],
    });
    const lock = sources.decisions.filter((decision) => decisionKey(decision.text) === decisionKey(LOCK_LINE));
    expect(lock).toHaveLength(1);
    expect(lock[0]?.sources.map((source) => [source.kind, source.ref])).toEqual([
      ['issue', '#754'],
      ['local-spec', '.rafa/specs/witness.md'],
    ]);
  });

  it('keeps two different lines apart, the control for the merge', () => {
    const sources = collectDecisions({ contextPages: [], issues: [issue], localSpecs: [] });
    expect(sources.decisions.filter((decision) => decision.kind === 'rejected')).toHaveLength(2);
  });

  it('reads tenets from the tenet issues only', () => {
    const tenetLine = 'The tenets: a shortener of commands.';
    const sources = collectDecisions({
      contextPages: [],
      issues: [{ body: tenetLine, number: 598, title: 'a' }, { body: tenetLine, number: 10, title: 'b' }],
      localSpecs: undefined,
    });
    const tenets = sources.decisions.filter((decision) => decision.kind === 'tenet');
    expect(tenets.map((tenet) => tenet.sources.map((source) => source.ref))).toEqual([['#598']]);
    expect(sources.tenetIssues).toEqual([{ number: 598, read: true }, { number: 754, read: false }]);
    expect(sources.localSpecs).toBeNull();
  });
});

describe('parseIssues', () => {
  it('refuses an entry with no body', () => {
    expect(() => parseIssues([{ number: 1, title: 't' }], 'fixture')).toThrow('entry 0');
    expect(() => parseIssues({}, 'fixture')).toThrow('JSON array');
  });
});

describe('main over a scratch repository', () => {
  let root = '';
  const git = (...args: string[]): void => {
    const result = Bun.spawnSync(['git', ...args], { cwd: root, stderr: 'pipe', stdout: 'pipe' });
    if (result.exitCode !== 0) {
      throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`);
    }
  };
  const issues: IssueBody[] = [{ body: SPEC_BODY, number: 754, title: 'Spec: witness' }];

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'decision-sources-'));
    mkdirSync(join(root, 'context'));
    writeFileSync(join(root, 'context', 'a.md'), '## A\n\nA page never moves.\n');
    writeFileSync(join(root, 'context', 'b.md'), '## B\n\nNothing here.\n');
    git('init', '-q');
    git('add', 'context');
  });

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('reads a missing .rafa/specs/ as no local specs', async () => {
    const written = await main(root, issues);
    expect(written).toEqual([JSON_PATH, MARKDOWN_PATH]);
    const json = JSON.parse(readFileSync(join(root, JSON_PATH), 'utf8')) as { localSpecs: unknown };
    expect(json.localSpecs).toBeNull();
    const markdown = readFileSync(join(root, MARKDOWN_PATH), 'utf8');
    expect(markdown).toContain('Local specs: none, `.rafa/specs/` is absent.');
    expect(markdown).toContain('Coverage: 2 of 2 tracked files read (context/).');
    expect(markdown).toContain('A page never moves. (`context/a.md:3`)');
  });

  it('reads .rafa/specs/ once it is there, the control for the missing case', async () => {
    mkdirSync(join(root, '.rafa', 'specs', 'nested'), { recursive: true });
    writeFileSync(join(root, '.rafa', 'specs', 'nested', 'witness.md'), `**Rejected:** ${LOCK_LINE}\n`);
    await main(root, issues);
    const json = JSON.parse(readFileSync(join(root, JSON_PATH), 'utf8')) as {
      localSpecs: string[];
      decisions: { text: string; sources: { ref: string }[] }[];
    };
    expect(json.localSpecs).toEqual(['.rafa/specs/nested/witness.md']);
    const lock = json.decisions.find((decision) => decision.text === LOCK_LINE);
    expect(lock?.sources.map((source) => source.ref)).toEqual(['#754', '.rafa/specs/nested/witness.md']);
  });

  it('writes the same bytes on a second run', async () => {
    const read = (): string[] => [JSON_PATH, MARKDOWN_PATH].map((path) => readFileSync(join(root, path), 'utf8'));
    await main(root, issues);
    const first = read();
    await main(root, [...issues, { body: '', number: 1, title: 'Spec: empty' }].reverse());
    const second = read();
    expect(second[0]).not.toBe(first[0]);
    await main(root, [...issues].reverse());
    expect(read()).toEqual(first);
  });
});
