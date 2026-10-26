/**
 * `rafa release fragment --plan=<id> --level=<level> --title=<text>
 * [--note=<area>: <summary>]... [--package=<name>]`: writes one change
 * fragment under `release.fragments` for a branch that has no wrap-up to
 * write it, such as a bot's pull request, and prints the path written.
 *
 * ```text
 * $ rafa release fragment --plan=dependabot-7 --level=patch --title='Bump zod'
 * .changes/dependabot-7-2.md
 * ```
 *
 * ## What the fragment holds
 *
 * The file is `packages/rafa/src/release/fragment.ts`'s format, written by
 * `serializeFragment`, so nothing written here is a file settle would
 * refuse to read:
 *
 *   - `plan` is `--plan`, refused unless it matches
 *     `FRAGMENT_PLAN_ID_PATTERN`;
 *   - `title` is `--title` with its whitespace collapsed to one line,
 *     refused when that leaves nothing;
 *   - `level` is `--level`, refused unless it is one of `patch`, `minor`,
 *     `major` and `none`;
 *   - `package` is `--package`, refused when the workspace of the
 *     checkout (`readWorkspacePackages`, `src/release/workspace-packages.ts`)
 *     holds no member of that name or holds it as `private`, since settle
 *     refuses such a fragment on the base; left out, the fragment is the
 *     root package's;
 *   - the notes are each `--note=<area>: <summary>` as one
 *     `- <area>: <summary>` line, in the order given, a note with no
 *     colon or an empty side refused. The flag is read off the line's own
 *     words (`RafaContext.argv`), since the parsed flags keep only the
 *     last of a flag given twice.
 *
 * A level other than `none` given no note cannot be written bare: the
 * format refuses a `patch`, `minor` or `major` with no body. The title
 * then becomes the one note, `- <title>`, as the wrap-up's own step does
 * (`src/release/prepare.ts`), and a warning says so. This is what lets
 * the bot fragment workflow pass only a title.
 *
 * ## The name
 *
 * The file is named by `allocateFragmentName` over the fragments waiting
 * on `origin/<pr.base>` (`main` when unset), read by `readFragmentTree`
 * (`src/release/fragment-tree.ts`) after a `git fetch` of it: `<plan>.md`,
 * or `-2`, `-3` and on when that name waits there, so the merge of the
 * branch never meets an add/add conflict. A failed fetch is a warning
 * and the ref is read as this clone holds it; a base that cannot be read
 * at all is refused, since no free name can be chosen without it.
 *
 * The name allocated is then checked against the branch: a file at that
 * path in the working tree or in `HEAD`'s tree is refused, so a second
 * run never overwrites nor duplicates the fragment the first one wrote.
 * The write itself opens the file with `wx`, so a file appearing between
 * the check and the write is not overwritten either.
 *
 * ## Refusals, output and json
 *
 * Every refusal exits 1 before anything is written. A run that wrote
 * prints its warnings, each a `warn:` line, then the path relative to
 * the repository root as the last line, so a script reads the path off
 * the last line. With `--output=json` the terminal
 * result's data is {@link ReleaseFragmentResult}: the path, the fragment
 * and the warnings.
 */
import type { RafaCommand, RafaContext } from '@open-tomato/rafa/core/command';
import type { GitRunner } from '@open-tomato/rafa/core/git';
import type { PlanReleaseLevel } from '@open-tomato/rafa/core/plan';
import type { Fragment } from '@open-tomato/rafa/release/fragment';

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

import { expectNoArgument, requireProject, resolveProjectConfig } from '@open-tomato/rafa/commands/plan/plan-files';
import { CommandExit } from '@open-tomato/rafa/core/command';
import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { createGitRunner, gitSaid } from '@open-tomato/rafa/core/git';
import { PLAN_RELEASE_LEVELS } from '@open-tomato/rafa/core/plan';
import { allocateFragmentName, FRAGMENT_PLAN_ID_PATTERN, serializeFragment } from '@open-tomato/rafa/release/fragment';

