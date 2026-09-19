/**
 * Tests for the board readiness checks (`src/board/readiness.ts`): the
 * `spec:ready` label, every template heading, the two list sections, the
 * placeholders, the heading each gap is named with, the refusal, and the
 * warning the two list sections are read on their own for.
 *
 * Both halves are pure, so there is no seam to plant: a label list in
 * and a boolean out, a body in and a list of gaps out. No case touches
 * a file, the board or a home directory.
 *
 * A gate like this passes for the wrong reason in two opposite ways, and
 * both are asserted against:
 *
 *  - A gate that refuses EVERYTHING satisfies every positive case here.
 *    So the complete body in {@link bodyWith} is asserted to answer NO
 *    gap, and every positive case is built by breaking exactly one
 *    thing in it — the same body, one heading dropped, one section
 *    emptied, one word changed.
 *  - A gate that refuses NOTHING satisfies every negative case. So each
 *    exemption — a fenced placeholder, a backticked one, a lower-case
 *    one, a `rafa:` marker comment, a heading quoted in a fence — sits
 *    beside the body that differs only in the part the rule reads.
 *
 * The self-reference is a case of its own. This module and its spec
 * quote `TBD`, `TODO` and `???` while describing the check, so a body
 * shaped like this repository's own documentation is asserted to pass;
 * a gate that could not read a spec about itself is one nobody can
 * document.
 *
 * Twelve mutations of `readiness.ts` were driven against this file on
 * 2026-09-19, one at a time, the module restored from a scratch copy
 * and verified with `shasum -c` after each. Those runs are the file as
 * it stood BEFORE the list-section group below was added, 35 pass
 * either side, and each count is that run's own:
 *
 *  - `hasSpecReadyLabel` answering true always, so every issue is
 *    ready: 3 fail, the whole label group.
 *  - `hasSpecReadyLabel` answering false always: the same 3.
 *  - `hasContent` answering true always, so no section is empty: 4
 *    fail, the three emptiness cases and the gap ordering.
 *  - `hasListItem` answering true always: 5 fail, the three list cases,
 *    the gap ordering and the refusal sentence.
 *  - the fence skip dropped from the placeholder scan: 2 fail, the
 *    fenced placeholder and the documentation-shaped body.
 *  - the code-span strip dropped: 2 fail, the backticked placeholder
 *    and the same documentation-shaped body. The two exemptions are
 *    written as separate cases because neither mutation sees the
 *    other's.
 *  - the `rafa:` marker exemption dropped: 1 fail.
 *  - a section's own lines read where the section's lines belong, so a
 *    heading whose content sits in a subsection reads empty: 1 fail.
 *  - the placeholder words matched case-insensitively: 1 fail, the
 *    lower-case control.
 *  - the heading normalisation dropped for an exact comparison: 1 fail,
 *    the heading written at another level, in another case and in
 *    emphasis.
 *  - the line number taken as `index` rather than `index + 1`: 2 fail,
 *    the empty heading's line and the placeholder's.
 *  - an empty section reporting its placeholders as well: 1 fail, the
 *    case that holds the two apart.
 *  - the preamble dropped from the spans: 1 fail, the placeholder
 *    before the first heading.
 */
import type { ReadinessGap } from './readiness.js';

import { describe, expect, it } from 'bun:test';

import { CommandExit } from '../cli/command.js';

import {
  findListSectionGaps,
  findReadinessGaps,
  hasSpecReadyLabel,
  listSectionWarning,
  LIST_HEADINGS,
  PLACEHOLDER_TOKENS,
  PREAMBLE_HEADING,
  READINESS_REFUSAL_EXIT,
  readinessRefusalMessage,
  requireCompleteSpec,
  requireSpecReadyLabel,
  SPEC_READY_LABEL,
  TEMPLATE_HEADINGS,
} from './readiness.js';

/** A complete spec, one entry per template heading, in template order. */
const SECTIONS: readonly (readonly [string, string])[] = [
  ['What you get', 'A gate that refuses a spec nobody has finished.'],
  ['Starting position', 'The gate reads the label and nothing else.'],
  ['Design', 'Two pure functions over the labels and the body.'],
  ['What can go wrong', 'A check that refuses a spec about itself.'],
  ['Tasks the plan must carry', '- add the module\n- add its tests'],
  ['Definition of done', '- a body with an empty section is refused'],
];

/**
 * The complete body, with `changes` applied by heading: a string
 * replaces that section's content, and null drops the heading whole.
 */
function bodyWith(changes: Readonly<Record<string, string | null>> = {}): string {
  const parts: string[] = [];

  for (const [heading, content] of SECTIONS) {
    const given = changes[heading];
    if (given === null) continue;
    parts.push(`## ${heading}\n\n${given ?? content}\n`);
  }

  return parts.join('\n');
}

