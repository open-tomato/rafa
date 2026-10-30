/**
 * Tests for the proposal pass's ledger (`./proposal-file.ts`): what a
 * written file says, what survives a round trip through it, and every
 * edit a reviewer can make that the reader has to refuse.
 *
 * Nothing here spawns a session or opens a skill. The round-trip case
 * is the one that matters most: a reviewer edits this file in an
 * editor, and a field that did not survive being written and read back
 * is a correction silently thrown away.
 *
 * ## Every refusal is paired
 *
 * A reader that refused everything would pass every refusal case here,
 * so each one edits ONE value of a file that is asserted to parse
 * clean in the same case, and both readings are made together.
 */
import type { ProposalFile } from './proposal-file.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  DRAFT_FILE,
  filledStringAt,
  isProposalFileName,
  isSkillSignal,
  isYamlMapping,
  parseProposalFile,
  PROPOSAL_FILE_HEADER,
  proposalPath,
  readProposalFiles,
  readYamlMapping,
  renderProposalFile,
  REVIEWED_FILE,
  SHA256_PATTERN,
  stringAt,
} from './proposal-file.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-proposal-file-'));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A sha256-shaped hash, distinct per digit. */
function hash(digit: string): string {
  return digit.repeat(64);
}

/** A file with one answered row and one unanswered one. */
function sampleFile(): ProposalFile {
  return {
    status: DRAFT_FILE,
    batch: 3,
    skills: '/tmp/tier/.claude/skills',
    exitCode: 0,
    rows: [
      {
        path: 'kotlin-testing/SKILL.md',
        name: 'kotlin-testing',
        hash: hash('a'),
        needs: ['prevents', 'trigger'],
        status: 'answered',
        prevents: 'a suite that passes while the code is wrong',
        signal: 'silent',
        trigger: 'Use it when a Kotlin module grows its first test.',
        description: null,
        note: null,
      },
      {
        path: 'verification-loop/SKILL.md',
        name: 'verification-loop',
        hash: hash('b'),
        needs: ['description'],
        status: 'unanswered',
        prevents: null,
        signal: null,
        trigger: null,
        description: null,
        note: 'the session answered nothing about this file',
      },
    ],
  };
}

