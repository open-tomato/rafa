/**
 * Tests for the config text editor (`src/config-set.ts`): the three
 * shapes it edits, the comments it keeps, and each refusal by reason.
 *
 * The appended-section case starts from the bytes `rafa init` writes,
 * `projectConfigText()`, so the edit is driven against the template that
 * ships, where every setting is commented. Every answered text is parsed
 * back through `parseConfigText` here as well, so a case does not rest
 * on the module's own parse-back alone.
 *
 * "Keeps every comment" is read as the list of comment tails, one per
 * line that carries a `#`, in order, equal before and after. That list
 * could pass while wrong if it read nothing, so it has a control: the
 * same list over a text with one comment dropped differs.
 *
 * Nothing here touches a file: the module takes text and answers text.
 */
import type { ConfigSetRefusalReason } from './config-set.js';

import { describe, expect, it } from 'bun:test';

import { ConfigSetRefusal, withConfigSetting } from './config-set.js';
import { parseConfigText } from './config.js';
import { projectConfigText } from './project/scaffold.js';

/** The path refusals are labelled with. */
const PATH = '.rafa/config.yaml';

/** The comment tail of every line carrying one, in order. */
function commentsOf(text: string): string[] {
  return text.split(/\r?\n/u)
    .filter((line) => line.includes('#'))
    .map((line) => line.slice(line.indexOf('#')));
}

/** The refusal `act` throws; fails the case when it throws none or another error. */
function refusalOf(act: () => unknown): ConfigSetRefusal {
  try {
    act();
  } catch (error) {
    if (error instanceof ConfigSetRefusal) return error;
    throw error;
  }
  throw new Error('expected a ConfigSetRefusal, and none was thrown');
}

/** Asserts `text` refuses `key=value` for `reason`, and answers the message. */
function refused(text: string, key: string, value: string, reason: ConfigSetRefusalReason): string {
  const refusal = refusalOf(() => withConfigSetting(text, key, value, PATH));
  expect(refusal.reason).toBe(reason);
  return refusal.message;
}

