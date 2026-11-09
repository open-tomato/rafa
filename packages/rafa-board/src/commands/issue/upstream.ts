/**
 * The gate `rafa issue create`, `rafa issue comment` and
 * `rafa issue list` pass before they reach the board of a tool the
 * project consumes, `--upstream=<tool>`, and the `gh` runner every
 * upstream call goes through.
 *
 * `.rafa/specs/rafa-751-report-rafa-gaps-bugs.md` names both. The
 * flag's name is {@link UPSTREAM_FLAG}, and the tools it accepts are
 * {@link UPSTREAM_TOOLS}, the tools a key under `collaborate` names
 * (`packages/rafa/src/config-schema-collaborate.ts`): only `rafa` now.
 *
 * ## The gate
 *
 * {@link resolveUpstream} is called after the line is read and before
 * anything reaches a tracker. In this order, it:
 *
 *   1. refuses a tool outside {@link UPSTREAM_TOOLS}, reading no config
 *      and sending no `gh`;
 *   2. reads the config as `issue-tracker.ts` does
 *      (`issueSubjectConfig`), and refuses a `collaborate.<tool>` left
 *      out, sending no `gh`;
 *   3. reads this board's `owner/name` and visibility with one
 *      `gh repo view --json nameWithOwner,visibility`
 *      (`readBoardRepositoryVisibility`,
 *      `packages/rafa-board/src/board/repository.ts`), and refuses a read
 *      that throws, a board with no GitHub remote or a `gh` signed out
 *      among them, naming the reason;
 *   4. compares the two owners ignoring case, so `Open-Tomato/app`
 *      against `open-tomato/rafa` passes, and refuses two owners that
 *      differ.
 *
 * It answers {@link UpstreamTarget}: the upstream repository, this
 * board's, and whether this board is `PUBLIC`. A visibility `PRIVATE`,
 * `INTERNAL` or unread is not public.
 *
 * Each refusal is a `CommandExit` with exit code 1, its message `❌ `
 * followed by the spec's line for the action, which ends
 * `Nothing was filed.` for `create` and `comment` and
 * `Nothing was read.` for `list`:
 *
 *   - `issue create --upstream=bun: --upstream names "bun", expected one of: rafa. Nothing was filed.`
 *   - `issue create --upstream=rafa: collaborate.rafa is not set, so reporting upstream is off. Nothing was filed.`
 *   - `issue create --upstream=rafa: collaborate.rafa names <upstream> (owner <a>), and this board is <own> (owner <b>). Reporting upstream is allowed only between repositories of one owner. Nothing was filed.`
 *   - `issue create --upstream=rafa: could not read this board's owner (<reason>). Nothing was filed.`
 *
 * A config `loadConfig` refuses is refused as every `issue` action
 * refuses it. The key's value is checked at load for its `owner/name`
 * shape only: a typo naming a repository that does not exist is not
 * checked here, and fails at the filing step with `gh`'s own error.
 *
 * ## The runner
 *
 * The upstream tracker is the `github` tracker made over
 * {@link upstreamGhRunner}, never an edit of the adapter. The runner
 * hands an `issue` or `label` call on with `--repo <upstream>` put
 * straight after the two words naming the command, and hands on one
 * already naming the upstream (`--repo`, `--repo=` or `-R`, the name
 * compared ignoring case) as it is. It answers a failed call, sending
 * nothing, for every other subcommand (`auth status`, `repo view`,
 * `api` among them) and for an `issue` or `label` call naming another
 * repository, so no upstream call falls through to this board.
 *
 * Both READ and send nothing of their own besides: the gate's one `gh`
 * call is a read, and the runner sends only what its caller hands it.
 */
import type { IssueSeams } from './issue-tracker.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { BoardRepositoryVisibility } from '../../board/repository.js';
import type { CollaborateTool } from '@open-tomato/rafa/config-schema-collaborate';
import type { Output } from '@open-tomato/rafa/ports';
import type { ProjectFound } from '@open-tomato/rafa/project/scope';

import { COLLABORATE_TOOLS, collaborateTarget } from '@open-tomato/rafa/config-schema-collaborate';
import { CommandExit } from '@open-tomato/rafa/core/command';
import { messageOf } from '@open-tomato/rafa/core/config/sections';

import { createGhRunner } from '../../adapters/tracker/github.js';
import { readBoardRepositoryVisibility } from '../../board/repository.js';

import { issueProject, issueSubjectConfig } from './issue-tracker.js';

/** The flag naming the tool whose board an action reaches: `--upstream=rafa`. */
export const UPSTREAM_FLAG = 'upstream';

/** The tools `--upstream` accepts: each one a key under `collaborate` names. */
export const UPSTREAM_TOOLS: readonly CollaborateTool[] = COLLABORATE_TOOLS;

/** The actions taking `--upstream`, as a refusal names them. */
export type UpstreamAction = 'create' | 'comment' | 'list';

/** What a refusal says was left undone, by action. */
const NOTHING_DONE: { readonly [A in UpstreamAction]: string } = Object.freeze({
  create: 'Nothing was filed.',
  comment: 'Nothing was filed.',
  list: 'Nothing was read.',
});

/** The `gh` subcommands {@link upstreamGhRunner} hands on. */
const UPSTREAM_COMMANDS: ReadonlySet<string> = new Set(['issue', 'label']);

/** The flags naming the repository a `gh` call acts on. */
const REPO_FLAGS: ReadonlySet<string> = new Set(['--repo', '-R']);

