/**
 * A strict recorded fake of the `gh pr`, `gh run` and `gh api` commands
 * the pull-request port sends: one in-memory repository of pull requests
 * behind a {@link GhRunner}, recording every command it is handed.
 *
 * The same discipline `src/adapters/tracker/github-fake.ts` holds for
 * issues, and behind the same seam: `GhRunner` and `GhResult` are
 * declared once, in `src/adapters/tracker/github.ts`, and `src/pr/gh.ts`
 * takes one as the tracker adapter does. So no case in `src/pr/` spawns
 * a process, reaches GitHub, or reads the configuration `gh` keeps under
 * the home.
 *
 * What an answer LOOKS like, and which readings it was taken from, is
 * `./gh-fake-shapes.ts`. This module owns which commands exist, what each
 * one accepts, and what the repository does when one arrives.
 *
 * This module is a test helper that is not itself a test file: bun runs
 * nothing in it until a `*.test.ts` calls it, and `check-types` reads it,
 * where it reads no test file.
 *
 * ## The commands modelled
 *
 * One per port member, and nothing beyond what this plan sends:
 *
 * | Command | For |
 * |---|---|
 * | `pr list --json <fields> [--state --limit --head --repo]` | `list`, `listMerged` through `--state merged`, and `findOpen` through `--head` |
 * | `pr view <n> --json <fields> [--repo]` | `get` |
 * | `pr view <n> --web [--repo]` | `browse` |
 * | `pr checks <n> --json <fields> [--repo]` | `checks` |
 * | `pr merge <n> --squash or --merge or --rebase [--repo]` | `merge` |
 * | `pr edit <n> --body <text> [--repo]` | `editBody` |
 * | `run view <id> --log-failed [--repo]` | `failedLog` |
 * | `api repos/<repo>/issues/<n>/comments [-X POST -f body=]` | `comments`, `comment` |
 * | `api repos/<repo>/issues/comments/<id> -X PATCH -f body=` | `editComment` |
 * | `api repos/<repo>/collaborators/<login>/permission` | the trust reading |
 * | `api repos/<repo>/actions/workflows` | the workflow count |
 *
 * The two comment members go through `gh api` rather than through
 * `gh pr view --json comments` and `gh pr comment`. The `--json` field
 * carries no `updatedAt`, and the `id` it carries is the GraphQL node id
 * (`IC_kwDO...`), not the REST id the PATCH path takes — both recorded in
 * `./gh-fake-shapes.ts`. What `gh pr comment` writes was not recorded at
 * all, it being a write, where the REST POST answers the whole comment.
 *
 * ## Strict
 *
 * A command, a flag, a `--json` field, a method or an `api` path the fake
 * does not model is refused, with `ok` false and a message naming it,
 * rather than ignored. An adapter that sent `--auto`, `--admin` or
 * `--delete-branch` fails the case that sent it, where a fake ignoring
 * the flag would let the case pass on a `gh` invocation nobody had
 * checked. A `--repo` naming another repository than the fake's own is
 * refused the same way, and so is an `api` path naming one. Every message
 * the fake invents opens with `fake gh:`; everything else it writes was
 * recorded.
 *
 * ## Recording and planting
 *
 * {@link FakePrGh.calls} answers every command handed over, refused ones
 * included, in order, each copied and frozen. {@link FakePrGh.plant} puts
 * a pull request in the repository and {@link FakePrGh.update} replaces
 * one, so a case can plant what a person, CI or dependabot could have
 * done on GitHub. A merge fails only where a case plants the refusal
 * ({@link FakePrGh.refuseMerge}), since what `gh pr merge` writes when it
 * fails could not be recorded without writing to a repository. A body
 * edit is that kind of write too: it replaces the stored body, which
 * every later `pr view --json body` then answers, and writes nothing to
 * either stream, because what `gh pr edit` writes was not recorded
 * either.
 *
 * The repository holds no workflow until {@link FakePrGh.plantWorkflows}
 * gives it some, as `open-tomato/rafa` has none, and the workflows path
 * answers a recorded 403 or 404 instead once
 * {@link FakePrGh.refuseWorkflows} plants one.
 */
