/**
 * Tests for the roadmap tick (`src/board/roadmap-tick.ts`): which lines
 * a list of closed issues ticks, the two `gh api` calls the board makes,
 * and the one retry a write that did not land gets.
 *
 * The pure half is driven over planted bodies and the board half over
 * {@link stubGh}, a runner answering recorded results and keeping the
 * argument lists it was handed; the retry is driven over a fake
 * {@link RoadmapBody} that can answer a different body on each read. So
 * no case spawns a process, reaches GitHub or reads the configuration
 * `gh` keeps under the home.
 *
 * A retry passes while wrong most easily by re-sending the first
 * attempt's text rather than re-reading, so the case that retries plants
 * a SECOND body with a line the first did not have and asserts the write
 * carries it.
 *
 * One mutation of `roadmap-tick.ts` was driven on 2026-09-19 over
 * `env -u CLAUDECODE bun test src/board/roadmap-tick.test.ts
 * src/commands/pr/merge-tick.test.ts`, the module restored from a
 * scratch copy and verified with `shasum -c`: {@link TICK_ATTEMPTS}
 * dropped from 2 to 1, so nothing retries, left 26 pass and 4 fail
 * against 30 pass either side — the three retry cases here and the
 * failed-board case next door.
 */
import type { RoadmapBody } from './roadmap-tick.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import {
  createGhRoadmapBody,
  splitKeepingBreaks,
  TICK_ATTEMPTS,
  tickRoadmapIssue,
  tickRoadmapLines,
  tickSentence,
} from './roadmap-tick.js';

/** A roadmap body whose lines are joined with `break`. */
function roadmap(lineBreak = '\n'): string {
  return [
    '## Next, in order',
    '',
    '- [x] #19 the pull request commands',
    '- [ ] #20 plans from the board',
    '- [ ] #33 the board setup',
  ].join(lineBreak);
}

/** A recorded `gh` result that succeeded, writing `stdout`. */
function wrote(stdout: string): GhResult {
  return { ok: true, stdout, stderr: '' };
}

/** A recorded `gh` result that failed, writing `stderr`. */
function failed(stderr: string): GhResult {
  return { ok: false, stdout: '', stderr };
}

