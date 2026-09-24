/**
 * Tests for the `multiSelect` prompt (`src/cli/prompt/multi-select.ts`),
 * driven by scripted keys over a recording terminal.
 */
import type { MultiChoice, MultiGroup, MultiSelectView } from './multi-select.js';
import type { Key, Terminal } from './terminal.js';

import { describe, expect, test } from 'bun:test';

import { CommandExit } from '../command.js';

import { DISABLED_MARK, multiSelect, NO_CHOICES_TEXT, NONE_CHECKED_TEXT, renderMultiSelect } from './multi-select.js';
import { NO_MATCHES_TEXT } from './select.js';
import { INTERRUPT_EXIT_CODE, NO_TERMINAL_TEXT } from './terminal.js';

/** A terminal recording raw-mode switches and writes. */
function recordingTerminal(isTTY = true): { readonly terminal: Terminal; readonly events: string[] } {
  const events: string[] = [];
  const terminal: Terminal = {
    isTTY,
    setRawMode: (on) => {
      events.push(on
        ? 'raw on'
        : 'raw off');
    },
    write: (written) => {
      events.push(written);
    },
    onInterrupt: () => () => undefined,
    exit: () => undefined,
  };
  return { terminal, events };
}

/** The keys for typing `typed`, one per code point. */
function typing(typed: string): Key[] {
  return [...typed].map((char) => ({ name: 'char', char }));
}

/** A key source yielding `keys` and then ending. */
async function* script(keys: readonly Key[]): AsyncGenerator<Key, void, undefined> {
  for (const key of keys) yield key;
}

/** Choices whose values are their labels. */
function choicesOf(...labels: string[]): MultiChoice<string>[] {
  return labels.map((label) => ({ label, value: label }));
}

/** The text of the frame showing `view`, as the prompt writes it after the erase. */
function frame(view: MultiSelectView): string {
  return renderMultiSelect(view).join('\n');
}

/** Where a redraw's erase ends: carriage return and erase down. */
const CLEAR_DOWN = '\r\u001b[J';

/** `written` without the erase a redraw opens with. */
function withoutErase(written: string): string {
  const at = written.indexOf(CLEAR_DOWN);
  return at === -1
    ? written
    : written.slice(at + CLEAR_DOWN.length);
}

/** The last frame drawn before the answer line: the write before the final one, erase stripped. */
function lastFrame(events: readonly string[]): string {
  const writes = events.filter((event) => event !== 'raw on' && event !== 'raw off');
  return withoutErase(writes.at(-2) ?? '');
}

/** Rows of `labels`, the ones in `checked` checked. */
function rowsOf(labels: readonly string[], checked: readonly string[] = []): MultiSelectView['rows'] {
  return labels.map((label) => ({ label, checked: checked.includes(label) }));
}

const UP: Key = { name: 'up' };
const DOWN: Key = { name: 'down' };
const ENTER: Key = { name: 'enter' };
const ESCAPE: Key = { name: 'escape' };
const BACKSPACE: Key = { name: 'backspace' };
const SPACE: Key = { name: 'char', char: ' ' };
const FRUIT = choicesOf('apple', 'banana', 'cherry');

