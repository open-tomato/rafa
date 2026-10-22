/**
 * `rafa release publish [--tag=<tag>] [--dry-run]`: the PUBLISH step of
 * the `release` subject, the one `rafa release tag` prints as a line and
 * never runs. It runs `release.publishCommand` (`npm publish` by
 * default) for each release unit whose tag points at HEAD, in that
 * unit's directory, so the publish workflow of the release ladder's
 * level 2 (`.github/workflows/release-publish.yml`) has one line to call
 * once the gates passed on the checked-out tag.
 *
 * ## The units
 *
 * A unit is a release tag on HEAD: `git tag --points-at HEAD`, each tag
 * read by `parseReleaseTag` (`src/release/version-tag.ts`), the inverse
 * of the two spellings `rafa release tag` writes. A tag in neither
 * spelling is not a release and is passed over. `--tag=<tag>` names one
 * unit instead, and is refused with exit 1 when it parses as no release
 * tag or is not among the tags on HEAD, so a publish never ships a tree
 * other than the one its tag names. With no release tag on HEAD the run
 * refuses with exit 1 too: a publish workflow started on such a commit
 * has nothing to publish, and saying so is louder than a green no-op.
 *
 * Each unit is read with the readers `rafa release tag` decides from
 * (`./tag-units.ts`): the root off `release.versionFile`, published from
 * the project root; a package off `<dir>/package.json` of the
 * publishable workspace member the tag names, published from `<dir>`. A
 * tag naming a package the workspace does not publish, a version file
 * that cannot be read, and a version other than the tag's are refused
 * with exit 1, and every unit is read before anything runs, so a refused
 * run has run nothing. The version is read from the working tree, which
 * the workflow checks out at the tag.
 *
 * Units run in the order git lists the tags, with the root's tag, if
 * any, first. The release order across packages is parked by the spec.
 *
 * ## The retry rule
 *
 * "A retry skips versions already on the registry" (the spec). Before a
 * unit publishes, `npm view <name>@<version> version
 * --registry=<registry>` is run through the {@link PublishRunner} seam
 * in the unit's directory, the registry being the manifest's
 * `publishConfig.registry` or `DEFAULT_REGISTRY` (`./tag-follow-ups.ts`).
 * Exit 0 with the version on stdout means the registry holds it: the
 * unit is skipped with one `Skipped` line. An `E404` means publish: npm
 * 11.16.0 answers exit 1 and `npm error code E404` on stderr both for a
 * version the registry lacks of a package it knows and for a package it
 * does not know (measured 2026-10-16 against registry.npmjs.org). Exit 0
 * without the version on stdout is read as absent too, so a publish is
 * never skipped on an answer that does not name the version. Any other failure is a
 * registry that could not be read, which stops the run with exit 1: a
 * publish on a guess could ship a version twice or not at all.
 *
 * A manifest that names no package or is `"private": true` has nothing
 * to publish, as `rafa release tag` prints no publish line for it; such
 * a unit is skipped with its own line too, and no `npm view` runs.
 *
 * ## The publish
 *
 * A unit not held has `release.publishCommand` run through the shell in
 * its directory with the standard streams inherited, so npm's own output
 * and its prompts reach the operator or the workflow log; in json mode
 * the child's stdout goes to stderr instead, so the terminal result is
 * the only thing on stdout. The first command that exits other than 0
 * stops the run with exit 1 or its own code, naming the tags published
 * before it; the units after it are not tried.
 *
 * ## `--dry-run`, and json
 *
 * `--dry-run` prints one line per unit, the command and the directory it
 * would run in and the registry it would check, and runs nothing, not
 * even `npm view`. In json mode a run that ends with exit 0 gives
 * {@link ReleasePublishResult}, the units, the skipped, the published
 * and the exit, as the terminal result's data; a run that fails ends
 * with the dispatcher's `command_exit` error, whose message names what
 * was published before the failure.
 */
import type { PublishTarget } from './tag-follow-ups.js';
import type { VersionReading } from './tag-units.js';
import type { GitRunner } from '../../pr/index.js';
import type { TaggedRelease } from '../../release/version-tag.js';
import type { RafaCommand, RafaContext } from '@open-tomato/rafa/core/command';
import type { ProjectFound } from '@open-tomato/rafa/project/scope';
import type { StdioOptions } from 'node:child_process';

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { expectNoArgument, readSwitch } from '@open-tomato/rafa/commands/plan/plan-files';
import { CommandExit } from '@open-tomato/rafa/core/command';
import { ConfigError } from '@open-tomato/rafa/core/config';
import { loadConfig } from '@open-tomato/rafa/core/config/load';

