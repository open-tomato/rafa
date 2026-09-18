/**
 * Tests for the proposal pass (`./propose.ts`): what a batch of twenty
 * comes to, what an unreadable session answer leaves behind, and the
 * four things an apply refuses.
 *
 * Every case plants its own skills directory under this file's
 * temporary directory. Nothing here reads the machine home, this
 * checkout or the real `PATH`, and NO case spawns `claude`: the pass
 * takes its spawner as a seam and every session in this file is
 * {@link scriptedSpawner}, which answers from a script and records what
 * it was asked. The checker seams are a null project root and an empty
 * `PATH` list, which is how a user tier is checked.
 *
 * ## Every reading is paired
 *
 * Six readings here would come out the same on a pass that did nothing
 * at all, so each is planted beside a twin that must move:
 *
 *   - **An unreadable answer leaves its batch unanswered.** The first
 *     session of a two-batch run answers prose and the second answers
 *     YAML, and both files are asserted in one run: a pass that marked
 *     every row unanswered would be red on the second.
 *   - **A file the session did not name is unanswered**, beside the
 *     nineteen in the same batch that it did name.
 *   - **A draft file is refused**, and the same rows applied once the
 *     status says `reviewed`, so the refusal cannot be an apply that
 *     writes nothing.
 *   - **A file naming another skills directory is refused**, beside the
 *     same file naming the right one.
 *   - **A row whose skill changed is refused**, beside a row in the same
 *     file whose skill did not.
 *   - **A description over the cap is put back**, beside a row in the
 *     same file that is written — an applier that wrote nothing at all
 *     would be red on the second.
 *
 * ## The one thing the stand-in cannot measure
 *
 * That the real spawner is reached at all. {@link runProposalBatch}
 * hands its spawner to `runClaudeCaptured`, whose own tests
 * (`../utils/claude.test.ts`) measure the argument list and the prompt
 * on stdin; the assertion here is that the pass builds the arguments
 * `claudeArgs` builds for the same setting sources, and that the prompt
 * names every file of the batch.
 */
import type { ProposalFile, ProposalRow } from './proposal-file.js';
import type { ClaudeSettingSource } from '../config.js';
import type { CapturedSession, CapturingSpawner } from '../utils/claude.js';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { sourceHash } from '../demote/report.js';
import { readFrontmatterDocument } from '../schema/frontmatter.js';
import { DESCRIPTION_LIMIT } from '../schema/skill.js';

import {
  DRAFT_FILE,
  parseProposalFile,
  proposalPath,
  REVIEWED_FILE,
  UNANSWERED_ROW,
} from './proposal-file.js';
import {
  applyProposals,
  countProposalActions,
  fileRefusal,
  PROPOSAL_ACTION_KINDS,
  runProposalPass,
} from './propose.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-backfill-propose-'));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The setting sources every session in this file is spawned with. */
const sources: readonly ClaudeSettingSource[] = ['project', 'local'];

/** The seams an apply checks with: no project, no `PATH`. */
const applyOptions = { projectRoot: null, pathDirs: [] };

/** What one scripted session was asked, and what it answered. */
interface RecordedCall {
  /** The argument list the pass built. */
  readonly args: readonly string[];
  /** The prompt it handed over. */
  readonly prompt: string;
}

/** A spawner that answers from `script`, call by call, and records each call. */
function scriptedSpawner(script: readonly ((prompt: string) => CapturedSession)[]): {
  calls: RecordedCall[];
  spawn: CapturingSpawner;
} {
  const calls: RecordedCall[] = [];
  const spawn: CapturingSpawner = (args, prompt) => {
    calls.push({ args: [...args], prompt });
    const answer = script[calls.length - 1];
    if (answer === undefined) throw new Error(`no scripted answer for call ${calls.length}`);
    return Promise.resolve(answer(prompt));
  };
  return { calls, spawn };
}

/** Every path the prompt lists, in the order it lists them. */
function promptPaths(prompt: string): readonly string[] {
  return [...prompt.matchAll(/^path: (.+)$/gm)].map((match) => match[1] ?? '');
}

