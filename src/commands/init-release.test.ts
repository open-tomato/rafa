/**
 * Tests for the release step (`init-release.ts`): the one question and
 * the lines a missing file gets above it, the order `runReleaseStep`
 * decides in, what it writes into the project config, and the line text
 * mode prints.
 *
 * Every case drives a scripted prompter that records what it was told,
 * what it was asked and whether it was closed, over a root of its own
 * under this file's own temporary root, holding the bytes `rafa init`
 * writes as its config. No case spawns a process, touches the home or
 * reads a real project. What the edit does to the text is
 * `src/release/setting.ts`'s and is held beside it; what is held here is
 * what decides that it happens at all, and the setting the config names
 * afterwards is read back through `parseConfigText` rather than matched
 * as a substring.
 *
 * ## What passes while wrong
 *
 * Every case that holds the step NOT asking also holds that the
 * prompter was never opened and the config kept its bytes, because a
 * step reported as unanswered while it rewrote the file is the failure
 * that costs a project the setting it did not choose. The `--yes` and
 * no-terminal cases are each paired with the same world on a terminal,
 * which does ask and does write, so neither reading can pass by the
 * question being unreachable for some other reason.
 *
 * Two mutations were driven on 2026-09-20 with both modules restored
 * from a scratch copy after each and verified with `shasum`, over
 * `bun test src/release/setting.test.ts src/commands/init-release.test.ts
 * src/commands/init.test.ts`, which reads 78 pass either side of both:
 *
 *  - the `--yes` answer dropped from `runReleaseStep`, so a line that
 *    says it will answer nothing is asked anyway: 1 fail, the `--yes`
 *    case here. `init.test.ts` stayed green, because its seams answer
 *    no terminal and that answer catches the same run — which is why
 *    the reading belongs to this file and not to that one.
 *  - the uncomment branch of `withReleaseEnabled` uncommenting the rest
 *    of the block, so the other three `release` settings are pinned at
 *    this build's defaults: 8 fail, five in `setting.test.ts` and three
 *    here, each of the three a case that reads the setting back out of
 *    a config the step had written.
 */
import type { Prompter } from '../cli/prompt/confirm.js';
import type { ReleaseFileSettings } from '../release/enabled.js';

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CONFIG_DEFAULTS, parseConfigText } from '../config.js';
import { projectConfigText } from '../project/scaffold.js';

import {
  askRelease,
  missingChangelogLine,
  missingVersionFileLine,
  releaseQuestion,
  RELEASE_FIX,
  renderReleaseStep,
  runReleaseStep,
} from './init-release.js';

/** A temporary directory of this file's own, its real path. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-init-release-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The three `release` settings at their defaults, as a resolved config carries them. */
const DEFAULT_SETTINGS: ReleaseFileSettings = {
  releaseEnabled: CONFIG_DEFAULTS.releaseEnabled,
  releaseVersionFile: CONFIG_DEFAULTS.releaseVersionFile,
  releaseChangelog: CONFIG_DEFAULTS.releaseChangelog,
};

/** A fresh project root holding `text`, the config `rafa init` writes when none is named. */
function freshRoot(label: string, text = projectConfigText()): string {
  const root = mkdtempSync(join(tempBase, `${label}-`));
  mkdirSync(join(root, '.rafa'));
  writeFileSync(join(root, '.rafa', 'config.yaml'), text, 'utf8');
  return root;
}

/** Plants both configured files under `root`, so an `auto` reading would be on. */
function plantReleaseFiles(root: string): void {
  writeFileSync(join(root, CONFIG_DEFAULTS.releaseVersionFile), '{"version":"1.2.3"}', 'utf8');
  writeFileSync(join(root, CONFIG_DEFAULTS.releaseChangelog), '# Changelog\n', 'utf8');
}

/** The project config's text under `root`. */
function configText(root: string): string {
  return readFileSync(join(root, '.rafa', 'config.yaml'), 'utf8');
}

/** What `release.enabled` resolves to in the project config under `root`. */
function settingUnder(root: string): boolean | 'auto' | null {
  const path = join(root, '.rafa', 'config.yaml');
  return parseConfigText(configText(root), path).values.releaseEnabled ?? null;
}

/** A prompter answering from `answers`, then null, recording what it was told. */
function scripted(answers: readonly string[]) {
  const record = { said: [] as string[], asked: [] as string[], opened: 0, closed: 0 };
  const queue = [...answers];
  const prompter: Prompter = {
    say: (text) => {
      record.said.push(text);
    },
    ask: (question) => {
      record.asked.push(question);
      return Promise.resolve(queue.shift() ?? null);
    },
    close: () => {
      record.closed += 1;
    },
  };
  return {
    record,
    open: (): Prompter => {
      record.opened += 1;
      return prompter;
    },
  };
}