import { readFragmentTree } from '../../release/fragment-tree.js';
import { RELEASE_BASE_BRANCH, RELEASE_REMOTE } from '../../release/version.js';
import { packageNamed, readWorkspacePackages } from '../../release/workspace-packages.js';

import { RELEASE_FRAGMENT_DECLARATION, RELEASE_FRAGMENT_LEVEL_FLAG, RELEASE_FRAGMENT_NOTE_FLAG, RELEASE_FRAGMENT_PACKAGE_FLAG, RELEASE_FRAGMENT_PLAN_FLAG, RELEASE_FRAGMENT_TITLE_FLAG } from './declarations.js';

/** The command's name, as its refusals spell it. */
const COMMAND_NAME = 'rafa release fragment';

/** The usage line this action's refusals name. */
export const RELEASE_FRAGMENT_USAGE: string = 'rafa release fragment --plan=<id> --level=<level> --title=<text>'
  + ' [--note=<area>: <summary>]... [--package=<name>]';

/** The flag naming the plan id the fragment carries and is named by. */
export const PLAN_FLAG: string = RELEASE_FRAGMENT_PLAN_FLAG;

/** The flag naming the bump the fragment asks for. */
export const LEVEL_FLAG: string = RELEASE_FRAGMENT_LEVEL_FLAG;

/** The flag carrying the fragment's title. */
export const TITLE_FLAG: string = RELEASE_FRAGMENT_TITLE_FLAG;

/** The flag carrying one note, given once per note. */
export const NOTE_FLAG: string = RELEASE_FRAGMENT_NOTE_FLAG;

/** The flag naming the workspace package the fragment releases. */
export const PACKAGE_FLAG: string = RELEASE_FRAGMENT_PACKAGE_FLAG;

/** The word after which nothing on the line is a flag. */
const END_OF_FLAGS = '--';

/** Any whitespace run, collapsed to one space in a title or a note. */
const WHITESPACE = /\s+/g;

/** Any whitespace at all, which a package name may not hold. */
const HOLDS_WHITESPACE = /\s/;

/** What json mode gives as the terminal result's `data`. */
export interface ReleaseFragmentResult {
  /** The path written, relative to the repository root, `/`-separated. */
  readonly path: string;
  /** The fragment as written. */
  readonly fragment: Fragment;
  /** One sentence per reading that did not come out as asked; each also a warning. */
  readonly problems: readonly string[];
}

/** The seams this action reaches git through. */
export interface FragmentSeams {
  /** Makes the git runner the base is fetched and read through. */
  readonly git?: (root: string) => GitRunner;
}

/** The flags of the line, read and checked, before anything touches the repository. */
interface FragmentRequest {
  readonly plan: string;
  readonly level: PlanReleaseLevel;
  readonly title: string;
  readonly notes: readonly string[];
  readonly package: string | null;
}

/** The exit a run refused with: the sentence, then the usage. */
function refusal(message: string): CommandExit {
  return new CommandExit(1, `❌ ${message}\nUsage: ${RELEASE_FRAGMENT_USAGE}`);
}

/** One line of text, its whitespace runs collapsed and its ends trimmed. */
function oneLine(text: string): string {
  return text.replace(WHITESPACE, ' ').trim();
}

/** The string `--<name>` carries, refused when the line leaves it out or gives it bare. */
function requiredValue(name: string, value: string | boolean | undefined, example: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw refusal(`--${name} takes a value, as ${example}`);
  }
  return value;
}

function isReleaseLevel(value: string): value is PlanReleaseLevel {
  return (PLAN_RELEASE_LEVELS as readonly string[]).includes(value);
}