/** A session answering every path of its prompt, in one fenced block. */
function answerEveryFile(prompt: string): CapturedSession {
  const rows = promptPaths(prompt).map((path) => [
    `  - path: ${path}`,
    '    prevents: a skill nobody can tell from its neighbours',
    '    signal: silent',
    `    trigger: Use it when ${path} is the shape in front of you`,
  ].join('\n'));
  return {
    exitCode: 0,
    stdout: ['Here is the batch.', '', '```yaml', 'proposals:', ...rows, '```', ''].join('\n'),
  };
}

/** A session answering prose and no YAML at all, with the given exit code. */
function answerNothing(exitCode: number): (prompt: string) => CapturedSession {
  return () => ({
    exitCode,
    stdout: 'I was unable to read the files in this batch and have written nothing.\n',
  });
}

/** A skills directory of this case's own, with its backfill directory beside it. */
function newScope(): { readonly root: string; readonly backfillDir: string } {
  planted += 1;
  const base = join(tempBase, `tier-${planted}`);
  const root = join(base, '.claude', 'skills');
  mkdirSync(root, { recursive: true });
  return { root, backfillDir: join(base, '.rafa', 'backfill') };
}

/** One `<root>/<name>/SKILL.md` with a clean block and a plain body. */
function plantSkill(root: string, name: string, front: readonly string[] = []): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'SKILL.md');
  writeFileSync(path, [
    '---',
    `name: ${name}`,
    `description: the ${name} skill, planted for this case`,
    'tags:',
    '  - planted',
    'stack:',
    '  - agnostic',
    ...front,
    '---',
    '',
    `# ${name}`,
    '',
    'One paragraph of plain prose, with no fenced command in it.',
    '',
  ].join('\n'), 'utf8');
  return path;
}

/** `count` skills named `skill-01` upwards, each needing prevents and a trigger. */
function plantSkills(root: string, count: number): readonly string[] {
  const names: string[] = [];
  for (let index = 1; index <= count; index += 1) {
    const name = `skill-${String(index).padStart(2, '0')}`;
    plantSkill(root, name);
    names.push(name);
  }
  return names;
}

/** The frontmatter the file at `path` now carries. */
function frontmatterOf(path: string): Readonly<Record<string, unknown>> {
  const document = readFrontmatterDocument(readFileSync(path, 'utf8'));
  if (document === null) throw new Error(`no frontmatter at ${path}`);
  return document.data;
}

/** The body the file at `path` now carries, byte for byte. */
function bodyOf(path: string): string {
  const document = readFrontmatterDocument(readFileSync(path, 'utf8'));
  if (document === null) throw new Error(`no frontmatter at ${path}`);
  return document.body;
}

/** The file written for `batch`, read back off disk. */
function writtenFile(backfillDir: string, batch: number): ProposalFile {
  const result = parseProposalFile(readFileSync(proposalPath(backfillDir, batch), 'utf8'));
  if (result.file === null) throw new Error(`unreadable proposal file: ${result.problem ?? ''}`);
  return result.file;
}

/** One answered row for `path`, hashed from the file that sits there. */
function answeredRow(
  root: string,
  name: string,
  over: Partial<ProposalRow> = {},
): ProposalRow {
  const relative = `${name}/SKILL.md`;
  return {
    path: relative,
    name,
    hash: sourceHash(readFileSync(join(root, name, 'SKILL.md'), 'utf8')),
    needs: ['prevents', 'trigger'],
    status: 'answered',
    prevents: 'a skill nobody can tell from its neighbours',
    signal: 'silent',
    trigger: `Use it when ${name} is the shape in front of you`,
    description: null,
    note: null,
    ...over,
  };
}

/** A reviewed file over `rows`, naming `root`. */
function reviewedFile(root: string, rows: readonly ProposalRow[]): ProposalFile {
  return { status: REVIEWED_FILE, batch: 1, skills: root, exitCode: 0, rows };
}

