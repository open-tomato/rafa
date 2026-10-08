/**
 * Tests for reading the `rafa:decision` block a `--continue` decision
 * session ends with. Every unreadable shape is held to `stop` with a
 * reason naming why, and each sits beside a readable control of the
 * same strategy, so a parser that read everything as `stop` fails here.
 */
import { describe, expect, it } from 'bun:test';

import { readRafaBlocks } from '../plan/blocks.js';

import { UNREADABLE_PREFIX, parseDecision } from './decision-parse.js';
import { DECISION_PROMPT_FILE, readBundledFile } from './decision-prompt.js';

/** A session output ending with one `rafa:decision` block holding `body`. */
function output(body: string): string {
  return `I read the plan and the report.\n\n\`\`\`rafa:decision\n${body}\n\`\`\`\n`;
}

/** The reason a refusal reads, given why. */
function unreadable(why: string): string {
  return `${UNREADABLE_PREFIX}${why}`;
}

describe('the four strategies', () => {
  it('reads retry with its approach', () => {
    expect(parseDecision(output('strategy: retry\nreason: "The wait is backgrounded."\napproach: "Run it in the foreground."'))).toEqual({
      strategy: 'retry',
      reason: 'The wait is backgrounded.',
      approach: 'Run it in the foreground.',
    });
  });

  it('reads stop with its reason', () => {
    expect(parseDecision(output('strategy: stop\nreason: "The task needs a design decision."'))).toEqual({
      strategy: 'stop',
      reason: 'The task needs a design decision.',
    });
  });

  it('reads jump with its reason', () => {
    expect(parseDecision(output('strategy: jump\nreason: "A person writes .env.local."'))).toEqual({
      strategy: 'jump',
      reason: 'A person writes .env.local.',
    });
  });

  it('reads defer with the line it waits on', () => {
    expect(parseDecision(output('strategy: defer\nreason: "Line 15 writes the helper."\nafter: 15'))).toEqual({
      strategy: 'defer',
      reason: 'Line 15 writes the helper.',
      after: 15,
    });
  });

  it('trims the text values and drops a key another strategy carries', () => {
    expect(parseDecision(output('strategy: jump\nreason: "  Gate.  "\napproach: "unused"\nafter: 3\nnote: "kept out"'))).toEqual({
      strategy: 'jump',
      reason: 'Gate.',
    });
  });
});

describe('an unreadable decision reads as stop', () => {
  it('when the output holds no block', () => {
    expect(parseDecision('I think the task should be jumped.')).toEqual({
      strategy: 'stop',
      reason: unreadable('the output holds no rafa:decision block'),
    });
  });

  it('when the block of another kind is the only one', () => {
    expect(parseDecision('```rafa:report\nstatus: done\n```\n').strategy).toBe('stop');
  });

  it('when the last block is never closed', () => {
    expect(parseDecision('```rafa:decision\nstrategy: jump\nreason: "x"\n')).toEqual({
      strategy: 'stop',
      reason: unreadable('the rafa:decision block at line 1 is never closed'),
    });
  });

  it('when the body is not YAML', () => {
    const decision = parseDecision(output('strategy: jump\nreason: "a: b'));

    expect(decision.strategy).toBe('stop');
    expect(decision.reason).toStartWith(unreadable('the rafa:decision block at line 3 is not valid YAML ('));
  });

  it.each([
    ['a list', '- strategy: jump'],
    ['"jump"', 'jump'],
    ['nothing', ''],
  ])('when the body is %s rather than a mapping', (shown, body) => {
    expect(parseDecision(output(body))).toEqual({
      strategy: 'stop',
      reason: unreadable(`the rafa:decision block at line 3 holds ${shown}, not a mapping`),
    });
  });

  it.each([
    ['no strategy', 'reason: "x"', 'strategy is missing'],
    ['an unknown strategy', 'strategy: skip\nreason: "x"', 'strategy is "skip", expected one of: retry, stop, jump, defer'],
    ['a strategy in capitals', 'strategy: Jump\nreason: "x"', 'strategy is "Jump", expected one of: retry, stop, jump, defer'],
    ['a list for a strategy', 'strategy: [jump]\nreason: "x"', 'strategy is a list, expected one of: retry, stop, jump, defer'],
    ['no reason', 'strategy: jump', 'reason is missing'],
    ['a blank reason', 'strategy: jump\nreason: "  "', 'reason is blank'],
    ['a number for a reason', 'strategy: jump\nreason: 4', 'reason is the number 4, expected text'],
    ['retry without an approach', 'strategy: retry\nreason: "x"', 'approach is missing, and retry needs one'],
    ['retry with a blank approach', 'strategy: retry\nreason: "x"\napproach: ""', 'approach is blank, and retry needs one'],
    ['defer without after', 'strategy: defer\nreason: "x"', 'after is missing, and defer needs one'],
    ['defer after line 0', 'strategy: defer\nreason: "x"\nafter: 0', 'after is the number 0, expected a line number from 1'],
    ['defer after a negative line', 'strategy: defer\nreason: "x"\nafter: -2', 'after is the number -2, expected a line number from 1'],
    ['defer after a fraction', 'strategy: defer\nreason: "x"\nafter: 1.5', 'after is the number 1.5, expected a line number from 1'],
    ['defer after a quoted line', 'strategy: defer\nreason: "x"\nafter: "12"', 'after is "12", expected a line number from 1'],
  ])('when it carries %s', (_name, body, why) => {
    expect(parseDecision(output(body))).toEqual({ strategy: 'stop', reason: unreadable(why) });
  });
});

describe('which block counts', () => {
  it('reads the last of two blocks', () => {
    const text = `${output('strategy: stop\nreason: "draft"')}\nOn reflection:\n\n${output('strategy: jump\nreason: "final"')}`;

    expect(parseDecision(text)).toEqual({ strategy: 'jump', reason: 'final' });
  });

  it('reads no earlier block in place of an unreadable last one', () => {
    const text = `${output('strategy: jump\nreason: "draft"')}\n${output('strategy: skip\nreason: "final"')}`;

    expect(parseDecision(text)).toEqual({
      strategy: 'stop',
      reason: unreadable('strategy is "skip", expected one of: retry, stop, jump, defer'),
    });
  });

  it('reads past a quoted fence that does not open its line', () => {
    const text = `The format is \`\`\`rafa:decision ... \`\`\`.\n\n${output('strategy: jump\nreason: "x"')}`;

    expect(parseDecision(text)).toEqual({ strategy: 'jump', reason: 'x' });
  });
});

describe('the contract\'s own examples', () => {
  it('read as the decisions they show, none of them a stop', () => {
    const prompt = readBundledFile(DECISION_PROMPT_FILE, import.meta.dir);
    const examples = readRafaBlocks(prompt).filter((block) => block.kind === 'decision');

    // The retry example sits in the contract's retry section, the jump one in its no-retry section.
    expect(examples.map((block) => parseDecision(`\`\`\`rafa:decision\n${block.body}\n\`\`\``).strategy)).toEqual(['retry', 'jump', 'defer']);
  });
});
