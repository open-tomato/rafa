/**
 * Tests for the epic checklist edit (`src/board/epic-checklist.ts`): the
 * three pure line edits over planted bodies, and the read, write and
 * re-read that carries one onto a board, with its retry.
 *
 * The pure half asserts whole bodies with `toBe`, so a byte the edit was
 * not meant to touch — a CRLF turned LF, a trailing break dropped — fails
 * the case rather than hiding under a `toContain`. The board half drives
 * {@link memoryBoard}, a stateful board that can let a second writer land
 * after a write, which is the lost update the re-read is there to see;
 * the last describe drives the same edits over {@link createFakeGh}
 * through `createGhRoadmapBody`, so the `gh api` calls are ones the fake
 * dispatches on its subcommand. No case spawns a process or reaches
 * GitHub.
 *
 * A retry passes while wrong most easily by re-sending the first
 * attempt's text rather than re-reading, so the concurrent case plants a
 * line the other writer added and asserts the landed body keeps it. The
 * confirmation passes while wrong most easily by never failing, so the
 * board that overwrites every write is the control that the check can
 * answer `failed`.
 *
 * Five mutations of `epic-checklist.ts` were driven on 2026-09-28 over
 * `env -u CLAUDECODE bun test src/board/epic-checklist.test.ts`, the
 * module restored from a scratch copy each time and verified with
 * `shasum -c`, against 30 pass unmutated: confirming by equality with
 * the body sent left 1 fail; one attempt instead of
 * {@link TICK_ATTEMPTS}, 4; re-sending the first attempt's text, 3; a new
 * line always ending `\n`, 2; matching lines without skipping fences, 3.
 */
import type { ChecklistEdit } from './epic-checklist.js';
import type { RoadmapBody } from './roadmap-tick.js';

import { describe, expect, it } from 'bun:test';

import { createFakeGh } from '../adapters/tracker/github-fake.js';

import { readEpicBody } from './epic-body.js';
import {
  appendLine,
  editChecklist,
  editChecklists,
  removeLine,
  tickLine,
} from './epic-checklist.js';
import { renderEpicBody } from './epic-template.js';
import { createGhRoadmapBody, TICK_ATTEMPTS } from './roadmap-tick.js';

/** An epic body whose lines are joined with `lineBreak`, ending with one. */
function epic(lineBreak = '\n'): string {
  return [
    '## Acceptance criteria',
    '',
    '- the listing prints every epic',
    '',
    'Estimate: two weeks',
    '',
    '## Specs',
    '',
    '- [x] #10 the listing',
    '- [ ] #12 the model',
    '- [ ] #14 the board',
    '',
    'Notes after the list stay where they are.',
    '',
  ].join(lineBreak);
}

/** The same body with `lines` in place of its three checklist lines. */
function epicWith(lines: readonly string[], lineBreak = '\n'): string {
  return [
    '## Acceptance criteria',
    '',
    '- the listing prints every epic',
    '',
    'Estimate: two weeks',
    '',
    '## Specs',
    '',
    ...lines,
    '',
    'Notes after the list stay where they are.',
    '',
  ].join(lineBreak);
}

/** A fenced example naming #12, then a real line naming it. */
const FENCED = [
  'An example of the list:',
  '',
  '```markdown',
  '- [ ] #12 an example',
  '```',
  '',
  '- [ ] #12 the model',
  '',
].join('\n');

