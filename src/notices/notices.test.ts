import type { NoticeSeams } from './notices.js';
import type { Prompter } from '../project/root-choice.js';

import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  FEEDBACK_URL,
  NOTICE_QUESTION,
  noticeLines,
  noticesPath,
  offerNotices,
  pendingNotices,
  readDismissed,
  readNoticeAnswer,
  writeDismissed,
} from './notices.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'rafa-notices-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** A prompter answering `answers` in order, recording what it was shown. */
function scriptedPrompter(answers: readonly (string | null)[]): { prompter: Prompter; shown: string[]; closed: () => boolean } {
  const shown: string[] = [];
  const queue = [...answers];
  let isClosed = false;
  return {
    shown,
    closed: () => isClosed,
    prompter: {
      say: (text) => {
        shown.push(text);
      },
      ask: async (question) => {
        shown.push(question);
        return queue.shift() ?? null;
      },
      close: () => {
        isClosed = true;
      },
    },
  };
}

/** Seams for a terminal run over `prompter`, refusing a warn. */
function terminalSeams(prompter: Prompter): NoticeSeams {
  return {
    isTerminal: () => true,
    openPrompter: () => prompter,
    warn: () => {
      throw new Error('a terminal run must ask, not warn');
    },
  };
}

describe('readDismissed', () => {
  test('answers nothing when the file is missing', () => {
    expect(readDismissed(home)).toEqual([]);
  });

  test('answers nothing for a file that is not JSON, erring toward telling', () => {
    mkdirSync(dirname(noticesPath(home)), { recursive: true });
    writeFileSync(noticesPath(home), '{ not json');
    expect(readDismissed(home)).toEqual([]);
  });

  test('drops an id this build does not know and keeps the known one', () => {
    mkdirSync(dirname(noticesPath(home)), { recursive: true });
    writeFileSync(noticesPath(home), JSON.stringify({ dismissed: ['danger', 'beta', 7] }));
    expect(readDismissed(home)).toEqual(['danger']);
  });
});

describe('writeDismissed', () => {
  test('keeps an id already dismissed beside the new one', () => {
    writeDismissed(home, ['alpha']);
    writeDismissed(home, ['danger']);
    expect(readDismissed(home)).toEqual(['alpha', 'danger']);
    expect(JSON.parse(readFileSync(noticesPath(home), 'utf8'))).toEqual({ dismissed: ['alpha', 'danger'] });
  });
});

describe('pendingNotices', () => {
  test('owes both notices to a home that dismissed neither, alpha first', () => {
    expect(pendingNotices([])).toEqual(['alpha', 'danger']);
  });

  test('owes nothing once both are dismissed', () => {
    expect(pendingNotices(['alpha', 'danger'])).toEqual([]);
  });
});

describe('noticeLines', () => {
  test('names the version and the feedback link in the alpha notice', () => {
    const text = noticeLines('alpha', '0.7.0').join('\n');
    expect(text).toContain('rafa 0.7.0 is alpha software');
    expect(text).toContain(FEEDBACK_URL);
  });

  test('names the flag and the account in the danger notice', () => {
    const text = noticeLines('danger', '0.7.0').join('\n');
    expect(text).toContain('--dangerously-skip-permissions');
    expect(text).toContain('your GitHub');
  });
});

describe('readNoticeAnswer', () => {
  test('continues on y and yes, whatever the case', () => {
    expect(readNoticeAnswer('y')).toBe('continue');
    expect(readNoticeAnswer(' YES ')).toBe('continue');
  });

  test('dismisses on d and dismiss', () => {
    expect(readNoticeAnswer('d')).toBe('dismiss');
    expect(readNoticeAnswer('Dismiss')).toBe('dismiss');
  });

  test('cancels on an empty line, an ended input and anything else', () => {
    expect(readNoticeAnswer('')).toBe('cancel');
    expect(readNoticeAnswer(null)).toBe('cancel');
    expect(readNoticeAnswer('maybe')).toBe('cancel');
  });
});

describe('offerNotices', () => {
  test('asks nothing and opens no prompter when both are dismissed', async () => {
    writeDismissed(home, ['alpha', 'danger']);
    const outcome = await offerNotices({ home, version: '0.7.0' }, {
      isTerminal: () => true,
      openPrompter: () => {
        throw new Error('nothing is owed, so nothing is asked');
      },
      warn: () => {
        throw new Error('nothing is owed, so nothing is warned');
      },
    });
    expect(outcome).toBe('continue');
  });

  test('prints both notices, asks once and continues on y without dismissing', async () => {
    const script = scriptedPrompter(['y']);
    const outcome = await offerNotices({ home, version: '0.7.0' }, terminalSeams(script.prompter));
    expect(outcome).toBe('continue');
    expect(script.shown[0]).toContain('alpha software');
    expect(script.shown[0]).toContain('--dangerously-skip-permissions');
    expect(script.shown[1]).toBe(NOTICE_QUESTION);
    expect(readDismissed(home)).toEqual([]);
    expect(script.closed()).toBe(true);
  });

  test('cancels on an ended input, the control for the yes above', async () => {
    const script = scriptedPrompter([null]);
    const outcome = await offerNotices({ home, version: '0.7.0' }, terminalSeams(script.prompter));
    expect(outcome).toBe('cancelled');
    expect(readDismissed(home)).toEqual([]);
    expect(script.closed()).toBe(true);
  });

  test('continues on d and owes nothing on the next run', async () => {
    const first = scriptedPrompter(['d']);
    expect(await offerNotices({ home, version: '0.7.0' }, terminalSeams(first.prompter))).toBe('continue');
    expect(readDismissed(home)).toEqual(['alpha', 'danger']);
    expect(pendingNotices(readDismissed(home))).toEqual([]);
  });

  test('shows only the notice still owed', async () => {
    writeDismissed(home, ['alpha']);
    const script = scriptedPrompter(['y']);
    await offerNotices({ home, version: '0.7.0' }, terminalSeams(script.prompter));
    expect(script.shown[0]).not.toContain('alpha software');
    expect(script.shown[0]).toContain('--dangerously-skip-permissions');
  });

  test('warns and continues without a terminal, asking nothing', async () => {
    const warned: string[] = [];
    const outcome = await offerNotices({ home, version: '0.7.0' }, {
      isTerminal: () => false,
      openPrompter: () => {
        throw new Error('no terminal, so no question');
      },
      warn: (line) => {
        warned.push(line);
      },
    });
    expect(outcome).toBe('continue');
    expect(warned.join('\n')).toContain('--dangerously-skip-permissions');
    expect(warned.join('\n')).toContain('alpha software');
  });
});