/** Every gap in `body` as `<kind> <heading>`, in the order it answers them. */
function gapsIn(body: string): readonly string[] {
  return findReadinessGaps(body).map((gap) => `${gap.kind} ${gap.heading}`);
}

/** The one gap in `body`; fails loudly when it holds none or several. */
function onlyGap(body: string): ReadinessGap {
  const gaps = findReadinessGaps(body);
  expect(gaps).toHaveLength(1);
  return gaps[0] as ReadinessGap;
}

describe('the spec:ready label', () => {
  it('is found among the labels an issue carries, and its absence is not', () => {
    expect(hasSpecReadyLabel(['type:spec', SPEC_READY_LABEL])).toBe(true);
    expect(hasSpecReadyLabel(['type:spec', 'spec:needs-work'])).toBe(false);
    expect(hasSpecReadyLabel([])).toBe(false);
  });

  it('is found whatever case and padding the label carries', () => {
    expect(hasSpecReadyLabel([' Spec:Ready '])).toBe(true);
    expect(hasSpecReadyLabel(['spec:readyish'])).toBe(false);
  });

  it('refuses an unlabelled issue with the sentence the spec names, and exits 2', () => {
    expect(requireSpecReadyLabel(20, [SPEC_READY_LABEL])).toBeUndefined();

    let thrown: unknown;
    try {
      requireSpecReadyLabel(20, ['type:spec']);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CommandExit);
    expect((thrown as CommandExit).message).toBe('issue #20 is not marked spec:ready');
    expect((thrown as CommandExit).exitCode).toBe(READINESS_REFUSAL_EXIT);
    expect((thrown as CommandExit).exitCode).toBe(2);
  });
});

describe('a complete spec', () => {
  it('answers no gap at all, so a gate refusing everything fails here', () => {
    expect(findReadinessGaps(bodyWith())).toEqual([]);
  });

  it('answers no gap with a title above it and extra sections beside it', () => {
    const body = `# rafa-20: the readiness gate\n\n${bodyWith()}\n## Notes\n\nNothing pending.\n`;
    expect(findReadinessGaps(body)).toEqual([]);
  });

  it('is let through by the refusal, which throws for a body with a gap', () => {
    expect(requireCompleteSpec('issue #20', bodyWith())).toBeUndefined();
    expect(() => requireCompleteSpec('issue #20', bodyWith({ Design: null }))).toThrow(CommandExit);
  });
});

describe('a template heading', () => {
  it('is reported missing by name, one gap per heading the body drops', () => {
    expect(gapsIn(bodyWith({ Design: null }))).toEqual(['missing-heading Design']);
    expect(gapsIn(bodyWith({ Design: null, 'What can go wrong': null })))
      .toEqual(['missing-heading Design', 'missing-heading What can go wrong']);
  });

  it('is reported missing for every heading when the body carries none', () => {
    expect(gapsIn('Just a paragraph about the work.')).toEqual(
      TEMPLATE_HEADINGS.map((heading) => `missing-heading ${heading}`),
    );
  });

  it('is matched at any level, in any case, and through emphasis', () => {
    const body = bodyWith({ Design: null, 'Definition of done': null })
      + '\n### **design**\n\nTwo pure functions.\n\n# DEFINITION OF DONE:\n\n- it refuses\n';
    expect(findReadinessGaps(body)).toEqual([]);
  });

  it('is not matched inside a fenced block, where the same heading outside one is', () => {
    const quoted = ['```markdown', '## Design', '', 'Two pure functions.', '```'].join('\n');
    expect(gapsIn(bodyWith({ Design: null }) + quoted)).toEqual(['missing-heading Design']);
    expect(findReadinessGaps(bodyWith({ Design: null }) + '\n## Design\n\nTwo pure functions.\n')).toEqual([]);
  });

  it('is reported empty when nothing sits under it, naming its line', () => {
    const gap = onlyGap(bodyWith({ 'What can go wrong': '' }));
    expect(gap.kind).toBe('empty-heading');
    expect(gap.heading).toBe('What can go wrong');
    const lines = bodyWith().split('\n');
    expect(gap.line).toBe(lines.indexOf('## What can go wrong') + 1);
  });

  it('is not empty when its content sits in a subsection under it', () => {
    expect(findReadinessGaps(bodyWith({ Design: '### Approach\n\nTwo pure functions.' }))).toEqual([]);
    expect(gapsIn(bodyWith({ Design: '### Approach\n' }))).toEqual(['empty-heading Design']);
  });

  it('is not empty when it holds a fenced block and nothing else', () => {
    expect(findReadinessGaps(bodyWith({ Design: '```ts\nconst gate = true;\n```' }))).toEqual([]);
  });
});