/** The plan id `--plan` carries, refused outside `FRAGMENT_PLAN_ID_PATTERN`. */
function readPlan(value: string | boolean | undefined): string {
  const plan = requiredValue(PLAN_FLAG, value, '--plan=dependabot-7');
  if (!FRAGMENT_PLAN_ID_PATTERN.test(plan)) {
    throw refusal(`the plan id ${JSON.stringify(plan)} cannot name a fragment: it is letters, digits, '.', '_' and '-', starting with a letter or digit`);
  }
  return plan;
}

/** The level `--level` carries, refused outside `PLAN_RELEASE_LEVELS`. */
function readLevel(value: string | boolean | undefined): PlanReleaseLevel {
  const level = requiredValue(LEVEL_FLAG, value, '--level=patch');
  if (!isReleaseLevel(level)) {
    throw refusal(`the level ${JSON.stringify(level)} is not one of ${PLAN_RELEASE_LEVELS.join(', ')}`);
  }
  return level;
}

/** The title `--title` carries as one line, refused when nothing is left. */
function readTitle(value: string | boolean | undefined): string {
  return oneLine(requiredValue(TITLE_FLAG, value, '--title=\'Bump zod from 3.22 to 3.23\''));
}

/** The package `--package` names, or null when the line names none. */
function readPackageFlag(value: string | boolean | undefined): string | null {
  if (value === undefined) return null;
  const name = requiredValue(PACKAGE_FLAG, value, '--package=@scope/plugin').trim();
  if (HOLDS_WHITESPACE.test(name)) throw refusal(`the package ${JSON.stringify(name)} holds whitespace`);
  return name;
}

/**
 * Every `--note` value on `argv`, in the order given, read by the rules
 * the line parser reads one flag by: `--note=<value>`, or `--note
 * <value>` when the next word does not open with `-`; nothing after `--`.
 * A bare `--note` is refused.
 */
export function readNoteValues(argv: readonly string[]): readonly string[] {
  const values: string[] = [];
  const long = `--${NOTE_FLAG}`;
  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index];
    if (word === undefined || word === END_OF_FLAGS) break;
    if (word.startsWith(`${long}=`)) {
      values.push(word.slice(long.length + 1));
      continue;
    }
    if (word !== long) continue;
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('-')) throw refusal('--note takes a value, as --note=\'deps: bump zod\'');
    values.push(next);
    index += 1;
  }
  return values;
}

/** One `--note` value as the fragment's `- <area>: <summary>` line, refused when it is not that shape. */
export function noteLine(value: string): string {
  const colon = value.indexOf(':');
  const area = colon < 0
    ? ''
    : oneLine(value.slice(0, colon));
  const summary = colon < 0
    ? ''
    : oneLine(value.slice(colon + 1));
  if (area === '' || summary === '') {
    throw refusal(`the note ${JSON.stringify(value)} is not <area>: <summary>, both sides non-empty`);
  }
  return `- ${area}: ${summary}`;
}

/** The line's flags read and checked; see the module note. */
export function readFragmentRequest(context: Pick<RafaContext, 'args' | 'argv' | 'flags'>): FragmentRequest {
  expectNoArgument(context.args, RELEASE_FRAGMENT_USAGE);
  const plan = readPlan(context.flags[PLAN_FLAG]);
  const level = readLevel(context.flags[LEVEL_FLAG]);
  const title = readTitle(context.flags[TITLE_FLAG]);
  const notes = readNoteValues(context.argv).map(noteLine);
  return { plan, level, title, notes, package: readPackageFlag(context.flags[PACKAGE_FLAG]) };
}

/** Refuses a package the checkout's workspace lacks or holds as private. */
function checkPackage(root: string, name: string | null): void {
  if (name === null) return;
  const workspace = readWorkspacePackages(root);
  if (!workspace.ok) throw refusal(`the workspace packages could not be read to check ${name}: ${workspace.problem}`);
  const member = packageNamed(workspace.packages, name);
  if (member === null) throw refusal(`the workspace holds no package named ${name}`);
  if (member.isPrivate) throw refusal(`${name} (${member.dir}) is private, so it never releases and settle would refuse its fragment`);
}

