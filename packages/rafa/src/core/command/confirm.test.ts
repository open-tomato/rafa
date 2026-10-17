/**
 * Tests for the line prompter (`confirm.ts`) over streams of its own.
 *
 * Each case writes to a `PassThrough` and reads back what the prompter
 * wrote; the end of input is the stream's `end`, and the case for a line
 * typed before it is asked for waits one turn of the event loop so
 * readline has read it.
 *
 * The lazy prompter's cases drive a scripted prompter that counts how
 * often it was opened, asked and closed, so none reads a stream.
 */
import type { Prompter } from './confirm.js';

import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'bun:test';

import { createLinePrompter, lazyPrompter } from './confirm.js';

/** A prompter over streams of its own, and what it has written so far. */
function overStreams(): { prompter: Prompter; input: PassThrough; written: () => string } {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on('data', (chunk: Buffer) => {
    chunks.push(chunk.toString());
  });
  return { prompter: createLinePrompter(input, output), input, written: () => chunks.join('') };
}

/** One turn of the event loop. */
async function settle(): Promise<void> {
  await new Promise((done) => {
    setTimeout(done, 0);
  });
}

describe('createLinePrompter', () => {
  it('writes the question, then answers the line typed after it', async () => {
    const { prompter, input, written } = overStreams();

    const answer = prompter.ask('Root? ');
    input.write('two words \n');

    expect(await answer).toBe('two words ');
    expect(written()).toBe('Root? ');
    prompter.close();
  });

  it('keeps lines typed before they are asked for, in order, and reads CRLF as one break', async () => {
    const { prompter, input } = overStreams();
    input.write('one\r\ntwo\n');
    await settle();

    expect([await prompter.ask(''), await prompter.ask('')]).toEqual(['one', 'two']);
    prompter.close();
  });

  it('answers null to a pending question and every later one once the input ends', async () => {
    const { prompter, input } = overStreams();

    const pending = prompter.ask('Root? ');
    input.end();

    expect(await pending).toBeNull();
    expect(await prompter.ask('Root? ')).toBeNull();
  });

  it('delivers a last line that ends without a line break before answering null', async () => {
    const { prompter, input } = overStreams();
    input.end('last');
    await settle();

    expect([await prompter.ask(''), await prompter.ask('')]).toEqual(['last', null]);
  });

  it('writes what it says with a line break, and answers null once closed', async () => {
    const { prompter, written } = overStreams();

    prompter.say('listed');
    prompter.close();
    await settle();

    expect(await prompter.ask('Root? ')).toBeNull();
    expect(written()).toBe('listed\nRoot? ');
  });
});

/** A prompter answering `answers` in order, and the count of each call made on every one opened. */
function scripted(answers: readonly (string | null)[]): {
  open: () => Prompter;
  opened: () => number;
  asked: () => string[];
  closed: () => number;
} {
  const queue = [...answers];
  const questions: string[] = [];
  let opens = 0;
  let closes = 0;
  return {
    open: (): Prompter => {
      opens += 1;
      return {
        say: (): void => {},
        ask: async (question) => {
          questions.push(question);
          return queue.shift() ?? null;
        },
        close: (): void => {
          closes += 1;
        },
      };
    },
    opened: () => opens,
    asked: () => questions,
    closed: () => closes,
  };
}

describe('lazyPrompter', () => {
  it('opens nothing and closes nothing for a run that never asks', () => {
    const script = scripted([]);

    lazyPrompter(script.open).close();

    expect([script.opened(), script.closed()]).toEqual([0, 0]);
  });

  it('opens at the first question and keeps the one prompter for the next', async () => {
    const script = scripted(['y', 'n']);
    const prompter = lazyPrompter(script.open);

    const answers = [await prompter.ask('One? '), await prompter.ask('Two? ')];

    expect(answers).toEqual([true, false]);
    expect(script.asked()).toEqual(['One? ', 'Two? ']);
    expect(script.opened()).toBe(1);
  });

  it('closes the one it opened once, and opens a fresh one for a question after close', async () => {
    const script = scripted(['y', 'yes']);
    const prompter = lazyPrompter(script.open);

    await prompter.ask('One? ');
    prompter.close();
    prompter.close();

    expect([script.opened(), script.closed()]).toEqual([1, 1]);
    expect(await prompter.ask('Two? ')).toBe(true);
    expect(script.opened()).toBe(2);
  });

  it.each([['y'], ['yes'], ['  YES \n'], ['Y']])('reads %p as yes', async (answer) => {
    expect(await lazyPrompter(scripted([answer]).open).ask('Go? ')).toBe(true);
  });

  it.each([[''], ['  '], ['n'], ['yeah'], [null]])('reads %p as no', async (answer) => {
    expect(await lazyPrompter(scripted([answer]).open).ask('Go? ')).toBe(false);
  });

  it('answers askLine with the line as typed, and null once the input has ended', async () => {
    const script = scripted(['  Not now \n']);
    const prompter = lazyPrompter(script.open);

    const answers = [await prompter.askLine('Why? '), await prompter.askLine('Again? ')];

    expect(answers).toEqual(['  Not now \n', null]);
    expect(script.asked()).toEqual(['Why? ', 'Again? ']);
  });

  it('opens once across askLine and ask, and reads yes over the same prompter', async () => {
    const script = scripted(['a reason', 'YES']);
    const prompter = lazyPrompter(script.open);

    const line = await prompter.askLine('Why? ');
    const yes = await prompter.ask('Go? ');
    prompter.close();

    expect([line, yes]).toEqual(['a reason', true]);
    expect([script.opened(), script.closed()]).toEqual([1, 1]);
  });
});
