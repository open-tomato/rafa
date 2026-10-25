## Cause codes

`packages/rafa/src/errors/` holds the cause codes a bug or a rafa error can
carry (#949), and `src/errors/match.ts` ranks them.
A code marks which gate tripped: where the pain shows and where the
symptoms come from. Two bugs sharing a code may still fail in different
things, so a shared code raises a match score and never decides a match.

### The shape

A code is `<family>:<leaf>`, both kebab-case, checked by `CODE_PATTERN`
(`packages/rafa/src/errors/codes.ts`). The family names the gate or tool
(`git`, `tsc`, `fs`), and the leaf names the condition (`git:no-identity`). An
entry (`ErrorCodeEntry`) holds:

- `code`
- `description`: one line saying what the context is
- `hint`: the recommended next action
- `level`: `error` or `warn`
- `since`: the version or issue that added it; rafa's list always names
  it, and a project's entry may leave it out
- `legacy`, optional: the spelling an older union gives the same context

### The reserved values

Every family holds `<family>:new-context` without declaring it, for a cause
no leaf fits yet. `unknown:new-context` is the last resort when even the
family is unknown. `isKnownCode` answers true for both. `codeProblem`
therefore refuses three spellings in a declared code: the leaf
`new-context`, the leaf `unknown`, and the family `unknown`. The bare word
`unknown` stays free to mean "the filer does not know" in other fields.

### rafa's list

`RAFA_CODES` (`packages/rafa/src/errors/rafa-codes.ts`) is declared through
`defineErrorCodes`, which throws a `TypeError` on a bad shape or on a code
declared twice: the list is source, so a fault in it is a build error. Each
family the list uses has one line in `FAMILY_DESCRIPTIONS`.

The list grows from fixes. A bug filed as `<family>:new-context` gets its
code added by the change that fixes it.

A bug a person files is held to the list: `rafa issue create --type=bug`
refuses a `--cause` the list lacks and names the line to file it with
instead, `--cause=<family>:new-context --proposed=<the code>`
(`context/bug-record.md`). A bug the loop files is never refused over its
cause. The cause rule (`packages/rafa-board/src/bugs/cause-rule.ts`) files a shaped code the
list lacks as `<family>:new-context`, with the code kept as `proposed`, and
any other text as `unknown:new-context`, with the words kept as `suspected`
(`context/triage.md`).

### The older unions and the drift guard

Four per-module unions existed before the list: `ROUTE_REFUSALS` and
`DISPATCH_ERROR_CODES` (`src/cli/`), and `SKILL_ISSUE_CODES` and
`FailureStringCode` (`src/schema/`). They keep their own spellings, because
`--output=json` readers see them in `error.code`. Each value has a list
entry in the new form, with the old spelling in `legacy`
(`cli:command-exit` carries `command_exit`).

Nothing derives the unions from the list.
`src/tests/core-coupled/errors/rafa-codes.test.ts` holds the two together in
both directions: a union value with no entry turns it red, and so does a
`legacy` naming no union value. Adding a value
to one of the four unions therefore means adding its entry in the same
commit.

### A project's codes

`errors.codes` in the project's config is a list of entries with the keys
`code`, `description`, `hint`, `level` and, optionally, `since`, read by
`packages/rafa/src/config-schema-errors.ts`. `legacy` is rafa's alone: on a
project entry it is an unknown key.

```yaml
errors:
  codes:
    - code: deploy:missing-secret
      description: a deploy step reads a secret the environment does not set
      hint: set the secret in the environment, then rerun the deploy
      level: error
      since: v1
```

A project may add a leaf to a rafa family or a whole family of its own.
The reader refuses, at load and naming both places:

- a code rafa already declares, so a rafa upgrade that adds a code a
  project also declared shows the clash instead of one meaning winning
- a code given twice in the list

An unknown key inside an entry is kept and warned about, as in every other
list of mappings. `listedCodes` puts rafa's codes and the project's side by
side, each tagged `rafa` or `project`.

### Matching

`src/errors/match.ts` splits words with triage's `wordSetOf`, so a code and
a bug's text are read the same way. It leaves the words of `FILLER_WORDS`
("a", "the", "is") out of every set, because nearly every description
holds them. "no" and "not" are kept: they tell `no-identity` from
`identity`.

- `suggestCodes(text, entries, limit)` ranks entries by the share of the
  TEXT's words each holds in its code and description, with Jaccard
  breaking ties. A text of three words or more must share two with an
  entry, so a cause the list lacks reads as no match and goes to
  `<family>:new-context`. It never picks a code: the caller does. Each
  row's `issue` is null and its `proposal` false.
- `suggestWithProposals(text, entries, proposals, limit)` ranks the codes
  open bugs proposed beside the list's, each read as an entry whose
  description is the proposing bug's title, through the same floor and
  tie rules. A proposal already a code of the list is left out, and a code
  two bugs proposed is ranked once, its `issue` the first of them.
- `nearDuplicates(entries, threshold)` pairs codes of one family whose
  leaf and description read alike at `NEAR_DUPLICATE_SCORE` (0.5) or above.
  A test keeps rafa's own list free of such pairs.

The 0.5 bar is measured. On rafa's list, two leaves for different causes
score up to 0.44, and a second leaf for `git:no-identity` scores 0.56 when
its description says the same in fewer words. A leaf naming the same
cause in other words scores about 0.36, below what distinct causes reach,
so no bar on shared words finds it. The control for that case is the
suggestion at filing time, which shows the existing code first.

### `rafa bug codes`

`src/commands/bug/codes.ts` lists rafa's codes and then the project's,
family by family. `--family` narrows the list, `--suggest` ranks the
closest codes for a cause in words, and `--check` exits 1 when two codes of
one family read alike, which is how a project checks its own additions.
`--suggest` and `--check` are refused together. In json mode a `--check`
that finds a pair writes its report as a `bug-codes-alike` event before
it refuses, because a refusal's terminal event carries no data.
`context/cli.md` holds the command's row.

**Proposals.** `--suggest` also ranks the codes open bugs proposed. The
tracker is resolved as the issue commands resolve it, and its open `bug`
issues are listed. Each body's `Proposed cause` is ranked beside the list's
codes through `suggestWithProposals` (`src/errors/match.ts`), each proposal
read as an entry whose description is the proposing bug's title, under the
same floor and tie rules. A line names the bug that proposed it, as
`  <code>  <percent>  proposed by <issue name>`. A proposal the list already
holds is left out, and a code two bugs proposed is ranked once, under the
first of them. `--family` narrows the proposals to that family.
`--no-proposals` skips the read, so no tracker is resolved and no `gh` runs.
A chain that lands nowhere, or a listing that throws, is a `warn` line, and
the suggestions print without proposals, exit code 0.

A proposal is not yet a cause. The cause rule files a code the list lacks as
`<family>:new-context`, the code kept as `Proposed cause`
(`packages/rafa-board/src/bugs/cause-rule.ts`), and that leaf earns no ranking bonus
(`context/triage.md`). A bug filed with a proposal is therefore shown by
`--suggest` and not ranked by its cause, until a fix adds the code to the
list and new bugs file under it.

A filer whose cause no leaf fits runs
`rafa bug codes --suggest="branch not found"`. If another open bug proposed
`git:branch-not-found`, the line shows it beside the list's codes and names
that bug as its proposer, and the filer files with the same proposal.
Rejected: storing proposals in config, since the tracker already holds each
one in the bug that made it.

### Throwing a RafaError

`RafaError` (`packages/rafa/src/errors/rafa-error.ts`) is the base of a
coded error. A root file imports it as `@open-tomato/rafa/errors/rafa-error`.
It imports `./codes.js` and `./rafa-codes.js` and nothing else, so it never
reaches the config. Its options are `code`, `message`, and optionally
`action`, `hint`, `context` and `cause`.

The constructor never throws: a failure while an error is built would
replace the failure it reports. It applies these rules:

- A `code` that is not `<family>:<leaf>` (`CODE_PATTERN`) becomes
  `unknown:new-context`, and the value given is kept as `context.code`.
- A shaped code is kept as written, whether rafa's list holds it or not.
  A project's code is checked where a config exists, by the bug filer.
- `hint` is the one given, else the entry's hint in `RAFA_CODES`, else null.
- `level` is the entry's, else `error`. A thrown error fails the command
  whatever its level, so a `warn`-level code still fails.
- `module` is the `static module` of the class that was constructed, or
  `unknown` when it is absent or not a non-empty string.
- `context` is copied and frozen, one level deep.
- `cause` is set only when the options carry the key, as
  `ErrorOptions.cause` takes it.
- `name` is the class's name, so a `ScopeError` reads `ScopeError`.

`message` is the error line, as `Error` takes it.

### Module classes

A module class sets its module once, as a static, and needs no constructor:

```ts
class LoopError extends RafaError {
  static readonly module = 'loop';
}

throw new LoopError({
  code: 'git:no-identity',
  message: 'no author identity is set',
});
```

The tree has two levels: `RafaError` at the root and one class per module
below it. There is no class for each action, since the action is a field
the thrower gives. `ScopeError` (`packages/rafa/src/project/scope.ts`) is the worked
example. It sets `static readonly module = 'project'` and has one
constructor, which takes the code, the message unprefixed and the cause,
prefixes the message with `rafa scope: `, and hands the rest to
`RafaError`. A team's own module class takes the same path: it sets its
module and throws a project code from `errors.codes`, and the handler
reads it the same way.

### The cause chain and failureOf

`codedErrorOf` (`src/errors/handler.ts`) answers the first `RafaError` among
an error and the errors its `cause` chain reaches. It reads at most
`MAX_CAUSE_LINKS` (8) links, the given error counted first: a `RafaError`
eight links down is found, one nine links down is not. A link that is not
an object ends the walk, and so does a chain that loops back on itself.

`failureOf(error, boundary)` answers what the dispatcher writes for a
failure. `boundary` is the command that ran, its subject as `module` and its
action, or null where no command ran. It is pure: it reads no logger, no
output and no config, and the dispatcher writes its one error line from
the answer.

- A coded failure gives the coded error's code as `cause`, its hint,
  its module, and its action, else the boundary's action. `coded` is true.
- Any other failure gives `unknown:new-context` as `cause`, no hint, the
  boundary's module and action, and `coded` false. The plain error is not
  wrapped in a new `RafaError`, since that error's stack would start in
  `handler.ts`.

A command that refuses in its own words catches a typed error and throws
`new CommandExit(1, '❌ ...', { cause: error })`. The chain then holds the
`RafaError`, so the answer is the error's code, hint and module, while the
message and exit code stay the command's. A `CommandExit` with no cause is
unchanged.

`causeOfDispatchCode(code)` answers the cause of one of the dispatcher's
own codes, spelled as `src/cli/dispatch.ts` spells them (`no_project`). It
finds the `cli:` entry of `RAFA_CODES` whose `legacy` is that spelling, so
`cli:command-exit` answers for `command_exit`. `command_error` answers
`unknown:new-context`, since a crash has no known cause, and so does a
spelling no entry holds. It takes a string, so `handler.ts` never imports
`dispatch.ts`, which imports it.

### From an error to bug fields

`toBugFields(error, boundary)` (`src/errors/bug-fields.ts`) answers four
bug fields for the same error and boundary `failureOf` takes. `module`,
`action` and `cause` are `failureOf`'s, so a bug filed from a failure names
what the error line named. `artifact` is the name, message and stack of
`codedErrorOf`'s error, or of the error itself when none is coded. The
coded error's stack starts in the module that threw it, where a
`CommandExit`'s starts in the command that converted the error. A stack
that does not open with the `name: message` header gets the header above
it. A thrown value that is not an `Error` gives its string form.

`toBugFields` redacts nothing and fills no version. What it leaves to
`readBugLine` (`packages/rafa-board/src/commands/issue/create-bug.ts`) is taking local paths
and named secrets out of every free text, cutting the artifact, reading
the error line from its first line, and writing the Versions section.
