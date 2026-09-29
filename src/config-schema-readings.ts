/**
 * The per-section readings of rafa's settings: for each section the
 * schema opens after the spec's first block, the choices its spec left
 * to the reader — which default, why null or never null, and why a key
 * is or is not a `CommandLineSetting` — argued once.
 *
 * `config-schema.ts` holds the settings these readings are about:
 * `RafaConfig`, `CONFIG_DEFAULTS`, `SETTINGS` and `CommandLineSetting`
 * are all there, and so are the four readings the phase-1 spec leaves
 * to the reader (open tracker kinds, empty prerequisite tiers,
 * `version: 1` alone, `loop.settingSources` as an ordered list). The
 * readings below sat in that module's note until it reached 780 lines
 * of the 800-line cap of `context/source.md`, and moved here before
 * another key was added, so a new key is not paid for by rewrapping
 * prose. This module exports nothing and runs nothing: it is
 * a note, and a new section's readings are written here beside its key
 * in `config-schema.ts`. What each VALUE may be stays
 * `config-sections.ts`'s to say.
 *
 * ## The `pr` section
 *
 * `.rafa/specs/rafa-20-pr-commands.md` spells it `pr: { provider: gh | none,
 * mergeMethod: squash | merge | rebase, base: <default branch> }`, and
 * names `pr.resolveBudget` as what a `triage --resolve` session's
 * `--max-budget-usd` comes from. Four readings it leaves to this module:
 *
 *   - `pr.provider` and `pr.base` default to NULL, and null here means
 *     "nobody has said", not "off". The spec's default for the provider
 *     is `gh` when `origin` is a GitHub remote and `none` otherwise, and
 *     its default base is whatever the remote calls its default branch;
 *     neither is a value this module can spell, because both are read
 *     off the repository at use (`pr/provider.ts`). Writing either
 *     default as a literal would be the silent choice the config refuses
 *     everywhere else: `prBase: 'main'` would open a pull request into a
 *     branch that may not exist on a repository whose default is
 *     `master`. A file spelling `provider:` or `base:` with no value
 *     says nothing, as every null does, and resolves to the same null.
 *   - `pr.mergeMethod` defaults to `squash`, the first method the spec
 *     lists and the one the merge flow is written for: it deletes the
 *     local branch with `-D` because a squash leaves it unmerged in
 *     git's eyes.
 *   - `pr.resolveBudget` defaults to 2 US dollars, which the attempt
 *     guard's default of two attempts caps at 4 for one pull request.
 *     It is a number and not null: the spec has every resolve run carry
 *     `--max-budget-usd`, so a session with no budget is not a state
 *     this setting can be left in.
 *   - No `pr` setting is a `CommandLineSetting`. `pr merge` takes
 *     a `--method` flag, but that flag is the command's own argument for
 *     one merge, read by the command beside this setting, and not a
 *     layer over the config: a global `--merge-method` nobody typed
 *     would be a flag this module invented.
 *
 * ## The `board` section
 *
 * `.rafa/specs/rafa-20-pr-commands.md` names `board.trustedAuthors` as the
 * allow-list beside the permission reading `src/board/trust.ts` makes:
 * text off the board reaches an agent's prompt, so its author must hold
 * write access on the repository or be listed here. Two readings it
 * leaves to this module:
 *
 *   - It defaults to the EMPTY list, and empty is a working default
 *     rather than a placeholder: with nothing listed, the permission
 *     reading alone decides, which is the answer GitHub already holds
 *     for every member. A name here is for the author a permission
 *     lookup cannot speak for — a bot account, or a maintainer whose
 *     access is held through an organisation the endpoint does not
 *     report — and inventing one as a default would trust an account
 *     nobody named.
 *   - Each entry goes through `githubLogin` and not through `text`,
 *     because a login from this setting is spliced into the
 *     collaborators path; `config-sections.ts` records what that
 *     narrower shape refuses and why.
 *
 * ## The `roadmap` section
 *
 * `.rafa/specs/rafa-20-pr-commands.md` has `plan create --next` read its
 * order off "the roadmap issue named by `roadmap.issue` in config, else
 * the pinned issue titled Roadmap". Two readings it leaves here:
 *
 *   - It defaults to NULL, and null means "nobody has said" as it does
 *     for `pr.provider` and `pr.base`. The fallback the spec names — the
 *     issue titled `Roadmap` — is a number only a repository can answer,
 *     and `src/board/roadmap.ts` asks it at use. Writing a literal here
 *     would point every repository that has not run `rafa init --board`
 *     at one project's issue number.
 *   - It is a number and not a string. `gh issue view <n>` takes the
 *     number, `src/board/naming.ts` refuses anything that is not a
 *     positive whole one, and `issueNumber` refuses it here instead,
 *     where a person can still fix the file.
 *
 * ## The `release` section
 *
 * `.rafa/specs/rafa-21-changelog-and-release.md` spells it `release: {
 * enabled: auto, versionFile: package.json, changelog: CHANGELOG.md,
 * heading: "## {version} — {date}, {title}" }`, and those four values
 * are the defaults here. Four readings it leaves to this module:
 *
 *   - `release.enabled` is not a flag. `auto`, its default, is a third
 *     value meaning "on when both files below exist" — a reading
 *     `release/enabled.ts` makes against a disk, which no value here
 *     could stand for. What the reader takes beside it, and why `on`
 *     and `off` are refused, is `config-sections.ts`'s to say.
 *   - `release.versionFile` and `release.changelog` are paths relative
 *     to the repository root, and neither is null. Null elsewhere here
 *     means "nobody has said", and the spec has said: `package.json`
 *     and `CHANGELOG.md`. The absence the spec cares about is the
 *     FILE's — "a project with no version file gets the changelog
 *     entry under a date heading and no bump" — which is a question
 *     about a disk, answered at use and not spellable as a default.
 *   - `release.heading` is free text. The spec makes it a template so
 *     "a consumer's changelog has another shape" is an edit rather
 *     than a fork, and which placeholders it may carry, and what an
 *     unknown one renders to, is `release/changelog.ts`'s to say. So
 *     nothing here refuses a heading for the placeholders it spells.
 *   - No `release` setting is a `CommandLineSetting`, for the
 *     reason the `pr` section gives: the `release` commands read these
 *     settings beside their own arguments, and a global flag nobody
 *     typed would be one this module invented.
 *
 * ## The `cleanup` section
 *
 * The `rafa cleanup` command rafa-94 builds lists local branches and
 * worktrees for a person to delete, and these three settings shape what
 * it lists. Three readings are this module's:
 *
 *   - `cleanup.staleDays` defaults to 30 and `cleanup.worktreeIdleDays`
 *     to 7. Both are numbers and never null: each is a threshold the
 *     listing compares against, and a listing with no threshold is not
 *     a state either can be left in. Both go through `dayCount`, which
 *     refuses zero, a fraction and a quoted number.
 *   - `cleanup.keep` defaults to the EMPTY list, as
 *     `board.trustedAuthors` does: with nothing kept, no branch is
 *     spared by name, and inventing a pattern as a default would spare
 *     a branch nobody named. Each entry is a glob pattern kept as
 *     written, through `text`; what a pattern matches is
 *     the cleanup command's to say, so nothing here refuses one for its
 *     syntax.
 *   - No `cleanup` setting is a `CommandLineSetting`, for the
 *     reason the `pr` section gives.
 *
 * ## The `dangerous` section
 *
 * `.rafa/specs/rafa-151-references-specs-bugs-are.md` names
 * `dangerous.acceptStaleRefs` as the setting that has check 4 of the
 * readiness gate accept every dangling and suspect reference of a spec
 * on every run, where `--accept-refs` does it for one. The section is named for what
 * its settings waive: each turns a refusal off for every run, where a
 * flag turns it off for the one run a person typed it on. Three
 * readings are this module's:
 *
 *   - `dangerous.acceptStaleRefs` defaults to `false`, and a boolean
 *     rather than null: whether the gate refuses a dangling or suspect
 *     reference is a question with an answer on every run, and the
 *     answer nobody has overridden is that it does.
 *   - It goes through `flag`, so `"true"`, `yes` and `1` are refused
 *     and not read as true, as every `tracking` key refuses them. A
 *     setting that switches a refusal off is the last one a misread
 *     spelling should turn on.
 *   - It is not a `CommandLineSetting`. `--accept-refs` is
 *     `plan create`'s own argument for one run and not a layer over
 *     this key, for the reason the `pr` section gives.
 *
 * ## The `status` section
 *
 * `rafa status` prints where a project stands, and the since-last-command
 * notice is the one line on stderr, before a command that runs inside a
 * project, naming `rafa status` or `rafa cleanup` when something is new
 * since the last such command. `status.notice` turns that line off. Two
 * readings are this module's:
 *
 *   - It defaults to `true`, and a boolean rather than null: whether the
 *     line is printed is a question with an answer on every command, and
 *     the answer nobody has overridden is that it is.
 *   - It goes through `flag`, so `"false"`, `no` and `0` are refused and
 *     not read as false, as every `tracking` key refuses them, and it is
 *     not a `CommandLineSetting`, for the reason the `pr` section
 *     gives.
 *
 * ## The `effort` section
 *
 * `effort.busyTimeoutMs` is how long an effort store open waits for
 * another process's write lock before it throws `SQLITE_BUSY`. Three
 * readings are this module's:
 *
 *   - It sits under `effort` because `store` is already a scalar
 *     (`store: sqlite`) and can open no section.
 *   - It defaults to 5000 and is never null: every open sets a busy
 *     timeout, and one with no wait is the failure the key prevents.
 *   - It is not a `CommandLineSetting`, for the reason the `pr`
 *     section gives. `loadConfig` hands the resolved value to the store
 *     (`effort/store/settings.ts`); nothing else reads it.
 *
 * `effort.sync` is how the store travels between a project's devices,
 * one of `SYNC_STRATEGIES`. Three readings are this module's:
 *
 *   - It defaults to `local` and is never null: a store that travels
 *     nowhere is still a strategy, and the one nobody has chosen.
 *   - The list is closed and names `git`, `service` and `p2p` though
 *     core ships no adapter for them, so a misspelt strategy is refused
 *     when the file is read, not when a sync is first attempted.
 *   - It is not a `CommandLineSetting`, for the reason the `pr`
 *     section gives. The user scope's file layers under the project's
 *     as it does for every setting, so a user default needs no reader
 *     of its own.
 *
 * ## The `tiers` section
 *
 * `.rafa/specs/rafa-26-skill-tiers.md` names three keys that decide which
 * skills and agents a loop session is served: `tiers.rafa`, whether the
 * tier rafa ships is loaded at all, and `tiers.skills` and
 * `tiers.agents`, which turn one item off or pin the tier that serves
 * it. What each VALUE may be is `config-sections.ts`'s to say. Five
 * readings are this module's:
 *
 *   - `tiers.rafa` defaults to `on`: a project that has said nothing is
 *     served rafa's core roster, which is the point of shipping it.
 *   - Both maps default to EMPTY, as `board.trustedAuthors` does: with
 *     nothing pinned and nothing turned off, the fixed order project →
 *     rafa → user decides alone, and a pin as a default would override
 *     a holder nobody named.
 *   - Each map is read by `mapOf` whole, as one setting's value.
 *     `tiers` is a section and `tiers.skills` is not, so the names under
 *     `skills:` reach the reader rather than the unknown-key warning. A
 *     name spelled flat at the top level, `tiers.skills.tdd-guide:`, is
 *     not a setting's key and is retained as an unknown one.
 *   - The spec has maps merge by key across layers, a `false` removing
 *     the item. `resolveConfig` merges the three maps by key, the
 *     project over the user over the default, and keeps a `false` as
 *     the key's answer so it shadows a lower layer's entry.
 *   - No `tiers` setting is a `CommandLineSetting`, for the reason
 *     the `pr` section gives.
 *
 * ## The `routing` setting
 *
 * The same spec makes the routing table a setting: `routing`, a map of
 * a task shape to the agent that takes it, read by `mapOf` as the
 * `tiers` maps are. Three readings are this module's:
 *
 *   - It sits at the top level, like `modules`, so it opens no section
 *     and adds `routing` alone to the keys a warning lists. A shape
 *     spelled flat, `routing.prose:`, is an unknown top-level key.
 *   - Its default is NOT empty: it is `tiers/routing.ts`'s
 *     `DEFAULT_ROUTING`, the spec's five rows, so a project that has
 *     said nothing still routes every shape the planner uses.
 *   - Layers merge it by key over the defaults, so a file's one row
 *     changes that shape and leaves the other four; a `false` row
 *     routes its shape nowhere.
 *
 * ## The `task` section
 *
 * Plan rafa-23 hands each task the skills and lessons it needs:
 * `task.skills` names the resolver that picks the skills, `task.lessons`
 * whether blessed lessons join the prompt. The two sit under one `task`
 * section so #118's merge finds them as one map. What each VALUE may be
 * is `config-sections.ts`'s to say. Three readings are this module's:
 *
 *   - `task.skills` defaults to `planner`, the resolver that serves the
 *     skills the plan named, and `task.lessons` to `on`. Neither is
 *     null, so a project that has said nothing gets the arm the plan
 *     was written for.
 *   - `task.skills` is a `CommandLineSetting`, so a command line
 *     may name it for one run as it names `plan.inject`. It is the one
 *     `task` setting that is: `task.lessons` has no flag.
 *   - Both are single strings, never maps, so they merge across layers
 *     as every scalar does, the project over the user over the default.
 *
 * ## The `learning` section
 *
 * `.rafa/specs/rafa-25-rafa-learns-own-runs.md` sets three floors beside
 * `learning.adapter`: numbers, never null, none a `CommandLineSetting`.
 * Why a confidence outside 0.3..0.9 and an `after` below 1 are refused
 * is `config-sections.ts`'s to say.
 */