describe('multiSelect', () => {
  test('enter with nothing checked answers an empty list and names none on the answer line', async () => {
    const { terminal, events } = recordingTerminal();
    const answer = await multiSelect({ message: 'Fruit?', choices: FRUIT, keys: script([ENTER]), terminal });
    expect(answer).toEqual([]);
    expect(events).toEqual([
      'raw on',
      frame({ message: 'Fruit?', filter: '', checkedCount: 0, rows: rowsOf(['apple', 'banana', 'cherry']), highlight: 0 }),
      `\u001b[3A\r\u001b[J? Fruit? ${NONE_CHECKED_TEXT}\n`,
      'raw off',
    ]);
  });

  test('space checks the highlighted choice and enter answers the checked labels on the answer line', async () => {
    const { terminal, events } = recordingTerminal();
    const answer = await multiSelect({ message: 'm', choices: FRUIT, keys: script([SPACE, DOWN, DOWN, SPACE, ENTER]), terminal });
    expect(answer).toEqual(['apple', 'cherry']);
    expect(lastFrame(events)).toBe(frame({ message: 'm', filter: '', checkedCount: 2, rows: rowsOf(['apple', 'banana', 'cherry'], ['apple', 'cherry']), highlight: 2 }));
    expect(events.at(-2)).toBe('\u001b[3A\r\u001b[J? m apple, cherry\n');
  });

  test('a second space unchecks the choice', async () => {
    const answer = await multiSelect({ message: 'm', choices: FRUIT, keys: script([SPACE, DOWN, SPACE, UP, SPACE, ENTER]), terminal: recordingTerminal().terminal });
    expect(answer).toEqual(['banana']);
  });

  test('answers in the order of the choices, not the order they were checked in', async () => {
    const answer = await multiSelect({ message: 'm', choices: FRUIT, keys: script([UP, SPACE, UP, SPACE, UP, SPACE, ENTER]), terminal: recordingTerminal().terminal });
    expect(answer).toEqual(['apple', 'banana', 'cherry']);
  });

  test('answers the values, not the labels', async () => {
    const choices: MultiChoice<number>[] = [{ label: 'one', value: 1 }, { label: 'two', value: 2 }];
    const answer = await multiSelect({ message: 'm', choices, keys: script([DOWN, SPACE, ENTER]), terminal: recordingTerminal().terminal });
    expect(answer).toEqual([2]);
  });

  test('choices marked checked open checked and can be unchecked', async () => {
    const { terminal, events } = recordingTerminal();
    const choices: MultiChoice<string>[] = [{ label: 'a', value: 'a', checked: true }, { label: 'b', value: 'b' }, { label: 'c', value: 'c', checked: true }];
    const kept = await multiSelect({ message: 'm', choices, keys: script([ENTER]), terminal });
    expect(kept).toEqual(['a', 'c']);
    expect(events[1]).toBe(frame({ message: 'm', filter: '', checkedCount: 2, rows: rowsOf(['a', 'b', 'c'], ['a', 'c']), highlight: 0 }));
    const dropped = await multiSelect({ message: 'm', choices, keys: script([SPACE, ENTER]), terminal: recordingTerminal().terminal });
    expect(dropped).toEqual(['c']);
  });

  test('typing narrows the rows, and a space toggles rather than joining the filter', async () => {
    const { terminal, events } = recordingTerminal();
    const answer = await multiSelect({ message: 'm', choices: FRUIT, keys: script([...typing('AN'), SPACE, ENTER]), terminal });
    expect(answer).toEqual(['banana']);
    expect(lastFrame(events)).toBe(frame({ message: 'm', filter: 'AN', checkedCount: 1, rows: rowsOf(['banana'], ['banana']), highlight: 0 }));
  });

  test('a checked choice the filter hides stays checked, counted and answered', async () => {
    const { terminal, events } = recordingTerminal();
    const answer = await multiSelect({ message: 'm', choices: FRUIT, keys: script([SPACE, ...typing('ch'), SPACE, ENTER]), terminal });
    expect(answer).toEqual(['apple', 'cherry']);
    expect(lastFrame(events)).toBe(frame({ message: 'm', filter: 'ch', checkedCount: 2, rows: rowsOf(['cherry'], ['cherry']), highlight: 0 }));
  });

  test('backspace widens the filter keeping the highlight, and is a no-op when it is empty', async () => {
    const { terminal, events } = recordingTerminal();
    const keys = [BACKSPACE, ...typing('ch'), BACKSPACE, BACKSPACE, SPACE, ENTER];
    const answer = await multiSelect({ message: 'm', choices: FRUIT, keys: script(keys), terminal });
    expect(answer).toEqual(['cherry']);
    const redraws = events.filter((event) => event.includes('\u001b[J'));
    expect(redraws.length).toBe(6);
  });

  test('with no match the frame says so, space does nothing and enter still answers', async () => {
    const { terminal, events } = recordingTerminal();
    const keys = [SPACE, ...typing('zz'), SPACE, DOWN, ENTER];
    const answer = await multiSelect({ message: 'm', choices: FRUIT, keys: script(keys), terminal });
    expect(answer).toEqual(['apple']);
    const empty = frame({ message: 'm', filter: 'zz', checkedCount: 1, rows: [], highlight: -1 });
    expect(empty).toBe(`? m (1 checked) zz\n  ${NO_MATCHES_TEXT}`);
    expect(lastFrame(events)).toBe(empty);
    expect(events.at(-2)).toBe('\u001b[1A\r\u001b[J? m apple\n');
  });

  test('the window scrolls only as far as it must to keep the highlight in view', async () => {
    const { terminal, events } = recordingTerminal();
    const choices = choicesOf('a1', 'a2', 'a3', 'a4');
    const keys = [DOWN, DOWN, SPACE, UP, UP, ENTER];
    const answer = await multiSelect({ message: 'm', choices, pageSize: 2, keys: script(keys), terminal });
    expect(answer).toEqual(['a3']);
    const frames = events.slice(1, -2).map(withoutErase);
    expect(frames).toEqual([
      frame({ message: 'm', filter: '', checkedCount: 0, rows: rowsOf(['a1', 'a2']), highlight: 0 }),
      frame({ message: 'm', filter: '', checkedCount: 0, rows: rowsOf(['a1', 'a2']), highlight: 1 }),
      frame({ message: 'm', filter: '', checkedCount: 0, rows: rowsOf(['a2', 'a3']), highlight: 1 }),
      frame({ message: 'm', filter: '', checkedCount: 1, rows: rowsOf(['a2', 'a3'], ['a3']), highlight: 1 }),
      frame({ message: 'm', filter: '', checkedCount: 1, rows: rowsOf(['a2', 'a3'], ['a3']), highlight: 0 }),
      frame({ message: 'm', filter: '', checkedCount: 1, rows: rowsOf(['a1', 'a2']), highlight: 0 }),
    ]);
  });

  test('escape answers null even with choices checked, leaving the question on its line', async () => {
    const { terminal, events } = recordingTerminal();
    const answer = await multiSelect({ message: 'm', choices: FRUIT, keys: script([SPACE, ESCAPE, ENTER]), terminal });
    expect(answer).toBeNull();
    expect(events.at(-2)).toBe('\u001b[3A\r\u001b[J? m\n');
    expect(events.at(-1)).toBe('raw off');
  });

  test('keys ending before enter answer null, not an empty list', async () => {
    const { terminal, events } = recordingTerminal();
    expect(await multiSelect({ message: 'm', choices: FRUIT, keys: script([SPACE]), terminal })).toBeNull();
    expect(events.at(-1)).toBe('raw off');
  });

  test('an empty list ignores arrows and space and answers an empty list on enter', async () => {
    const { terminal, events } = recordingTerminal();
    const answer = await multiSelect({ message: 'm', choices: [], keys: script([DOWN, UP, SPACE, ENTER]), terminal });
    expect(answer).toEqual([]);
    expect(events).toEqual([
      'raw on',
      frame({ message: 'm', filter: '', checkedCount: 0, rows: [], highlight: -1 }),
      `\u001b[1A\r\u001b[J? m ${NONE_CHECKED_TEXT}\n`,
      'raw off',
    ]);
  });

  test('ctrl-c throws the interrupt exit and switches raw mode off', async () => {
    const { terminal, events } = recordingTerminal();
    const thrown = await multiSelect({ message: 'm', choices: FRUIT, keys: script([SPACE, { name: 'ctrl-c' }]), terminal })
      .catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(CommandExit);
    expect((thrown as CommandExit).exitCode).toBe(INTERRUPT_EXIT_CODE);
    expect(events.at(-1)).toBe('raw off');
  });

  test('refuses with no terminal before reading a key, naming instead', async () => {
    const { terminal, events } = recordingTerminal(false);
    let read = false;
    async function* keys(): AsyncGenerator<Key, void, undefined> {
      read = true;
      yield ENTER;
    }
    const run = multiSelect({ message: 'm', choices: FRUIT, keys: keys(), terminal, instead: 'Use --output=json.' });
    const refusal = await run.catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(CommandExit);
    expect((refusal as CommandExit).message).toContain(NO_TERMINAL_TEXT);
    expect((refusal as CommandExit).message).toContain('Use --output=json.');
    expect(read).toBe(false);
    expect(events).toEqual([]);
  });
});

