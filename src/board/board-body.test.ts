/**
 * Tests for the board body reader (`src/board/board-body.ts`): the
 * checklist, the `Owner:` handle, the `Owns:` folders and the problems a
 * malformed line answers.
 *
 * Every case is a pure call over a literal body; the module spawns
 * nothing and opens nothing.
 *
 * ## The controls
 *
 * Three readings could pass while wrong, so each is paired with one that
 * must read the other way:
 *
 *  - The malformed owners are read beside the two well-formed shapes, so
 *    a reader answering null always fails the control.
 *  - The rejected folders are read beside kept ones on the same line, so
 *    a reader that dropped the whole line, or kept every entry, fails.
 *  - The full body must carry no problem at all, so a reader that always
 *    reported a line passes no malformed case alone.
 */
import { describe, expect, it } from 'bun:test';

import {
  boardBodyProblemMessage,
  normaliseFolder,
  readBoardBody,
} from './board-body.js';
import { parseRoadmapBody } from './roadmap.js';

/** A body carrying every part, as the module note shows it. */
const FULL = [
  'Owner: @open-tomato/loop',
  'Owns: src/board/, ./src/commands',
  '',
  '- [ ] #252 epics and boards',
  '- [x] #260 the release epic',
].join('\n');

describe('readBoardBody', () => {
  it('reads the checklist, owner and folders of a full body and reports no problem', () => {
    const read = readBoardBody(FULL);

    expect(read.owner).toBe('@open-tomato/loop');
    expect(read.owns).toEqual(['src/board', 'src/commands']);
    expect(read.lines.map((line) => [line.issue, line.ticked, line.why])).toEqual([
      [252, false, 'epics and boards'],
      [260, true, 'the release epic'],
    ]);
    expect(read.problems).toEqual([]);
  });

  it('answers the checklist exactly as parseRoadmapBody reads it', () => {
    const body = [
      '- [ ] #1 first',
      '```markdown',
      '- [ ] #99 an example',
      '```',
      '- [ ] #2',
    ].join('\n');

    expect(readBoardBody(body).lines).toEqual(parseRoadmapBody(body));
    expect(readBoardBody(body).lines.map((line) => line.issue)).toEqual([1, 2]);
  });

  it('reads a body with neither field as no owner and no folders, with no problem', () => {
    const read = readBoardBody('- [ ] #7 the only epic');

    expect(read.owner).toBeNull();
    expect(read.owns).toEqual([]);
    expect(read.problems).toEqual([]);
  });

  it('never throws on an empty body', () => {
    expect(readBoardBody('')).toEqual({ lines: [], owner: null, owns: [], problems: [] });
  });
});

describe('the Owner: line', () => {
  it.each([
    ['Owner: @marcos', '@marcos'],
    ['Owner: @open-tomato/loop', '@open-tomato/loop'],
    ['Owner: `@org/team_a.b`', '@org/team_a.b'],
    ['- **Owner:** @a-b', '@a-b'],
    ['owner:@x', '@x'],
  ])('reads %p as %p', (line, handle) => {
    const read = readBoardBody(line);

    expect(read.owner).toBe(handle);
    expect(read.problems).toEqual([]);
  });

  it.each([
    ['Owner: marcos'],
    ['Owner: @a @b'],
    ['Owner: @-leading'],
    ['Owner: @trailing-'],
    ['Owner: @double--hyphen'],
    ['Owner: @org/'],
    ['Owner: @org/team/extra'],
    ['Owner: @' + 'a'.repeat(40)],
    ['Owner:'],
  ])('reports %p as malformed and reads no owner', (line) => {
    const read = readBoardBody(`intro\n${line}`);

    expect(read.owner).toBeNull();
    expect(read.problems).toEqual([{
      kind: 'malformed-owner',
      line: 2,
      text: line.slice(line.indexOf(':') + 1).trim(),
      rejected: [],
    }]);
  });

  it('accepts a 39-character login, the length GitHub allows', () => {
    expect(readBoardBody(`Owner: @${'a'.repeat(39)}`).owner).toBe(`@${'a'.repeat(39)}`);
  });

  it('reads the first Owner: line and leaves a second alone', () => {
    expect(readBoardBody('Owner: @first\nOwner: not a handle').owner).toBe('@first');
    expect(readBoardBody('Owner: @first\nOwner: not a handle').problems).toEqual([]);
  });

  it('skips an Owner: line inside a fence', () => {
    const read = readBoardBody('```\nOwner: @example\n```\nOwner: @real');

    expect(read.owner).toBe('@real');
  });
});

describe('the Owns: line', () => {
  it('splits on commas and whitespace, takes backticks off, and dedupes after normalising', () => {
    const read = readBoardBody('Owns: `src/a/`, src/b\tsrc/c ,, ./src/a  src/b/');

    expect(read.owns).toEqual(['src/a', 'src/b', 'src/c']);
    expect(read.problems).toEqual([]);
  });

  it('reads an empty Owns: line as no folders and no problem', () => {
    const read = readBoardBody('Owns:   ');

    expect(read.owns).toEqual([]);
    expect(read.problems).toEqual([]);
  });

  it('keeps the readable folders and names the rejected ones in one problem', () => {
    const read = readBoardBody('Owner: @org/team\nOwns: src/board, /etc, ../up, ./, ., docs/../x, lib/');

    expect(read.owns).toEqual(['src/board', 'lib']);
    expect(read.owner).toBe('@org/team');
    expect(read.problems).toEqual([{
      kind: 'malformed-owns',
      line: 2,
      text: 'src/board, /etc, ../up, ./, ., docs/../x, lib/',
      rejected: ['/etc', '../up', './', '.', 'docs/../x'],
    }]);
  });

  it('lists the owner problem before the folders problem', () => {
    const read = readBoardBody('Owns: /abs\nOwner: nobody');

    expect(read.problems.map((problem) => problem.kind)).toEqual(['malformed-owner', 'malformed-owns']);
  });
});

describe('normaliseFolder', () => {
  it.each([
    ['src/board', 'src/board'],
    ['src/board/', 'src/board'],
    ['./src/board', 'src/board'],
    ['././src//', 'src'],
    ['./', ''],
    ['src/./x', 'src/./x'],
  ])('normalises %p to %p', (folder, expected) => {
    expect(normaliseFolder(folder)).toBe(expected);
  });
});

describe('boardBodyProblemMessage', () => {
  it('names the board, line and text of a malformed owner', () => {
    const [problem] = readBoardBody('\nOwner: marcos').problems;
    if (problem === undefined) throw new Error('expected a problem');

    expect(boardBodyProblemMessage(245, problem)).toBe(
      'board #245 has an "Owner:" line on line 2 reading "marcos", which is not one @login or @org/team handle;'
      + ' it is read as having no owner until the line is fixed',
    );
  });

  it('names every rejected folder of a malformed Owns: line', () => {
    const [problem] = readBoardBody('Owns: src, /etc, ../up').problems;
    if (problem === undefined) throw new Error('expected a problem');

    expect(boardBodyProblemMessage(9, problem)).toBe(
      'board #9 has an "Owns:" line on line 1 naming "/etc", "../up", which is not a folder inside the repository;'
      + ' name folders relative to the repository root, such as src/board',
    );
  });
});
