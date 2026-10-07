/**
 * The `editable` and `edit` pair of the `github` Tracker adapter: what
 * `rafa issue edit` reads of an issue before it writes, and the write.
 * rafa's own pair, absent from the source `github.ts` was copied from.
 *
 * ## The read
 *
 * `editable` is one `gh issue view <number> --json
 * title,body,state,labels,author`, with `--repo` when the ref names one.
 * The payload is checked by hand, as `get` checks its own: a title and
 * a body that are strings, a state of `OPEN` or `CLOSED`, labels that
 * are a list of named labels, and an author that is a mapping holding a
 * string `login`. The issue is open when the state is `OPEN`; the labels
 * are answered by name in the order `gh` wrote them, and the author by
 * its login. The ref is answered as it was handed over.
 *
 * The read asks for no `url`, so it cannot tell an open pull request
 * from an issue the way `get` does: `gh issue view` answers a pull
 * request's number too, and an open one reads as an open issue here. A
 * merged one answers `state` `MERGED` (read off `gh` 2.100.0 on
 * 2026-09-14, see `github.ts`) and is refused.
 *
 * ## The write
 *
 * `edit` is one `gh issue edit <number>`, with `--repo` when the ref
 * names one, `--title` with the new title when the change names one,
 * and `--body-file -` with the new body handed to `gh` on stdin when the
 * change names one. `gh issue edit --help` (`gh` 2.100.0, read on
 * 2026-10-06) names `-F, --body-file file  Read body text from file (use
 * "-" to read from standard input)`. The body travels on stdin rather
 * than as a `--body` argument so that no length limit on an argument
 * list, and no reading of a value as a flag, stands between the text
 * and the issue. What `gh issue edit` writes when it succeeds or fails
 * was not recorded, since reading it writes to a repository; the
 * adapter reads nothing of a success and names the command and what it
 * wrote in the rejection of a failure.
 *
 * Before anything is sent, `edit` refuses a change that is not a
 * mapping, that names neither a body nor a title, or whose body or
 * title is not a string, as the `local` adapter refuses one.
 *
 * ## Why the readers are handed over
 *
 * `github.ts` makes the pair with {@link createGithubEditMembers} and
 * hands over its own command runner and readers, rather than this
 * module importing them: the two modules then share one spelling of
 * each refusal and `github.ts`, which imports this module, is imported
 * by it for types alone.
 */
import type { EditableIssue, IssueEdit, IssueRef, Tracker } from '../../ports/index.js';

import { describeValue, isMapping } from '../../config-sections.js';

/** What every refusal opens with, as `github.ts` spells it. */
const PREFIX = 'github tracker';

/** The fields `editable` asks `gh issue view` for. */
export const EDITABLE_FIELDS = 'title,body,state,labels,author';

/** What the pair is made with: the adapter's own runner and readers. */
export interface GithubEditReaders {
  /**
   * Runs `gh` with `args`, handing `stdin` to it when given, and answers
   * what it wrote to stdout. Rejects, naming `command`, when it failed.
   */
  readonly run: (args: readonly string[], command: string, stdin?: string) => Promise<string>;
  /** The issue number a ref names, as `gh` is handed it. Throws for a ref the adapter refuses. */
  readonly issueNumberOf: (ref: IssueRef) => string;
  /** What `command` wrote, parsed as JSON. Throws, naming the command, when it is not JSON. */
  readonly parseJson: (stdout: string, command: string) => unknown;
  /** The names of a payload's labels, or null when they are not a list of named labels. */
  readonly labelNames: (value: unknown) => string[] | null;
}

/** The pair, as the `Tracker` port names its members. */
export interface GithubEditMembers {
  readonly editable: NonNullable<Tracker['editable']>;
  readonly edit: NonNullable<Tracker['edit']>;
}

/** A `gh issue view` payload for `editable`, checked. */
interface ViewedEditable {
  readonly title: string;
  readonly body: string;
  readonly open: boolean;
  readonly labels: readonly string[];
  readonly author: string;
}

/** The checked payload, or the first thing wrong with it. */
function viewedEditable(payload: unknown, labelNames: GithubEditReaders['labelNames']): ViewedEditable | string {
  if (!isMapping(payload)) return `${describeValue(payload)}, expected a mapping`;
  const { title, body, state, author } = payload;
  if (typeof title !== 'string') return `title ${describeValue(title)}, expected a string`;
  if (typeof body !== 'string') return `body ${describeValue(body)}, expected a string`;
  if (state !== 'OPEN' && state !== 'CLOSED') return `state ${describeValue(state)}, expected "OPEN" or "CLOSED"`;
  const labels = labelNames(payload['labels']);
  if (labels === null) return 'labels that are not a list of named labels';
  const login = isMapping(author)
    ? author['login']
    : undefined;
  if (typeof login !== 'string') return `author ${describeValue(author)}, expected a mapping holding a string login`;
  return { title, body, open: state === 'OPEN', labels, author: login };
}

/** The first thing wrong with a change, or null when nothing is. */
function editProblem(change: unknown): string | null {
  if (!isMapping(change)) return `the change is ${describeValue(change)}, expected a mapping`;
  const { body, title } = change;
  if (body === undefined && title === undefined) return 'the change names neither a body nor a title';
  if (body !== undefined && typeof body !== 'string') return `body is ${describeValue(body)}, expected a string`;
  return title !== undefined && typeof title !== 'string'
    ? `title is ${describeValue(title)}, expected a string`
    : null;
}

/** A flag and its value, or nothing when the value is absent. */
function optionalFlag(name: string, value: string | undefined): string[] {
  return value === undefined
    ? []
    : [name, value];
}

/** Makes the `editable` and `edit` pair over the adapter's readers; see the module note. */
export function createGithubEditMembers(readers: GithubEditReaders): GithubEditMembers {
  const { run, issueNumberOf, parseJson, labelNames } = readers;

  const editable = async (ref: IssueRef): Promise<EditableIssue> => {
    const number = issueNumberOf(ref);
    const command = `gh issue view ${number}`;
    const stdout = await run(['issue', 'view', number, ...optionalFlag('--repo', ref.repo), '--json', EDITABLE_FIELDS], command);
    const viewed = viewedEditable(parseJson(stdout, command), labelNames);
    if (typeof viewed === 'string') throw new Error(`${PREFIX}: ${command} answered ${viewed}`);
    return { ref, ...viewed };
  };

  const edit = async (ref: IssueRef, change: IssueEdit): Promise<void> => {
    const number = issueNumberOf(ref);
    const problem = editProblem(change);
    if (problem !== null) throw new TypeError(`${PREFIX}: refused an edit of issue #${number}: ${problem}`);
    const bodyFlag = change.body === undefined
      ? []
      : ['--body-file', '-'];
    await run(
      ['issue', 'edit', number, ...optionalFlag('--repo', ref.repo), ...optionalFlag('--title', change.title), ...bodyFlag],
      `gh issue edit ${number}`,
      change.body,
    );
  };

  return Object.freeze({ editable, edit });
}
