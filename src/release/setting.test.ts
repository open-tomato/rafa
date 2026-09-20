/**
 * Tests for the `release.enabled` write (`src/release/setting.ts`): the
 * shapes of config text the edit covers, replacing an answer already
 * there included, the one it refuses, and the setting read back off a
 * project root.
 *
 * The config the branch cases start from is the bytes `rafa init`
 * writes, `projectConfigText()`, so the uncomment branch is driven
 * against the template that actually ships rather than against a
 * five-line imitation of it. Every text is parsed back through
 * `parseConfigText`, which is what a written file would be read with,
 * so a branch that produced a file this rafa cannot load reddens here.
 *
 * The narrowing this module exists for has a case of its own: the other
 * three `release` settings must still be COMMENTED after the edit, since
 * uncommenting them would pin this build's defaults into a project file.
 * Its control is the same text parsed back, which names none of them.
 *
 * A line edit passes while wrong most easily by writing a line that
 * parses and means something else, so the refused shape has a case of
 * its own: `release: {enabled: true}` appended to would read back as the
 * new answer and still hold the key twice.
 *
 * No case touches the real home or a real project: each root is a
 * directory under this file's own temporary root.
 *
 * The mutation that uncommented the rest of the block reddened five
 * cases here; it and the one other driven against these two modules are
 * recorded in `src/commands/init-release.test.ts`.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { parseConfigText } from '../config.js';
import { projectConfigText } from '../project/scaffold.js';

import { readReleaseSetting, RELEASE_ENABLED_SETTING, releaseEnabledIn, withReleaseEnabled } from './setting.js';

/** A temporary directory of this file's own, its real path. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-release-setting-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A fresh project root holding `text` as its project config. */
function rootHolding(label: string, text: string): string {
  const root = mkdtempSync(join(tempBase, `${label}-`));
  mkdirSync(join(root, '.rafa'));
  writeFileSync(join(root, '.rafa', 'config.yaml'), text, 'utf8');
  return root;
}

describe('withReleaseEnabled', () => {
  it('uncomments the release block the written config carries, and nothing else in it', () => {
    const text = withReleaseEnabled(projectConfigText(), true) ?? '';

    expect(text).toContain('release:\n  enabled: true\n');
    expect(parseConfigText(text, 'config.yaml').values.releaseEnabled).toBe(true);
    expect(text).toContain('# rafa project config');
  });

  it('leaves the other three release settings commented, so no default is pinned', () => {
    const text = withReleaseEnabled(projectConfigText(), true) ?? '';
    const values = parseConfigText(text, 'config.yaml').values;

    expect(text).toContain('#   versionFile: package.json');
    expect(text).toContain('#   changelog: CHANGELOG.md');
    expect(values.releaseVersionFile).toBeUndefined();
    expect(values.releaseChangelog).toBeUndefined();
    expect(values.releaseHeading).toBeUndefined();
  });

  it('writes a no as false, which the template default auto would not have meant', () => {
    const text = withReleaseEnabled(projectConfigText(), false) ?? '';

    expect(text).toContain('release:\n  enabled: false\n');
    expect(parseConfigText(text, 'config.yaml').values.releaseEnabled).toBe(false);
  });

  it('sets the answer under a release key the file already spells', () => {
    const text = withReleaseEnabled('version: 1\nrelease:\n', true);

    expect(text).toBe('version: 1\nrelease:\n  enabled: true\n');
  });

  it('replaces an enabled line the release block already carries, rather than adding a second', () => {
    const text = withReleaseEnabled('version: 1\nrelease:\n  enabled: auto\n  changelog: NEWS.md\n', false) ?? '';

    expect(text).toBe('version: 1\nrelease:\n  enabled: false\n  changelog: NEWS.md\n');
    expect(parseConfigText(text, 'config.yaml').values.releaseEnabled).toBe(false);
  });

  it('finds that line past a comment and a blank, and stops at the next top-level key', () => {
    const block = 'version: 1\nrelease:\n\n  # the answer rafa init wrote\n  enabled: true\nstore: ndjson\n';

    const text = withReleaseEnabled(block, false) ?? '';
    const after = withReleaseEnabled('version: 1\nrelease:\nstore: ndjson\n  enabled: true\n', false) ?? '';

    expect(text).toBe('version: 1\nrelease:\n\n  # the answer rafa init wrote\n  enabled: false\nstore: ndjson\n');
    expect(after).toBe('version: 1\nrelease:\n  enabled: false\nstore: ndjson\n  enabled: true\n');
  });

  it('appends the block to a file naming no release at all', () => {
    const text = withReleaseEnabled('version: 1\n', true) ?? '';

    expect(text).toBe('version: 1\nrelease:\n  enabled: true\n');
    expect(parseConfigText(text, 'config.yaml').values.releaseEnabled).toBe(true);
  });

  it('keeps a commented release section whose enabled line was deleted, and sets the answer under it', () => {
    const text = withReleaseEnabled('version: 1\n# release:\n#   changelog: NEWS.md\n', true) ?? '';

    expect(text).toBe('version: 1\nrelease:\n  enabled: true\n#   changelog: NEWS.md\n');
    expect(parseConfigText(text, 'config.yaml').values.releaseEnabled).toBe(true);
  });
});

describe('withReleaseEnabled over a shape it does not edit', () => {
  it('answers null rather than a file holding the key twice', () => {
    expect(withReleaseEnabled('version: 1\nrelease: {enabled: true}\n', false)).toBe(null);
    expect(withReleaseEnabled('version: 1\nrelease: true\n', false)).toBe(null);
  });
});

describe('releaseEnabledIn', () => {
  it('reads the last of two enabled lines under one release key, as the parser does', () => {
    expect(releaseEnabledIn('version: 1\nrelease:\n  enabled: true\n  enabled: false\n', 'config.yaml')).toBe(false);
  });

  it('answers auto as written, and null for a config naming the setting not at all', () => {
    expect(releaseEnabledIn('version: 1\nrelease:\n  enabled: auto\n', 'config.yaml')).toBe('auto');
    expect(releaseEnabledIn('version: 1\n', 'config.yaml')).toBe(null);
  });

  it('throws for a text this rafa cannot read as a config', () => {
    expect(() => releaseEnabledIn('version: 1\nrelease:\n  enabled: on\n', 'config.yaml'))
      .toThrow(/release\.enabled/u);
  });
});

describe('readReleaseSetting', () => {
  it('answers the problem, and no value, for a root holding no config', () => {
    const reading = readReleaseSetting(join(tempBase, 'nowhere'));

    expect(reading.enabled).toBe(null);
    expect(reading.problem).toContain('could not be read');
  });

  it('answers the value the project config names, with the text it read', () => {
    const text = withReleaseEnabled(projectConfigText(), false) ?? '';
    const root = rootHolding('named', text);

    const reading = readReleaseSetting(root);

    expect(reading.enabled).toBe(false);
    expect(reading.text).toBe(text);
    expect(reading.problem).toBe(null);
  });

  it('answers no value, and no problem, for the config rafa init writes', () => {
    const reading = readReleaseSetting(rootHolding('silent', projectConfigText()));

    expect(reading.enabled).toBe(null);
    expect(reading.problem).toBe(null);
  });

  it('answers the problem, and no value, for a config this rafa cannot read', () => {
    const reading = readReleaseSetting(rootHolding('broken', 'version: 1\nrelease:\n  enabled: on\n'));

    expect(reading.enabled).toBe(null);
    expect(reading.problem).toContain(RELEASE_ENABLED_SETTING);
  });
});