describe('removeLine', () => {
  it('drops the line naming the issue with its break, every other byte kept', () => {
    expect(removeLine(epic(), 12)).toBe(epicWith(['- [x] #10 the listing', '- [ ] #14 the board']));
  });

  it('keeps a CRLF body CRLF', () => {
    const edited = removeLine(epic('\r\n'), 12);

    expect(edited).toBe(epicWith(['- [x] #10 the listing', '- [ ] #14 the board'], '\r\n'));
    expect(edited.replaceAll('\r\n', '').includes('\n')).toBe(false);
  });

  it('drops a ticked line as well as an unticked one', () => {
    expect(removeLine(epic(), 10)).toBe(epicWith(['- [ ] #12 the model', '- [ ] #14 the board']));
  });

  it('drops every line naming the issue where the body names it twice', () => {
    expect(removeLine('- [ ] #12 first\n- [ ] #14 kept\n- [ ] #12 again\n', 12)).toBe('- [ ] #14 kept\n');
  });

  it('leaves a line inside a fenced block alone, dropping the real one', () => {
    expect(removeLine(FENCED, 12)).toBe(FENCED.replace('\n- [ ] #12 the model\n', '\n'));
    expect(removeLine(FENCED, 12)).toContain('- [ ] #12 an example');
  });

  it('answers the very body it was handed when no line names the issue', () => {
    const body = epic('\r\n');

    expect(removeLine(body, 404)).toBe(body);
    expect(removeLine('```\n- [ ] #12 fenced\n```\n', 12)).toBe('```\n- [ ] #12 fenced\n```\n');
  });

  it('drops the break before a last line that ended with none, so the body still ends bare', () => {
    expect(removeLine('## Specs\r\n- [ ] #10 a\r\n- [ ] #12 b', 12)).toBe('## Specs\r\n- [ ] #10 a');
    expect(removeLine('- [ ] #12 alone', 12)).toBe('');
  });

  it('refuses an issue number that is no positive whole number', () => {
    expect(() => removeLine(epic(), 0)).toThrow(TypeError);
    expect(() => removeLine(epic(), 1.5)).toThrow('expected a positive whole number');
  });
});

describe('appendLine', () => {
  it('writes the line after the last checklist line, before the prose that follows', () => {
    expect(appendLine(epic(), 16, 'the gate')).toBe(epicWith([
      '- [x] #10 the listing',
      '- [ ] #12 the model',
      '- [ ] #14 the board',
      '- [ ] #16 the gate',
    ]));
  });

  it('keeps a CRLF body CRLF, the new line ending CRLF too', () => {
    expect(appendLine(epic('\r\n'), 16, 'the gate')).toBe(epicWith([
      '- [x] #10 the listing',
      '- [ ] #12 the model',
      '- [ ] #14 the board',
      '- [ ] #16 the gate',
    ], '\r\n'));
  });

  it('copies the indentation and bullet of the line it follows', () => {
    expect(appendLine('  * [ ] #10 a\n', 12)).toBe('  * [ ] #10 a\n  * [ ] #12\n');
  });

  it('answers the body as it is when a line names the issue already, ticked or not', () => {
    const body = epic();

    expect(appendLine(body, 10, 'again')).toBe(body);
    expect(appendLine(body, 12)).toBe(body);
  });

  it('ignores a fenced line both as a duplicate and as the place to write after', () => {
    const body = '- [ ] #10 a\n\n```\n- [ ] #12 an example\n```\n';

    expect(appendLine(body, 12, 'real')).toBe('- [ ] #10 a\n- [ ] #12 real\n\n```\n- [ ] #12 an example\n```\n');
  });

  it('writes the line under the Specs heading of a body rendered from the epic template', () => {
    const template = renderEpicBody();

    const edited = appendLine(template, 12, 'the model');

    expect(edited).toBe(`${template}- [ ] #12 the model\n`);
    expect(readEpicBody(edited).lines.map((line) => line.issue)).toEqual([12]);
  });

  it('writes after the last line of a body that ends bare, taking the body\'s own break', () => {
    expect(appendLine('## Specs\r\n\r\nNo lines yet', 12)).toBe('## Specs\r\n\r\nNo lines yet\r\n- [ ] #12');
    expect(appendLine('', 12)).toBe('- [ ] #12');
  });

  it('is undone byte for byte by removeLine', () => {
    const bodies = [epic(), epic('\r\n'), FENCED, renderEpicBody(), '## Specs\r\n- [ ] #10 a', ''];

    for (const body of bodies) expect(removeLine(appendLine(body, 99, 'why'), 99)).toBe(body);
  });

  it('refuses a why that spans several lines, which would write a second line', () => {
    expect(() => appendLine(epic(), 16, 'one\n- [ ] #17 injected')).toThrow(TypeError);
  });
});