import { createGitRunner, gitSaid } from '../../pr/index.js';
import { parseReleaseTag } from '../../release/version-tag.js';

import { RELEASE_PUBLISH_DECLARATION, RELEASE_PUBLISH_DRY_RUN_FLAG, RELEASE_PUBLISH_TAG_FLAG } from './declarations.js';
import { readPublishTarget } from './tag-follow-ups.js';
import { readTagPackages, readVersion } from './tag-units.js';

/** The usage line this action's refusals name. */
export const RELEASE_PUBLISH_USAGE = 'rafa release publish [--tag=<tag>] [--dry-run]';

/** The flag naming the one tag to publish. */
export const TAG_FLAG: string = RELEASE_PUBLISH_TAG_FLAG;

/** The flag that prints each unit's line and runs nothing. */
export const DRY_RUN_FLAG: string = RELEASE_PUBLISH_DRY_RUN_FLAG;

/** The code npm writes for a package the registry does not know. */
const NOT_FOUND_CODE = 'E404';

/** The exit a failed publish ends with when its command answered none, as a signal leaves it. */
const FALLBACK_EXIT = 1;

/** The file descriptor of this process's stderr, which a json-mode publish writes its stdout to. */
const STDERR_FD = 2;

/** The highest exit code a run can end with. */
const MAX_EXIT = 255;

/** What a captured process answered. */
export interface ProcessResult {
  /** Its exit code; a process that could not start or was killed reads as non-zero. */
  readonly exitCode: number;
  /** Its standard output, empty when it wrote none. */
  readonly stdout: string;
  /** Its standard error, empty when it wrote none. */
  readonly stderr: string;
}

/** Where a publish command's standard output goes: the terminal, or stderr in json mode. */
export type PublishStdout = 'inherit' | 'stderr';

/** The two processes a run starts, behind one seam so a test hands a fake. */
export interface PublishRunner {
  /** Runs `npm` with `args` in `cwd`, its output captured. */
  readonly npm: (args: readonly string[], cwd: string) => ProcessResult;
  /** Runs `command` through the shell in `cwd`, the streams inherited, and answers its exit code. */
  readonly shell: (command: string, cwd: string, stdout: PublishStdout) => number;
}

/** The seams this action reaches git and the two processes through. */
export interface PublishSeams {
  /** Makes the git runner the tag readings go through. */
  readonly git?: (root: string) => GitRunner;
  /** Runs `npm view` and the publish command. */
  readonly runner?: PublishRunner;
}

/** One unit to publish: a release tag on HEAD and what its manifest says. */
export interface PublishUnit {
  /** The release tag that names it. */
  readonly tag: string;
  /** The workspace package's manifest name, or null for the root. */
  readonly package: string | null;
  /** The name `npm view` asks the registry for, or null when the manifest names none. */
  readonly name: string | null;
  /** The version the tag and the manifest agree on. */
  readonly version: string;
  /** The package's folder relative to the root, or null for the root, which publishes from the root. */
  readonly dir: string | null;
  /** The registry the retry rule asks. */
  readonly registry: string;
  /** True when the manifest is `"private": true` or names no package, so nothing publishes. */
  readonly unpublishable: boolean;
}

/** Why a unit was passed over: the registry holds its version, or it has nothing to publish. */
export type PublishSkipReason = 'held' | 'unpublishable';

/** A unit passed over, and the sentence its `Skipped` line says. */
export interface PublishSkipped {
  /** The unit's tag. */
  readonly tag: string;
  /** Why it was passed over. */
  readonly reason: PublishSkipReason;
  /** The sentence, with no marker on the front and no full stop. */
  readonly message: string;
}

/** What json mode gives as the terminal result's `data` for a run that ended with exit 0. */
export interface ReleasePublishResult {
  /** True for `--dry-run`, which ran nothing. */
  readonly dryRun: boolean;
  /** The command each unit publishes with, `release.publishCommand`. */
  readonly command: string;
  /** Every unit, in run order. */
  readonly units: readonly PublishUnit[];
  /** The units passed over, in run order. */
  readonly skipped: readonly PublishSkipped[];
  /** The tags published, in run order. */
  readonly published: readonly string[];
  /** The exit code the run ended with. */
  readonly exit: number;
}

/** The two settings one run reads out of the config. */
interface PublishSettings {
  /** `release.versionFile`, the root unit's manifest. */
  readonly versionFile: string;
  /** `release.publishCommand`, run in each unit's directory. */
  readonly publishCommand: string;
}

