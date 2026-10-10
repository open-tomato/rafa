## Cause codes

`src/errors/` holds the cause codes a bug or a rafa error can carry (#949).
A code marks which gate tripped: where the pain shows and where the
symptoms come from. Two bugs sharing a code may still fail in different
things, so a shared code raises a match score and never decides a match.

### The shape

A code is `<family>:<leaf>`, both kebab-case, checked by `CODE_PATTERN`
(`src/errors/codes.ts`). The family names the gate or tool (`git`, `tsc`,
`fs`), and the leaf names the condition (`git:no-identity`). An entry
(`ErrorCodeEntry`) holds:

- `code`
- `description`: one line saying what the context is
- `hint`: the recommended next action
- `level`: `error` or `warn`
- `since`: the version or issue that added it
- `legacy`, optional: the spelling an older union gives the same context

### The reserved values

Every family holds `<family>:new-context` without declaring it, for a cause
no leaf fits yet. `unknown:new-context` is the last resort when even the
family is unknown. `isKnownCode` answers true for both. `codeProblem`
therefore refuses three spellings in a declared code: the leaf
`new-context`, the leaf `unknown`, and the family `unknown`. The bare word
`unknown` stays free to mean "the filer does not know" in other fields.

### rafa's list

`RAFA_CODES` (`src/errors/rafa-codes.ts`) is declared through
`defineErrorCodes`, which throws a `TypeError` on a bad shape or on a code
declared twice: the list is source, so a fault in it is a build error. Each
family the list uses has one line in `FAMILY_DESCRIPTIONS`.

The list grows from fixes. A bug filed as `<family>:new-context` gets its
code added by the change that fixes it.

### The older unions and the drift guard

Four per-module unions existed before the list: `ROUTE_REFUSALS` and
`DISPATCH_ERROR_CODES` (`src/cli/`), and `SKILL_ISSUE_CODES` and
`FailureStringCode` (`src/schema/`). They keep their own spellings, because
`--output=json` readers see them in `error.code`. Each value has a list
entry in the new form, with the old spelling in `legacy`
(`cli:command-exit` carries `command_exit`).

Nothing derives the unions from the list. `src/errors/rafa-codes.test.ts`
holds the two together in both directions: a union value with no entry
turns it red, and so does a `legacy` naming no union value. Adding a value
to one of the four unions therefore means adding its entry in the same
commit.

### A project's codes

`errors.codes` in `.rafa/config.yaml` is a list of entries of the same
shape, read by `src/config-schema-errors.ts`:

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
a bug's text are read the same way.

- `suggestCodes(text, entries, limit)` ranks entries by the share of the
  TEXT's words each holds in its code and description, with Jaccard
  breaking ties. An entry sharing no word is left out. It never picks a
  code: the caller does.
- `nearDuplicates(entries, threshold)` pairs codes of one family whose
  leaf and description read alike at `NEAR_DUPLICATE_SCORE` (0.6) or above.
  A test keeps rafa's own list free of such pairs.

### `rafa bug codes`

`src/commands/bug/codes.ts` lists rafa's codes and then the project's,
family by family. `--family` narrows the list, `--suggest` ranks the
closest codes for a cause in words, and `--check` exits 1 when two codes of
one family read alike, which is how a project checks its own additions.
`context/cli.md` holds the command's row.
