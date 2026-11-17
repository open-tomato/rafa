/**
 * Tests for `packages/rafa-board/src/commands/issue/upstream-text.ts`:
 * the private-name rule over what is filed upstream, and an upstream
 * comment's redaction of local paths and named secrets.
 *
 * Every root, home, name and secret here is made up: the roots are paths
 * that do not exist, so `localPathRedactor` adds no realpath form, and
 * the secrets come from a planted environment, never the process's own.
 * Each positive case states what the text held before the rule, the
 * control that the replacement could have failed.
 *
 * Negative cases come first.
 */
import type { PrivateNames, UpstreamCommentRedaction } from './upstream-text.js';

import { describe, expect, it } from 'bun:test';

import { PRIVATE_SIBLING, privateNameRule, upstreamCommentRedactor } from './upstream-text.js';

/** This board, as the gate reads it. */
const OWN = 'open-tomato/components';

/** The filing package's name. */
const PACKAGE = 'components-workspace';

/** The names of a private board filing from {@link PACKAGE}. */
const PRIVATE: PrivateNames = { own: OWN, ownIsPublic: false, packages: [PACKAGE] };

/** A Versions block naming the filing package. */
const VERSIONS = `rafa: 1.2.3\ncode: abc1234\npackage: ${PACKAGE}@0.1.0\npath: src/a.ts`;

/** The checkout and home a comment's redaction takes out. */
const CHECKOUT = '/home/alice/work/components';
const HOME = '/home/alice';

/** A secret's value, planted in the environment a case hands over. */
const TOKEN = 'ghp_made_up_token_value_0123456789';

/** A redaction over {@link CHECKOUT} and {@link HOME}, with `env` and a config naming `DB_URL`. */
function redactionOf(env: UpstreamCommentRedaction['env']): UpstreamCommentRedaction {
  return {
    roots: [CHECKOUT],
    home: HOME,
    config: {
      prerequisitesRequired: [{ kind: 'env', name: 'DB_URL', probe: null }],
      prerequisitesOptional: [],
    },
    env,
  };
}

describe('privateNameRule', () => {
  it('answers a public board\'s text unchanged, names and package included', () => {
    const text = `Filed from ${OWN}, package ${PACKAGE}.\n${VERSIONS}`;
    expect(privateNameRule({ ...PRIVATE, ownIsPublic: true })(text)).toBe(text);
  });

  it('leaves a name inside a longer word, and the owner alone, as they are', () => {
    const rule = privateNameRule({ own: 'open-tomato/app', ownIsPublic: false, packages: [] });
    expect(rule('the application of open-tomato')).toBe('the application of open-tomato');
  });

  it('skips a blank package name rather than matching every gap', () => {
    const rule = privateNameRule({ own: OWN, ownIsPublic: false, packages: ['', '  '] });
    expect(rule('a b c')).toBe('a b c');
  });

  it('replaces the owner/name whole, leaving no owner before the marker', () => {
    const text = `See ${OWN}#12.`;
    expect(text).toContain(OWN);
    expect(privateNameRule(PRIVATE)(text)).toBe(`See ${PRIVATE_SIBLING}#12.`);
  });

  it('replaces the bare repository name', () => {
    expect(privateNameRule(PRIVATE)('cloned components into a worktree'))
      .toBe(`cloned ${PRIVATE_SIBLING} into a worktree`);
  });

  it('replaces the package name in the Versions block, keeping its version', () => {
    const replaced = privateNameRule(PRIVATE)(VERSIONS);
    expect(replaced).toContain(`package: ${PRIVATE_SIBLING}@0.1.0`);
    expect(replaced).not.toContain('components');
  });

  it('replaces a scoped package name whole', () => {
    const rule = privateNameRule({ own: OWN, ownIsPublic: false, packages: ['@open-tomato/components-app'] });
    expect(rule('package: @open-tomato/components-app@2.0.0')).toBe(`package: ${PRIVATE_SIBLING}@2.0.0`);
  });

  it('matches each name ignoring case, as GitHub\'s names hold none', () => {
    expect(privateNameRule(PRIVATE)('Open-Tomato/Components and COMPONENTS'))
      .toBe(`${PRIVATE_SIBLING} and ${PRIVATE_SIBLING}`);
  });

  it('keeps the rule for an unread visibility, which is not public', () => {
    const replaced = privateNameRule({ own: OWN, ownIsPublic: false, packages: [PACKAGE] })(`${OWN} ${PACKAGE}`);
    expect(replaced).toBe(`${PRIVATE_SIBLING} ${PRIVATE_SIBLING}`);
  });
});

describe('upstreamCommentRedactor', () => {
  it('answers a text holding no path and no secret unchanged', () => {
    const text = 'The gate refused with exit 1.';
    expect(upstreamCommentRedactor(redactionOf({ GITHUB_TOKEN: TOKEN }))(text)).toBe(text);
  });

  it('leaves a value no named variable holds', () => {
    const redact = upstreamCommentRedactor(redactionOf({ UNNAMED: TOKEN }));
    expect(redact(`token ${TOKEN}`)).toBe(`token ${TOKEN}`);
  });

  it('takes the checkout path out as relative to it, and the home as its marker', () => {
    const text = `${CHECKOUT}/src/a.ts failed; bun at ${HOME}/.bun/bin/bun`;
    expect(upstreamCommentRedactor(redactionOf({}))(text))
      .toBe('src/a.ts failed; bun at [redacted: HOME]/.bun/bin/bun');
  });

  it('replaces a secret always named and one the config names', () => {
    const redact = upstreamCommentRedactor(redactionOf({ GITHUB_TOKEN: TOKEN, DB_URL: 'postgres://u:p@db/x' }));
    expect(redact(`GITHUB_TOKEN=${TOKEN} DB_URL=postgres://u:p@db/x`))
      .toBe('GITHUB_TOKEN=[redacted: GITHUB_TOKEN] DB_URL=[redacted: DB_URL]');
  });

  it('runs before the private-name rule, so a path naming the repository leaves neither', () => {
    const text = `${CHECKOUT}/packages/x.ts with ${TOKEN}`;
    const redacted = upstreamCommentRedactor(redactionOf({ GITHUB_TOKEN: TOKEN }))(text);
    const filed = privateNameRule(PRIVATE)(redacted);
    expect(filed).toBe('packages/x.ts with [redacted: GITHUB_TOKEN]');
    expect(filed).not.toContain('alice');
  });
});
