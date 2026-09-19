## Workflow

Feature-branch → PR → merge. Conventional commit types (feat, fix, refactor,
docs, test, chore, perf, ci).

### Task shape to agent

**A task's `agent=` key routes its dispatch, and the key is the task's
SHAPE rather than its subject or its verb.** A documentation task's verb
is whatever the edit happens to be (`Remove ...`, `Rewrite ...`,
`Split ...`) while the thing it names is reliably a markdown file, so
the shape discriminates where the verb does not.

| Task shape | Agent | Where it lives |
|---|---|---|
| Prose — an `AGENTS.md` map, a `context/` page, a README, a skill or an agent file | `doc-updater` | `.claude/agents/doc-updater.md` |
| Tests — a suite over code that already exists, or a red-first case | `tdd-guide` | `.claude/agents/tdd-guide.md` |
| Repair — a red gate, a type error, a broken build | `build-error-resolver` | `.claude/agents/build-error-resolver.md` |
| Cleanup — dead code, duplicates, a consolidation | `refactor-cleaner` | user-level |
| Review of a TypeScript change | `typescript-reviewer` | user-level |
| Review of a change as a whole | `code-reviewer` | `.claude/agents/code-reviewer.md` |
| Implementation — a module plus its TSDoc plus its colocated tests | `loop-implementer` | `.claude/agents/loop-implementer.md` |

**`user-level` in the third column is a portability warning and not a
footnote.** Those two definitions live outside the repo, so a fresh
clone receives none of them and the name resolves against whatever that
machine happens to hold — or against nothing. Under the default
`loop.settingSources` of `project,local` it resolves against nothing on
any machine: every loop session is spawned with `--setting-sources`,
and the CLI lists no agent from `~/.claude/agents` until the sources
include `user`. The five tracked rows travel. A project file also SHADOWS a user-level agent of the same name
rather than merging with it, and the roster is blind to the difference:
a shadowed name appears exactly ONCE in the CLI's own list of available
agents, so only a behavioural probe separates a shadow from an
unshadowed name — ask for a literal each definition carries and the
other does not, and require each side to answer its own plus a refusal
token for the other's, since a resolver that MERGED the two would
answer both questions from one column.

**A name that resolves to nothing STOPS the dispatch**, which is what
makes a wrong row something a test can find rather than a silent
downgrade: an unresolvable agent exits 1 with NO JSON at all and the
whole roster on stderr, before any model call. `loop start` no longer
waits for that: its preflight resolves the roster from the same two
`.claude/agents` directories and refuses the run, ahead of every
prerequisite probe, when a still-to-run task of the plan or the tracker
names an agent no loaded scope defines (`src/start/preflight.ts`).
`rafa plan validate` runs the same check and exits 1 on the same plan.

**`agent=` outranks `model` and `tools` because routing supplies
both.** A declaration carrying an agent never passes `--model` or
`--tools`: the agent file's own frontmatter names its model and tool
set, and every tracked file the table names carries a `model:`.
`effort` is the exception, being the cost lever a plan most needs to
reach the session: `--effort` joins `--agent` unless the definition
declares an `effort` of its own. `src/utils/agent-definition.ts`
answers that from `.claude/agents/<name>.md` under the repo root, then
under the home directory when `loop.settingSources` includes `user`,
and takes a file only when its frontmatter
`name` is the name asked for, because the CLI resolves `--agent` by
that `name` and not by the file name. A name found in neither still
passes `--effort`, leaving the CLI to refuse the name. `budget` is
outranked by nothing, since a definition supplies no budget:
`--max-budget-usd` joins whatever the block resolved to, ahead of
`--tools`, whose variadic value has to end the argument list. Every key
stays on the dispatch record whatever reached the CLI, and on the
session's `dispatches` row beside the flags that did
(`src/effort/store/dispatches.ts`), and the `Routed as:` line names the
ones left to the agent.

**Routing also changes what a session can be read back from.** The
prompt is untouched, byte-identical to what was piped in, but record 0
becomes an agent-setting record and the enqueue moves to record 1, so
every prompt-keyed reader has to key on the type/operation pair and
never on position.

### Naming convention

All rafa work follows a consistent naming scheme across specifications,
plans, branches, and pull requests. The board is GitHub Issues on
`open-tomato/rafa`; every spec has one issue labelled `type:spec`,
whose ID appears as `rafa-<n>`.

| Artifact | Pattern | Example |
|---|---|---|
| Specification file | `.specs/rafa-<n>-<slug>.md` | `.specs/rafa-20-pr-commands.md` |
| Plan stub and directory | `rafa-<n>-<slug>` | `rafa-20-pr-commands` |
| `issue:` field in `rafa:plan` | `<n>` (number only) | `issue: 20` |
| Git branch | `feat/rafa-<n>-<slug>` | `feat/rafa-20-pr-commands` |
| Pull request title | `rafa-<n>: <title>` | `rafa-20: Add pull-request commands` |
| Pull request body | `Closes #<n>` | `Closes #20` |

The slug summarizes what the user gets, using two to four words joined
by hyphens.

**The order of all work lives in ONE place: the pinned "Roadmap" issue**
on the `open-tomato/rafa` board. The word "phase" and its letters are
retired; merged work keeps its old file names and a table in the Roadmap
issue maps them.

### Files beside the tree

**`.plans/` and `.specs/` are gitignored**, so they live only in the
checkout that wrote them. A sweep over tracked files never reaches a plan
or a spec, and nothing reviews their text: leave a plan's or a spec's
illustrative text, and a test quoting it verbatim, alone when a sweep
turns up its subject.

**The loop owns staging, so a task's own work is always unstaged.** No
task runs `git add`; the loop stages and commits after the session ends.
That puts every edit a task has made in the blast radius of
`git checkout <file>` and `git restore <file>`, which restore from
`HEAD` and not from the working tree of a moment ago — a task that
mutates a module to prove a test reddens and then "reverts" that way
throws away its own implementation along with the mutation. Copy the
file to a scratch path first, restore from the copy, and verify with
`shasum -c`.

**`progress.txt` is not tracked**, living only via `.gitignore`. It is
derived: `src/utils/progress.ts` rewrites it whole from the store's `findings`
rows before every dispatch, so a render over an empty store blanks what a
session wrote there by hand. The stray `@progress.txt` file has been
deleted.