describe('withConfigSetting: the shapes it edits', () => {
  it('replaces an uncommented line in place, keeping its indentation and trailing comment', () => {
    const text = 'version: 1\npr:\n    base: main   # the branch a PR opens into\n    provider: gh\n';

    const edit = withConfigSetting(text, 'pr.base', 'stretch/9', PATH);

    expect(edit.text).toBe('version: 1\npr:\n    base: stretch/9   # the branch a PR opens into\n    provider: gh\n');
    expect(edit.before).toBe('main');
    expect(edit.after).toBe('stretch/9');
    expect(edit.setting).toBe('prBase');
    expect(edit.changed).toBe(true);
    expect(parseConfigText(edit.text, PATH).values.prProvider).toBe('gh');
  });

  it('adds the key under its existing section at the indentation its other keys use', () => {
    const text = 'version: 1\npr:\n    provider: gh\nstore: ndjson\n';

    const edit = withConfigSetting(text, 'pr.base', 'stretch/9', PATH);

    expect(edit.text).toBe('version: 1\npr:\n    base: stretch/9\n    provider: gh\nstore: ndjson\n');
    expect(edit.before).toBeNull();
  });

  it('adds the key two spaces in under a section that holds only comments', () => {
    const text = 'version: 1\npr:   # opened by hand\n#   base: main\n';

    const edit = withConfigSetting(text, 'pr.base', 'stretch/9', PATH);

    expect(edit.text).toBe('version: 1\npr:   # opened by hand\n  base: stretch/9\n#   base: main\n');
    expect(parseConfigText(edit.text, PATH).values.prBase).toBe('stretch/9');
  });

  it('appends the section to the config rafa init writes, leaving its commented block commented', () => {
    const text = projectConfigText();

    const edit = withConfigSetting(text, 'pr.base', 'stretch/9', PATH);

    expect(edit.text).toBe(`${text.replace(/\n$/u, '')}\npr:\n  base: stretch/9\n`);
    expect(edit.text).toContain('\n#   base:');
    expect(parseConfigText(edit.text, PATH).values.prBase).toBe('stretch/9');
  });

  it('appends the section to a text that does not end in a newline', () => {
    const edit = withConfigSetting('version: 1', 'pr.base', 'stretch/9', PATH);

    expect(edit.text).toBe('version: 1\npr:\n  base: stretch/9\n');
  });

  it('replaces and appends a one-level key', () => {
    expect(withConfigSetting('version: 1\nstore: ndjson  # kept\n', 'store', 'sqlite', PATH).text)
      .toBe('version: 1\nstore: sqlite  # kept\n');
    expect(withConfigSetting('version: 1\n# store: sqlite\n', 'store', 'ndjson', PATH).text)
      .toBe('version: 1\n# store: sqlite\nstore: ndjson\n');
  });

  it('replaces a top-level line spelling the dotted key itself', () => {
    const edit = withConfigSetting('version: 1\npr.base: main\n', 'pr.base', 'stretch/9', PATH);

    expect(edit.text).toBe('version: 1\npr.base: stretch/9\n');
    expect(edit.before).toBe('main');
  });

  it('writes a flow value the key reads as a list', () => {
    const edit = withConfigSetting('version: 1\n', 'cleanup.keep', '[main, release/*]', PATH);

    expect(edit.after).toEqual(['main', 'release/*']);
    expect(parseConfigText(edit.text, PATH).values.cleanupKeep).toEqual(['main', 'release/*']);
  });

  it('answers the text unchanged when it already reads the value', () => {
    const text = 'version: 1\npr:\n  base:   stretch/9 # same\n';

    const edit = withConfigSetting(text, 'pr.base', 'stretch/9', PATH);

    expect(edit.changed).toBe(false);
    expect(edit.text).toBe(text);
    expect(edit.before).toBe('stretch/9');
  });

  it('keeps CRLF line endings', () => {
    const edit = withConfigSetting('version: 1\r\npr:\r\n  base: main\r\n', 'pr.base', 'stretch/9', PATH);

    expect(edit.text).toBe('version: 1\r\npr:\r\n  base: stretch/9\r\n');
  });
});

describe('withConfigSetting: comments', () => {
  it('keeps every comment of the config rafa init writes, and the reading has a control', () => {
    const text = projectConfigText();
    const comments = commentsOf(text);

    const edit = withConfigSetting(text, 'pr.base', 'stretch/9', PATH);

    expect(comments.length).toBeGreaterThan(50);
    expect(commentsOf(edit.text)).toEqual(comments);
    const dropped = text.replace('#   base:', '');
    expect(commentsOf(dropped)).not.toEqual(comments);
  });

  it('keeps the comment after a plain value holding an apostrophe', () => {
    const text = 'version: 1\nrelease:\n  heading: don\'t panic # the heading\n';

    const edit = withConfigSetting(text, 'release.heading', 'Changes', PATH);

    expect(edit.text).toBe('version: 1\nrelease:\n  heading: Changes # the heading\n');
  });

  it('keeps the comment after a quoted value holding a hash', () => {
    const text = 'version: 1\nrelease:\n  heading: "a # b"  # the heading\n';

    const edit = withConfigSetting(text, 'release.heading', 'Changes', PATH);

    expect(edit.text).toBe('version: 1\nrelease:\n  heading: Changes  # the heading\n');
  });
});

