/**
 * A recorded fake of the `gh` CLI for the `github` Tracker adapter: one
 * in-memory repository behind a {@link GhRunner}, recording every
 * command it is handed.
 *
 * Copied from `createFakeGh` in open-tomato's
 * `packages/shared/issue-tracker/src/adapters/github-fake.ts` at commit
 * `45aaab563e5b4f4e6258e19ebf752b7cfeb67bf0` (2026-08-05), with the
 * commands the copied adapter no longer sends left out: the Projects v2
 * GraphQL probe, every `gh project` subcommand, `gh issue close` and
 * `gh label list`.
 *
 * This module is a test helper that is not itself a test file: bun runs
 * nothing in it until a `*.test.ts` calls it, and `check-types` reads
 * it, where it reads no test file.
 *
 * ## Recorded
 *
 * What the fake writes is modelled on `gh` 2.100.0, read on 2026-09-14
 * with read-only commands against the public `cli/cli` repository, in
 * scratch directories, and with an empty `GH_CONFIG_DIR`:
 *
 *   - `gh issue view --json` and `gh issue list --json` write exactly the
 *     fields asked for, keys in name order, and each label as `id`,
 *     `name`, `description` and `color`. An open issue's `stateReason` is
 *     an empty string; a closed one's is `COMPLETED` or `NOT_PLANNED`.
 *   - An issue's `author` is `{"id","is_bot","login","name"}` for a
 *     person, the shape `src/pr/gh-fake-shapes.ts` records for a pull
 *     request's: `gh issue view 1 --repo cli/cli --json author`,
 *     read on 2026-09-21 with the same `gh` 2.100.0, answered
 *     `{"id":"MDQ6VXNlcjk4NDgy","is_bot":false,"login":"vilmibm","name":"Nate Smith"}`.
 *     A bot-authored issue was not read; the fake plants people only.
 *   - `gh issue list` answered its rows newest first.
 *   - `--label "needs-triage,enhancement"` answered what two `--label`
 *     flags did, so a label value is split on commas.
 *   - A value flag takes the argument after it even when that argument
 *     opens with a dash: `--search --help` searched for `--help`.
 *   - To stderr, with exit 1: `You are not logged into any GitHub hosts.
 *     To log in, run: gh auth login` with no hosts configured;
 *     `GraphQL: Could not resolve to an issue or pull request with the
 *     number of <number>. (repository.issue)` for an issue that does not
 *     exist; `no git remotes found` in a repository with no remote; and
 *     `unable to expand placeholder in path: no git remotes found` from
 *     `gh api` there.
 *   - `gh repo view --json nameWithOwner` wrote
 *     `{"nameWithOwner":"open-tomato/rafa"}` in this repository.
 *   - `gh issue create --help` says the new issue URL is printed to stdout.
 *
 * Not recorded, since reading them would write to a repository: what
 * `gh issue create`, `gh issue comment`, `gh issue reopen`,
 * `gh label create` and a `gh api` PATCH write when they succeed, and
 * what they write when they fail. Those answers, and the rules that
 * `gh issue create` fails whole on a label that does not exist and that a
 * reopen clears the close reason, are the source's, and every message
 * this module makes up opens with `fake gh:`.
 *
 * ## Strict
 *
 * A command or a flag the fake does not model is refused, with `ok`
 * false and a message naming it, rather than ignored. An adapter that
 * sent `--type`, `--project` or a Projects v2 query would fail the case
 * that sent it, where a fake ignoring the flag would let the case pass.
 * A `--repo` naming another repository than the fake's own is refused
 * the same way.
 *
 * ## Recording
 *
 * {@link FakeGh.calls} answers every command handed over, refused ones
 * included, in order, each copied and frozen. {@link FakeGh.update}
 * replaces one issue, so a case can plant what a person could have
 * edited on GitHub.
 */
import type { GhResult, GhRunner } from './github.js';

/** One issue the fake repository holds. */
export interface FakeGhIssue {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
  readonly state: 'OPEN' | 'CLOSED';
  /** `COMPLETED` or `NOT_PLANNED` once closed; empty while open, as recorded. */
  readonly stateReason: string;
  /** The login that opened it; every issue the fake plants carries the fake's own account. */
  readonly author: string;
  readonly comments: readonly string[];
}