import type {
  FakeHttpStatus,
  FakePrComment,
  FakePullRequest,
  FakePullRequestSeed,
  FakeWorkflow,
} from './gh-fake-shapes.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import {
  CHECK_FIELDS,
  DEFAULT_LIST_LIMIT,
  failed,
  fillSeed,
  isResult,
  LIST_STATES,
  LOG_NOT_FOUND,
  missingPull,
  missingRun,
  NO_REMOTES,
  noChecksReported,
  notFound,
  ok,
  PULL_FIELDS,
  renderCheckRow,
  renderPermission,
  renderPull,
  renderRestComment,
  renderWorkflows,
  WEB_WITH_JSON,
  workflowsFailure,
} from './gh-fake-shapes.js';

export type {
  FakeCheckKind,
  FakeHttpStatus,
  FakePrAuthor,
  FakePrCheck,
  FakePrComment,
  FakePullRequest,
  FakePullRequestSeed,
  FakeWorkflow,
} from './gh-fake-shapes.js';

export { logFailedText } from './gh-fake-shapes.js';

/** What the fake is made with. */
export interface FakePrGhOptions {
  /**
   * The repository the working directory resolves to, as `owner/name`,
   * or null for a checkout with no git remote. `open-tomato/rafa` when
   * left out.
   */
  readonly repo?: string | null;
  /**
   * The clock a written comment and a merge are stamped with. A fixed
   * instant when left out, so a case that wants an edit to move
   * `updated_at` hands over a clock that advances.
   */
  readonly now?: () => string;
}

/** The fake: its runner, and what it holds and was handed. */
export interface FakePrGh {
  /** The runner to make a pull-request adapter with. */
  readonly run: GhRunner;
  /** Every command handed to `run`, in order, refused ones included. */
  readonly calls: () => readonly (readonly string[])[];
  /** Puts a pull request in the repository, filling what the seed leaves out. */
  readonly plant: (seed: FakePullRequestSeed) => void;
  /** The pull request under a number, or undefined when there is none. */
  readonly pull: (number: number) => FakePullRequest | undefined;
  /** Replaces a pull request. Throws when there is none. */
  readonly update: (number: number, change: (pull: FakePullRequest) => FakePullRequest) => void;
  /** Makes `gh pr merge` on this pull request fail, writing `stderr`. */
  readonly refuseMerge: (number: number, stderr: string) => void;
  /** Puts the `--log-failed` output of one run in the repository. */
  readonly plantRun: (id: string, log: string) => void;
  /** Makes one run answer that its log has been dropped. */
  readonly expireRun: (id: string) => void;
  /** Gives a login the permission the collaborators endpoint answers. */
  readonly plantPermission: (login: string, permission: string) => void;
  /** Replaces the workflows the repository holds, which start empty. */
  readonly plantWorkflows: (workflows: readonly FakeWorkflow[]) => void;
  /** Makes the workflows path answer the recorded failure under `status`. */
  readonly refuseWorkflows: (status: FakeHttpStatus) => void;
}

/** The repository the working directory resolves to when the options name none. */
const DEFAULT_REPO = 'open-tomato/rafa';

/** The instant a comment is stamped with when the options hand over no clock. */
const FIXED_NOW = '2026-09-18T12:00:00Z';

/** The REST id the first written comment takes; later ones count up. */
const FIRST_COMMENT_ID = 5000000001;

/** Who the fake writes a comment as, there being no `gh` account behind it. */
const COMMENT_AUTHOR = Object.freeze({ login: 'rafa-fake', isBot: false, name: 'rafa fake' });

/** The documentation URL a 404 on the comment list carries. */
const COMMENT_LIST_DOCS = 'https://docs.github.com/rest/issues/comments#list-issue-comments';

/** The documentation URL a 404 on one comment carries. */
const COMMENT_DOCS = 'https://docs.github.com/rest/issues/comments#get-an-issue-comment';

/** The documentation URL a 404 on a collaborator permission carries. */
const PERMISSION_DOCS = 'https://docs.github.com/rest/collaborators/collaborators#get-repository-permissions-for-a-user';

/** The merge methods `gh pr merge` takes, exactly one of which is required. */
const MERGE_SWITCHES = ['--squash', '--merge', '--rebase'];