describe('renderMultiSelect', () => {
  test('marks the highlighted row and each row\'s check, with the count on the first line', () => {
    const lines = renderMultiSelect({ message: 'Q', filter: 'f', checkedCount: 3, rows: rowsOf(['x', 'y'], ['y']), highlight: 1 });
    expect(lines).toEqual(['? Q (3 checked) f', '  ◯ x', '❯ ◉ y']);
  });
});

/** The frames drawn between the opening frame and the answer line, erases stripped, the opening one first. */
function framesOf(events: readonly string[]): string[] {
  return events.slice(1, -2).map(withoutErase);
}

/** A heading row. */
function heading(title: string): MultiSelectView['rows'][number] {
  return { label: title, checked: false, heading: true };
}

/** A disabled row. */
function disabledRow(label: string, reason: string): MultiSelectView['rows'][number] {
  return { label, checked: false, disabled: reason };
}

/** A grouped view of `rows`, nothing filtered. */
function groupedView(message: string, checkedCount: number, rows: MultiSelectView['rows'], highlight: number): MultiSelectView {
  return { message, filter: '', checkedCount, rows, highlight, grouped: true };
}

const A_KEY: Key = { name: 'char', char: 'a' };

/** Branches in three groups: two tickable merged, one stale beside a disabled one, and a worktree group all disabled. */
const BRANCHES: MultiGroup<string>[] = [
  { title: 'Merged', choices: choicesOf('m1', 'm2') },
  { title: 'Stale', choices: [{ label: 's1', value: 's1' }, { label: 's2', value: 's2', disabled: 'checked out' }] },
  { title: 'Worktrees', choices: [{ label: 'w1', value: 'w1', disabled: 'loop running' }] },
];

