/**
 * Tests for the line prompter (`confirm.ts`) over streams of its own.
 *
 * Each case writes to a `PassThrough` and reads back what the prompter
 * wrote; the end of input is the stream's `end`, and the case for a line
 * typed before it is asked for waits one turn of the event loop so
 * readline has read it.
 */
import type { Prompter } from './confirm.js';

import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'bun:test';

import { createLinePrompter } from './confirm.js';

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