/** A prompter nobody may open. */
function noPrompter(): Prompter {
  throw new Error('the release step opened a prompter where none was expected');
}

describe('the question', () => {
  it('names both configured files, and says nothing more when both are there', async () => {
    const root = freshRoot('both');
    plantReleaseFiles(root);
    const script = scripted(['']);

    const answer = await askRelease(script.open(), DEFAULT_SETTINGS, root);

    expect(answer).toBe(true);
    expect(script.record.asked).toEqual([releaseQuestion('package.json', 'CHANGELOG.md')]);
    expect(script.record.said).toEqual([]);
  });

  it('says a line for each configured file that is missing, above the question', async () => {
    const root = freshRoot('neither');
    const script = scripted(['y']);

    await askRelease(script.open(), DEFAULT_SETTINGS, root);

    expect(script.record.said).toEqual([
      missingVersionFileLine('package.json', 'CHANGELOG.md'),
      missingChangelogLine('CHANGELOG.md'),
    ]);
  });

  it('reads n and no as a no however they are cased, and anything else as a yes', async () => {
    const root = freshRoot('answers');
    const answers = ['n', 'NO', ' No ', 'y', 'yes', '', 'sure'];

    const read = [];
    for (const answer of answers) read.push(await askRelease(scripted([answer]).open(), DEFAULT_SETTINGS, root));

    expect(read).toEqual([false, false, false, true, true, true, true]);
  });

  it('answers null for an input that ended, which is nobody answering', async () => {
    const root = freshRoot('ended');

    expect(await askRelease(scripted([]).open(), DEFAULT_SETTINGS, root)).toBe(null);
  });
});

describe('the order the answer is decided in', () => {
  it('writes true under --release and false under --no-release, asking nothing', async () => {
    const on = freshRoot('flag-on');
    const off = freshRoot('flag-off');

    const turnedOn = await runReleaseStep({
      wanted: true,
      yes: false,
      root: on,
      settings: DEFAULT_SETTINGS,
      isTerminal: () => true,
      openPrompter: noPrompter,
    });
    const turnedOff = await runReleaseStep({
      wanted: false,
      yes: false,
      root: off,
      settings: DEFAULT_SETTINGS,
      isTerminal: () => true,
      openPrompter: noPrompter,
    });

    expect(turnedOn).toMatchObject({ status: 'set', asked: false, enabled: true, changed: true });
    expect(settingUnder(on)).toBe(true);
    expect(turnedOff).toMatchObject({ status: 'set', asked: false, enabled: false, changed: true });
    expect(settingUnder(off)).toBe(false);
  });

  it('leaves a config that already sets the setting exactly as it was, asking nothing', async () => {
    const root = freshRoot('answered', 'version: 1\nrelease:\n  enabled: false\n');
    const script = scripted(['y']);
    const before = configText(root);

    const result = await runReleaseStep({
      wanted: null,
      yes: false,
      root,
      settings: DEFAULT_SETTINGS,
      isTerminal: () => true,
      openPrompter: script.open,
    });

    expect(result).toMatchObject({ status: 'present', asked: false, enabled: false, changed: false });
    expect(script.record.opened).toBe(0);
    expect(configText(root)).toBe(before);
  });

  it('writes nothing when a flag says what the config already says', async () => {
    const root = freshRoot('agreed', 'version: 1\nrelease:\n  enabled: true\n');
    const before = configText(root);

    const result = await runReleaseStep({
      wanted: true,
      yes: false,
      root,
      settings: DEFAULT_SETTINGS,
      isTerminal: () => true,
      openPrompter: noPrompter,
    });

    expect(result).toMatchObject({ status: 'present', enabled: true, changed: false });
    expect(configText(root)).toBe(before);
  });

  it('writes the flag over a config that says something else', async () => {
    const root = freshRoot('overruled', 'version: 1\nrelease:\n  enabled: auto\n');

    const result = await runReleaseStep({
      wanted: false,
      yes: false,
      root,
      settings: DEFAULT_SETTINGS,
      isTerminal: () => true,
      openPrompter: noPrompter,
    });

    expect(result).toMatchObject({ status: 'set', enabled: false, changed: true });
    expect(settingUnder(root)).toBe(false);
  });

  it('asks nothing under --yes, and asks the same world without it', async () => {
    const quiet = freshRoot('yes-flag');
    const asked = freshRoot('asked');
    const script = scripted(['y']);
    const before = configText(quiet);

    const underYes = await runReleaseStep({
      wanted: null,
      yes: true,
      root: quiet,
      settings: DEFAULT_SETTINGS,
      isTerminal: () => true,
      openPrompter: noPrompter,
    });
    const control = await runReleaseStep({
      wanted: null,
      yes: false,
      root: asked,
      settings: DEFAULT_SETTINGS,
      isTerminal: () => true,
      openPrompter: script.open,
    });

    expect(underYes).toMatchObject({ status: 'unanswered', asked: false, enabled: null, changed: false });
    expect(configText(quiet)).toBe(before);
    expect(control).toMatchObject({ status: 'set', asked: true, enabled: true });
    expect(script.record.closed).toBe(1);
  });

  it('asks nothing without a terminal, and asks the same world with one', async () => {
    const quiet = freshRoot('no-terminal');
    const asked = freshRoot('terminal');
    const script = scripted(['n']);
    const before = configText(quiet);

    const noTerminal = await runReleaseStep({
      wanted: null,
      yes: false,
      root: quiet,
      settings: DEFAULT_SETTINGS,
      isTerminal: () => false,
      openPrompter: noPrompter,
    });
    const control = await runReleaseStep({
      wanted: null,
      yes: false,
      root: asked,
      settings: DEFAULT_SETTINGS,
      isTerminal: () => true,
      openPrompter: script.open,
    });

    expect(noTerminal).toMatchObject({ status: 'unanswered', asked: false, changed: false });
    expect(configText(quiet)).toBe(before);
    expect(control).toMatchObject({ status: 'set', asked: true, enabled: false });
    expect(settingUnder(asked)).toBe(false);
  });

  it('leaves the setting unset when the input ended, having asked', async () => {
    const root = freshRoot('ended-input');
    const script = scripted([]);
    const before = configText(root);

    const result = await runReleaseStep({
      wanted: null,
      yes: false,
      root,
      settings: DEFAULT_SETTINGS,
      isTerminal: () => true,
      openPrompter: script.open,
    });

    expect(result).toMatchObject({ status: 'unanswered', asked: true, enabled: null, changed: false });
    expect(configText(root)).toBe(before);
    expect(script.record.closed).toBe(1);
  });
});

