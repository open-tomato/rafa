/**
 * The engineer's opening message: which prompt file a stretch starts
 * from, and the text it becomes once `{{STRETCH}}` and `{{PREVIOUS}}`
 * are filled in (#816).
 *
 * The rules are the ones `scripts/stretch/stretch.sh` follows, with one
 * change: the default comes from the installed package, never from a
 * checkout's `scripts/`.
 *
 *   - **Which file.** {@link engineerPromptFile} takes the first of
 *     three: the project's own `.rafa/stretch/engineer-prompt.md`; then,
 *     when the project is the rafa checkout, `scripts/stretch/engineer-prompt.md`,
 *     which carries rafa's own work; then the bundled default. So no
 *     other project is handed rafa's carried work.
 *   - **The rafa checkout** ({@link isRafaCheckout}) is a root whose
 *     `package.json` is named `@open-tomato/rafa` and which holds
 *     `src/rafa.ts`, the test `src/runtime/identity.ts` makes of a
 *     checkout. The script asked instead whether the project was the
 *     checkout it sat in; a command runs from an installed package that
 *     sits in no checkout, so the project is asked what it is.
 *   - **The default** ({@link bundledPromptPath}) is
 *     `bundled/stretch/engineer-prompt-default.md` beside the running
 *     entry with its links resolved, found the way
 *     `bundledOperatorsDirectory` (`./operators.ts`) finds the
 *     operators. The build copies `src/bundled/` to `dist/bundled/`, so
 *     an installed package carries it.
 *   - **The fill.** {@link fillPrompt} writes the stretch number for
 *     every `{{STRETCH}}` and the one before it for every `{{PREVIOUS}}`.
 *     On a first stretch there is no report before it, so each line
 *     naming `{{PREVIOUS}}` is dropped first, and a run of blank lines
 *     that leaves is squeezed to one, as the script's `cat -s` does.
 *
 * Every read goes through {@link PromptSeams}. Nothing outside
 * `src/commands/stretch/` and `src/commands/doctor-stretch.ts` imports
 * this module, so the stretch logic can move into its own package.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { name as RAFA_PACKAGE_NAME } from '../../package.json';
import { errorCode } from '../loop/sessions.js';
import { realEntry } from '../schema/tiers.js';

import { STRETCH_DIR } from './folder.js';

/** The project's own prompt, relative to its root. */
export const PROJECT_PROMPT = join(STRETCH_DIR, 'engineer-prompt.md');

/** Rafa's own prompt, relative to the rafa checkout's root. */
export const RAFA_PROMPT = join('scripts', 'stretch', 'engineer-prompt.md');

/** The default prompt, relative to the folder of the running entry. */
export const BUNDLED_PROMPT = join('bundled', 'stretch', 'engineer-prompt-default.md');

/** The placeholder for the stretch being started. */
export const STRETCH_PLACEHOLDER = '{{STRETCH}}';

/** The placeholder for the stretch before it. */
export const PREVIOUS_PLACEHOLDER = '{{PREVIOUS}}';

/** The file under a checkout that makes it one: the CLI's source entry. */
const CHECKOUT_ENTRY = join('src', 'rafa.ts');

/** The reads the prompt goes through. */
export interface PromptFs {
  /** Whether a file is at `path`. */
  readonly exists: (path: string) => boolean;
  /** The text of `file`, or null when it does not exist. */
  readonly readText: (file: string) => string | null;
}

/** The effects and readings every function here reaches through. */
export interface PromptSeams {
  readonly fs: PromptFs;
  /** The running entry, as `Bun.main` names it; its links are resolved. */
  readonly entry: string;
}

/** Which of the three files a prompt came from. */
export type PromptSource = 'project' | 'rafa' | 'bundled';

/** The prompt file a stretch starts from. */
export interface PromptFile {
  readonly path: string;
  readonly source: PromptSource;
}

/** A prompt read and filled in. */
export interface PromptRead extends PromptFile {
  readonly kind: 'read';
  readonly text: string;
}

/** A prompt file that is not there: only the bundled default can be, in a broken install. */
export interface PromptMissing extends PromptFile {
  readonly kind: 'missing';
  readonly reason: string;
}

/** What {@link engineerPrompt} read. */
export type PromptReading = PromptRead | PromptMissing;

/** `bundled/stretch/engineer-prompt-default.md` beside the entry, links resolved. */
export function bundledPromptPath(entry?: string): string {
  return join(dirname(realEntry(entry ?? Bun.main)), BUNDLED_PROMPT);
}

/** True when `root` is the rafa checkout; see the module note. */
export function isRafaCheckout(root: string, fs: PromptFs = nodePromptFs): boolean {
  if (!fs.exists(join(root, CHECKOUT_ENTRY))) return false;
  const text = fs.readText(join(root, 'package.json'));
  if (text === null) return false;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object'
      && parsed !== null
      && (parsed as Record<string, unknown>)['name'] === RAFA_PACKAGE_NAME;
  } catch {
    return false;
  }
}

/** The first of the project's prompt, rafa's own in the rafa checkout, and the bundled default. */
export function engineerPromptFile(root: string, seams: PromptSeams = defaultPromptSeams()): PromptFile {
  const project = join(root, PROJECT_PROMPT);
  if (seams.fs.exists(project)) return { path: project, source: 'project' };
  const rafa = join(root, RAFA_PROMPT);
  if (isRafaCheckout(root, seams.fs) && seams.fs.exists(rafa)) return { path: rafa, source: 'rafa' };
  return { path: bundledPromptPath(seams.entry), source: 'bundled' };
}

/**
 * The prompt with `{{STRETCH}}` and `{{PREVIOUS}}` filled in for stretch
 * `stretch`, each `{{PREVIOUS}}` line dropped on a first stretch. Throws
 * on a number that is no stretch number.
 */
export function fillPrompt(text: string, stretch: number): string {
  if (!Number.isSafeInteger(stretch) || stretch < 1) {
    throw new Error(`not a stretch number: ${String(stretch)}`);
  }
  const lines = stretch === 1
    ? text.split('\n').filter((line) => !line.includes(PREVIOUS_PLACEHOLDER))
    : text.split('\n');
  return squeezeBlankRuns(lines)
    .join('\n')
    .replaceAll(STRETCH_PLACEHOLDER, String(stretch))
    .replaceAll(PREVIOUS_PLACEHOLDER, String(stretch - 1));
}

/** The prompt stretch `stretch` of the project at `root` opens with, or `missing` when its file is not there. */
export function engineerPrompt(root: string, stretch: number, seams: PromptSeams = defaultPromptSeams()): PromptReading {
  const file = engineerPromptFile(root, seams);
  const text = seams.fs.readText(file.path);
  if (text === null) {
    return { kind: 'missing', ...file, reason: `${file.path} is missing` };
  }
  return { kind: 'read', ...file, text: fillPrompt(text, stretch) };
}

/** The real filesystem and entry. */
export function defaultPromptSeams(): PromptSeams {
  return { fs: nodePromptFs, entry: Bun.main };
}

/** {@link PromptFs} over `node:fs`; a missing file reads as null, any other failure throws. */
export const nodePromptFs: PromptFs = {
  exists: (path) => existsSync(path),
  readText(file) {
    try {
      return readFileSync(file, 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null;
      throw error;
    }
  },
};

/** The lines with each run of blank lines cut to one, as `cat -s` does. */
function squeezeBlankRuns(lines: readonly string[]): readonly string[] {
  return lines.filter((line, index) => line.trim() !== '' || index === 0 || lines[index - 1]?.trim() !== '');
}