describe('multiSelect, grouped', () => {
  test('opens with headings over their choices, the highlight on the first choice and disabled rows showing their reason', async () => {
    const { terminal, events } = recordingTerminal();
    const answer = await multiSelect({ message: 'Delete?', groups: BRANCHES, keys: script([ENTER]), terminal });
    expect(answer).toEqual([]);
    const opening = groupedView('Delete?', 0, [
      heading('Merged'), ...rowsOf(['m1', 'm2']),
      heading('Stale'), ...rowsOf(['s1']), disabledRow('s2', 'checked out'),
      heading('Worktrees'), disabledRow('w1', 'loop running'),
    ], 1);
    expect(frame(opening)).toBe([
      '? Delete? (0 checked) ',
      '  Merged',
      '❯ ◯ m1',
      '  ◯ m2',
      '  Stale',
      '  ◯ s1',
      `  ${DISABLED_MARK} s2 (checked out)`,
      '  Worktrees',
      `  ${DISABLED_MARK} w1 (loop running)`,
    ].join('\n'));
    expect(events).toEqual(['raw on', frame(opening), `\u001b[8A\r\u001b[J? Delete? ${NONE_CHECKED_TEXT}\n`, 'raw off']);
  });

  test('down steps over headings onto disabled choices and wraps; up wraps from the first choice to the last', async () => {
    const { terminal, events } = recordingTerminal();
    const groups: MultiGroup<string>[] = [{ title: 'G1', choices: choicesOf('x') }, { title: 'G2', choices: [{ label: 'y', value: 'y', disabled: 'no' }] }];
    await multiSelect({ message: 'm', groups, keys: script([DOWN, DOWN, UP, ENTER]), terminal });
    const rows = [heading('G1'), ...rowsOf(['x']), heading('G2'), disabledRow('y', 'no')];
    expect(framesOf(events)).toEqual([
      frame(groupedView('m', 0, rows, 1)),
      frame(groupedView('m', 0, rows, 3)),
      frame(groupedView('m', 0, rows, 1)),
      frame(groupedView('m', 0, rows, 3)),
    ]);
  });

  test('space checks a tickable choice and does nothing on a disabled one, which is never redrawn nor answered', async () => {
    const { terminal, events } = recordingTerminal();
    const keys = [DOWN, DOWN, SPACE, DOWN, SPACE, ENTER];
    const answer = await multiSelect({ message: 'm', groups: BRANCHES, keys: script(keys), terminal });
    expect(answer).toEqual(['s1']);
    expect(events.filter((event) => event.includes('\u001b[J')).length).toBe(keys.length - 1);
  });

  test('a disabled choice marked checked opens unchecked and is not answered', async () => {
    const { terminal, events } = recordingTerminal();
    const groups: MultiGroup<string>[] = [{ title: 'G', choices: [{ label: 'on', value: 'on', checked: true }, { label: 'off', value: 'off', checked: true, disabled: 'why' }] }];
    const answer = await multiSelect({ message: 'm', groups, keys: script([ENTER]), terminal });
    expect(answer).toEqual(['on']);
    expect(events[1]).toBe(frame(groupedView('m', 1, [heading('G'), ...rowsOf(['on'], ['on']), disabledRow('off', 'why')], 1)));
  });

  test('a ticks every tickable choice of the highlighted group only, and a second a unticks them', async () => {
    const ticked = await multiSelect({ message: 'm', groups: BRANCHES, keys: script([A_KEY, ENTER]), terminal: recordingTerminal().terminal });
    expect(ticked).toEqual(['m1', 'm2']);
    const unticked = await multiSelect({ message: 'm', groups: BRANCHES, keys: script([A_KEY, A_KEY, ENTER]), terminal: recordingTerminal().terminal });
    expect(unticked).toEqual([]);
  });

  test('a on a partly checked group ticks the rest rather than unticking', async () => {
    const answer = await multiSelect({ message: 'm', groups: BRANCHES, keys: script([DOWN, SPACE, A_KEY, ENTER]), terminal: recordingTerminal().terminal });
    expect(answer).toEqual(['m1', 'm2']);
  });

  test('a with a disabled choice highlighted ticks its group\'s tickable choices, never the disabled one', async () => {
    const { terminal, events } = recordingTerminal();
    const answer = await multiSelect({ message: 'm', groups: BRANCHES, keys: script([DOWN, DOWN, DOWN, A_KEY, ENTER]), terminal });
    expect(answer).toEqual(['s1']);
    expect(lastFrame(events)).toBe(frame(groupedView('m', 1, [
      heading('Merged'), ...rowsOf(['m1', 'm2']),
      heading('Stale'), ...rowsOf(['s1'], ['s1']), disabledRow('s2', 'checked out'),
      heading('Worktrees'), disabledRow('w1', 'loop running'),
    ], 5)));
  });

  test('a in a group whose choices are all disabled changes nothing and draws nothing', async () => {
    const { terminal, events } = recordingTerminal();
    const answer = await multiSelect({ message: 'm', groups: BRANCHES, keys: script([UP, A_KEY, ENTER]), terminal });
    expect(answer).toEqual([]);
    expect(events.filter((event) => event.includes('\u001b[J')).length).toBe(2);
  });

  test('typing and backspace do not filter: nothing is redrawn and every row stays shown', async () => {
    const { terminal, events } = recordingTerminal();
    const answer = await multiSelect({ message: 'm', groups: BRANCHES, keys: script([...typing('s1'), BACKSPACE, SPACE, ENTER]), terminal });
    expect(answer).toEqual(['m1']);
    expect(framesOf(events).length).toBe(2);
    expect(lastFrame(events).split('\n').length).toBe(9);
  });

  test('the same keys filter a flat prompt, so the grouped reading above could have failed', async () => {
    const answer = await multiSelect({ message: 'm', choices: choicesOf('m1', 's1'), keys: script([...typing('s1'), SPACE, ENTER]), terminal: recordingTerminal().terminal });
    expect(answer).toEqual(['s1']);
    const flatA = await multiSelect({ message: 'm', choices: choicesOf('bb', 'ab'), keys: script([A_KEY, SPACE, ENTER]), terminal: recordingTerminal().terminal });
    expect(flatA).toEqual(['ab']);
  });

  test('answers in the order of the groups and their choices, not the order checked', async () => {
    const answer = await multiSelect({ message: 'm', groups: BRANCHES, keys: script([DOWN, DOWN, SPACE, UP, SPACE, UP, SPACE, ENTER]), terminal: recordingTerminal().terminal });
    expect(answer).toEqual(['m1', 'm2', 's1']);
  });

  test('the answer line names the checked labels', async () => {
    const { terminal, events } = recordingTerminal();
    await multiSelect({ message: 'm', groups: BRANCHES, keys: script([A_KEY, ENTER]), terminal });
    expect(events.at(-2)).toBe('\u001b[8A\r\u001b[J? m m1, m2\n');
  });

  test('a group with no choice is not shown', async () => {
    const { terminal, events } = recordingTerminal();
    const groups: MultiGroup<string>[] = [{ title: 'Empty', choices: [] }, { title: 'G', choices: choicesOf('x') }];
    await multiSelect({ message: 'm', groups, keys: script([ENTER]), terminal });
    expect(events[1]).toBe(frame(groupedView('m', 0, [heading('G'), ...rowsOf(['x'])], 1)));
  });

  test('with no choice in any group the frame says so, and arrows, space and a do nothing', async () => {
    const { terminal, events } = recordingTerminal();
    const groups: MultiGroup<string>[] = [{ title: 'Empty', choices: [] }];
    const answer = await multiSelect({ message: 'm', groups, keys: script([DOWN, UP, SPACE, A_KEY, ENTER]), terminal });
    expect(answer).toEqual([]);
    expect(events).toEqual(['raw on', `? m (0 checked) \n  ${NO_CHOICES_TEXT}`, `\u001b[1A\r\u001b[J? m ${NONE_CHECKED_TEXT}\n`, 'raw off']);
  });

  test('the window counts headings as rows and brings a group\'s heading back into view when moving up to its first choice', async () => {
    const { terminal, events } = recordingTerminal();
    const groups: MultiGroup<string>[] = [{ title: 'G1', choices: choicesOf('a', 'b') }, { title: 'G2', choices: choicesOf('c') }];
    await multiSelect({ message: 'm', groups, pageSize: 2, keys: script([DOWN, DOWN, UP, UP, ENTER]), terminal });
    expect(framesOf(events)).toEqual([
      frame(groupedView('m', 0, [heading('G1'), ...rowsOf(['a'])], 1)),
      frame(groupedView('m', 0, rowsOf(['a', 'b']), 1)),
      frame(groupedView('m', 0, [heading('G2'), ...rowsOf(['c'])], 1)),
      frame(groupedView('m', 0, rowsOf(['b']).concat(heading('G2')), 0)),
      frame(groupedView('m', 0, [heading('G1'), ...rowsOf(['a'])], 1)),
    ]);
  });

  test('a page of one row shows only the highlighted choice, never a heading in its place', async () => {
    const { terminal, events } = recordingTerminal();
    const groups: MultiGroup<string>[] = [{ title: 'G1', choices: choicesOf('a') }, { title: 'G2', choices: choicesOf('b') }];
    await multiSelect({ message: 'm', groups, pageSize: 1, keys: script([DOWN, UP, ENTER]), terminal });
    expect(framesOf(events)).toEqual([
      frame(groupedView('m', 0, [heading('G1')], 1)),
      frame(groupedView('m', 0, rowsOf(['b']), 0)),
      frame(groupedView('m', 0, rowsOf(['a']), 0)),
    ]);
  });

  test('escape answers null with a group checked', async () => {
    const { terminal, events } = recordingTerminal();
    expect(await multiSelect({ message: 'm', groups: BRANCHES, keys: script([A_KEY, ESCAPE]), terminal })).toBeNull();
    expect(events.at(-2)).toBe('\u001b[8A\r\u001b[J? m\n');
  });

  test('refuses with no terminal before reading a key', async () => {
    const { terminal, events } = recordingTerminal(false);
    const refusal = await multiSelect({ message: 'm', groups: BRANCHES, keys: script([ENTER]), terminal }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(CommandExit);
    expect(events).toEqual([]);
  });
});

describe('renderMultiSelect, grouped rows', () => {
  test('draws a heading under the marks\' column and a disabled row with its mark and reason', () => {
    const lines = renderMultiSelect(groupedView('Q', 0, [heading('H'), disabledRow('x', 'r')], 1));
    expect(lines).toEqual(['? Q (0 checked) ', '  H', `❯ ${DISABLED_MARK} x (r)`]);
  });
});