/** The flags a modelled command takes, and how many arguments it takes besides. */
interface CommandShape {
  /** Flags taking the argument after them. */
  readonly values: readonly string[];
  /** Flags taking no argument. */
  readonly switches: readonly string[];
  readonly positionals: number;
}

/** Each modelled command, keyed by the words naming it. */
const COMMANDS: ReadonlyMap<string, CommandShape> = new Map([
  ['pr list', { values: ['--json', '--state', '--limit', '--head', '--repo'], switches: [], positionals: 0 }],
  ['pr view', { values: ['--json', '--repo'], switches: ['--web'], positionals: 1 }],
  ['pr checks', { values: ['--json', '--repo'], switches: [], positionals: 1 }],
  ['pr merge', { values: ['--repo'], switches: MERGE_SWITCHES, positionals: 1 }],
  ['pr edit', { values: ['--body', '--repo'], switches: [], positionals: 1 }],
  ['run view', { values: ['--repo'], switches: ['--log-failed'], positionals: 1 }],
  ['api', { values: ['-X', '-f'], switches: [], positionals: 1 }],
]);

/** A command's arguments once read against its shape. */
interface ParsedCommand {
  readonly positionals: readonly string[];
  /** Each flag's values, in order; a switch holds one empty value per use. */
  readonly flags: ReadonlyMap<string, readonly string[]>;
}

/** The words naming the command `args` runs: two, or `api` alone. */
function commandKey(args: readonly string[]): string {
  return args[0] === 'api'
    ? 'api'
    : args.slice(0, 2).join(' ');
}

/** Reads `rest` against `shape`, or answers what the fake refuses in it. */
function parseCommand(key: string, shape: CommandShape, rest: readonly string[]): ParsedCommand | string {
  const positionals: string[] = [];
  const flags = new Map<string, readonly string[]>();
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index] ?? '';
    if (shape.switches.includes(arg)) {
      flags.set(arg, [...(flags.get(arg) ?? []), '']);
    } else if (shape.values.includes(arg)) {
      const value = rest[index + 1];
      if (value === undefined) return `fake gh: ${key} ${arg} needs an argument`;
      flags.set(arg, [...(flags.get(arg) ?? []), value]);
      index += 1;
    } else if (arg.startsWith('-')) {
      return `fake gh: ${key} does not model flag ${arg}`;
    } else {
      positionals.push(arg);
    }
  }
  if (positionals.length !== shape.positionals) {
    return `fake gh: ${key} takes ${shape.positionals} arguments besides its flags, and was handed ${positionals.length}`;
  }
  return { positionals, flags };
}

/** The one value of a flag, or undefined when it was not passed. */
function flagValue(parsed: ParsedCommand, name: string): string | undefined {
  return parsed.flags.get(name)?.at(-1);
}

/** Whether a switch was passed. */
function hasSwitch(parsed: ParsedCommand, name: string): boolean {
  return parsed.flags.has(name);
}

/** The `-f key=value` pairs of an `api` call. */
function apiFields(parsed: ParsedCommand): ReadonlyMap<string, string> {
  return new Map((parsed.flags.get('-f') ?? []).map((pair): [string, string] => {
    const at = pair.indexOf('=');
    return [pair.slice(0, at), pair.slice(at + 1)];
  }));
}