describe('a config the setting cannot be written into', () => {
  it('refuses a root holding no config, asking nothing and naming the fix', async () => {
    const result = await runReleaseStep({
      wanted: true,
      yes: false,
      root: join(tempBase, 'nowhere'),
      settings: DEFAULT_SETTINGS,
      isTerminal: () => true,
      openPrompter: noPrompter,
    });

    expect(result).toMatchObject({ status: 'refused', asked: false, changed: false });
    expect(result.warnings[0]).toContain('could not be read');
    expect(result.warnings[0]).toContain(RELEASE_FIX);
  });

  it('refuses a config spelling release in a shape the edit does not cover, leaving its bytes', async () => {
    const root = freshRoot('flow', 'version: 1\nrelease: {enabled: auto}\n');
    const before = configText(root);

    const result = await runReleaseStep({
      wanted: true,
      yes: false,
      root,
      settings: DEFAULT_SETTINGS,
      isTerminal: () => true,
      openPrompter: noPrompter,
    });

    expect(result).toMatchObject({ status: 'refused', enabled: 'auto', changed: false });
    expect(result.warnings[0]).toContain('a shape this command does not edit');
    expect(configText(root)).toBe(before);
  });
});

describe('the line text mode prints', () => {
  it('names the setting written, and what it means', () => {
    const on = renderReleaseStep({ status: 'set', asked: true, enabled: true, changed: true, warnings: [] });
    const off = renderReleaseStep({ status: 'set', asked: true, enabled: false, changed: true, warnings: [] });

    expect(on).toEqual(['release.enabled: true (on) written to .rafa/config.yaml.']);
    expect(off).toEqual(['release.enabled: false (off) written to .rafa/config.yaml.']);
  });

  it('says a setting already there was left as it was, auto included', () => {
    const line = renderReleaseStep({ status: 'present', asked: false, enabled: 'auto', changed: false, warnings: [] });

    expect(line).toEqual(['release.enabled: auto (on when both configured files exist) in .rafa/config.yaml,'
      + ' left as it was.']);
  });

  it('names the fix when nobody answered, and says nothing at all when the write was refused', () => {
    const unset = renderReleaseStep({ status: 'unanswered', asked: false, enabled: null, changed: false, warnings: [] });
    const refused = renderReleaseStep({
      status: 'refused',
      asked: false,
      enabled: null,
      changed: false,
      warnings: ['it could not be written'],
    });

    expect(unset).toEqual([`release.enabled is left unset, which reads as auto; run ${RELEASE_FIX} to set it.`]);
    expect(refused).toEqual([]);
  });
});