/** A spawn's output stream as text, null read as empty. */
function textOf(value: string | Buffer | null | undefined): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string'
    ? value
    : value.toString('utf8');
}

/** The lines of `text` with something on them, trimmed. */
function nonEmptyLines(text: string): readonly string[] {
  return text.split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** The system's own runner: `npm` spawned with captured output, and the shell with inherited streams. */
export const SYSTEM_PUBLISH_RUNNER: PublishRunner = Object.freeze({
  npm: (args: readonly string[], cwd: string): ProcessResult => {
    const result = spawnSync('npm', [...args], { cwd, encoding: 'utf8' });
    if (result.error !== undefined) {
      return { exitCode: FALLBACK_EXIT, stdout: '', stderr: `npm could not run in ${cwd}: ${result.error.message}` };
    }
    return { exitCode: result.status ?? FALLBACK_EXIT, stdout: textOf(result.stdout), stderr: textOf(result.stderr) };
  },
  shell: (command: string, cwd: string, stdout: PublishStdout): number => {
    const streams: StdioOptions = stdout === 'inherit'
      ? 'inherit'
      : ['inherit', STDERR_FD, 'inherit'];
    const result = spawnSync(command, { cwd, shell: true, stdio: streams });
    return result.status ?? FALLBACK_EXIT;
  },
});

/** The project the dispatcher resolved, which it resolves for every action of the subject. */
function projectOf(context: RafaContext): ProjectFound {
  if (context.project === null) throw new Error('rafa release runs inside a project, and was handed none');
  return context.project;
}

/** The exit a run refused with: one `❌` line per sentence, then the usage. */
function refusal(messages: readonly string[]): CommandExit {
  const lines = messages.map((message) => `❌ ${message}`);
  return new CommandExit(1, `${lines.join('\n')}\nUsage: ${RELEASE_PUBLISH_USAGE}`);
}

/** The two settings this action reads, refusing a config `loadConfig` refuses. */
async function publishConfig(project: ProjectFound, warn: (message: string) => void): Promise<PublishSettings> {
  try {
    const { config } = await loadConfig({ root: project.root, home: project.home }, {}, warn);
    return { versionFile: config.releaseVersionFile, publishCommand: config.releasePublishCommand };
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    throw new CommandExit(
      1,
      ['❌ The config cannot be used:', ...error.problems.map((problem) => `  ${problem}`)].join('\n'),
    );
  }
}

/** The tag `--tag` names, or null when the line names none. */
function readTagFlag(value: string | boolean | undefined): string | null {
  if (value === undefined) return null;
  const tag = typeof value === 'string'
    ? value.trim()
    : '';
  if (tag === '') throw refusal(['--tag takes a release tag, as --tag=v0.5.0 or --tag=@scope/plugin@0.2.0']);
  return tag;
}

/** The tags pointing at HEAD, in the order git lists them. */
export function readHeadTags(git: GitRunner): readonly string[] {
  const listed = git(['tag', '--points-at', 'HEAD']);
  if (!listed.ok) throw refusal([`the tags on HEAD could not be read: ${gitSaid(listed)}`]);
  return nonEmptyLines(listed.stdout);
}

/** One release tag on HEAD, parsed. */
interface HeadRelease {
  /** The tag as git lists it. */
  readonly tag: string;
  /** What it names. */
  readonly release: TaggedRelease;
}

/**
 * The release tags a run publishes: the one `wanted` names, refused when
 * it is no release tag or not on HEAD, or every release tag on HEAD, the
 * root's first, refused when there is none.
 */
export function selectReleases(headTags: readonly string[], wanted: string | null): readonly HeadRelease[] {
  if (wanted !== null) {
    const release = parseReleaseTag(wanted);
    if (release === null) {
      throw refusal([`${wanted} is no release tag: one is v<version> for the root or <name>@<version> for a package`]);
    }
    if (!headTags.includes(wanted)) throw refusal([`${wanted} does not point at HEAD, so HEAD is not its release`]);
    return [{ tag: wanted, release }];
  }
  const releases = headTags.flatMap((tag): HeadRelease[] => {
    const release = parseReleaseTag(tag);
    return release === null
      ? []
      : [{ tag, release }];
  });
  if (releases.length === 0) throw refusal(['no release tag points at HEAD, so there is nothing to publish']);
  return [
    ...releases.filter((each) => each.release.package === null),
    ...releases.filter((each) => each.release.package !== null),
  ];
}

/** Where a unit's manifest is and the folder it publishes from, or the sentence refusing it. */
type UnitPlace =
  | { readonly ok: true; readonly manifest: string; readonly dir: string | null }
  | { readonly ok: false; readonly problem: string };

/** The manifest and folder of `head`'s unit: the root's version file, or the publishable member it names. */
function placeOf(root: string, settings: PublishSettings, head: HeadRelease): UnitPlace {
  const name = head.release.package;
  if (name === null) return { ok: true, manifest: settings.versionFile, dir: null };
  const packages = readTagPackages(root);
  if (!packages.ok) return { ok: false, problem: packages.problem };
  const member = packages.packages.find((each) => each.name === name);
  return member === undefined
    ? { ok: false, problem: `${head.tag} names ${name}, which is no publishable package of the workspace` }
    : { ok: true, manifest: `${member.dir}/package.json`, dir: member.dir };
}

/** The sentence refusing `reading` for `head`, or null when it declares the tag's version. */
function versionProblem(head: HeadRelease, reading: VersionReading): string | null {
  if (reading.version === null) return reading.problem ?? `${reading.path} declares no version`;
  return reading.version === head.release.version
    ? null
    : `${head.tag} names ${head.release.version} and ${reading.path} declares ${reading.version} at HEAD`;
}

/** A unit read, or the sentence refusing it. */
type UnitReading = { readonly ok: true; readonly unit: PublishUnit } | { readonly ok: false; readonly problem: string };

/** One unit read off its manifest and checked against its tag. */
export function readPublishUnit(root: string, settings: PublishSettings, head: HeadRelease): UnitReading {
  const place = placeOf(root, settings, head);
  if (!place.ok) return place;
  const reading = readVersion(root, place.manifest);
  const problem = versionProblem(head, reading);
  if (problem !== null) return { ok: false, problem };
  const target: PublishTarget = readPublishTarget(reading.text);
  const name = head.release.package ?? target.name;
  return {
    ok: true,
    unit: {
      tag: head.tag,
      package: head.release.package,
      name,
      version: head.release.version,
      dir: place.dir,
      registry: target.registry,
      unpublishable: name === null || target.isPrivate,
    },
  };
}

/** Every unit of the run, read before anything runs; any refusal stops the run with every sentence. */
function readUnits(root: string, settings: PublishSettings, heads: readonly HeadRelease[]): readonly PublishUnit[] {
  const readings = heads.map((head) => readPublishUnit(root, settings, head));
  const problems = readings.flatMap((reading) => reading.ok
    ? []
    : [reading.problem]);
  if (problems.length > 0) throw refusal(problems);
  return readings.flatMap((reading) => reading.ok
    ? [reading.unit]
    : []);
}

/** What the registry answered about a unit's version. */
export type RegistryReading =
  | { readonly kind: 'held' }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unread'; readonly problem: string };

/** The `npm view` words that ask `unit`'s registry for its version. */
export function viewArgs(unit: PublishUnit): readonly string[] {
  return ['view', `${unit.name ?? ''}@${unit.version}`, 'version', `--registry=${unit.registry}`];
}

/** What `result`, `npm view`'s answer for `version`, says; see the module note. */
export function readRegistry(result: ProcessResult, version: string): RegistryReading {
  if (result.exitCode === 0) {
    return nonEmptyLines(result.stdout).includes(version)
      ? { kind: 'held' }
      : { kind: 'absent' };
  }
  if (`${result.stdout}\n${result.stderr}`.includes(NOT_FOUND_CODE)) return { kind: 'absent' };
  const said = result.stderr.trim() === ''
    ? `exit code ${String(result.exitCode)}`
    : result.stderr.trim();
  return { kind: 'unread', problem: said };
}

/** The absolute folder `unit` runs in. */
function cwdOf(root: string, unit: PublishUnit): string {
  return unit.dir === null
    ? root
    : join(root, unit.dir);
}

/** Where `unit` runs, as a line names it. */
function placeName(unit: PublishUnit): string {
  return unit.dir ?? 'the root';
}

/** The clause naming the tags published before a failure, or nothing when none was. */
function publishedBefore(published: readonly string[]): string {
  if (published.length === 0) return '; nothing was published before it';
  const verb = published.length === 1
    ? 'was'
    : 'were';
  return `; ${published.join(', ')} ${verb} published before it`;
}

/** The line `--dry-run` prints for `unit`. */
export function dryRunLine(unit: PublishUnit, command: string): string {
  if (unit.unpublishable) return `Would skip ${unit.tag}: ${unpublishableMessage(unit)}.`;
  return `Would publish ${unit.tag} from ${placeName(unit)} with ${command}, unless ${unit.registry}`
    + ` holds ${unit.name ?? ''}@${unit.version}.`;
}

/** Why `unit` has nothing to publish. */
function unpublishableMessage(unit: PublishUnit): string {
  return unit.name === null
    ? `the manifest of ${placeName(unit)} names no package, so there is nothing to publish`
    : `${unit.name} is private, so there is nothing to publish`;
}

/** What one run did, as it ran. */
interface Ran {
  readonly skipped: readonly PublishSkipped[];
  readonly published: readonly string[];
}

/**
 * Publishes each unit in turn: a unit with nothing to publish and one
 * the registry holds are skipped, any other runs the command; the first
 * failure stops the run, naming the tags published before it.
 */
function publishUnits(
  root: string,
  units: readonly PublishUnit[],
  command: string,
  runner: PublishRunner,
  context: RafaContext,
): Ran {
  const skipped: PublishSkipped[] = [];
  const published: string[] = [];
  const say = (line: string): void => {
    if (context.outputMode !== 'json') context.output.info(line);
  };
  for (const unit of units) {
    const cwd = cwdOf(root, unit);
    if (unit.unpublishable) {
      skipped.push({ tag: unit.tag, reason: 'unpublishable', message: unpublishableMessage(unit) });
      say(`Skipped ${unit.tag}: ${unpublishableMessage(unit)}.`);
      continue;
    }
    const registry = readRegistry(runner.npm(viewArgs(unit), cwd), unit.version);
    if (registry.kind === 'unread') {
      throw new CommandExit(1, `❌ ${unit.registry} could not be asked for ${unit.name ?? ''}@${unit.version}:`
        + ` ${registry.problem}${publishedBefore(published)}`);
    }
    if (registry.kind === 'held') {
      const message = `${unit.registry} holds ${unit.name ?? ''}@${unit.version} already`;
      skipped.push({ tag: unit.tag, reason: 'held', message });
      say(`Skipped ${unit.tag}: ${message}.`);
      continue;
    }
    say(`Publishing ${unit.tag} from ${placeName(unit)} with ${command}`);
    const code = runner.shell(command, cwd, context.outputMode === 'json'
      ? 'stderr'
      : 'inherit');
    if (code !== 0) {
      const exit = code > 0 && code <= MAX_EXIT
        ? code
        : FALLBACK_EXIT;
      throw new CommandExit(exit, `❌ ${command} exited ${String(code)} publishing ${unit.tag} from`
        + ` ${placeName(unit)}${publishedBefore(published)}`);
    }
    published.push(unit.tag);
    say(`✅ Published ${unit.tag}.`);
  }
  return { skipped, published };
}

/** One whole run: the line, the units, and the publishes or the dry run's lines. */
export async function runPublish(context: RafaContext, seams: PublishSeams = {}): Promise<ReleasePublishResult> {
  expectNoArgument(context.args, RELEASE_PUBLISH_USAGE);
  const dryRun = readSwitch(DRY_RUN_FLAG, context.flags[DRY_RUN_FLAG], `Usage: ${RELEASE_PUBLISH_USAGE}`);
  const wanted = readTagFlag(context.flags[TAG_FLAG]);
  const project = projectOf(context);
  const settings = await publishConfig(project, (message: string) => {
    context.output.warn(message);
  });
  const git = (seams.git ?? createGitRunner)(project.root);
  const heads = selectReleases(readHeadTags(git), wanted);
  const units = readUnits(project.root, settings, heads);
  const command = settings.publishCommand;
  if (dryRun) {
    if (context.outputMode !== 'json') {
      for (const unit of units) context.output.info(dryRunLine(unit, command));
    }
    return { dryRun, command, units, skipped: [], published: [], exit: 0 };
  }
  const ran = publishUnits(project.root, units, command, seams.runner ?? SYSTEM_PUBLISH_RUNNER, context);
  return { dryRun, command, units, skipped: ran.skipped, published: ran.published, exit: 0 };
}

/** The command, reaching git and the processes through `seams`; see the module note. */
export function createReleasePublishCommand(seams: PublishSeams = {}): RafaCommand {
  const command: RafaCommand = {
    ...RELEASE_PUBLISH_DECLARATION,
    run: async (context) => {
      const result = await runPublish(context, seams);
      if (context.outputMode === 'json') context.output.result(result);
    },
  };
  return Object.freeze(command);
}

const command: RafaCommand = createReleasePublishCommand();
export default command;