/** What `--repo` is spelled as when typed with its value: `--repo=<owner>/<name>`. */
const REPO_PREFIX = '--repo=';

/** What {@link resolveUpstream} answers for a gate passed. */
export interface UpstreamTarget {
  /** The upstream repository, `owner/name`, as `collaborate.<tool>` writes it. */
  readonly upstream: string;
  /** This board's repository, `owner/name`, as `gh repo view` answered it. */
  readonly own: string;
  /** True only when `gh` answered this board's visibility `PUBLIC`. */
  readonly ownIsPublic: boolean;
}

/** What the gate reads off a command's context: the project, and where a config warning goes. */
export interface UpstreamContext {
  readonly project: ProjectFound | null;
  readonly output: Pick<Output, 'warn'>;
}

/** What the gate is asked: the action refusing, and the tool `--upstream` named, as typed. */
export interface UpstreamRequest {
  readonly action: UpstreamAction;
  readonly tool: string;
}

/** A refusal of the gate with exit code 1: the action and flag, the problem, and what was left undone. */
function upstreamRefusal(request: UpstreamRequest, problem: string): CommandExit {
  const { action, tool } = request;
  return new CommandExit(1, `❌ issue ${action} --${UPSTREAM_FLAG}=${tool}: ${problem} ${NOTHING_DONE[action]}`);
}

/** The owner of an `owner/name`, the part before its `/`. */
function ownerOf(repository: string): string {
  const slash = repository.indexOf('/');
  return slash < 0
    ? repository
    : repository.slice(0, slash);
}

/** True when `a` and `b` name one GitHub repository or owner: GitHub's names hold no case. */
function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** `tool` when `--upstream` accepts it, or the refusal naming the accepted values. */
function acceptedTool(request: UpstreamRequest): CollaborateTool {
  const tool = UPSTREAM_TOOLS.find((known) => known === request.tool);
  if (tool !== undefined) return tool;
  throw upstreamRefusal(request, `--${UPSTREAM_FLAG} names "${request.tool}", expected one of: ${UPSTREAM_TOOLS.join(', ')}.`);
}

/** This board's repository and visibility, or the refusal naming why they could not be read. */
async function readOwnBoard(gh: GhRunner, request: UpstreamRequest): Promise<BoardRepositoryVisibility> {
  try {
    return await readBoardRepositoryVisibility(gh);
  } catch (error) {
    throw upstreamRefusal(request, `could not read this board's owner (${messageOf(error)}).`);
  }
}

/**
 * The gate: the upstream an action reaches and this board, or a refusal
 * with exit code 1 and the spec's line for the action. `seams.gh` is
 * what this board's owner is read through, a runner spawning `gh` in
 * the project root when left out. See the module note.
 */
export async function resolveUpstream(
  context: UpstreamContext,
  seams: Pick<IssueSeams, 'gh'>,
  request: UpstreamRequest,
): Promise<UpstreamTarget> {
  const tool = acceptedTool(request);
  const project = issueProject(context);
  const config = await issueSubjectConfig(project, (message) => {
    context.output.warn(message);
  });

  const upstream = collaborateTarget(config, tool);
  if (upstream === null) {
    throw upstreamRefusal(request, `collaborate.${tool} is not set, so reporting upstream is off.`);
  }

  const read = await readOwnBoard(seams.gh ?? createGhRunner({ cwd: project.root }), request);
  const own = read.repository;
  const upstreamOwner = ownerOf(upstream);
  const ownOwner = ownerOf(own);
  if (!sameName(upstreamOwner, ownOwner)) {
    throw upstreamRefusal(
      request,
      `collaborate.${tool} names ${upstream} (owner ${upstreamOwner}), and this board is ${own} (owner ${ownOwner}). `
      + 'Reporting upstream is allowed only between repositories of one owner.',
    );
  }
  return { upstream, own, ownIsPublic: read.visibility === 'PUBLIC' };
}

/** The repository a `gh` call names with `--repo`, `--repo=` or `-R`, or undefined when it names none. */
function namedRepository(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (REPO_FLAGS.has(arg)) return args[index + 1] ?? '';
    if (arg.startsWith(REPO_PREFIX)) return arg.slice(REPO_PREFIX.length);
  }
  return undefined;
}

/** A call {@link upstreamGhRunner} refuses, sending nothing. */
function refusedCall(upstream: string, args: readonly string[], why: string): Promise<GhResult> {
  const command = args.slice(0, 2).join(' ');
  return Promise.resolve({
    ok: false,
    stdout: '',
    stderr: `the runner reaching ${upstream} refuses gh ${command}: ${why}\n`,
  });
}

/**
 * `gh` reaching `upstream`'s board: every `issue` and `label` call with
 * `--repo <upstream>`, and every other call refused. See the module note.
 */
export function upstreamGhRunner(gh: GhRunner, upstream: string): GhRunner {
  return (args, stdin) => {
    const [subcommand = ''] = args;
    if (!UPSTREAM_COMMANDS.has(subcommand)) {
      return refusedCall(upstream, args, 'only issue and label calls are sent upstream');
    }
    const named = namedRepository(args);
    if (named === undefined) return gh([...args.slice(0, 2), '--repo', upstream, ...args.slice(2)], stdin);
    if (sameName(named, upstream)) return gh(args, stdin);
    return refusedCall(upstream, args, `it names --repo ${named}, and every upstream call names ${upstream}`);
  };
}
