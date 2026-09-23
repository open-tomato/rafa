/**
 * Tests that exactly the five commands the plan names declare `spends`
 * in the core registry (`src/commands/index.ts`), each with the `when`
 * and flag the plan's table gives it, and that the `start` alias reaches
 * the same declaration as `loop start`.
 */
import { describe, expect, it } from 'bun:test';

import { CORE_REGISTRY } from '../commands/index.js';

/** The five commands the plan's table names, by subject and action. */
const EXPECTED_SPENDERS: ReadonlyArray<{
  readonly subject: string;
  readonly action: string;
  readonly when: string;
  readonly flag?: string;
}> = [
  { subject: 'plan', action: 'create', when: 'always' },
  { subject: 'loop', action: 'start', when: 'always' },
  { subject: 'pr', action: 'triage', when: 'with', flag: '--resolve' },
  { subject: 'skill', action: 'backfill', when: 'with', flag: '--propose' },
  { subject: 'next', action: 'next', when: 'through' },
];

describe('the core registry\'s spends roster', () => {
  it('declares spends on exactly the five commands the plan names', () => {
    const spenders = CORE_REGISTRY.commands({ includeHidden: true })
      .filter((command) => command.spends !== undefined)
      .map((command) => (command.subject === command.action
        ? command.subject
        : `${command.subject} ${command.action}`));

    const expectedLabels = EXPECTED_SPENDERS.map(({ subject, action }) => (
      subject === action
        ? subject
        : `${subject} ${action}`
    ));

    expect(spenders.sort()).toStrictEqual([...expectedLabels].sort());
  });

  it.each(EXPECTED_SPENDERS)('$subject $action declares its when and flag', ({ subject, action, when, flag }) => {
    const command = subject === action
      ? CORE_REGISTRY.topLevel(subject)
      : CORE_REGISTRY.find(subject, action);

    expect(command).toBeDefined();
    expect(command?.spends?.when).toBe(when);
    if (flag === undefined) {
      expect(command?.spends && 'flag' in command.spends
        ? command.spends.flag
        : undefined).toBeUndefined();
    } else {
      expect(command?.spends && 'flag' in command.spends
        ? command.spends.flag
        : undefined).toBe(flag);
    }
  });

  it('reaches the "loop start" declaration through the "start" alias', () => {
    const startAlias = CORE_REGISTRY.aliases().find((alias) => alias.words.length === 1 && alias.words[0] === 'start');
    const loopStart = CORE_REGISTRY.find('loop', 'start');

    expect(startAlias).toBeDefined();
    expect(startAlias?.command).toBe(loopStart);
    expect(startAlias?.command.spends).toStrictEqual(loopStart?.spends);
  });
});