describe('tickLine', () => {
  it('ticks the unticked line naming the issue, every other byte kept, CRLF included', () => {
    expect(tickLine(epic('\r\n'), 12)).toBe(epicWith([
      '- [x] #10 the listing',
      '- [x] #12 the model',
      '- [ ] #14 the board',
    ], '\r\n'));
  });

  it('leaves a line inside a fenced block unticked', () => {
    expect(tickLine(FENCED, 12)).toBe(FENCED.replace('- [ ] #12 the model', '- [x] #12 the model'));
    expect(tickLine(FENCED, 12)).toContain('- [ ] #12 an example');
  });

  it('answers the body as it is when the line is ticked already', () => {
    const body = epic();

    expect(tickLine(body, 10)).toBe(body);
  });
});

/** A stateful board over `bodies`, counting its calls. */
function memoryBoard(
  bodies: Readonly<Record<number, string>>,
  options: {
    /** Called after each write lands; may write over it, as a second writer would. */
    readonly afterWrite?: (issue: number, write: number, store: Map<number, string>) => void;
    /** How many writes, from the first, reject before storing anything. */
    readonly failingWrites?: number;
  } = {},
): { board: RoadmapBody; body: (issue: number) => string; reads: () => number; writes: () => number } {
  const store = new Map(Object.entries(bodies).map(([issue, body]) => [Number(issue), body]));
  let reads = 0;
  let writes = 0;
  const board: RoadmapBody = {
    read: (issue) => {
      reads += 1;
      const body = store.get(issue);
      return body === undefined
        ? Promise.reject(new Error(`board: no issue #${String(issue)}`))
        : Promise.resolve(body);
    },
    write: (issue, body) => {
      writes += 1;
      if (writes <= (options.failingWrites ?? 0)) return Promise.reject(new Error('board: gh api failed: 502'));
      store.set(issue, body);
      options.afterWrite?.(issue, writes, store);
      return Promise.resolve(body);
    },
  };
  return { board, body: (issue) => store.get(issue) ?? '', reads: () => reads, writes: () => writes };
}

/** `removeLine` bound to `issue`. */
function removing(issue: number): ChecklistEdit {
  return (body) => removeLine(body, issue);
}

describe('editChecklist', () => {
  it('reads, writes and re-reads once, answering edited', async () => {
    const made = memoryBoard({ 40: epic() });

    const result = await editChecklist({ issue: 40, edit: removing(12), board: made.board });

    expect(result).toEqual({ issue: 40, status: 'edited', attempts: 1, problem: '' });
    expect(made.body(40)).toBe(removeLine(epic(), 12));
    expect([made.reads(), made.writes()]).toEqual([2, 1]);
  });

  it('writes nothing when the body needs no edit, answering nothing-to-edit', async () => {
    const made = memoryBoard({ 40: epic() });

    const result = await editChecklist({ issue: 40, edit: removing(404), board: made.board });

    expect(result).toEqual({ issue: 40, status: 'nothing-to-edit', attempts: 0, problem: '' });
    expect(made.writes()).toBe(0);
  });

  it('retries a concurrent edit that lost the write, landing over the body as it reads now', async () => {
    const theirs = `${epic()}- [ ] #40 added since\n`;
    const made = memoryBoard({ 40: epic() }, {
      afterWrite: (issue, write, store) => {
        if (write === 1) store.set(issue, theirs);
      },
    });

    const result = await editChecklist({ issue: 40, edit: removing(12), board: made.board });

    expect(result).toMatchObject({ status: 'edited', attempts: TICK_ATTEMPTS });
    expect(made.body(40)).toBe(removeLine(theirs, 12));
    expect(made.body(40)).toContain('- [ ] #40 added since');
    expect([made.reads(), made.writes()]).toEqual([4, 2]);
  });

  it('confirms without a retry when a concurrent edit kept the line it wrote', async () => {
    const made = memoryBoard({ 40: epic() }, {
      afterWrite: (issue, _write, store) => {
        store.set(issue, `${store.get(issue) ?? ''}A note somebody added.\n`);
      },
    });

    const result = await editChecklist({ issue: 40, edit: removing(12), board: made.board });

    expect(result).toMatchObject({ status: 'edited', attempts: 1 });
    expect(made.writes()).toBe(1);
  });

  it('retries a write that failed, re-reading first', async () => {
    const made = memoryBoard({ 40: epic() }, { failingWrites: 1 });

    const result = await editChecklist({ issue: 40, edit: removing(12), board: made.board });

    expect(result).toMatchObject({ status: 'edited', attempts: 2 });
    expect(made.body(40)).toBe(removeLine(epic(), 12));
  });

  it('gives up after TICK_ATTEMPTS when every write is lost, writing no further time', async () => {
    const made = memoryBoard({ 40: epic() }, {
      afterWrite: (issue, _write, store) => {
        store.set(issue, epic());
      },
    });

    const result = await editChecklist({ issue: 40, edit: removing(12), board: made.board });

    expect(result).toMatchObject({ issue: 40, status: 'failed', attempts: TICK_ATTEMPTS });
    expect(result.problem).toBe(
      'board epic checklist: issue #40 read back without the edit that was written, so somebody edited it in between',
    );
    expect(made.writes()).toBe(TICK_ATTEMPTS);
  });

  it('answers a read that failed as failed rather than throwing', async () => {
    const made = memoryBoard({});

    const result = await editChecklist({ issue: 40, edit: removing(12), board: made.board });

    expect(result).toMatchObject({ status: 'failed', problem: 'board: no issue #40' });
    expect(made.writes()).toBe(0);
  });
});