/** What the fake is made with. */
export interface FakeGhOptions {
  /** Whether `gh auth status` succeeds. True when left out. */
  readonly authOk?: boolean;
  /**
   * The repository the working directory resolves to, as `owner/name`,
   * or null for a checkout with no git remote. `open-tomato/rafa` when
   * left out.
   */
  readonly repo?: string | null;
  /** Whether `gh label create` succeeds. True when left out. */
  readonly labelCreateOk?: boolean;
}

/** The fake: its runner, and what it holds and was handed. */
export interface FakeGh {
  /** The runner to make a tracker with. */
  readonly run: GhRunner;
  /** Every command handed to `run`, in order. */
  readonly calls: () => readonly (readonly string[])[];
  /** The issue under a number, as `externalId` names it. */
  readonly issue: (number: string) => FakeGhIssue | undefined;
  /** How many issues the repository holds. */
  readonly issueCount: () => number;
  /** Whether the repository holds a label. */
  readonly hasLabel: (name: string) => boolean;
  /** Replaces the issue under a number. Throws when there is none. */
  readonly update: (number: string, change: (issue: FakeGhIssue) => FakeGhIssue) => void;
}

/** The repository the working directory resolves to when the options name none. */
const DEFAULT_REPO = 'open-tomato/rafa';

/** The labels a new GitHub repository holds, from the source. */
const DEFAULT_LABELS = [
  'bug',
  'documentation',
  'duplicate',
  'enhancement',
  'good first issue',
  'help wanted',
  'invalid',
  'question',
  'wontfix',
];

/** The account `gh auth status` names, and the author of every issue the fake plants. */
const FAKE_LOGIN = 'rafa-fake';

/** Recorded with no hosts configured. */
const NOT_LOGGED_IN = 'You are not logged into any GitHub hosts. To log in, run: gh auth login\n';

/** Recorded in a repository with no remote. */
const NO_REMOTES = 'no git remotes found\n';

/** The source's stand-in for a refused label create. */
const LABEL_CREATE_ERROR = 'HTTP 403: Resource not accessible by integration (label create)\n';

/** The fields each viewing command can be asked for. */
const VIEW_FIELDS: ReadonlySet<string> = new Set(['author', 'body', 'labels', 'number', 'state', 'stateReason', 'title', 'url']);

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
  ['auth status', { values: [], switches: [], positionals: 0 }],
  ['repo view', { values: ['--json'], switches: [], positionals: 0 }],
  ['label create', { values: ['--repo'], switches: ['--force'], positionals: 1 }],
  ['issue create', { values: ['--title', '--body', '--label', '--repo'], switches: [], positionals: 0 }],
  ['issue view', { values: ['--json', '--repo'], switches: [], positionals: 1 }],
  ['issue list', { values: ['--state', '--json', '--limit', '--label', '--search', '--repo'], switches: [], positionals: 0 }],
  ['issue comment', { values: ['--body', '--repo'], switches: [], positionals: 1 }],
  ['issue reopen', { values: ['--repo'], switches: [], positionals: 1 }],
  ['api', { values: ['-X', '-f'], switches: [], positionals: 1 }],
]);

/** A command's arguments once read against its shape. */
interface ParsedCommand {
  readonly positionals: readonly string[];
  /** Each flag's values, in order; a switch holds one empty value per use. */
  readonly flags: ReadonlyMap<string, readonly string[]>;
}

/** A successful answer. */
function ok(stdout = ''): GhResult {
  return { ok: true, stdout, stderr: '' };
}