/** The action for `relative` in an apply result. */
function actionFor(
  result: ReturnType<typeof applyProposals>,
  relative: string,
): ReturnType<typeof applyProposals>['actions'][number] {
  const found = result.actions.find((action) => action.relative === relative);
  if (found === undefined) throw new Error(`no action for ${relative}`);
  return found;
}

describe('runProposalPass', () => {
  it('runs one session per twenty files and writes one draft file per batch', async () => {
    const { root, backfillDir } = newScope();
    plantSkills(root, 21);
    const { calls, spawn } = scriptedSpawner([answerEveryFile, answerEveryFile]);

    const result = await runProposalPass({
      root,
      backfillDir,
      settingSources: sources,
      spawn,
    });

    expect(result.candidates).toBe(21);
    expect(calls).toHaveLength(2);
    expect(result.written.map((entry) => entry.file.rows.length)).toEqual([20, 1]);
    expect(writtenFile(backfillDir, 1).rows).toHaveLength(20);
    expect(writtenFile(backfillDir, 2).rows).toHaveLength(1);
    expect(writtenFile(backfillDir, 1).status).toBe(DRAFT_FILE);
    expect(writtenFile(backfillDir, 1).skills).toBe(root);
  });

  it('spawns each session with the base arguments and its setting sources', async () => {
    const { root, backfillDir } = newScope();
    plantSkills(root, 2);
    const { calls, spawn } = scriptedSpawner([answerEveryFile]);

    await runProposalPass({ root, backfillDir, settingSources: sources, spawn });

    expect(calls[0]?.args).toEqual([
      '-p',
      '--dangerously-skip-permissions',
      '--setting-sources',
      'project,local',
    ]);
    expect(promptPaths(calls[0]?.prompt ?? '')).toEqual(['skill-01/SKILL.md', 'skill-02/SKILL.md']);
    expect(calls[0]?.prompt).toContain('needs: prevents, trigger');
  });

  it('marks every row of a batch unanswered when its session answers no YAML', async () => {
    const { root, backfillDir } = newScope();
    plantSkills(root, 21);
    const { spawn } = scriptedSpawner([answerNothing(1), answerEveryFile]);

    await runProposalPass({ root, backfillDir, settingSources: sources, spawn });

    const first = writtenFile(backfillDir, 1);
    const second = writtenFile(backfillDir, 2);
    expect(first.rows.every((row) => row.status === UNANSWERED_ROW)).toBe(true);
    expect(first.rows.every((row) => row.prevents === null)).toBe(true);
    expect(first.rows[0]?.note).toContain('exit 1');
    expect(first.exitCode).toBe(1);
    expect(second.rows[0]?.status).toBe('answered');
    expect(second.rows[0]?.prevents).toBe('a skill nobody can tell from its neighbours');
  });

  it('marks a file its session did not name unanswered and answers the rest', async () => {
    const { root, backfillDir } = newScope();
    plantSkills(root, 3);
    const { spawn } = scriptedSpawner([(prompt) => {
      const answered = promptPaths(prompt).filter((path) => !path.startsWith('skill-02'));
      return answerEveryFile(answered.map((path) => `path: ${path}`).join('\n'));
    }]);

    await runProposalPass({ root, backfillDir, settingSources: sources, spawn });

    const file = writtenFile(backfillDir, 1);
    expect(file.rows.map((row) => row.status)).toEqual(['answered', UNANSWERED_ROW, 'answered']);
    expect(file.rows[1]?.note).toBe('the session answered nothing about this file');
  });

  it('writes no file and spawns no session when nothing needs anything', async () => {
    const { root, backfillDir } = newScope();
    plantSkill(root, 'complete-skill', [
      'prevents: a gap nobody notices',
      'signal: silent',
    ]);
    writeFileSync(
      join(root, 'complete-skill', 'SKILL.md'),
      `${readFileSync(join(root, 'complete-skill', 'SKILL.md'), 'utf8')}\n## When to Use\n\nUse it when the gap is in front of you.\n`,
      'utf8',
    );
    const { calls, spawn } = scriptedSpawner([]);

    const result = await runProposalPass({ root, backfillDir, settingSources: sources, spawn });

    expect(result.candidates).toBe(0);
    expect(calls).toHaveLength(0);
    expect(result.written).toEqual([]);
  });
});

