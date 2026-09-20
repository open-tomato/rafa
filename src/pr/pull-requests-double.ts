/**
 * A test double of the pull request port: a provider answering the
 * members one case names, refusing every other one, and recording each
 * call either way.
 *
 * ## Why this is a module and not a helper in each test file
 *
 * `tsconfig.json` excludes every `*.test.ts`, so `check-types` never opens
 * a test file. A case building a {@link PullRequests} literal by hand is
 * therefore checked by nothing: when the port grows a member, the literal
 * keeps compiling for `bun test`, which strips types without checking
 * them, and the case goes on passing against a provider that is missing
 * the member the port now declares. Eight files held such a literal
 * before this module, and `editBody` — the member rafa-21 added — is in
 * none of them.
 *
 * This module is not a test file, so `check-types` DOES open it: the
 * object {@link createPullRequestsDouble} builds is annotated
 * `PullRequests`, and a member added to the port reddens the types gate
 * here, in one place, rather than passing silently in eight.
 *
 * It is a test helper all the same — bun runs nothing in it until a
 * `*.test.ts` calls it — so it is NOT re-exported from `./index.js`, for
 * the reason the barrel's note gives for `./gh-fake.js`: a barrel
 * carrying it would put it into the import graph of the loop itself.
 * Import it as `../pr/pull-requests-double.js`.
 *
 * ## What the double is for, and what it is not
 *
 * It is for a case whose subject is the CALLER: which members a command
 * sends, in what order, with what arguments, and what it does with the
 * answers. Every member the case does not name refuses, so a caller
 * reaching for a member the case did not plan for fails that case rather
 * than reading an invented answer — and the refusal is RECORDED before
 * it is thrown, so "it refused and merged nothing" is a reading off
 * {@link PullRequestsDouble.calls} and not an inference from a message.
 *
 * It is NOT for a case whose subject is the PROVIDER. A read-modify-write
 * against a genuine implementation — the release stage's body edit, say —
 * wants `createGhPullRequests` over `createFakePrGh()`, which
 * `context/pull-requests.md` points at: the double answers whatever the
 * case handed it and so can agree with a caller that is wrong about what
 * `gh` does.
 *
 * Every refusal REJECTS rather than throwing synchronously, because the
 * port's members all answer promises and a caller that forgot to await
 * one should fail the same way it would against a real provider.
 */
import type { PullRequests } from './types.js';

/** Every member of {@link PullRequests} but `kind`, which is a value. */
export type PullRequestsMember = Exclude<keyof PullRequests, 'kind'>;

/**
 * What a case names: the answer for each member it expects to be sent.
 *
 * Read once, when the double is built, so a later edit of the object a
 * case passed changes nothing about the double it already has.
 */
export type PullRequestsAnswers = Partial<Pick<PullRequests, PullRequestsMember>>;

/** One call the double was handed, answered or refused. */
export interface PullRequestsCall {
  /** The member sent. */
  readonly member: PullRequestsMember;
  /** Its arguments, in order, exactly as the caller passed them. */
  readonly args: readonly unknown[];
  /** True when the case named no answer for it, so the call was refused. */
  readonly refused: boolean;
}

/** How a case shapes the double beyond its answers. */
export interface PullRequestsDoubleOptions {
  /**
   * The message every refusal carries, in place of the one
   * {@link createPullRequestsDouble} composes. A file moving off a
   * hand-built literal keeps its own wording through this.
   */
  readonly refusal?: string;
}

/** A double of the port, and the log of every call it was handed. */
export interface PullRequestsDouble {
  /** The provider to hand the subject under test. */
  readonly pulls: PullRequests;
  /** Every call, in order, refused ones included. */
  readonly calls: () => readonly PullRequestsCall[];
  /**
   * The same calls spelled one line each, the member then its arguments
   * separated by spaces: a squash merge of #41 is `merge 41 squash`.
   */
  readonly sent: () => readonly string[];
}

/** A member of the port, as this module calls one without naming its own signature. */
type AnyAnswer = (...args: readonly unknown[]) => Promise<unknown>;

/** `a`, `a and b`, `a, b and c` — the shape the refusals of the port's own callers use. */
function wordList(words: readonly string[]): string {
  if (words.length < 2) return words.join('');
  const last = words[words.length - 1] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${last}`;
}

/** The refusal a case that named no wording of its own gets. */
function composeRefusal(member: PullRequestsMember, named: readonly string[]): string {
  const answers = named.length === 0
    ? 'answers no member'
    : `answers ${wordList(named)} alone`;
  return `the pull request double was sent ${member}, which this case did not name: it ${answers}`;
}

/**
 * Builds a {@link PullRequests} answering the members `answers` names
 * and refusing every other one.
 *
 * Each call is recorded before it is answered or refused, so a case
 * reads what the subject sent from {@link PullRequestsDouble.calls} or
 * {@link PullRequestsDouble.sent} rather than from the effect it had.
 *
 * @param answers One answer per member the case expects to be sent.
 * @param options The refusal wording, when the case wants its own.
 *
 * @example
 * ```ts
 * const double = createPullRequestsDouble({
 *   get: () => Promise.resolve(detail()),
 *   merge: () => Promise.resolve({ merged: true, detail: 'Squashed' }),
 * });
 * // ... hand double.pulls to the command, then:
 * expect(double.sent()).toEqual(['get 41', 'merge 41 squash']);
 * ```
 */
export function createPullRequestsDouble(
  answers: PullRequestsAnswers = {},
  options: PullRequestsDoubleOptions = {},
): PullRequestsDouble {
  let calls: readonly PullRequestsCall[] = [];
  const named = Object.keys(answers)
    .filter((key) => answers[key as PullRequestsMember] !== undefined);

  const bind = <K extends PullRequestsMember>(member: K): PullRequests[K] => {
    const answer = answers[member];
    const handle = (...args: readonly unknown[]): Promise<unknown> => {
      calls = [...calls, Object.freeze({
        member,
        args: Object.freeze([...args]),
        refused: answer === undefined,
      })];
      return answer === undefined
        ? Promise.reject(new Error(options.refusal ?? composeRefusal(member, named)))
        : (answer as AnyAnswer)(...args);
    };
    return handle as PullRequests[K];
  };

  const pulls: PullRequests = {
    kind: 'gh',
    findOpen: bind('findOpen'),
    list: bind('list'),
    get: bind('get'),
    checks: bind('checks'),
    browse: bind('browse'),
    merge: bind('merge'),
    editBody: bind('editBody'),
    comments: bind('comments'),
    comment: bind('comment'),
    editComment: bind('editComment'),
    failedLog: bind('failedLog'),
  };

  return Object.freeze({
    pulls,
    calls: () => calls,
    sent: () => calls.map((call) => [call.member, ...call.args.map((arg) => String(arg))].join(' ')),
  });
}