/** The file names waiting on the base after a fetch of it, and the warning a failed fetch leaves. */
function waitingNames(
  git: GitRunner,
  branch: string,
  fragments: string,
): { readonly names: readonly string[]; readonly problems: readonly string[] } {
  const ref = `${RELEASE_REMOTE}/${branch}`;
  const fetched = git(['fetch', RELEASE_REMOTE, branch]);
  const problems = fetched.ok
    ? []
    : [`${branch} could not be fetched from ${RELEASE_REMOTE}, so the fragments waiting on it are whatever this clone holds for ${ref}: ${gitSaid(fetched)}`];
  const tree = readFragmentTree(git, ref, fragments);
  if (!tree.ok) throw refusal(`${tree.problem}, so no free fragment name could be chosen`);
  return { names: tree.fragments.map((each) => posix.basename(each.path)), problems };
}

/** True when `path` is in `HEAD`'s tree; a repository with no commit holds nothing. */
function inHead(git: GitRunner, path: string): boolean {
  const listed = git(['ls-tree', '--name-only', 'HEAD', '--', path]);
  return listed.ok && listed.stdout.trim() !== '';
}

/** The notes the fragment carries: the line's, or the title as the one note where a shipping level would carry none. */
function fragmentNotes(request: FragmentRequest): { readonly notes: readonly string[]; readonly problem: string | null } {
  if (request.notes.length > 0 || request.level === 'none') return { notes: request.notes, problem: null };
  return {
    notes: [`- ${request.title}`],
    problem: `no --note was given, so the ${request.level} fragment's one note is its title`,
  };
}

/** Writes `text` at `resolved`, its directory made first, never over an existing file. */
function writeNew(path: string, resolved: string, text: string): void {
  try {
    mkdirSync(dirname(resolved), { recursive: true });
    writeFileSync(resolved, text, { flag: 'wx' });
  } catch (error) {
    throw new CommandExit(1, `❌ ${path} could not be written: ${messageOf(error)}`);
  }
}

/** One whole run: the line, the config, the base's names, the checks, then the one write. */
export async function runFragment(context: RafaContext, seams: FragmentSeams = {}): Promise<ReleaseFragmentResult> {
  const request = readFragmentRequest(context);
  const project = requireProject(context, COMMAND_NAME);
  const config = await resolveProjectConfig(project, COMMAND_NAME, (message) => {
    context.output.warn(message);
  });
  checkPackage(project.root, request.package);

  const git = (seams.git ?? createGitRunner)(project.root);
  const base = waitingNames(git, config.prBase ?? RELEASE_BASE_BRANCH, config.releaseFragments);
  const name = allocateFragmentName(request.plan, base.names);
  const path = posix.join(config.releaseFragments.replace(/\\/g, '/'), name);
  const resolved = join(project.root, path);
  if (existsSync(resolved) || inHead(git, path)) {
    throw refusal(`${path} is already on this branch, so the fragment is not written twice`);
  }

  const lines = fragmentNotes(request);
  const fragment: Fragment = {
    plan: request.plan,
    title: request.title,
    level: request.level,
    package: request.package,
    notes: lines.notes,
  };
  writeNew(path, resolved, serializeFragment(fragment));
  const problems = lines.problem === null
    ? base.problems
    : [...base.problems, lines.problem];
  return { path, fragment, problems };
}

/** The command, reaching git through `seams`; see the module note. */
export function createReleaseFragmentCommand(seams: FragmentSeams = {}): RafaCommand {
  const command: RafaCommand = {
    ...RELEASE_FRAGMENT_DECLARATION,
    run: async (context) => {
      const result = await runFragment(context, seams);
      if (context.outputMode === 'json') {
        context.output.result(result);
        return;
      }
      for (const problem of result.problems) context.output.warn(problem);
      context.output.info(result.path);
    },
  };
  return Object.freeze(command);
}

const command: RafaCommand = createReleaseFragmentCommand();
export default command;
