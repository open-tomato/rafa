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
| Tests — a suite over code that already exists, or a red-first case | `tdd-guide` | user-level |
| Repair — a red gate, a type error, a broken build | `build-error-resolver` | user-level |
| Cleanup — dead code, duplicates, a consolidation | `refactor-cleaner` | user-level |
| Review of a TypeScript change | `typescript-reviewer` | user-level |
| Review of a change as a whole | `code-reviewer` | user-level |
| Implementation — a module plus its TSDoc plus its colocated tests | `loop-implementer` | `.claude/agents/loop-implementer.md` |

**`user-level` in the third column is a portability warning and not a
footnote.** Those five definitions live outside the repo, so a fresh
clone receives none of them and the name resolves against whatever that
machine happens to hold — or against nothing. The two tracked rows
travel. A project file also SHADOWS a user-level agent of the same name
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
whole roster on stderr, before any model call.

**`agent=` outranks the other three declaration keys because routing
supplies the model.** A declaration carrying an agent passes only
`--agent`; its `model`, `effort` and `tools` stay on the record so the
collector can report what the planner expected against what ran, and
none of the three reaches the CLI. The model comes from the agent
file's own frontmatter — `doc-updater` and `loop-implementer` carry
their own models, every user-level row defaults — and the collector
uses this to report routed versus unrouted session models.

**Routing also changes what a session can be read back from.** The
prompt is untouched, byte-identical to what was piped in, but record 0
becomes an agent-setting record and the enqueue moves to record 1, so
every prompt-keyed reader has to key on the type/operation pair and
never on position.

### Files beside the tree

**`.plans/` and `.specs/` are gitignored**, so they live only in the
checkout that wrote them. A sweep over tracked files never reaches a plan
or a spec, and nothing reviews their text: leave a plan's or a spec's
illustrative text, and a test quoting it verbatim, alone when a sweep
turns up its subject.

**`progress.txt` is not tracked**, living only via `.gitignore`. It is
derived: `src/utils/progress.ts` rewrites it whole from the store's `findings`
rows before every dispatch, so a render over an empty store blanks what a
session wrote there by hand. The stray `@progress.txt` file has been
deleted.