/** A runner answering `results` in turn, the last one repeating, keeping every call. */
function stubGh(...results: readonly GhResult[]): { run: GhRunner; calls: () => readonly (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  let index = 0;
  const run: GhRunner = (args) => {
    calls.push([...args]);
    const result = results[Math.min(index, results.length - 1)] ?? wrote('');
    index += 1;
    return Promise.resolve(result);
  };
  return { run, calls: () => calls };
}

/** What one write of the fake board came to. */
type WriteAnswer =
  | { readonly kind: 'echo' }
  | { readonly kind: 'stored'; readonly body: string }
  | { readonly kind: 'threw'; readonly why: string };

/** A board reading `bodies` in turn and answering `answers` in turn to its writes. */
function fakeBoard(bodies: readonly string[], answers: readonly WriteAnswer[]): {
  board: RoadmapBody;
  reads: () => number;
  writes: () => readonly string[];
} {
  const written: string[] = [];
  let read = 0;
  const board: RoadmapBody = {
    read: (): Promise<string> => {
      const body = bodies[Math.min(read, bodies.length - 1)] ?? '';
      read += 1;
      return Promise.resolve(body);
    },
    write: (_issue: number, body: string): Promise<string> => {
      const answer = answers[Math.min(written.length, answers.length - 1)] ?? { kind: 'echo' as const };
      written.push(body);
      if (answer.kind === 'threw') return Promise.reject(new Error(answer.why));
      return answer.kind === 'echo'
        ? Promise.resolve(body)
        : Promise.resolve(answer.body);
    },
  };
  return { board, reads: () => read, writes: () => written };
}

/** A write answer that stores exactly what was sent. */
function stores(): WriteAnswer {
  return { kind: 'echo' };
}

/** A board whose every write stores what it was sent. */
function storingBoard(...bodies: readonly string[]): ReturnType<typeof fakeBoard> {
  return fakeBoard(bodies, [stores()]);
}

describe('tickRoadmapLines', () => {
  it('ticks the unticked line naming the issue and leaves every other line as it was', () => {
    const edit = tickRoadmapLines(roadmap(), [20]);

    expect(edit.ticked).toEqual([20]);
    expect(edit.already).toEqual([]);
    expect(edit.absent).toEqual([]);
    expect(edit.body).toBe([
      '## Next, in order',
      '',
      '- [x] #19 the pull request commands',
      '- [x] #20 plans from the board',
      '- [ ] #33 the board setup',
    ].join('\n'));
  });

  it('keeps the line breaks the body spelled, so a CRLF roadmap comes back CRLF', () => {
    const edit = tickRoadmapLines(roadmap('\r\n'), [20]);

    expect(edit.body.split('\r\n')[3]).toBe('- [x] #20 plans from the board');
    expect(edit.body.includes('\n\n')).toBe(false);
  });

  it('ticks every unticked line naming the issue where the roadmap names it twice', () => {
    const body = '- [ ] #20 first\n- [ ] #20 again\n';

    expect(tickRoadmapLines(body, [20]).body).toBe('- [x] #20 first\n- [x] #20 again\n');
  });

  it('reads no line inside a fenced block, where the same line outside one is ticked', () => {
    const fenced = '```\n- [ ] #20 an example\n```\n';

    expect(tickRoadmapLines(fenced, [20])).toMatchObject({ body: fenced, ticked: [], absent: [20] });
    expect(tickRoadmapLines('- [ ] #20 an example\n', [20]).ticked).toEqual([20]);
  });

  it('answers a line that is ticked already as already, writing nothing new', () => {
    const body = roadmap();

    expect(tickRoadmapLines(body, [19])).toMatchObject({ body, ticked: [], already: [19], absent: [] });
  });

  it('answers an issue the roadmap carries no line for as absent', () => {
    const body = roadmap();

    expect(tickRoadmapLines(body, [404])).toMatchObject({ body, ticked: [], already: [], absent: [404] });
  });

  it('sorts several issues into the three lists in the order asked, ticking each of them', () => {
    const edit = tickRoadmapLines(roadmap(), [33, 19, 404, 20, 20]);

    expect(edit.ticked).toEqual([33, 20]);
    expect(edit.already).toEqual([19]);
    expect(edit.absent).toEqual([404]);
    expect(edit.body).toContain('- [x] #33 the board setup');
    expect(edit.body).toContain('- [x] #20 plans from the board');
  });
});

describe('splitKeepingBreaks', () => {
  it('joins back into the body it was handed', () => {
    const body = 'a\r\nb\nc\rd';

    expect(splitKeepingBreaks(body).join('')).toBe(body);
  });
});

describe('createGhRoadmapBody', () => {
  it('reads the body off the REST resource, leaving the repository for gh to expand', async () => {
    const stub = stubGh(wrote(JSON.stringify({ number: 31, body: roadmap() })));

    const body = await createGhRoadmapBody({ gh: stub.run }).read(31);

    expect(stub.calls()).toEqual([['repos/{owner}/{repo}/issues/31']]);
    expect(body).toBe(roadmap());
  });

  it('writes the body as one PATCH and answers what the resource holds afterwards', async () => {
    const stub = stubGh(wrote(JSON.stringify({ number: 31, body: 'stored' })));

    const stored = await createGhRoadmapBody({ gh: stub.run }).write(31, 'sent');

    expect(stub.calls()).toEqual([['repos/{owner}/{repo}/issues/31', '-X', 'PATCH', '-f', 'body=sent']]);
    expect(stored).toBe('stored');
  });

  it('rejects naming the command and what gh wrote when the read failed', async () => {
    const stub = stubGh(failed('gh: Not Found (HTTP 404)'));

    await expect(createGhRoadmapBody({ gh: stub.run }).read(31)).rejects.toThrow(
      'gh api repos/{owner}/{repo}/issues/31 failed: gh: Not Found (HTTP 404)',
    );
  });

  it('rejects an answer whose body is not a string', async () => {
    const stub = stubGh(wrote(JSON.stringify({ number: 31, body: null })));

    await expect(createGhRoadmapBody({ gh: stub.run }).read(31)).rejects.toThrow('expected a string');
  });

  it('refuses an issue number that is no positive whole number before any command leaves', async () => {
    const stub = stubGh(wrote('{}'));

    expect(() => createGhRoadmapBody({ gh: stub.run }).read(0)).toThrow(TypeError);
    expect(stub.calls()).toEqual([]);
  });
});

describe('tickRoadmapIssue', () => {
  it('reads once, writes the ticked body once, and answers what it ticked', async () => {
    const made = storingBoard(roadmap());

    const result = await tickRoadmapIssue({ roadmap: 31, issues: [20], board: made.board });

    expect(result).toMatchObject({ roadmap: 31, status: 'ticked', ticked: [20], attempts: 1 });
    expect(made.reads()).toBe(1);
    expect(made.writes()).toEqual([tickRoadmapLines(roadmap(), [20]).body]);
  });

  it('writes nothing at all when every line is ticked already', async () => {
    const made = storingBoard(roadmap());

    const result = await tickRoadmapIssue({ roadmap: 31, issues: [19], board: made.board });

    expect(result).toMatchObject({ status: 'nothing-to-tick', already: [19], attempts: 0 });
    expect(made.writes()).toEqual([]);
  });

  it('re-reads and retries once when the write failed, ticking the body as it reads now', async () => {
    const second = `${roadmap()}\n- [ ] #40 added since`;
    const made = fakeBoard([roadmap(), second], [{ kind: 'threw', why: 'board roadmap: gh api ... failed: 502' }, stores()]);

    const result = await tickRoadmapIssue({ roadmap: 31, issues: [20], board: made.board });

    expect(result).toMatchObject({ status: 'ticked', ticked: [20], attempts: TICK_ATTEMPTS });
    expect(made.reads()).toBe(2);
    expect(made.writes()[1]).toBe(tickRoadmapLines(second, [20]).body);
    expect(made.writes()[1]).toContain('- [ ] #40 added since');
  });

  it('reads a stored body other than the one sent as an edit conflict and retries once', async () => {
    const made = fakeBoard(
      [roadmap(), roadmap()],
      [{ kind: 'stored', body: 'somebody else wrote this' }, stores()],
    );

    const result = await tickRoadmapIssue({ roadmap: 31, issues: [20], board: made.board });

    expect(result).toMatchObject({ status: 'ticked', attempts: TICK_ATTEMPTS });
    expect(made.writes()).toHaveLength(2);
  });

  it('answers nothing-to-tick when the re-read shows the line ticked by somebody else', async () => {
    const ticked = roadmap().replace('- [ ] #20', '- [x] #20');
    const made = fakeBoard([roadmap(), ticked], [{ kind: 'threw', why: 'board roadmap: 409' }, stores()]);

    const result = await tickRoadmapIssue({ roadmap: 31, issues: [20], board: made.board });

    expect(result).toMatchObject({ status: 'nothing-to-tick', already: [20], attempts: 1 });
    expect(made.writes()).toHaveLength(1);
  });

  it('gives up after the retry, naming what went wrong and writing no third time', async () => {
    const made = fakeBoard([roadmap()], [{ kind: 'threw', why: 'board roadmap: gh api ... failed: 502' }]);

    const result = await tickRoadmapIssue({ roadmap: 31, issues: [20], board: made.board });

    expect(result).toMatchObject({ status: 'failed', ticked: [], attempts: TICK_ATTEMPTS });
    expect(result.problem).toContain('502');
    expect(made.writes()).toHaveLength(TICK_ATTEMPTS);
  });

  it('answers a read that failed as failed rather than throwing', async () => {
    const board: RoadmapBody = {
      read: () => Promise.reject(new Error('board roadmap: gh api ... failed: no network')),
      write: () => Promise.reject(new Error('never')),
    };

    const result = await tickRoadmapIssue({ roadmap: 31, issues: [20], board });

    expect(result.status).toBe('failed');
    expect(result.problem).toContain('no network');
  });
});

describe('tickSentence', () => {
  const base = { roadmap: 31, ticked: [], already: [], absent: [], attempts: 0, problem: '' };

  it('names what was ticked', () => {
    expect(tickSentence({ ...base, status: 'ticked', ticked: [20, 33], attempts: 1 }))
      .toBe('Ticked #20, #33 on the roadmap, issue #31.');
  });

  it('says a line was ticked already', () => {
    expect(tickSentence({ ...base, status: 'nothing-to-tick', already: [20] }))
      .toBe('#20 is ticked on the roadmap, issue #31 already.');
  });

  it('says the roadmap carries no line for the issue', () => {
    expect(tickSentence({ ...base, status: 'nothing-to-tick', absent: [404] }))
      .toBe('the roadmap, issue #31 carries no line for #404, so nothing was ticked.');
  });

  it('names the attempts and the problem when the tick failed', () => {
    expect(tickSentence({ ...base, status: 'failed', attempts: 2, problem: 'gh said 502' }))
      .toBe('the roadmap, issue #31 was not ticked after 2 attempts: gh said 502');
  });
});
