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
 * its login. The ref is answered as it was handed over. The priority is
 * read off the labels as `get` reads it in `github.ts`: the value of the
 * first `priority:` label when that is one of the port's priorities,
 * else null.
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
 * mapping, that names no body, no title and no priority, whose body or
 * title is not a string, or whose priority is not one of the port's
 * priorities, as the `local` adapter refuses one.
 *
 * ## A priority
 *
 * A priority is a label swap in that same `gh issue edit`: `--add-label
 * priority:<value>`, and one `--remove-label` for each other `priority:`
 * label and for `needs-triage`. `gh issue edit --help` (`gh` 2.102.0,
 * read on 2026-10-13) names `--add-label name  Add labels by name` and
 * `--remove-label name  Remove labels by name`. So the swap and the way
 * out of triage land in one edit or not at all, beside a title or a body
 * when the change names one.
 *
 * What `gh` does with a `--remove-label` naming a label the issue lacks,
 * or an `--add-label` naming one it holds already, was not recorded, and
 * the edit depends on neither: it first reads the issue's labels through
 * `editable`, one `gh issue view`, and names only labels that read
 * holds, and adds the new label only when the read lacks it. An issue
 * holding the priority already, alone and out of triage, therefore has
 * nothing to swap, and a change naming that priority and nothing else
 * sends no `gh issue edit`. A label another edit writes between the read
 * and the write is not seen.
 *
 * The label added is made first, with `gh label create <label> --force`
 * and `--repo` when the ref names one, as `create` makes the labels it
 * sends: `rafa init --board` makes `needs-triage` and no `priority:`
 * label, and what `gh issue edit` does with a label the repository lacks
 * was not recorded either. A failed make rejects with nothing edited.
 *
 * That help page shows `--add-label "bug,help wanted"` adding two
 * labels. Whether `--remove-label` splits its value the same way was not
 * read, so an issue holding a label to remove whose name holds a comma
 * refuses the edit, with nothing sent after the read.
 *
 * ## Why the readers are handed over
 *
 * `github.ts` makes the pair with {@link createGithubEditMembers} and
 * hands over its own command runner and readers, rather than this
 * module importing them: the two modules then share one spelling of
 * each refusal and `github.ts`, which imports this module, is imported
 * by it for types alone.
 */
import type { EditableIssue, IssueEdit, IssuePriority, IssueRef, Tracker } from '../../ports/index.js';

import { describeValue, isMapping } from '../../core/config/sections.js';

import { ISSUE_PRIORITIES } from './issue-values.js';

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
  /** The label names a priority is held as, which `github.ts` spells in `GITHUB_LABELS`. */
  readonly labels: PriorityLabels;
}

/** What opens a priority's label, and the label of an issue triage has set no priority for. */
export interface PriorityLabels {
  readonly priorityPrefix: string;
  readonly needsTriage: string;
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

/** True when `value` is one of the port's priorities. */
function isPriority(value: unknown): value is IssuePriority {
  return ISSUE_PRIORITIES.some((priority) => priority === value);
}

/**
 * The priority an issue's labels carry: the value of the first label
 * opening with `prefix` when that is one of the port's priorities, else
 * null, as `get` reads it in `github.ts`.
 */
function priorityOf(held: readonly string[], prefix: string): IssuePriority | null {
  const value = held.find((label) => label.startsWith(prefix))?.slice(prefix.length);
  return isPriority(value)
    ? value
    : null;
}

/** The first thing wrong with a change, or null when nothing is. */
function editProblem(change: unknown): string | null {
  if (!isMapping(change)) return `the change is ${describeValue(change)}, expected a mapping`;
  const { body, title, priority } = change;
  if (body === undefined && title === undefined && priority === undefined) {
    return 'the change names no body, no title and no priority';
  }
  if (body !== undefined && typeof body !== 'string') return `body is ${describeValue(body)}, expected a string`;
  if (title !== undefined && typeof title !== 'string') return `title is ${describeValue(title)}, expected a string`;
  return priority === undefined || isPriority(priority)
    ? null
    : `priority is ${describeValue(priority)}, expected one of: ${ISSUE_PRIORITIES.join(', ')}`;
}

/** The labels one edit adds and removes. */
interface LabelSwap {
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

/** The swap of an edit naming no priority. */
const NO_SWAP: LabelSwap = Object.freeze({ added: [], removed: [] });

/**
 * The swap that leaves an issue holding `held` with `priority` and no
 * other, out of triage: the priority's label added unless held, and each
 * other priority label and the triage label removed, of those held.
 */
function swapFor(priority: IssuePriority, held: readonly string[], labels: PriorityLabels): LabelSwap {
  const wanted = `${labels.priorityPrefix}${priority}`;
  return {
    added: held.includes(wanted)
      ? []
      : [wanted],
    removed: held.filter((label) => label !== wanted
      && (label === labels.needsTriage || label.startsWith(labels.priorityPrefix))),
  };
}

/** A flag and its value, or nothing when the value is absent. */
function optionalFlag(name: string, value: string | undefined): string[] {
  return value === undefined
    ? []
    : [name, value];
}

/** Makes the `editable` and `edit` pair over the adapter's readers; see the module note. */
export function createGithubEditMembers(readers: GithubEditReaders): GithubEditMembers {
  const { run, issueNumberOf, parseJson, labelNames, labels } = readers;

  const editable = async (ref: IssueRef): Promise<EditableIssue> => {
    const number = issueNumberOf(ref);
    const command = `gh issue view ${number}`;
    const stdout = await run(['issue', 'view', number, ...optionalFlag('--repo', ref.repo), '--json', EDITABLE_FIELDS], command);
    const viewed = viewedEditable(parseJson(stdout, command), labelNames);
    if (typeof viewed === 'string') throw new Error(`${PREFIX}: ${command} answered ${viewed}`);
    return { ref, ...viewed, priority: priorityOf(viewed.labels, labels.priorityPrefix) };
  };

  const edit = async (ref: IssueRef, change: IssueEdit): Promise<void> => {
    const number = issueNumberOf(ref);
    const problem = editProblem(change);
    if (problem !== null) throw new TypeError(`${PREFIX}: refused an edit of issue #${number}: ${problem}`);
    const swap = change.priority === undefined
      ? NO_SWAP
      : swapFor(change.priority, (await editable(ref)).labels, labels);
    const split = swap.removed.find((label) => label.includes(','));
    if (split !== undefined) {
      throw new Error(
        `${PREFIX}: refused an edit of issue #${number}: it holds the label ${describeValue(split)},`
          + ' and a label holding a comma cannot be named to gh issue edit',
      );
    }
    const bodyFlag = change.body === undefined
      ? []
      : ['--body-file', '-'];
    const flags = [
      ...optionalFlag('--title', change.title),
      ...bodyFlag,
      ...swap.added.flatMap((label) => ['--add-label', label]),
      ...swap.removed.flatMap((label) => ['--remove-label', label]),
    ];
    // The issue holds the priority already, alone and out of triage, and the change names nothing else.
    if (flags.length === 0) return;
    const repoFlag = optionalFlag('--repo', ref.repo);
    for (const label of swap.added) {
      // Before `gh issue edit`: nothing is edited yet, so a failure leaves the issue as it was.
      await run(['label', 'create', label, ...repoFlag, '--force'], `gh label create ${describeValue(label)}`);
    }
    await run(['issue', 'edit', number, ...repoFlag, ...flags], `gh issue edit ${number}`, change.body);
  };

  return Object.freeze({ editable, edit });
}
