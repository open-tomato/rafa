/**
 * The release step `rafa init` takes once the scopes are written:
 * whether this project bumps a version and writes a changelog entry
 * with every pull request, the one question it asks, and the line it
 * prints for what came of it.
 *
 * `.specs/rafa-21-changelog-and-release.md` ends its config section
 * with "`rafa init` asks once", and this is that question. What it
 * decides is one setting, `release.enabled`, written into the project's
 * `.rafa/config.yaml` through `src/release/setting.ts`; the other three
 * `release` settings stay commented at their defaults, where an
 * operator can read them and set them by hand.
 *
 * ## Asked once, and only when nobody has answered already
 *
 * {@link runReleaseStep} decides in this order, and the first answer
 * wins:
 *
 *   - `--release` or `--no-release`: taken as the answer, nothing is
 *     asked.
 *   - The project config already SETS `release.enabled`: left exactly
 *     as it is and nothing is asked. A rerun of `rafa init` over a
 *     project that answered once therefore changes no byte, which is
 *     the promise `rafa init` makes about a rerun.
 *   - `--yes`: not asked. `--yes` means "do not ask me anything" — it
 *     is how the root is taken without a prompt — so the setting is
 *     left unset, which reads as the default `auto`.
 *   - No terminal: not asked, for the reason `init` refuses to prompt
 *     for a root without one, and the line naming `rafa init --release`
 *     is printed instead.
 *   - Otherwise: the question, on stderr through the {@link Prompter}
 *     `init` reads a root with, so a json-mode stdout stays NDJSON.
 *
 * An answer that is `n` or anything else is a NO and is written as
 * `release.enabled: false`, because a question whose no changes nothing
 * is a question that was not worth asking: under the default `auto` a
 * repository that grows a `CHANGELOG.md` later would turn the release
 * on by itself, which is exactly what the operator declined.
 *
 * An input that ENDED is not an answer at all, and leaves the setting
 * unset. The question is spelled `[Y/n]`, so reading the end of an
 * input as the default would turn the release on for nobody, and
 * reading it as a no would write a refusal nobody typed.
 *
 * ## What the question says
 *
 * The question names both configured paths, and a missing one gets a
 * line above it: a repository with no version manifest still gets
 * changelog entries and no bump, which the spec spells out and is a
 * thing to know BEFORE answering. Those presences come from
 * `resolveReleaseEnabled` (`src/release/enabled.ts`), the same reading
 * the wrap-up makes, and are read only when the question is actually
 * asked — the flags and an already-set config have decided by then, and
 * two `stat` calls to word a question nobody sees are two too many.
 *
 * ## Nothing here refuses `rafa init`
 *
 * The step runs after the scopes are on disk, so a config that cannot
 * be read, one spelling `release` in a shape the edit does not cover,
 * and a write that fails are each reported as a refused step carrying
 * its reason as a warning, never as a refusal of `rafa init`: a project
 * is set up whether or not this one setting could be written, exactly
 * as with the board step (`./init-board.ts`).
 *
 * Nothing here spawns. The terminal and the prompter arrive through
 * `src/commands/init.ts`'s seams, and the only disk this module touches
 * is the project config under the root it is handed, which every case
 * in `./init-release.test.ts` points at its own temporary directory.
 */
import type { ReleaseEnabled } from '../config-sections.js';
import type { Prompter } from '../project/root-choice.js';
import type { ReleaseFileSettings } from '../release/enabled.js';

import { writeFileSync } from 'node:fs';

import { describeValue, messageOf, RELEASE_AUTO } from '../config-sections.js';
import { CONFIG_FILE, configFilePath } from '../config.js';
import { resolveReleaseEnabled } from '../release/enabled.js';
import {
  readReleaseSetting,
  RELEASE_ENABLED_SETTING,
  releaseEnabledIn,
  withReleaseEnabled,
} from '../release/setting.js';

/** The answers that mean no to the question, which is spelled `[Y/n]`. */
const NO_ANSWERS: readonly string[] = ['n', 'no'];

/** What a run that did not set the setting names as the way to set it. */
export const RELEASE_FIX = 'rafa init --release';

/** The question, asked once for the whole release. */
export function releaseQuestion(versionFile: string, changelog: string): string {
  return `Bump ${versionFile} and add a ${changelog} entry with every pull request? [Y/n] `;
}

/** The line a repository with no version manifest gets above the question. */
export function missingVersionFileLine(versionFile: string, changelog: string): string {
  return `There is no ${versionFile} here, so a yes writes ${changelog} entries and bumps no version.`;
}

/** The line a repository with no changelog gets above the question. */
export function missingChangelogLine(changelog: string): string {
  return `There is no ${changelog} here yet; release.changelog names the path an entry is written to.`;
}

/** What the release step came to. */
export type ReleaseStepStatus =
  /** An answer was written into the project config. */
  | 'set'
  /** The project config already said so, and was left as it was. */
  | 'present'
  /** Nobody was asked, or the input ended: the setting is left unset. */
  | 'unanswered'
  /** The answer could not be written; `warnings` says why. */
  | 'refused';

/** What one run of {@link runReleaseStep} came to. */
export interface ReleaseStepResult {
  readonly status: ReleaseStepStatus;
  /** True when the question was put to an operator. */
  readonly asked: boolean;
  /** What the project config names `release.enabled` as after the step, or null when it names none. */
  readonly enabled: ReleaseEnabled | null;
  /** True when the project config was rewritten. */
  readonly changed: boolean;
  /** A sentence per reading that failed without stopping the step. */
  readonly warnings: readonly string[];
}

