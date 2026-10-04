import type { ScrubContext } from '../src/fixtures/scrub.js';
import type { BoardIssue, CauseJudgement } from '../src/triage/scoring-fixture.js';

import { resolve } from 'node:path';

import { describe, expect, it } from 'bun:test';
import { ESLint } from 'eslint';

import { EMAIL_MARKER, HOST_MARKER, ScrubRefusal, findLeaks } from '../src/fixtures/scrub.js';
import { ISSUE_OPENING, issueText } from '../src/triage/issue-text.js';
import { HOME_MARKER } from '../src/triage/local-paths.js';

import { FIXTURE_INDENT, scrubbedFilings, serializeFixture } from './extract-scoring-fixture.js';

/**
 * The pieces of `scripts/extract-scoring-fixture.ts` that run without the
 * board: the filings it reads, each value through the fixture scrub of
 * `src/fixtures/scrub.ts`, and the fixture serializer, whose text passes
 * the `jsonc/indent` rule `eslint.base.mjs` applies to `.json` files and
 * holds both fixture files under `src/triage/testdata/`. No case runs the
 * extract itself, which reads the live board with `gh`.
 */

const ROOT = resolve(import.meta.dir, '..');
const eslint = new ESLint({ cwd: ROOT });

/** The fixture files kept in the serializer's form. */
const FIXTURE_FILES = [
  'src/triage/testdata/scoring.json',
  'src/triage/testdata/scoring-causes.json',
];

/** A small value with nesting on every level the fixtures use. */
const SAMPLE = { repo: 'o/r', filings: [{ issue: 1, tags: ['a', 'b'] }] };

/** The `jsonc/indent` messages ESLint answers for `text` linted as a fixture file. */
async function indentMessages(text: string): Promise<string[]> {
  const [result] = await eslint.lintText(text, { filePath: resolve(ROOT, FIXTURE_FILES[0] ?? '') });
  if (result === undefined) throw new Error('ESLint returned no result');
  return result.messages
    .filter((message) => message.ruleId === 'jsonc/indent')
    .map((message) => message.message);
}

const NO_JUDGEMENT: CauseJudgement = { groups: {}, excluded: [], filings: {} };

/** A planted machine: every name in it is made up for these cases. */
const CONTEXT: ScrubContext = {
  host: 'planted-box',
  secrets: [{ name: 'PLANTED_TOKEN', value: 'planted-token-value-0123' }],
  repoRoot: '/home/alice/work/repo',
  home: '/home/alice',
};

/** A board issue triage filed, reporting `what` with `artifact`. */
function filed(number: number, what: string, artifact: string): BoardIssue {
  const body = issueText(ISSUE_OPENING, {
    what,
    artifact,
    key: null,
    refs: null,
    planStub: 'a-plan',
    taskText: 'a task',
    feedback: null,
  }, (text) => text);
  return { number, createdAt: '2026-09-28T10:00:00Z', body, comments: [] };
}

/** The one filing of `issue`, scrubbed for {@link CONTEXT}. */
function scrubbedOne(issue: BoardIssue): { what: string; artifact: string | null } {
  const [filing] = scrubbedFilings([issue], NO_JUDGEMENT, CONTEXT);
  if (filing === undefined) throw new Error('the issue gave no filing');
  return filing;
}

describe('scrubbedFilings', () => {
  /** A planted value of each leak kind, which the finder reads as a leak before the scrub. */
  const PLANTED = [
    ['home path', 'copied to /home/bob/p/a.ts', `copied to ${HOME_MARKER}/p/a.ts`],
    ['email address', 'signed by alice@example.com', `signed by ${EMAIL_MARKER}`],
    ['host name', 'minted on planted-box', `minted on ${HOST_MARKER}`],
    ['named secret', 'token planted-token-value-0123 sent', 'token [redacted: PLANTED_TOKEN] sent'],
  ] as const;

  for (const [kind, planted, written] of PLANTED) {
    it(`takes a planted ${kind} out of the What and the Artifact`, () => {
      expect(findLeaks(planted, CONTEXT.host, CONTEXT.secrets).map((leak) => leak.kind)).toEqual([kind]);
      const filing = scrubbedOne(filed(1, planted, `log: ${planted}`));
      expect(filing.what).toBe(written);
      expect(filing.artifact).toBe(`log: ${written}`);
    });
  }

  it('writes a path under the checkout relative to it', () => {
    expect(scrubbedOne(filed(1, 'failed in /home/alice/work/repo/src/a.ts:12', 'x')).what).toBe('failed in src/a.ts:12');
  });

  it('leaves a version pin and clean text as they are', () => {
    const clean = 'bumped pkg@1.2.3 and src/a.ts';
    expect(scrubbedOne(filed(1, clean, clean))).toMatchObject({ what: clean, artifact: clean });
  });

  it('refuses when a value still holds a leak after the scrub', () => {
    const issue = filed(1, 'deployed from host', 'x');
    expect(() => scrubbedFilings([issue], NO_JUDGEMENT, { ...CONTEXT, host: 'host' })).toThrow(ScrubRefusal);
  });
});

describe('serializeFixture', () => {
  it('writes JSON at two spaces, closed by one newline', () => {
    expect(FIXTURE_INDENT).toBe(2);
    expect(serializeFixture(SAMPLE)).toBe(`${JSON.stringify(SAMPLE, null, 2)}\n`);
  });

  it('answers text jsonc/indent accepts', async () => {
    expect(await indentMessages(serializeFixture(SAMPLE))).toEqual([]);
  });

  it('is refused at the old one-space indent, the control', async () => {
    const messages = await indentMessages(`${JSON.stringify(SAMPLE, null, 1)}\n`);
    expect(messages.length).toBeGreaterThan(0);
  });
});

describe('the fixture files under src/triage/testdata/', () => {
  for (const path of FIXTURE_FILES) {
    it(`holds ${path} in the serializer's text`, async () => {
      const text = await Bun.file(resolve(ROOT, path)).text();
      expect(text).toBe(serializeFixture(JSON.parse(text)));
    });
  }
});