describe('a required list section', () => {
  it('is reported for prose alone, where the same section with a bullet is not', () => {
    expect(gapsIn(bodyWith({ 'Definition of done': 'The gate refuses an unfinished spec.' })))
      .toEqual(['no-list-item Definition of done']);
    expect(findReadinessGaps(bodyWith({ 'Definition of done': '- the gate refuses it' }))).toEqual([]);
  });

  it('is satisfied by a numbered item and by a task-list box', () => {
    expect(findReadinessGaps(bodyWith({ 'Tasks the plan must carry': '1. add the module' }))).toEqual([]);
    expect(findReadinessGaps(bodyWith({ 'Tasks the plan must carry': '- [ ] add the module' }))).toEqual([]);
  });

  it('is not satisfied by a list quoted in a fenced block, where one outside it is', () => {
    const fenced = '```markdown\n- add the module\n```';
    expect(gapsIn(bodyWith({ 'Tasks the plan must carry': fenced })))
      .toEqual(['no-list-item Tasks the plan must carry']);
    expect(findReadinessGaps(bodyWith({ 'Tasks the plan must carry': `${fenced}\n\n- add the module` })))
      .toEqual([]);
  });

  it('is asked of both headings the spec names, and of no other', () => {
    expect(LIST_HEADINGS).toEqual(['Tasks the plan must carry', 'Definition of done']);
    expect(gapsIn(bodyWith({ 'Tasks the plan must carry': 'Prose.', 'Definition of done': 'Prose.' })))
      .toEqual(['no-list-item Tasks the plan must carry', 'no-list-item Definition of done']);
    expect(findReadinessGaps(bodyWith({ Design: 'Prose, with no list in it at all.' }))).toEqual([]);
  });
});

describe('a placeholder', () => {
  it('is found for each word the spec names, so a word without a shape fails here', () => {
    for (const token of PLACEHOLDER_TOKENS) {
      expect(gapsIn(bodyWith({ Design: `it says ${token} here` }))).toEqual(['placeholder Design']);
    }
  });

  it('is named with the heading holding it, whichever section that is', () => {
    expect(gapsIn(bodyWith({ 'Starting position': 'TODO: measure it' }))).toEqual(['placeholder Starting position']);
    expect(gapsIn(bodyWith({ 'What can go wrong': 'who knows ???' }))).toEqual(['placeholder What can go wrong']);
  });

  it('names the line it sits on, counting from 1', () => {
    const body = '## Design\n\nfirst\nsecond\nTODO finish this\n';
    const gap = findReadinessGaps(body).find((found) => found.kind === 'placeholder');
    expect(gap?.line).toBe(5);
    expect(gap?.what).toBe('holds the placeholder TODO on line 5');
  });

  it('is not found in lower case, where the upper-case form is', () => {
    expect(findReadinessGaps(bodyWith({ Design: 'the todo list stays where it is' }))).toEqual([]);
    expect(gapsIn(bodyWith({ Design: 'the TODO stays where it is' }))).toEqual(['placeholder Design']);
  });

  it('is not found inside an inline code span, where the bare word is', () => {
    expect(findReadinessGaps(bodyWith({ Design: 'it refuses a surviving `TODO` or `TBD`' }))).toEqual([]);
    expect(gapsIn(bodyWith({ Design: 'it refuses a surviving TODO' }))).toEqual(['placeholder Design']);
  });

  it('is not found inside a fenced block, where the same line outside one is', () => {
    expect(findReadinessGaps(bodyWith({ Design: '```text\nTBD\n```' }))).toEqual([]);
    expect(gapsIn(bodyWith({ Design: 'TBD' }))).toEqual(['placeholder Design']);
  });

  it('is found as a whole word only, so a word carrying one is not a gap', () => {
    expect(findReadinessGaps(bodyWith({ Design: 'the TODOS module and the TBDX flag' }))).toEqual([]);
  });

  it('is found before the first heading, named as the opening', () => {
    const gaps = findReadinessGaps(`TODO write the spec\n\n${bodyWith()}`);
    expect(gaps.map((gap) => `${gap.kind} ${gap.heading}`)).toEqual([`placeholder ${PREAMBLE_HEADING}`]);
  });

  it('is found once per word on a line carrying two', () => {
    expect(gapsIn(bodyWith({ Design: 'TBD, and TODO' }))).toEqual(['placeholder Design', 'placeholder Design']);
  });
});

