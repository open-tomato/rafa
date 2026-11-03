import { describe as suite, expect, it } from 'bun:test';

import { describe, MODAL_KEYS } from './describe.js';
import {
  applyDescriptor,
  CARD_MODES,
  cardSpecSchema,
  cardDescriptorSchema,
  cardModeSchema,
  descriptorOf,
  modalKeySchema,
  TIME_RANGES,
  timeRangeSchema,
} from './schemas.js';

const VALID_CARD = {
  id: 'tokens-per-day',
  title: 'Tokens per day',
  chart: { primitive: 'line', options: { zoom: true } },
  range: 'past-month',
  menu: [{ key: 'info', label: 'Info', icon: 'info' }],
};

suite('the card schemas', () => {
  it('parse a minimal card config', () => {
    expect(cardSpecSchema.parse(VALID_CARD)).toEqual(VALID_CARD);
  });

  it('refuse a card with an empty title', () => {
    expect(cardSpecSchema.safeParse({ ...VALID_CARD, title: '' }).success).toBe(false);
  });

  it('refuse a range outside the four', () => {
    expect(timeRangeSchema.safeParse('yesterday').success).toBe(false);
  });

  it('list the four modes', () => {
    expect(cardModeSchema.options).toEqual([...CARD_MODES]);
  });
});

suite('describe()', () => {
  it('lists every mode, range and modal key the schemas know, each with a summary', () => {
    const document = describe();

    expect(document.modes.map((entry) => entry.name)).toEqual([...CARD_MODES]);
    expect(document.ranges.map((entry) => entry.name)).toEqual([...TIME_RANGES]);
    expect(document.modalKeys.map((entry) => entry.name)).toEqual([...MODAL_KEYS]);
    const blank = [...document.modes, ...document.ranges, ...document.modalKeys, ...document.options]
      .filter((entry) => entry.summary.trim() === '');
    expect(blank).toEqual([]);
  });

  it('survives a JSON round trip unchanged', () => {
    const document = describe();

    expect(JSON.parse(JSON.stringify(document))).toEqual(document);
  });

  it('answers a fresh document each call', () => {
    expect(describe()).not.toBe(describe());
    expect(describe().options).not.toBe(describe().options);
  });
});

suite('the descriptor the Config modal edits', () => {
  it('takes the words, range and span of a config', () => {
    const config = cardSpecSchema.parse({ ...VALID_CARD, subtitle: 'tokens', span: 'two' });

    expect(descriptorOf(config)).toEqual({
      title: 'Tokens per day',
      subtitle: 'tokens',
      description: undefined,
      range: 'past-month',
      span: 'two',
    });
  });

  it('puts a descriptor back into a config, clearing a blank field', () => {
    const config = cardSpecSchema.parse({ ...VALID_CARD, subtitle: 'old' });
    const next = applyDescriptor(config, { title: 'New', range: 'now' });

    expect(next.title).toBe('New');
    expect(next.subtitle).toBeUndefined();
    expect(next.range).toBe('now');
    expect(next.chart).toEqual(config.chart);
    expect(config.title).toBe('Tokens per day');
  });

  it('refuses a blank title with a message for the form', () => {
    const result = cardDescriptorSchema.safeParse({ title: '   ' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('A card needs a title.');
  });

  it('parses a card that lists its built-in modals, legend and span', () => {
    const card = { ...VALID_CARD, span: 'full', legend: { mark: 'line', toggleable: true }, modals: ['info', 'maximise'] };

    expect(cardSpecSchema.parse(card)).toEqual(card);
    expect(cardSpecSchema.safeParse({ ...VALID_CARD, modals: ['zoom'] }).success).toBe(false);
  });

  it('lists the five built-in modal keys', () => {
    expect(modalKeySchema.options).toEqual([...MODAL_KEYS]);
  });
});