/** Makes a fake `gh` over an empty repository; see the module note. */
export function createFakePrGh(options: FakePrGhOptions = {}): FakePrGh {
  const repo = options.repo === undefined
    ? DEFAULT_REPO
    : options.repo;
  const now = options.now ?? ((): string => FIXED_NOW);
  /** The name a URL is written with; each command checks `repo` itself. */
  const named = repo ?? DEFAULT_REPO;

  let pulls: ReadonlyMap<number, FakePullRequest> = new Map();
  let mergeRefusals: ReadonlyMap<number, string> = new Map();
  let runLogs: ReadonlyMap<string, string | null> = new Map();
  let permissions: ReadonlyMap<string, string> = new Map();
  let workflows: readonly FakeWorkflow[] = [];
  let workflowsRefusal: FakeHttpStatus | null = null;
  let nextCommentId = FIRST_COMMENT_ID;
  let calls: readonly (readonly string[])[] = [];

  const store = (pull: FakePullRequest): void => {
    pulls = new Map([...pulls, [pull.number, Object.freeze({ ...pull })]]);
  };

  /** The repository a command acts on, or the failure `gh` answers for it. */
  const repoProblem = (parsed: ParsedCommand): GhResult | null => {
    const flag = flagValue(parsed, '--repo');
    if (flag !== undefined) {
      return flag === repo
        ? null
        : failed(`fake gh: models one repository, ${repo ?? 'none'}, and was handed --repo ${flag}\n`);
    }
    return repo === null
      ? failed(NO_REMOTES)
      : null;
  };

  /** The fields `--json` asks for, or the failure for one the fake does not model. */
  const jsonFields = (parsed: ParsedCommand, allowed: ReadonlySet<string>): string[] | GhResult => {
    const raw = flagValue(parsed, '--json');
    if (raw === undefined) return failed('fake gh: models --json alone, and was handed no fields\n');
    const fields = raw.split(',');
    const unknown = fields.find((field) => !allowed.has(field));
    return unknown === undefined
      ? fields
      : failed(`fake gh: does not model --json field ${JSON.stringify(unknown)}\n`);
  };

  /** The pull request a command names, or the recorded failure for one that does not exist. */
  const namedPull = (raw: string): FakePullRequest | GhResult => {
    const number = Number(raw);
    const pull = Number.isSafeInteger(number)
      ? pulls.get(number)
      : undefined;
    return pull ?? missingPull(raw);
  };

  const handlePrList = (parsed: ParsedCommand): GhResult => {
    const refused = repoProblem(parsed);
    if (refused !== null) return refused;
    const fields = jsonFields(parsed, PULL_FIELDS);
    if (!Array.isArray(fields)) return fields;
    const limit = Number(flagValue(parsed, '--limit') ?? String(DEFAULT_LIST_LIMIT));
    if (!Number.isSafeInteger(limit) || limit < 1) return failed(`fake gh: does not model --limit ${String(limit)}\n`);
    const state = flagValue(parsed, '--state') ?? 'open';
    if (!LIST_STATES.has(state)) return failed(`fake gh: does not model --state ${state}\n`);
    const head = flagValue(parsed, '--head');

    // Newest first, as recorded, which is the number descending here.
    const rows = [...pulls.values()]
      .filter((pull) => state === 'all' || pull.state.toLowerCase() === state)
      .filter((pull) => head === undefined || pull.headRefName === head)
      .sort((a, b) => b.number - a.number)
      .slice(0, limit)
      .map((pull) => renderPull(pull, fields, named));
    return ok(`${JSON.stringify(rows)}\n`);
  };

  const handlePrView = (parsed: ParsedCommand): GhResult => {
    const refused = repoProblem(parsed);
    if (refused !== null) return refused;
    const web = hasSwitch(parsed, '--web');
    if (web && flagValue(parsed, '--json') !== undefined) return failed(WEB_WITH_JSON);
    const pull = namedPull(parsed.positionals[0] ?? '');
    if (isResult(pull)) return pull;
    if (web) return ok();
    const fields = jsonFields(parsed, PULL_FIELDS);
    return Array.isArray(fields)
      ? ok(`${JSON.stringify(renderPull(pull, fields, named))}\n`)
      : fields;
  };

  const handlePrChecks = (parsed: ParsedCommand): GhResult => {
    const refused = repoProblem(parsed);
    if (refused !== null) return refused;
    const fields = jsonFields(parsed, CHECK_FIELDS);
    if (!Array.isArray(fields)) return fields;
    const pull = namedPull(parsed.positionals[0] ?? '');
    if (isResult(pull)) return pull;
    if (pull.checks.length === 0) return noChecksReported(pull.headRefName);
    const rows = pull.checks.map((check) => renderCheckRow(check, fields));
    return ok(`${JSON.stringify(rows)}\n`);
  };

  const handlePrMerge = (parsed: ParsedCommand): GhResult => {
    const refused = repoProblem(parsed);
    if (refused !== null) return refused;
    const methods = MERGE_SWITCHES.filter((name) => hasSwitch(parsed, name));
    if (methods.length !== 1) {
      return failed(`fake gh: pr merge models exactly one of --squash, --merge and --rebase, and was handed ${methods.length}\n`);
    }
    const pull = namedPull(parsed.positionals[0] ?? '');
    if (isResult(pull)) return pull;
    const planted = mergeRefusals.get(pull.number);
    if (planted !== undefined) return failed(planted);
    if (pull.state !== 'OPEN') {
      return failed(`fake gh: pull request ${pull.number} is ${pull.state}, and a merge is modelled for an open one alone\n`);
    }
    // A merged pull request answers UNKNOWN for both merge fields, as recorded,
    // and is merged at the fake's clock, which a comment is stamped with too.
    store({ ...pull, state: 'MERGED', mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN', mergedAt: now() });
    return ok();
  };

  const handlePrEdit = (parsed: ParsedCommand): GhResult => {
    const refused = repoProblem(parsed);
    if (refused !== null) return refused;
    const body = flagValue(parsed, '--body');
    if (body === undefined) return failed('fake gh: pr edit models --body <text> alone, and was handed no body\n');
    const pull = namedPull(parsed.positionals[0] ?? '');
    if (isResult(pull)) return pull;
    // The body is replaced whole, and nothing is written: see the module note.
    store({ ...pull, body });
    return ok();
  };

  const handleRunView = (parsed: ParsedCommand): GhResult => {
    const refused = repoProblem(parsed);
    if (refused !== null) return refused;
    if (!hasSwitch(parsed, '--log-failed')) return failed('fake gh: run view models --log-failed alone\n');
    const id = parsed.positionals[0] ?? '';
    if (!runLogs.has(id)) return missingRun(named, id);
    const log = runLogs.get(id);
    return log === null || log === undefined
      ? failed(LOG_NOT_FOUND)
      : ok(log);
  };

  /** The repository an `api` path names, or the failure `gh` answers for it. */
  const apiRepoProblem = (path: string, inPath: string): GhResult | null => {
    if (inPath === '{owner}/{repo}') {
      return repo === null
        ? failed(`unable to expand placeholder in path: ${NO_REMOTES}`)
        : null;
    }
    return inPath === repo
      ? null
      : failed(`fake gh: models one repository, ${repo ?? 'none'}, and was handed ${path}\n`);
  };

  /** `repos/<repo>/issues/<n>/comments`: the list, and the comment a POST writes. */
  const handleCommentsPath = (parsed: ParsedCommand, raw: string, method: string): GhResult => {
    const pull = namedPull(raw);
    if (isResult(pull)) return notFound('Not Found', COMMENT_LIST_DOCS);
    if (method === 'GET') {
      return ok(JSON.stringify(pull.comments.map((comment) => renderRestComment(comment, pull, named))));
    }
    if (method !== 'POST') return failed(`fake gh: issue comments model GET and POST alone, and were handed ${method}\n`);
    const body = apiFields(parsed).get('body');
    if (body === undefined) return failed('fake gh: a comment POST models -f body=<text>\n');
    const at = now();
    const comment: FakePrComment = { id: nextCommentId, author: COMMENT_AUTHOR, body, createdAt: at, updatedAt: at };
    nextCommentId += 1;
    store({ ...pull, comments: [...pull.comments, comment] });
    return ok(JSON.stringify(renderRestComment(comment, pull, named)));
  };

  /** `repos/<repo>/issues/comments/<id>`: the body a PATCH replaces. */
  const handleCommentPath = (parsed: ParsedCommand, raw: string, method: string): GhResult => {
    const id = Number(raw);
    const holder = [...pulls.values()].find((pull) => pull.comments.some((comment) => comment.id === id));
    if (holder === undefined) return notFound('Not Found', COMMENT_DOCS);
    if (method !== 'PATCH') return failed(`fake gh: one comment is modelled for PATCH alone, and was handed ${method}\n`);
    const body = apiFields(parsed).get('body');
    if (body === undefined) return failed('fake gh: a comment PATCH models -f body=<text>\n');
    const edited = holder.comments.map((comment) => (comment.id === id
      ? { ...comment, body, updatedAt: now() }
      : comment));
    store({ ...holder, comments: edited });
    const answered = edited.find((comment) => comment.id === id);
    return answered === undefined
      ? notFound('Not Found', COMMENT_DOCS)
      : ok(JSON.stringify(renderRestComment(answered, holder, named)));
  };

  /** `repos/<repo>/collaborators/<login>/permission`: the trust reading. */
  const handlePermissionPath = (login: string, method: string): GhResult => {
    if (method !== 'GET') return failed(`fake gh: a permission is modelled for GET alone, and was handed ${method}\n`);
    const permission = permissions.get(login);
    return permission === undefined
      ? notFound(`${login} is not a user`, PERMISSION_DOCS)
      : ok(JSON.stringify(renderPermission(login, permission)));
  };

  /** `repos/<repo>/actions/workflows`: the workflow count, or its planted failure. */
  const handleWorkflowsPath = (method: string): GhResult => {
    if (method !== 'GET') return failed(`fake gh: workflows are modelled for GET alone, and were handed ${method}\n`);
    return workflowsRefusal === null
      ? ok(JSON.stringify(renderWorkflows(workflows, named)))
      : workflowsFailure(workflowsRefusal);
  };

  const handleApi = (parsed: ParsedCommand): GhResult => {
    const path = parsed.positionals[0] ?? '';
    const method = flagValue(parsed, '-X') ?? 'GET';

    const comments = /^repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/comments$/.exec(path);
    const comment = /^repos\/([^/]+\/[^/]+)\/issues\/comments\/(\d+)$/.exec(path);
    const permission = /^repos\/([^/]+\/[^/]+)\/collaborators\/([^/]+)\/permission$/.exec(path);
    const workflowList = /^repos\/([^/]+\/[^/]+)\/actions\/workflows$/.exec(path);
    const match = comments ?? comment ?? permission ?? workflowList;
    if (match === null) {
      return failed(`fake gh: api models the issue comment, collaborator permission and workflow list paths alone, and was handed ${path}\n`);
    }
    const [, inPath = '', tail = ''] = match;
    const refused = apiRepoProblem(path, inPath);
    if (refused !== null) return refused;

    if (comments !== null) return handleCommentsPath(parsed, tail, method);
    if (comment !== null) return handleCommentPath(parsed, tail, method);
    if (workflowList !== null) return handleWorkflowsPath(method);
    return handlePermissionPath(tail, method);
  };

  const handlers: ReadonlyMap<string, (parsed: ParsedCommand) => GhResult> = new Map([
    ['pr list', handlePrList],
    ['pr view', handlePrView],
    ['pr checks', handlePrChecks],
    ['pr merge', handlePrMerge],
    ['pr edit', handlePrEdit],
    ['run view', handleRunView],
    ['api', handleApi],
  ]);

  const run: GhRunner = async (args) => {
    calls = [...calls, Object.freeze([...args])];
    const key = commandKey(args);
    const shape = COMMANDS.get(key);
    const handle = handlers.get(key);
    if (shape === undefined || handle === undefined) return failed(`fake gh: unhandled command ${args.join(' ')}\n`);
    const parsed = parseCommand(key, shape, args.slice(key.split(' ').length));
    return typeof parsed === 'string'
      ? failed(`${parsed}\n`)
      : handle(parsed);
  };

  const fake: FakePrGh = {
    run,
    calls: () => calls,
    plant: (seed) => {
      store(fillSeed(seed));
    },
    pull: (number) => pulls.get(number),
    update: (number, change) => {
      const pull = pulls.get(number);
      if (pull === undefined) throw new Error(`fake gh: holds no pull request ${number}`);
      store({ ...change(pull), number: pull.number });
    },
    refuseMerge: (number, stderr) => {
      mergeRefusals = new Map([...mergeRefusals, [number, stderr]]);
    },
    plantRun: (id, log) => {
      runLogs = new Map([...runLogs, [id, log]]);
    },
    expireRun: (id) => {
      runLogs = new Map([...runLogs, [id, null]]);
    },
    plantPermission: (login, permission) => {
      permissions = new Map([...permissions, [login, permission]]);
    },
    plantWorkflows: (planted) => {
      workflows = Object.freeze(planted.map((workflow) => Object.freeze({ ...workflow })));
    },
    refuseWorkflows: (status) => {
      workflowsRefusal = status;
    },
  };
  return Object.freeze(fake);
}