describe('editChecklists', () => {
  it('answers one result per body in the order handed, a failure not stopping the next', async () => {
    const made = memoryBoard({ 40: epic(), 41: epic() });

    const results = await editChecklists({
      board: made.board,
      edits: [
        { issue: 99, edit: removing(12) },
        { issue: 40, edit: removing(12) },
        { issue: 41, edit: (body) => appendLine(body, 12) },
      ],
    });

    expect(results.map((result) => [result.issue, result.status])).toEqual([
      [99, 'failed'],
      [40, 'edited'],
      [41, 'nothing-to-edit'],
    ]);
  });
});

describe('editChecklists over the gh fake', () => {
  /** The fake with one issue planted per body, numbered from 1. */
  async function plant(...bodies: readonly string[]): Promise<ReturnType<typeof createFakeGh>> {
    const fake = createFakeGh();
    for (const body of bodies) {
      const created = await fake.run(['issue', 'create', '--title', 'Epic', '--body', body]);
      if (!created.ok) throw new Error(`planting an epic failed: ${created.stderr}`);
    }
    return fake;
  }

  it('moves a line between two epic bodies through the gh api calls, each other byte kept', async () => {
    const target = epicWith(['- [ ] #20 there already'], '\r\n');
    const fake = await plant(epic(), target);

    const results = await editChecklists({
      board: createGhRoadmapBody({ gh: fake.run }),
      edits: [
        { issue: 2, edit: (body) => appendLine(body, 12, 'the model') },
        { issue: 1, edit: removing(12) },
      ],
    });

    expect(results.map((result) => result.status)).toEqual(['edited', 'edited']);
    expect(fake.issue('1')?.body).toBe(removeLine(epic(), 12));
    expect(fake.issue('2')?.body).toBe(epicWith(['- [ ] #20 there already', '- [ ] #12 the model'], '\r\n'));
  });

  it('retries when a second writer lands between the write and the re-read', async () => {
    const fake = await plant(epic());
    const theirs = epic().replace('- [ ] #14 the board', '- [ ] #14 the board, renamed');
    let patches = 0;
    const board = createGhRoadmapBody({
      gh: async (args) => {
        const result = await fake.run(args);
        if (args.includes('PATCH')) {
          patches += 1;
          if (patches === 1) await fake.run(['api', 'repos/{owner}/{repo}/issues/1', '-X', 'PATCH', '-f', `body=${theirs}`]);
        }
        return result;
      },
    });

    const result = await editChecklist({ issue: 1, edit: removing(12), board });

    expect(result).toMatchObject({ status: 'edited', attempts: 2 });
    expect(fake.issue('1')?.body).toBe(removeLine(theirs, 12));
  });
});
