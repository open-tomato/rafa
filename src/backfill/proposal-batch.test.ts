/**
 * Tests for one batch of the proposal pass (`./proposal-batch.ts`):
 * which skills are asked about, what the prompt says, and what a
 * session's output reads as.
 *
 * Every case plants its own skills directory under this file's
 * temporary directory and selects over that. Nothing here reads the
 * machine home, this checkout or the real `PATH`, and nothing spawns a
 * session: the answers are strings written in the case.
 *
 * ## Every reading is paired
 *
 *   - **A skill short of nothing is no candidate**, planted beside one
 *     short of everything, and the two are asserted in one selection: a
 *     selector that took every file would be red on the first, and one
 *     that took none would be red on the second.
 *   - **A body is cut at the limit**, beside one under it that is kept
 *     whole.
 *   - **An answer with no proposals list reads as none**, beside a
 *     second fenced block in the same output that reads as the answer.
 */
import type { ProposalCandidate } from './proposal-batch.js';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { sourceHash } from '../demote/report.js';
import { DESCRIPTION_LIMIT } from '../schema/skill.js';

import {
  batchCandidates,
  candidateNeeds,
  parseSessionAnswer,
  PROMPT_BODY_LIMIT,
  PROPOSAL_BATCH_SIZE,
  PROPOSAL_PROMPT_HEADER,
  renderProposalPrompt,
  selectProposals,
} from './proposal-batch.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-proposal-batch-'));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A skills directory of this case's own. */
function newRoot(): string {
  planted += 1;
  const root = join(tempBase, `tier-${planted}`, 'skills');
  mkdirSync(root, { recursive: true });
  return root;
}

/** One `<root>/<name>/SKILL.md`, with `front` after its block and `body` under it. */
function plantSkill(
  root: string,
  name: string,
  front: readonly string[] = [],
  body: readonly string[] = ['One paragraph of plain prose.'],
): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'SKILL.md');
  writeFileSync(path, [
    '---',
    `name: ${name}`,
    `description: the ${name} skill`,
    'tags:',
    '  - planted',
    'stack:',
    '  - agnostic',
    ...front,
    '---',
    '',
    ...body,
    '',
  ].join('\n'), 'utf8');
  return path;
}

/** The frontmatter a complete skill carries: both halves of the pair. */
const completeFront: readonly string[] = [
  'prevents: a gap nobody notices',
  'signal: silent',
];

/** A body with the section a trigger sentence is taken from. */
const bodyWithTrigger: readonly string[] = [
  '## When to Use',
  '',
  'Use it when the gap is in front of you. It is short.',
];

describe('candidateNeeds', () => {
  it('asks for prevents when either half of the pair is missing or unknown', () => {
    const body = bodyWithTrigger.join('\n');

    expect(candidateNeeds({ description: 'short' }, body)).toEqual(['prevents']);
    expect(candidateNeeds({ description: 'short', prevents: 'a gap' }, body)).toEqual(['prevents']);
    expect(candidateNeeds({ description: 'short', prevents: 'a gap', signal: 'quiet' }, body))
      .toEqual(['prevents']);
    expect(candidateNeeds({ description: 'short', prevents: 'a gap', signal: 'loud' }, body))
      .toEqual([]);
  });

  it('asks for a trigger only when the body has no When to Use section', () => {
    const complete = { description: 'short', prevents: 'a gap', signal: 'loud' };

    expect(candidateNeeds(complete, 'No heading at all.')).toEqual(['trigger']);
    expect(candidateNeeds(complete, bodyWithTrigger.join('\n'))).toEqual([]);
  });

  it('asks for a description at the cap and not under it', () => {
    const complete = { prevents: 'a gap', signal: 'loud' };
    const body = bodyWithTrigger.join('\n');

    expect(candidateNeeds({ ...complete, description: 'x'.repeat(DESCRIPTION_LIMIT) }, body))
      .toEqual(['description']);
    expect(candidateNeeds({ ...complete, description: 'x'.repeat(DESCRIPTION_LIMIT - 1) }, body))
      .toEqual([]);
  });

  it('lists every need it has, in order', () => {
    expect(candidateNeeds({ description: 'x'.repeat(DESCRIPTION_LIMIT) }, 'No heading.'))
      .toEqual(['prevents', 'trigger', 'description']);
  });
});

describe('selectProposals', () => {
  it('takes the skill short of something and passes over the one short of nothing', () => {
    const root = newRoot();
    const wanting = plantSkill(root, 'wanting-skill');
    plantSkill(root, 'complete-skill', completeFront, bodyWithTrigger);

    const candidates = selectProposals(root);

    expect(candidates.map((candidate) => candidate.name)).toEqual(['wanting-skill']);
    expect(candidates[0]?.path).toBe(wanting);
    expect(candidates[0]?.relative).toBe('wanting-skill/SKILL.md');
    expect(candidates[0]?.needs).toEqual(['prevents', 'trigger']);
    expect(candidates[0]?.description).toBe('the wanting-skill skill');
  });

  it('hashes the file as it read it', () => {
    const root = newRoot();
    const path = plantSkill(root, 'wanting-skill');

    expect(selectProposals(root)[0]?.hash).toBe(sourceHash(readFileSync(path, 'utf8')));
  });

  it('passes over a file carrying no frontmatter, beside one that does', () => {
    const root = newRoot();
    plantSkill(root, 'wanting-skill');
    mkdirSync(join(root, 'no-block'), { recursive: true });
    writeFileSync(join(root, 'no-block', 'SKILL.md'), '# no frontmatter here\n', 'utf8');

    expect(selectProposals(root).map((candidate) => candidate.name)).toEqual(['wanting-skill']);
  });
});