describe('withConfigSetting: refusals', () => {
  const text = 'version: 1\npr:\n  base: main\n';

  it('refuses a key no setting is spelled with, naming the known keys under its section', () => {
    const message = refused(text, 'pr.bse', 'x', 'key');

    expect(message).toContain('unknown key "pr.bse"');
    expect(message).toContain('known keys under pr:');
    expect(message).toContain('base');
    expect(refused(text, 'nothing', 'x', 'key')).toContain('unknown key "nothing"');
  });

  it('refuses a section named as a key', () => {
    expect(refused(text, 'pr', 'x', 'key')).toContain('pr is a section');
    expect(refused(text, 'learning.bless', 'x', 'key')).toContain('learning.bless is a section');
  });

  it('refuses a setting three levels deep', () => {
    expect(refused(text, 'loop.wrapUp.retries', '2', 'key')).toContain('3 levels deep');
  });

  it('refuses a value parseConfigText refuses, with its reader\'s sentence', () => {
    const message = refused(text, 'pr.mergeMethod', 'fast', 'value');

    expect(message).toContain('pr.mergeMethod');
    expect(message).toContain('fast');
    expect(refused(text, 'pr.base', '[a]', 'value')).toContain('expected a branch name');
    expect(refused(text, 'version', '2', 'value')).toContain('version');
  });

  it('refuses an empty, a multi-line and a comment-only value', () => {
    expect(refused(text, 'pr.base', '', 'value')).toContain('needs a value');
    expect(refused(text, 'pr.base', '  ', 'value')).toContain('needs a value');
    expect(refused(text, 'pr.base', 'a\nb', 'value')).toContain('one line');
    expect(refused(text, 'pr.base', '# note', 'value')).toContain('reads as no value');
  });

  it('refuses a text that cannot be read as a config before the edit', () => {
    expect(refused('version: 2\n', 'pr.base', 'main', 'config')).toContain('cannot be read as a config');
  });

  it('refuses a section opened twice', () => {
    const twice = 'version: 1\npr:\n  provider: gh\npr:\n  base: main\n';

    expect(refused(twice, 'pr.base', 'stretch/9', 'duplicate')).toContain('opens pr on 2 lines');
  });

  it('refuses a key written twice, under its section or in its dotted spelling', () => {
    const underSection = 'version: 1\npr:\n  base: main\n  base: next\n';
    const dottedTwice = 'version: 1\npr.base: main\npr.base: next\n';

    expect(refused(underSection, 'pr.base', 'stretch/9', 'duplicate')).toContain('sets pr.base on 2 lines');
    expect(refused(dottedTwice, 'pr.base', 'stretch/9', 'duplicate')).toContain('sets pr.base on 2 lines');
    expect(refused('version: 1\nstore: ndjson\nstore: sqlite\n', 'store', 'sqlite', 'duplicate'))
      .toContain('sets store on 2 lines');
  });

  it('leaves a key in both spellings to parseConfigText, which refuses it as given twice', () => {
    const besideDotted = 'version: 1\npr.base: main\npr:\n  base: next\n';

    expect(refused(besideDotted, 'pr.base', 'stretch/9', 'config')).toContain('pr.base is given more than once');
  });

  it('counts only the section\'s own keys, not a deeper key of the same name', () => {
    const nested = 'version: 1\nlearning:\n  adapter: rafa\n  bless:\n    minConfidence: 0.5\n';

    const edit = withConfigSetting(nested, 'learning.adapter', 'other', PATH);

    expect(edit.text).toBe('version: 1\nlearning:\n  adapter: other\n  bless:\n    minConfidence: 0.5\n');
  });

  it('refuses a section written in flow style', () => {
    expect(refused('version: 1\npr: {base: main}\n', 'pr.base', 'stretch/9', 'shape')).toContain('flow style');
  });

  it('refuses a document naming the key in a spelling no line matches', () => {
    expect(refused('{version: 1, pr: {base: main}}\n', 'pr.base', 'x', 'shape')).toContain('names pr');
    expect(refused('version: 1\n"pr":\n  base: main\n', 'pr.base', 'x', 'shape')).toContain('names pr');
    expect(refused('{version: 1, store: ndjson}\n', 'store', 'sqlite', 'shape')).toContain('names store');
  });

  it('refuses an edit that reads the key back but moves another setting', () => {
    const aliased = 'version: 1\nrelease:\n  heading: &b Changes\npr:\n  base: main\ncleanup:\n  keep: [*b]\n';

    expect(refused(aliased, 'pr.base', '&b stretch/9', 'readback')).toContain('with every other setting kept');
  });

  it('refuses an edit that would not read back, leaving a block value\'s items orphaned', () => {
    const block = 'version: 1\ncleanup:\n  keep:\n    - main\n';

    expect(refused(block, 'cleanup.keep', '[next]', 'readback')).toContain('would not read back');
  });
});