/** What {@link runReleaseStep} is asked. */
export interface ReleaseStepOptions {
  /** True for `--release`, false for `--no-release`, null when the line said neither. */
  readonly wanted: boolean | null;
  /** True under `--yes`, which asks nothing. */
  readonly yes: boolean;
  /** The project root: where the config is read and written. */
  readonly root: string;
  /** The three `release` settings as the config resolved them, which word the question. */
  readonly settings: ReleaseFileSettings;
  /** True when a question can be answered. */
  readonly isTerminal: () => boolean;
  /** Opens the prompter the question is asked through. Called only to ask. */
  readonly openPrompter: () => Prompter;
}

/** A step that wrote nothing, carrying `warnings`. */
function noWrite(
  status: ReleaseStepStatus,
  enabled: ReleaseEnabled | null,
  asked: boolean,
  warnings: readonly string[] = [],
): ReleaseStepResult {
  return { status, asked, enabled, changed: false, warnings: Object.freeze([...warnings]) };
}

/** What a step that could not write the setting is warned about. */
export function releaseRefusedWarning(path: string, why: string): string {
  return `${path} was left as it was: ${why}. Set ${RELEASE_ENABLED_SETTING} by hand, or run ${RELEASE_FIX}.`;
}

/**
 * Asks the question, a line for each configured file that is missing
 * above it. False only for `n` or `no`, however it is cased, and null
 * when the input ended: see the module note on why the three answers
 * are not two.
 */
export async function askRelease(
  prompter: Prompter,
  settings: ReleaseFileSettings,
  root: string,
): Promise<boolean | null> {
  const reading = resolveReleaseEnabled(settings, root);
  if (!reading.versionFile.present) {
    prompter.say(missingVersionFileLine(reading.versionFile.path, reading.changelog.path));
  }
  if (!reading.changelog.present) prompter.say(missingChangelogLine(reading.changelog.path));

  const answer = await prompter.ask(releaseQuestion(reading.versionFile.path, reading.changelog.path));
  if (answer === null) return null;
  return !NO_ANSWERS.includes(answer.trim().toLowerCase());
}

/** The answer an operator typed, with the prompter opened and closed around it. */
async function answered(options: ReleaseStepOptions): Promise<boolean | null> {
  const prompter = options.openPrompter();
  try {
    return await askRelease(prompter, options.settings, options.root);
  } finally {
    prompter.close();
  }
}

/**
 * Writes `release.enabled: <enabled>` into the project config under
 * `root`, having read the text back as that answer first. Answers null
 * when it was written, or the reason it was not.
 */
function writeSetting(root: string, text: string, enabled: boolean): string | null {
  const path = configFilePath(root);
  const written = withReleaseEnabled(text, enabled);
  if (written === null) {
    return 'it spells release in a shape this command does not edit';
  }

  let read: ReleaseEnabled | null;
  try {
    read = releaseEnabledIn(written, path);
  } catch (error) {
    return `the file this run would have written does not parse: ${messageOf(error)}`;
  }
  if (read !== enabled) {
    return `the file this run would have written reads ${RELEASE_ENABLED_SETTING} as ${describeValue(read)}`;
  }

  try {
    writeFileSync(path, written, 'utf8');
  } catch (error) {
    return `it could not be written: ${messageOf(error)}`;
  }
  return null;
}

/**
 * Decides `release.enabled` for the project under `root` and writes it
 * when there is something to write; see the module note for the order
 * the answer is decided in. Never throws: a config it cannot read or
 * write is a refused step carrying its reason.
 */
export async function runReleaseStep(options: ReleaseStepOptions): Promise<ReleaseStepResult> {
  const path = configFilePath(options.root);
  const reading = readReleaseSetting(options.root);
  if (reading.problem !== null) {
    return noWrite('refused', null, false, [releaseRefusedWarning(path, reading.problem)]);
  }

  let asked = false;
  let answer = options.wanted;
  if (answer === null) {
    if (reading.enabled !== null) return noWrite('present', reading.enabled, false);
    if (options.yes || !options.isTerminal()) return noWrite('unanswered', null, false);
    answer = await answered(options);
    asked = true;
    if (answer === null) return noWrite('unanswered', null, true);
  }
  if (answer === reading.enabled) return noWrite('present', reading.enabled, asked);

  const why = writeSetting(options.root, reading.text, answer);
  if (why !== null) return noWrite('refused', reading.enabled, asked, [releaseRefusedWarning(path, why)]);
  return { status: 'set', asked, enabled: answer, changed: true, warnings: Object.freeze([]) };
}

/** What `enabled` means, as a line says it. */
function stateOf(enabled: ReleaseEnabled): string {
  if (enabled === RELEASE_AUTO) return 'on when both configured files exist';
  return enabled
    ? 'on'
    : 'off';
}

/** The line text mode writes for the step, and none when it has nothing to say. */
export function renderReleaseStep(result: ReleaseStepResult): readonly string[] {
  if (result.status === 'refused') return [];
  if (result.enabled === null) {
    return [`${RELEASE_ENABLED_SETTING} is left unset, which reads as ${RELEASE_AUTO};`
      + ` run ${RELEASE_FIX} to set it.`];
  }
  const state = `${RELEASE_ENABLED_SETTING}: ${String(result.enabled)} (${stateOf(result.enabled)})`;
  return result.status === 'set'
    ? [`${state} written to ${CONFIG_FILE}.`]
    : [`${state} in ${CONFIG_FILE}, left as it was.`];
}