describe('batchCandidates', () => {
  /** `count` candidates, each one enough of a candidate to be counted. */
  function fakeCandidates(count: number): readonly ProposalCandidate[] {
    return Array.from({ length: count }, (_unused, index) => ({
      path: `/tmp/skill-${index}/SKILL.md`,
      relative: `skill-${index}/SKILL.md`,
      name: `skill-${index}`,
      hash: 'a'.repeat(64),
      description: 'one line',
      needs: ['prevents'] as const,
      body: 'one paragraph',
    }));
  }

  it('runs to the batch size and starts a new batch past it', () => {
    expect(batchCandidates(fakeCandidates(PROPOSAL_BATCH_SIZE)).map((batch) => batch.length))
      .toEqual([PROPOSAL_BATCH_SIZE]);
    expect(batchCandidates(fakeCandidates(PROPOSAL_BATCH_SIZE + 1)).map((batch) => batch.length))
      .toEqual([PROPOSAL_BATCH_SIZE, 1]);
    expect(batchCandidates(fakeCandidates(0))).toEqual([]);
  });

  it('keeps the order it was given', () => {
    const batches = batchCandidates(fakeCandidates(PROPOSAL_BATCH_SIZE + 2));

    expect(batches[0]?.[0]?.name).toBe('skill-0');
    expect(batches[1]?.[0]?.name).toBe(`skill-${PROPOSAL_BATCH_SIZE}`);
  });
});

describe('renderProposalPrompt', () => {
  it('opens with the header and names every file of the batch', () => {
    const root = newRoot();
    plantSkill(root, 'first-skill');
    plantSkill(root, 'second-skill');

    const prompt = renderProposalPrompt(selectProposals(root));

    expect(prompt.startsWith(PROPOSAL_PROMPT_HEADER)).toBe(true);
    expect(prompt).toContain('path: first-skill/SKILL.md');
    expect(prompt).toContain('name: second-skill');
    expect(prompt).toContain('description: the first-skill skill');
    expect(prompt).toContain('needs: prevents, trigger');
    expect(prompt).toContain('--- file 2 of 2 ---');
  });

  it('cuts a body at the limit and keeps a shorter one whole', () => {
    const root = newRoot();
    plantSkill(root, 'long-skill', [], ['y'.repeat(PROMPT_BODY_LIMIT + 500)]);
    plantSkill(root, 'short-skill', [], ['a short body']);

    const prompt = renderProposalPrompt(selectProposals(root));

    expect(prompt).toContain(`[body cut at ${PROMPT_BODY_LIMIT} characters]`);
    expect(prompt).not.toContain('y'.repeat(PROMPT_BODY_LIMIT + 1));
    expect(prompt).toContain('a short body');
  });
});

describe('parseSessionAnswer', () => {
  /** One well-formed answer block, as a session would fence it. */
  const block = [
    '```yaml',
    'proposals:',
    '  - path: one/SKILL.md',
    '    prevents: a failure nobody sees',
    '    signal: silent',
    '    trigger: Use it when the first case arrives.',
    '```',
  ].join('\n');

  it('reads a fenced block out of the prose around it', () => {
    const answers = parseSessionAnswer(`Here is my answer.\n\n${block}\n\nThat is all.\n`);

    expect(answers?.size).toBe(1);
    expect(answers?.get('one/SKILL.md')?.prevents).toBe('a failure nobody sees');
    expect(answers?.get('one/SKILL.md')?.signal).toBe('silent');
    expect(answers?.get('one/SKILL.md')?.description).toBeNull();
  });

  it('reads an answer that was never fenced', () => {
    const answers = parseSessionAnswer('proposals:\n  - path: one/SKILL.md\n    signal: loud\n');

    expect(answers?.get('one/SKILL.md')?.signal).toBe('loud');
  });

  it('passes over a block with no proposals list and reads the one that has it', () => {
    const answer = ['```yaml', 'notes: I thought about it', '```', '', block].join('\n');

    expect(parseSessionAnswer(answer)?.get('one/SKILL.md')?.prevents).toBe('a failure nobody sees');
  });

  it('answers null for prose, for an empty list, and for YAML nothing can parse', () => {
    expect(parseSessionAnswer('I could not do this.\n')).toBeNull();
    expect(parseSessionAnswer('proposals: []\n')).toBeNull();
    expect(parseSessionAnswer('```yaml\nproposals: [\n```\n')).toBeNull();
  });

  it('drops an answer naming no path and keeps the one that does', () => {
    const answer = [
      'proposals:',
      '  - prevents: a failure with no file',
      '  - path: one/SKILL.md',
      '    prevents: a failure nobody sees',
    ].join('\n');

    const answers = parseSessionAnswer(answer);

    expect(answers?.size).toBe(1);
    expect(answers?.has('one/SKILL.md')).toBe(true);
  });
});