/** A directory of this case's own. */
function newDir(): string {
  planted += 1;
  const dir = join(tempBase, `backfill-${planted}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** `sampleFile` rendered, with `find` replaced by `replace` once. */
function renderedWith(find: string, replace: string): string {
  const text = renderProposalFile(sampleFile());
  if (!text.includes(find)) throw new Error(`the rendered file holds no ${find}`);
  return text.replace(find, replace);
}

describe('renderProposalFile', () => {
  it('opens with the review instructions and carries every field back through a parse', () => {
    const file = sampleFile();

    const text = renderProposalFile(file);
    const parsed = parseProposalFile(text);

    expect(text.startsWith(PROPOSAL_FILE_HEADER)).toBe(true);
    expect(text).toContain('# Review each row');
    expect(parsed.problem).toBeNull();
    expect(parsed.file).toEqual(file);
  });

  it('writes the status a reviewer edits as the first key of the mapping', () => {
    const text = renderProposalFile(sampleFile());

    expect(text.slice(PROPOSAL_FILE_HEADER.length).startsWith('status: draft\n')).toBe(true);
    expect(parseProposalFile(text.replace('status: draft', 'status: reviewed')).file?.status)
      .toBe(REVIEWED_FILE);
  });

  it('leaves no trailing space on the line above a list', () => {
    const text = renderProposalFile(sampleFile());

    expect(text).toContain('rows:\n');
    expect(text.split('\n').some((line) => /[ \t]$/.test(line))).toBe(false);
  });
});

describe('parseProposalFile', () => {
  it('refuses a status outside the two, and reads the two', () => {
    expect(parseProposalFile(renderedWith('status: draft', 'status: applied')).problem)
      .toContain('is neither draft nor reviewed');
    expect(parseProposalFile(renderedWith('status: draft', 'status: reviewed')).file?.status)
      .toBe(REVIEWED_FILE);
  });

  it('refuses a file naming no skills directory, and reads the one that does', () => {
    const clean = parseProposalFile(renderProposalFile(sampleFile()));

    expect(parseProposalFile(renderedWith('skills: /tmp/tier/.claude/skills', 'skills: null')).problem)
      .toBe('the file names no skills directory');
    expect(clean.file?.skills).toBe('/tmp/tier/.claude/skills');
  });

  it('refuses one bad row and with it the whole file, naming the row', () => {
    const broken = parseProposalFile(renderedWith(`sha256: ${hash('a')}`, 'sha256: nope'));

    expect(broken.file).toBeNull();
    expect(broken.problem).toBe('row 1 carries no sha256');
    expect(parseProposalFile(renderProposalFile(sampleFile())).file?.rows).toHaveLength(2);
  });

  it('refuses a signal outside the two the schema allows', () => {
    expect(parseProposalFile(renderedWith('signal: silent', 'signal: quiet')).problem)
      .toContain('which is neither loud nor silent');
  });

  it('refuses a row status outside the two', () => {
    expect(parseProposalFile(renderedWith('status: answered', 'status: perhaps')).problem)
      .toContain('which is no row status');
  });

  it('refuses a file with no rows list and a text that is no YAML mapping', () => {
    expect(parseProposalFile('status: draft\nskills: /tmp/x\n').problem)
      .toBe('the file carries no rows list');
    expect(parseProposalFile('- one\n- two\n').problem).toBe('the file holds no YAML mapping');
    expect(parseProposalFile('status: draft\n  bad indent: [\n').problem)
      .toBe('the file holds no YAML mapping');
  });

  it('drops a need it does not know and keeps the ones it does', () => {
    const parsed = parseProposalFile(renderedWith('      - prevents\n', '      - prevents\n      - colour\n'));

    expect(parsed.file?.rows[0]?.needs).toEqual(['prevents', 'trigger']);
  });
});

describe('readProposalFiles', () => {
  it('reads every proposal file in name order and passes over anything else', () => {
    const dir = newDir();
    writeFileSync(proposalPath(dir, 2), renderProposalFile({ ...sampleFile(), batch: 2 }), 'utf8');
    writeFileSync(proposalPath(dir, 1), renderProposalFile({ ...sampleFile(), batch: 1 }), 'utf8');
    writeFileSync(join(dir, 'notes.md'), 'not a proposal file\n', 'utf8');

    const read = readProposalFiles(dir);

    expect(read.map((entry) => entry.result.file?.batch)).toEqual([1, 2]);
    expect(read.map((entry) => entry.path)).toEqual([proposalPath(dir, 1), proposalPath(dir, 2)]);
  });

  it('answers a problem for a file it cannot read, beside one it can', () => {
    const dir = newDir();
    writeFileSync(proposalPath(dir, 1), renderProposalFile(sampleFile()), 'utf8');
    writeFileSync(proposalPath(dir, 2), 'status: draft\n', 'utf8');

    const read = readProposalFiles(dir);

    expect(read[0]?.result.problem).toBeNull();
    expect(read[1]?.result.file).toBeNull();
    expect(read[1]?.result.problem).toBe('the file names no skills directory');
  });

  it('answers none for a directory that is not there', () => {
    expect(readProposalFiles(join(tempBase, 'no-such-directory'))).toEqual([]);
  });
});

describe('proposalPath', () => {
  it('pads the batch number to two digits', () => {
    expect(proposalPath('/tmp/b', 1).endsWith('proposals-01.yaml')).toBe(true);
    expect(proposalPath('/tmp/b', 12).endsWith('proposals-12.yaml')).toBe(true);
    expect(proposalPath('/tmp/b', 120).endsWith('proposals-120.yaml')).toBe(true);
  });

  it('names its own files and no others', () => {
    expect(isProposalFileName('proposals-01.yaml')).toBe(true);
    expect(isProposalFileName('proposals-01.yml')).toBe(false);
    expect(isProposalFileName('report.md')).toBe(false);
  });
});

describe('the value readers', () => {
  it('tells a mapping from a list and from null', () => {
    expect(isYamlMapping({ a: 1 })).toBe(true);
    expect(isYamlMapping([1])).toBe(false);
    expect(isYamlMapping(null)).toBe(false);
  });

  it('reads a string, and answers null for another type or a blank one', () => {
    expect(stringAt({ a: 'x' }, 'a')).toBe('x');
    expect(stringAt({ a: 3 }, 'a')).toBeNull();
    expect(filledStringAt({ a: '  x  ' }, 'a')).toBe('x');
    expect(filledStringAt({ a: '   ' }, 'a')).toBeNull();
    expect(filledStringAt({}, 'a')).toBeNull();
  });

  it('tells the two signals from anything else', () => {
    expect(isSkillSignal('loud')).toBe(true);
    expect(isSkillSignal('silent')).toBe(true);
    expect(isSkillSignal('LOUD')).toBe(false);
  });

  it('reads a mapping out of YAML and answers null for what is not one', () => {
    expect(readYamlMapping('a: 1\n')).toEqual({ a: 1 });
    expect(readYamlMapping('a: 1\r\nb: 2\r\n')).toEqual({ a: 1, b: 2 });
    expect(readYamlMapping('[1, 2]')).toBeNull();
    expect(readYamlMapping('a: [\n')).toBeNull();
  });

  it('matches a sha256 and nothing shorter or upper-case', () => {
    expect(SHA256_PATTERN.test(hash('a'))).toBe(true);
    expect(SHA256_PATTERN.test(hash('A'))).toBe(false);
    expect(SHA256_PATTERN.test('abc')).toBe(false);
  });
});