describe('a surviving template comment', () => {
  it('is a gap wherever it sits, named with its line and its heading', () => {
    const gap = onlyGap(bodyWith({ Design: 'Two pure functions.\n<!-- say what changes -->' }));
    expect(gap.kind).toBe('placeholder');
    expect(gap.heading).toBe('Design');
    expect(gap.what).toContain('an unfilled template comment on line');
  });

  it('is reported once for a comment spanning several lines', () => {
    const comment = '<!-- say what changes,\nand what it is measured by -->';
    expect(gapsIn(bodyWith({ Design: `Two pure functions.\n${comment}` }))).toEqual(['placeholder Design']);
  });

  it('is not reported for a comment rafa wrote itself, where a plain one is', () => {
    const marker = 'Two pure functions.\n<!-- rafa:spec-review v1 -->';
    expect(findReadinessGaps(bodyWith({ Design: marker }))).toEqual([]);
    expect(gapsIn(bodyWith({ Design: 'Two pure functions.\n<!-- fill this in -->' })))
      .toEqual(['placeholder Design']);
  });

  it('leaves a section holding nothing else reported empty and not twice', () => {
    expect(gapsIn(bodyWith({ Design: '<!-- say what changes -->' }))).toEqual(['empty-heading Design']);
  });
});

describe('a spec written about this check', () => {
  it('passes, quoting every placeholder word and the template itself', () => {
    const body = bodyWith({
      Design: [
        'No placeholder survives (`TBD`, `TODO`, `???`, an unfilled comment).',
        '',
        '```markdown',
        '## Design',
        '',
        'TODO: say what changes',
        '```',
      ].join('\n'),
    });
    expect(findReadinessGaps(body)).toEqual([]);
  });
});

describe('the order the gaps answer in', () => {
  it('puts the missing headings first in template order, then the body order', () => {
    const body = bodyWith({
      'What you get': null,
      'Starting position': 'TODO measure it',
      Design: '',
      'Definition of done': 'Prose alone.',
    });

    expect(gapsIn(body)).toEqual([
      'missing-heading What you get',
      'placeholder Starting position',
      'empty-heading Design',
      'no-list-item Definition of done',
    ]);
  });
});

describe('the refusal sentence', () => {
  const body = bodyWith({ Design: null, 'Definition of done': 'Prose alone.' });

  it('names the source, each gap with its heading, and what to do', () => {
    const message = readinessRefusalMessage('issue #20', findReadinessGaps(body));
    expect(message).toContain('issue #20');
    expect(message).toContain('"Design" is missing');
    expect(message).toContain('"Definition of done" holds no list item');
    expect(message).toContain('fill each gap');
  });

  it('refuses to be spelled for a body with no gap', () => {
    expect(() => readinessRefusalMessage('issue #20', [])).toThrow(TypeError);
    expect(readinessRefusalMessage('.specs/rafa-20.md', findReadinessGaps(body)))
      .toContain('.specs/rafa-20.md');
  });

  it('is what the refusal throws, with the exit code the spec names', () => {
    let thrown: unknown;
    try {
      requireCompleteSpec('issue #20', body);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CommandExit);
    expect((thrown as CommandExit).exitCode).toBe(2);
    expect((thrown as CommandExit).message).toBe(readinessRefusalMessage('issue #20', findReadinessGaps(body)));
  });
});

describe('the two list sections read on their own', () => {
  it('answers nothing for a body whose two sections both hold an item', () => {
    expect(findListSectionGaps(bodyWith())).toEqual([]);
  });

  it('answers each of the two missing, empty or itemless, and only those', () => {
    const body = bodyWith({
      Design: null,
      'Tasks the plan must carry': null,
      'Definition of done': 'Prose alone, and no item.',
    });

    expect(findListSectionGaps(body).map((gap) => `${gap.kind} ${gap.heading}`)).toEqual([
      'missing-heading Tasks the plan must carry',
      'no-list-item Definition of done',
    ]);
    expect(findListSectionGaps(bodyWith({ 'Definition of done': '' })).map((gap) => gap.kind))
      .toEqual(['empty-heading']);
  });

  it('leaves a placeholder under a filled section out, where the refusal keeps it', () => {
    const body = bodyWith({ 'Definition of done': '- the gate refuses TODO bodies' });

    expect(findListSectionGaps(body)).toEqual([]);
    expect(findReadinessGaps(body).map((gap) => gap.kind)).toEqual(['placeholder']);
  });

  it('is warned about naming the source, each heading and what to do', () => {
    const body = bodyWith({ 'Tasks the plan must carry': null, 'Definition of done': 'Prose alone.' });
    const message = listSectionWarning('issue #20', findListSectionGaps(body));

    expect(message).toContain('issue #20');
    expect(message).toContain('"Tasks the plan must carry" is missing');
    expect(message).toContain('"Definition of done" holds no list item');
    expect(message).toContain('fill them in and rerun');
  });

  it('refuses to be spelled for a body whose lists are filled', () => {
    expect(() => listSectionWarning('issue #20', [])).toThrow(TypeError);
  });
});