describe('applyProposals', () => {
  it('refuses every row of a draft file and applies the same rows once it is reviewed', () => {
    const { root } = newScope();
    plantSkills(root, 2);
    const rows = [answeredRow(root, 'skill-01'), answeredRow(root, 'skill-02')];
    const draft: ProposalFile = { ...reviewedFile(root, rows), status: DRAFT_FILE };

    const refused = applyProposals([draft], root, applyOptions);
    expect(refused.counts.refused).toBe(2);
    expect(refused.actions[0]?.detail).toContain('still marked draft');
    expect(frontmatterOf(join(root, 'skill-01', 'SKILL.md'))['prevents']).toBeUndefined();
    expect(refused.triggers).toEqual({});

    const applied = applyProposals([reviewedFile(root, rows)], root, applyOptions);
    expect(applied.counts.applied).toBe(2);
    expect(frontmatterOf(join(root, 'skill-01', 'SKILL.md'))['prevents'])
      .toBe('a skill nobody can tell from its neighbours');
    expect(frontmatterOf(join(root, 'skill-01', 'SKILL.md'))['signal']).toBe('silent');
  });

  it('refuses a file naming another skills directory, and accepts the one naming this one', () => {
    const { root } = newScope();
    const other = newScope().root;
    plantSkills(root, 1);
    const rows = [answeredRow(root, 'skill-01')];

    const refused = applyProposals([reviewedFile(other, rows)], root, applyOptions);
    expect(refused.counts.refused).toBe(1);
    expect(refused.actions[0]?.detail).toContain(other);
    expect(frontmatterOf(join(root, 'skill-01', 'SKILL.md'))['prevents']).toBeUndefined();

    const applied = applyProposals([reviewedFile(root, rows)], root, applyOptions);
    expect(applied.counts.applied).toBe(1);
  });

  it('refuses a row whose skill changed since the proposal, beside one that did not', () => {
    const { root } = newScope();
    plantSkills(root, 2);
    const rows = [answeredRow(root, 'skill-01'), answeredRow(root, 'skill-02')];
    const changed = join(root, 'skill-01', 'SKILL.md');
    writeFileSync(changed, `${readFileSync(changed, 'utf8')}\nOne line the session never read.\n`, 'utf8');

    const result = applyProposals([reviewedFile(root, rows)], root, applyOptions);

    expect(actionFor(result, 'skill-01/SKILL.md').kind).toBe('refused');
    expect(actionFor(result, 'skill-01/SKILL.md').detail).toContain('changed since the proposal');
    expect(frontmatterOf(changed)['prevents']).toBeUndefined();
    expect(actionFor(result, 'skill-02/SKILL.md').kind).toBe('applied');
    expect(result.triggers).toEqual({ 'skill-02': 'Use it when skill-02 is the shape in front of you' });
  });

  it('refuses a row whose file is gone', () => {
    const { root } = newScope();
    plantSkills(root, 1);
    const rows = [answeredRow(root, 'skill-01')];
    rmSync(join(root, 'skill-01'), { recursive: true, force: true });

    const result = applyProposals([reviewedFile(root, rows)], root, applyOptions);

    expect(result.counts.refused).toBe(1);
    expect(result.actions[0]?.detail).toContain('is gone');
  });

  it('puts a file back when the write adds a check failure, beside a row that is written', () => {
    const { root } = newScope();
    plantSkills(root, 2);
    const long = 'x'.repeat(DESCRIPTION_LIMIT + 10);
    const rows = [
      answeredRow(root, 'skill-01', { needs: ['prevents', 'trigger', 'description'], description: long }),
      answeredRow(root, 'skill-02'),
    ];
    const overCap = join(root, 'skill-01', 'SKILL.md');
    const before = readFileSync(overCap, 'utf8');

    const result = applyProposals([reviewedFile(root, rows)], root, applyOptions);

    const refused = actionFor(result, 'skill-01/SKILL.md');
    expect(refused.kind).toBe('refused');
    expect(refused.added.join(' ')).toContain('description-too-long');
    expect(readFileSync(overCap, 'utf8')).toBe(before);
    expect(actionFor(result, 'skill-02/SKILL.md').kind).toBe('applied');
  });

  it('refuses a row carrying prevents with no signal', () => {
    const { root } = newScope();
    plantSkills(root, 1);
    const rows = [answeredRow(root, 'skill-01', { signal: null })];

    const result = applyProposals([reviewedFile(root, rows)], root, applyOptions);

    expect(result.counts.refused).toBe(1);
    expect(result.actions[0]?.detail).toContain('prevents with no signal');
    expect(frontmatterOf(join(root, 'skill-01', 'SKILL.md'))['prevents']).toBeUndefined();
  });

  it('passes an unanswered row over untouched and leaves its trigger out', () => {
    const { root } = newScope();
    plantSkills(root, 2);
    const rows = [
      answeredRow(root, 'skill-01', {
        status: UNANSWERED_ROW,
        prevents: null,
        signal: null,
        note: 'the session answered nothing about this file',
      }),
      answeredRow(root, 'skill-02'),
    ];

    const result = applyProposals([reviewedFile(root, rows)], root, applyOptions);

    expect(actionFor(result, 'skill-01/SKILL.md').kind).toBe('unanswered');
    expect(frontmatterOf(join(root, 'skill-01', 'SKILL.md'))['prevents']).toBeUndefined();
    expect(Object.keys(result.triggers)).toEqual(['skill-02']);
  });

  it('writes no trigger into the skill and answers it for the derivation', () => {
    const { root } = newScope();
    plantSkills(root, 1);
    const path = join(root, 'skill-01', 'SKILL.md');
    const body = bodyOf(path);

    const result = applyProposals([reviewedFile(root, [answeredRow(root, 'skill-01')])], root, applyOptions);

    expect(result.triggers['skill-01']).toBe('Use it when skill-01 is the shape in front of you');
    expect(Object.keys(frontmatterOf(path))).not.toContain('trigger');
    expect(Object.keys(frontmatterOf(path))).not.toContain('when_to_use');
    expect(bodyOf(path)).toBe(body);
    expect(actionFor(result, 'skill-01/SKILL.md').changes).toEqual({
      prevents: 'a skill nobody can tell from its neighbours',
      signal: 'silent',
    });
  });

  it('reports a second apply of the same rows as unchanged', () => {
    const { root } = newScope();
    plantSkills(root, 1);
    const rows = [answeredRow(root, 'skill-01')];

    expect(applyProposals([reviewedFile(root, rows)], root, applyOptions).counts.applied).toBe(1);
    const again = applyProposals(
      [reviewedFile(root, [{ ...rows[0] as ProposalRow, hash: sourceHash(readFileSync(join(root, 'skill-01', 'SKILL.md'), 'utf8')) }])],
      root,
      applyOptions,
    );
    expect(again.counts.unchanged).toBe(1);
  });
});

describe('countProposalActions', () => {
  it('counts every kind, with the kinds nothing came to at zero', () => {
    const counts = countProposalActions([
      { path: 'a', relative: 'a', kind: 'applied', detail: '', changes: {}, added: [] },
      { path: 'b', relative: 'b', kind: 'applied', detail: '', changes: {}, added: [] },
      { path: 'c', relative: 'c', kind: 'refused', detail: '', changes: {}, added: [] },
    ]);

    expect(counts).toEqual({ applied: 2, unchanged: 0, unanswered: 0, refused: 1 });
    expect(Object.keys(counts)).toEqual([...PROPOSAL_ACTION_KINDS]);
  });
});

describe('fileRefusal', () => {
  it('names the draft status, the wrong directory, and nothing for a reviewed file that fits', () => {
    const file = reviewedFile('/tmp/skills', []);

    expect(fileRefusal({ ...file, status: DRAFT_FILE }, '/tmp/skills')).toContain('draft');
    expect(fileRefusal(file, '/tmp/other')).toContain('/tmp/skills');
    expect(fileRefusal(file, '/tmp/skills')).toBeNull();
  });
});