/** A failed answer. */
function failed(stderr: string): GhResult {
  return { ok: false, stdout: '', stderr };
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

/** Every label a command's `--label` flags name, each split on commas as recorded. */
function labelValues(parsed: ParsedCommand): string[] {
  return (parsed.flags.get('--label') ?? []).flatMap((value) => value.split(','));
}

/** Makes a fake `gh` over an empty repository; see the module note. */
export function createFakeGh(options: FakeGhOptions = {}): FakeGh {
  const authOk = options.authOk ?? true;
  const repo = options.repo === undefined
    ? DEFAULT_REPO
    : options.repo;
  const labelCreateOk = options.labelCreateOk ?? true;

  let issues: ReadonlyMap<string, FakeGhIssue> = new Map();
  let labels: ReadonlySet<string> = new Set(DEFAULT_LABELS);
  let calls: readonly (readonly string[])[] = [];

  const urlOf = (number: number): string => `https://github.com/${repo ?? DEFAULT_REPO}/issues/${number}`;

  const store = (issue: FakeGhIssue): void => {
    issues = new Map([...issues, [String(issue.number), Object.freeze({ ...issue })]]);
  };

  /** The repository a command acts on, or the failure `gh` answers for it. */
  const repoProblem = (parsed: ParsedCommand): GhResult | null => {
    const named = flagValue(parsed, '--repo');
    if (named !== undefined) {
      return named === repo
        ? null
        : failed(`fake gh: models one repository, ${repo ?? 'none'}, and was handed --repo ${named}\n`);
    }
    return repo === null
      ? failed(NO_REMOTES)
      : null;
  };

  /** The fields `--json` asks for, or the failure for one the fake does not model. */
  const jsonFields = (parsed: ParsedCommand, allowed: ReadonlySet<string>): string[] | GhResult => {
    const fields = (flagValue(parsed, '--json') ?? '').split(',');
    const unknown = fields.find((field) => !allowed.has(field));
    return unknown === undefined
      ? fields
      : failed(`fake gh: does not model --json field ${JSON.stringify(unknown)}\n`);
  };

  /** An issue as `--json` writes it: the fields asked for, keys in name order. */
  const render = (issue: FakeGhIssue, fields: readonly string[]): Record<string, unknown> => {
    const values: Record<string, unknown> = {
      author: { id: `MDQ6VXNlcmZha2U${issue.author}`, is_bot: false, login: issue.author, name: issue.author },
      body: issue.body,
      labels: issue.labels.map((name, index) => ({ id: `LA_fake${index}`, name, description: '', color: 'ededed' })),
      number: issue.number,
      state: issue.state,
      stateReason: issue.stateReason,
      title: issue.title,
      url: urlOf(issue.number),
    };
    return Object.fromEntries([...fields].sort().map((field) => [field, values[field]]));
  };

  /** The issue a command names, or the recorded failure for one that does not exist. */
  const namedIssue = (number: string): FakeGhIssue | GhResult => issues.get(number)
    ?? failed(`GraphQL: Could not resolve to an issue or pull request with the number of ${number}. (repository.issue)\n`);

  const handlers = new Map<string, (parsed: ParsedCommand) => GhResult>([
    ['auth status', () => (authOk
      ? ok(`github.com\n  Logged in to github.com account ${FAKE_LOGIN} (keyring)\n`)
      : failed(NOT_LOGGED_IN))],

    ['repo view', (parsed) => {
      if (flagValue(parsed, '--json') !== 'nameWithOwner') return failed('fake gh: repo view models --json nameWithOwner alone\n');
      return repoProblem(parsed) ?? ok(`${JSON.stringify({ nameWithOwner: repo })}\n`);
    }],

    ['label create', (parsed) => {
      const refused = repoProblem(parsed);
      if (refused !== null) return refused;
      if (!labelCreateOk) return failed(LABEL_CREATE_ERROR);
      labels = new Set([...labels, parsed.positionals[0] ?? '']);
      return ok();
    }],

    ['issue create', (parsed) => {
      const refused = repoProblem(parsed);
      if (refused !== null) return refused;
      const title = flagValue(parsed, '--title');
      const body = flagValue(parsed, '--body');
      if (title === undefined || body === undefined) return failed('fake gh: issue create models --title with --body alone\n');
      const wanted = labelValues(parsed);
      const missing = wanted.find((label) => !labels.has(label));
      if (missing !== undefined) return failed(`could not add label: '${missing}' not found\n`);

      const number = Math.max(0, ...[...issues.values()].map((issue) => issue.number)) + 1;
      store({ number, title, body, labels: wanted, state: 'OPEN', stateReason: '', author: FAKE_LOGIN, comments: [] });
      return ok(`${urlOf(number)}\n`);
    }],

    ['issue view', (parsed) => {
      const refused = repoProblem(parsed);
      if (refused !== null) return refused;
      const fields = jsonFields(parsed, VIEW_FIELDS);
      if (!Array.isArray(fields)) return fields;
      const issue = namedIssue(parsed.positionals[0] ?? '');
      return 'ok' in issue
        ? issue
        : ok(`${JSON.stringify(render(issue, fields))}\n`);
    }],

    ['issue list', (parsed) => {
      const refused = repoProblem(parsed);
      if (refused !== null) return refused;
      const fields = jsonFields(parsed, VIEW_FIELDS);
      if (!Array.isArray(fields)) return fields;
      const limit = Number(flagValue(parsed, '--limit') ?? '30');
      if (!Number.isSafeInteger(limit) || limit < 1) return failed(`fake gh: does not model --limit ${String(limit)}\n`);
      const state = flagValue(parsed, '--state') ?? 'open';
      if (!['open', 'closed', 'all'].includes(state)) return failed(`fake gh: does not model --state ${state}\n`);
      const wanted = labelValues(parsed);
      const search = flagValue(parsed, '--search')?.toLowerCase();

      // Newest first, as recorded. The search is a lower-cased substring
      // of the title and body, the source's; GitHub's search syntax is
      // not modelled.
      const rows = [...issues.values()]
        .filter((issue) => state === 'all' || issue.state.toLowerCase() === state)
        .filter((issue) => wanted.every((label) => issue.labels.includes(label)))
        .filter((issue) => search === undefined || `${issue.title}\n${issue.body}`.toLowerCase().includes(search))
        .sort((a, b) => b.number - a.number)
        .slice(0, limit)
        .map((issue) => render(issue, fields));
      return ok(`${JSON.stringify(rows)}\n`);
    }],

    ['issue comment', (parsed) => {
      const refused = repoProblem(parsed);
      if (refused !== null) return refused;
      const body = flagValue(parsed, '--body');
      if (body === undefined) return failed('fake gh: issue comment models --body alone\n');
      const issue = namedIssue(parsed.positionals[0] ?? '');
      if ('ok' in issue) return issue;
      store({ ...issue, comments: [...issue.comments, body] });
      return ok(`${urlOf(issue.number)}#issuecomment-fake\n`);
    }],

    ['issue reopen', (parsed) => {
      const refused = repoProblem(parsed);
      if (refused !== null) return refused;
      const issue = namedIssue(parsed.positionals[0] ?? '');
      if ('ok' in issue) return issue;
      store({ ...issue, state: 'OPEN', stateReason: '' });
      return ok();
    }],

    ['api', (parsed) => {
      const path = parsed.positionals[0] ?? '';
      const match = /^repos\/(.+)\/issues\/([^/]+)$/.exec(path);
      if (match === null) return failed(`fake gh: api models repos/<repository>/issues/<number> alone, and was handed ${path}\n`);
      const [, named = '', number = ''] = match;
      if (named === '{owner}/{repo}' && repo === null) return failed(`unable to expand placeholder in path: ${NO_REMOTES}`);
      if (named !== '{owner}/{repo}' && named !== repo) {
        return failed(`fake gh: models one repository, ${repo ?? 'none'}, and was handed ${path}\n`);
      }
      // `gh api` sends a POST once `-f` is passed, and a POST cannot update an issue.
      if (flagValue(parsed, '-X') !== 'PATCH') return failed(`fake gh: ${path} is modelled for -X PATCH alone\n`);
      const issue = namedIssue(number);
      if ('ok' in issue) return issue;

      const fields = new Map((parsed.flags.get('-f') ?? []).map((pair): [string, string] => {
        const at = pair.indexOf('=');
        return [pair.slice(0, at), pair.slice(at + 1)];
      }));
      const state = fields.get('state');
      const reason = fields.get('state_reason');
      if (state !== 'closed' || (reason !== 'completed' && reason !== 'not_planned')) {
        return failed('fake gh: api PATCH models state=closed with state_reason completed or not_planned alone\n');
      }
      store({ ...issue, state: 'CLOSED', stateReason: reason.toUpperCase() });
      return ok(`${JSON.stringify(render(issues.get(number) ?? issue, ['number', 'state', 'stateReason']))}\n`);
    }],
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

  const fake: FakeGh = {
    run,
    calls: () => calls,
    issue: (number) => issues.get(number),
    issueCount: () => issues.size,
    hasLabel: (name) => labels.has(name),
    update: (number, change) => {
      const issue = issues.get(number);
      if (issue === undefined) throw new Error(`fake gh: holds no issue ${number}`);
      store({ ...change(issue), number: issue.number });
    },
  };
  return Object.freeze(fake);
}
