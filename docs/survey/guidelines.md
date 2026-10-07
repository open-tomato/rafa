# Guidelines

Coverage: 9 of 9 tenets, 152 Rejected lines and 361 context rules of `docs/survey/decision-sources.json` read (147 `type:spec` bodies, 14 `context/` pages, no local specs); 231 of the 522 decisions have a source line cited below, and the other 291, the mechanism of one module or a one-off choice, are left in `docs/survey/decision-sources.md` rather than restated.

Each line is one guideline, marked with how it is known:

- `stated`: a source says it in words. Two sources saying the same thing make one stated line naming both.
- `inferred`: the code or a pattern of specs stands on it, and no source says it.
- `conflicting`: two sources disagree; the line names both sides.

Sources are written as `decision-sources.md` writes them: `#<issue>:<line>` for an issue body, `context/<page>.md:<line>` for a context page, and a repository path for code. The sheet asks nothing; the list at the end is what #802's alignment Q&A asks about.

## Tenets

- **G01** `stated` rafa is a helper, not a hinderer: a reminder of steps, a shortener of commands, a simplifier of tasks. (`#598:234`, `#754:28`)
- **G02** `stated` Never block on a suspicion: a suspected copy, rollback or fork never refuses a command, halts a loop or fails a sync; refusing to write on a suspected copy was rejected as breaking that rule. (`#754:28`, `#754:49`, `context/effort-store.md:394`)
- **G03** `stated` Always tell: the person sees one warning line where it happens, `rafa doctor` lists it until it is resolved, and nothing is lost or overwritten silently. (`#754:29`, `#276:423`, `#367:49`, `#26:43`, `#641:35`)
- **G04** `stated` Say what was observed, never what it might mean: a warning states facts and a signal never claims a cause. (`#754:30`, `context/effort-store.md:886`)
- **G05** `stated` Offer the fix, or the way around: a refusal names every gap in one sentence and the next safe step, or the steps in order with the reason for each. (`#754:31`, `context/cli.md:753`, `context/pull-requests.md:523`, `context/cli.md:941`)
- **G06** `stated` Explain once, in one place: each warning links to one page that says why it matters. (`#754:32`)
- **G07** `inferred` The boundary of G01 and G02: rafa refuses when a fact is certain and a rule is broken (an untrusted author, an incomplete spec, a version collision, a detached HEAD, a failed permission lookup), and only warns on what it suspects; no source draws that line in words. (`#754:28`, `context/pull-requests.md:480`, `context/pull-requests.md:687`, `context/release.md:171`, `context/workflow.md:596`)

## Decisions stay with the person

- **G08** `stated` A decision between items is the person's: no state changes on its own, a run never merges an epic into `main` unattended, and a single command that would make the calls between items was rejected because it would hide them from the record. (`#246:28`, `#557:183`, `#816:21`)
- **G09** `stated` Nothing is taken over automatically: `rafa:in-development` moves only by an explicit `rafa claim take <n> --stale`, and the loop never switches a checkout back by itself. (`#324:118`, `context/pull-requests.md:1069`, `#370:33`)
- **G10** `stated` Consent is never forged from argv: the mode is set by the command invoked and frozen in `ctx`, one `dangerous.*` key covers a pass rather than a `--yes` per step, and an action that must never run from a list is always asked. (`#557:177`, `#557:178`, `context/cli.md:259`, `context/workflow.md:426`)
- **G11** `stated` Opt-in over a new default: a change never alters the output of a project that does not use it, so a project that never cancels an epic or labels a board prints what it printed before. (`#598:244`, `#641:35`, `context/cli.md:1985`, `context/cli.md:2036`, `context/cli.md:1713`)
- **G12** `stated` Never widen the person's permission fence: no broad `Bash(ssh:*)` or `Bash(rafa *)` allow rule, and a skill or a message to the classifier grants nothing. (`#803:29`, `#836:40`, `#836:41`, `#836:42`)
- **G13** `stated` Fail in the first seconds: readiness is checked for every member at the start, not as each is reached, and a dry run does every read and refusal before the first write. (`#557:179`, `context/cli.md:634`)

## One source per fact

- **G14** `stated` One source per fact: two records of one fact drift apart, so a fact is not kept in a second place (a stamp in the issue body, a requirements file, a replay ledger, a label for what the body holds), and only the configured convention is read. (`#367:49`, `#151:21`, `#340:32`, `#340:115`, `#318:38`)
- **G15** `stated` One owner per step: a step two commands could run belongs to one of them, and a workflow chains them. (`#812:51`, `#276:424`)
- **G16** `stated` Derive from the registry, never from a copy of it: help and `describe` read the registry the line was routed through, and a generated script was rejected because it drifts. (`context/cli.md:2317`, `context/cli.md:2593`, `context/cli.md:2529`, `#347:40`, `#461:22`)
- **G17** `stated` Keep, do not erase: a plan is moved rather than deleted, a discarded action stays in the push log, and a superseding reference is a new row beside the old one. (`#455:33`, `#812:50`, `context/learning.md:52`, `context/effort-store.md:1125`)

## Code answers, agents do not guess

- **G18** `stated` An exact answer from code over an agent's reading or a similarity score: Bun's import graph picks the tests, the runner's file and case names match failures, and an agent reading prose for meaning was rejected for having no stable output. (`#479:81`, `#481:23`, `#486:19`, `#486:74`, `#151:21`)
- **G19** `stated` A session works inside a fixed frame: the person fills in a form, rafa runs one fixed-template session, code validates the result and the person accepts it; agents do not set up their own environments. (`context/workflow.md:447`, `#476:46`)
- **G20** `inferred` G18 and G19 as one rule for every new step: whatever code can answer, code answers, and a session gets only the part that needs judgment. (`#479:81`, `#486:19`, `#151:21`, `#476:46`, `context/workflow.md:447`)
- **G21** `stated` Decide from a measurement, dated and versioned: a design waits for its measurement, and the context pages record the date and tool version a reading was taken with. (`#841:20`, `#449:25`, `#486:74`, `context/effort-store.md:15`, `context/pull-requests.md:748`)
- **G22** `stated` A skill is advice and the command is the enforcer, the same for a person and an agent. (`#812:49`, `#836:41`)

## History and git

- **G23** `stated` Pushed history is never rewritten: no force-push, work commits never leave the branch, a branch catches up by a merge and never a rebase, and a tag push is never forced. (`context/pull-requests.md:396`, `context/pull-requests.md:1038`, `context/workflow.md:298`, `#557:180`, `context/release.md:147`)
- **G24** `stated` The loop owns staging, committing and the release fragment: a task's work is left unstaged, no plan carries a version or changelog task, and the wrap-up never edits the version file or the changelog. (`context/workflow.md:490`, `context/workflow.md:508`, `context/release.md:27`)
- **G25** `stated` The loop guard halts on an external change to the checkout's branch or HEAD, keeps the work, and never interferes with the loop's own commits. (`context/cli.md:416`, `context/workflow.md:316`)
- **G26** `stated` A spec's pull request goes into its epic branch, never into `main`, so an epic can be reverted as one change. (`#557:181`)
- **G27** `stated` One writer per board and branch: a watchtower that restarts an agent, several loops inside one stretch and a second clone per loop were rejected for putting two writers on one place. (`#598:243`, `#598:248`, `#370:33`)

## Trust, secrets and machine identity

- **G28** `stated` Text that reaches an agent's prompt comes from someone allowed to change the repository: the issue's author must hold write access or be listed, a failed lookup refuses, comments are never read into a plan, and a member cannot edit an outsider's issue. (`context/pull-requests.md:431`, `context/pull-requests.md:480`, `#812:52`)
- **G29** `stated` A security bug never reaches a public tracker: no search, no create, no comment, no stored reference. (`context/triage.md:14`, `context/triage.md:21`)
- **G30** `stated` A secret is named, never stored: rafa keeps no token in its config, `hub.tokenSecret` names where the token is held, and a fixture reports a secret by name. (`#326:60`, `context/effort-store.md:260`, `context/verification.md:458`)
- **G31** `stated` No machine identity ships: every committed fixture is scrubbed of paths, emails and host names, the host id is a keyed hash, and machine paths live in local notes, never on the board. (`context/verification.md:458`, `context/verification.md:472`, `context/effort-store.md:451`, `context/pull-requests.md:648`)
- **G32** `stated` A host with no git identity refuses, as git does; production commits carry the user's identity. (`#799:16`)

## The effort store

- **G33** `stated` A development build never adopts or migrates a store it does not own, and branch code never runs against the live `.rafa/effort/`. (`context/effort-store.md:641`, `context/effort-store.md:706`, `context/effort-store.md:1182`, `context/effort-store.md:36`)
- **G34** `stated` Migrations are additive by default, a shipped entry is never edited, and an id is never reused. (`context/effort-store.md:700`, `context/effort-store.md:702`, `context/effort-store.md:570`)
- **G35** `stated` A new table declares its merge rule in the same commit as its migration. (`context/effort-merge.md:9`, `context/effort-store.md:820`)
- **G36** `stated` Minting a new origin is always safe and missing a copy is not, so a write open that detects a copy mints and a loop never records to a copy. (`context/effort-store.md:394`, `context/effort-store.md:210`, `#593:22`)
- **G37** `stated` Ports before transports: every transport calls the same merge, so the hub waited for merge and the Sync port. (`#325:70`, `context/effort-store.md:296`)

## Tests and verification

- **G38** `stated` Scoped checks in a task, the full suite as the last warranty before a merge; a full suite on every task step and one only at the wrap-up were both rejected. (`context/verification.md:5`, `#683:37`, `#479:29`)
- **G39** `conflicting` What the stage step runs: `context/verification.md` says the runner's recorded steps are full runs at fixed points and the runner runs the full suite at defined stages, while `context/workflow.md` says a stage with no `Owns:` folder runs `bun test --changed=<since>` with the always-run files (scope `affected`). (`context/verification.md:21`, `context/verification.md:26`, `context/workflow.md:182`)
- **G40** `conflicting` What a full pass costs: `context/verification.md` gives about 20 minutes a pass; #683 rejects a full suite per task step at about 4.8 minutes each (#666). Stage 4 of this plan measures it. (`context/verification.md:5`, `#683:37`)
- **G41** `stated` A gate judges what a change did, not the debt it touched: a failure counts when it is new against the baseline, and failing on every error in a touched file was rejected. (`context/verification.md:64`, `context/verification.md:97`, `#818:19`)
- **G42** `stated` Read the exit code from the tool itself, never from a pipe, and never poll with `until` or `while` plus `sleep`. (`context/verification.md:43`, `context/verification.md:177`, `context/verification.md:199`, `context/workflow.md:123`)
- **G43** `stated` A check that could pass by never looking carries a control: a planted leak, a planted literal, a liveness control on a clean merge reading. (`context/verification.md:348`, `context/verification.md:472`, `context/cli.md:2564`)
- **G44** `stated` A host-dependent case is never skipped; a stand-in keeps it checking on every host, because a skip hides the next host difference. (`#607:30`, `#766:18`, `#729:29`)
- **G45** `conflicting` The two parity suites skip unless `RAFA_LIVE_PARITY=1`, which is the skip G44's sources reject. (`context/verification.md:252`, `#607:30`, `#766:18`)
- **G46** `stated` A content check is a sweep that reads files at run time, not a lint rule, and always runs beside the scoped tests since `--changed` follows only the import graph. (`#819:17`, `context/verification.md:87`, `context/workflow.md:168`)
- **G47** `stated` A fixture or capture is a record and is never rewritten or re-recorded. (`#683:38`, `context/cli.md:1713`)
- **G48** `stated` Test helpers stay out of the loop's import graph: a double or fake is imported by its own path, never from a barrel. (`context/pull-requests.md:127`, `context/pull-requests.md:144`)
- **G49** `stated` A test opens stores under `tmpdir()` only, and the store throws otherwise. (`context/effort-store.md:1194`)
- **G50** `stated` Every rule holds on every host and tracker rafa supports: no reliance on inode birth time, on `main` as the default branch, on Linux tool directories, or on one tracker's native fields. (`#729:29`, `#730:20`, `context/verification.md:397`, `#244:41`, `#340:31`)

## The run and its pull request

- **G51** `conflicting` What a run with no pull request reports: `context/workflow.md` says a run never ends `done` without its pull request, retrying the wrap-up, opening one itself and else ending `blocked`; `context/cli.md` says a wrap-up that could not open its PR still ends `ok`, with only its log lines saying so. (`context/workflow.md:524`, `context/cli.md:517`)
- **G52** `stated` Retries are bounded: unbounded wrap-up retries were rejected, and a pull request is never opened before the wrap-up merges the base. (`#579:34`)
- **G53** `stated` Diagnostics read and never write: `rafa doctor`'s rows and the label check never edit a label or a body and never change the exit code, save the store schema row that fails where its check fails. (`context/cli.md:941`, `context/pull-requests.md:1094`)
- **G54** `stated` Labels show the stage, never the owner. (`context/pull-requests.md:1049`, `#324:118`)
- **G55** `stated` A board holds one relationship convention at a time, chosen in config (`labels` or `native`); replacing labels outright and keeping labels only for portability, the two earlier positions, are both recorded as rejected. (`#340:113`, `#340:114`, `#340:115`, `#340:31`, `#244:41`, `context/workflow.md:426`)

## Releases and versions

- **G56** `stated` One version per epic or integration branch reaching `main`, never one per spec or merged item. (`#557:182`, `#598:245`)
- **G57** `stated` Lockstep versions at the cut, and no release strategy rafa enforces on every project. (`#809:66`)
- **G58** `stated` A version collision always refuses unless `dangerous.acceptVersionCollision` is set. (`context/release.md:171`, `context/release.md:249`)

## Configuration

- **G59** `stated` No boolean switch shapes and no override keyed by issue number; a risky override lives under `dangerous.*`, and a config default that turns a check off was rejected. (`#250:51`, `#248:62`, `#787:23`, `#557:177`)
- **G60** `stated` Customisation must reach every shape: settings alone cannot reorder or swap, TypeScript modules alone shut out everyone who does not write TypeScript, and hooks around a fixed flow cannot remove. (`#71:103`)
- **G61** `stated` The locked keys, `effort.sync` and `prerequisites.required`, change only with a released version, never through a plan. (`context/effort-store.md:361`)
- **G62** `conflicting` Who writes `.rafa/config.yaml`: #714 calls it the person's file that `rafa init` promises never to rewrite, while `rafa effort move` sets `store: sqlite` in it by a line edit. (`#714:29`, `context/effort-merge.md:154`)

## Core, packages and the cut

- **G63** `stated` Core carries what every project needs: strategies are modules because the heavy ones pull in dependencies a solo project never needs, core registers only `sync/local` and `sync/file`, and alpha operator code stays out of the core roster until one action proves stable. (`#323:82`, `context/effort-store.md:275`, `#658:46`, `#641:36`)
- **G64** `stated` No loop is ever served an operator: the rafa tier reads only `bundled/agents` and `bundled/skills`, and an operator is never linked into the repository's `.claude/`. (`context/operators.md:10`, `context/operators.md:19`, `#598:246`)
- **G65** `conflicting` Served or copied into the project: #26 rejects vendoring into the project's `.claude/` because it writes into the tree and goes stale on every upgrade, while #449 copies the tooling hook into each project to make it self-contained, and `rafa agent vendor <name>` copies an agent. (`#26:43`, `#449:26`, `context/cli.md:815`)
- **G66** `conflicting` The tooling hook: #449 chose the hook over a skill and pointer line alone, measured as never loaded by the smaller model; #598 rejects the tooling hook as an enforcer for denying the agent's own steps. It still ships under `extras/claude-code/rafa-hookify/`. (`#449:25`, `#598:247`, `extras/claude-code/rafa-hookify/files/rafa-tooling-hook.ts`)
- **G67** `stated` A package imports core only as `@open-tomato/rafa/store` or `@open-tomato/rafa/ports`, resolved through `paths`, and a library module never imports `src/rafa.ts`. (`context/source.md:46`, `context/source.md:50`, `context/source.md:13`)
- **G68** `inferred` The two-subpath rule cannot survive the cut as written: with core split into many `@open-tomato/rafa-*` packages, each package's needs become new core exports or new subpaths. (`context/source.md:46`, `context/source.md:59`, `docs/survey/import-graph.md`)
- **G69** `inferred` A cross-subject helper import is the convention today, so the cut turns each into a dependency between packages, or moves the helper to a neutral package the convention says it does not live in. (`context/source.md:16`, `docs/survey/import-graph.md`)
- **G70** `inferred` Package code is not linted today (`bun run lint` ignores `packages/`), so moving modules into packages drops them out of lint unless the lint scope moves with them. (`context/verification.md:50`)
- **G71** `stated` A contract lands whole before commands move onto it, not as a first slice that callers move onto twice. (`#557:184`, `#322:166`)
- **G72** `inferred` The cut waits for `run(ctx, options)` (#119) and define-config (#118): neither has landed, and G71 asks that commands move onto a full contract once. (`#557:184`, `docs/survey/trace-c03-config.md`)
- **G73** `stated` Stay inside the stack: no runtime outside it, no separate server binary, no paid step, and no undocumented endpoint. (`#802:22`, `#322:99`, `#637:24`, `#725:38`)

## Names and prose

- **G74** `stated` A name says plainly what a thing does, in words a newcomer would search for; renaming a flag that hides what it does was rejected. (`#455:32`, `#836:43`, `#641:37`)
- **G75** `stated` "Lore" and "hindsight" are never a code identifier, config key, command, spec heading or table name, and none of the three terms is a brand. (`context/terminology.md:45`, `context/terminology.md:34`)
- **G76** `stated` `AGENTS.md` stays under its 80-line cap, so its rules are reached by pointer, never by an `@` import. (`#449:24`)
- **G77** `stated` A sweep over tracked files never reaches a plan or a spec; their illustrative text, and a test quoting it, are left alone. (`context/workflow.md:484`)
- **G78** `stated` Independent readings stay sealed: one combined write-up anchors every source to the first, and one architect opinion has one blind spot. (`#664:36`, `#802:22`)

## For #802's alignment Q&A

- G07 (inferred): is "a helper, not a hinderer" bounded to suspicions, with certain facts and broken rules still refusing, or does it reach the readiness, trust and collision refusals too?
- G20 (inferred): is "code answers what it can, a session only judges" the rule for every step a package exports?
- G39 (conflicting): does a stage step run the full suite, as `context/verification.md` says, or the changed tests when the stage has no `Owns:` folder, as `context/workflow.md` says?
- G40 (conflicting): is a full pass about 20 minutes or about 4.8, and does the scoped-testing rule rest on that figure?
- G45 (conflicting): may the parity suites keep skipping without `RAFA_LIVE_PARITY=1`, against the rule that no case is skipped?
- G51 (conflicting): does a run whose wrap-up opened no pull request end `blocked` or `ok`?
- G62 (conflicting): may a rafa command edit `.rafa/config.yaml`, which #714 calls the person's, and does that change once define-config makes the YAML a fallback?
- G65 (conflicting): does rafa serve its items or copy them into the project, given #26's rejection of vendoring and the copies #449 and `rafa agent vendor` make?
- G66 (conflicting): does the tooling hook stay, as #449 chose, or go, as #598 rejects it as an enforcer?
- G68 (inferred): how do packages reach core once there are many: more subpaths of `@open-tomato/rafa`, or packages importing each other?
- G69 (inferred): do cross-subject helpers become dependencies between packages, or move to a shared package?
- G70 (inferred): does lint cover `packages/` before modules move into them?
- G72 (inferred): does the cut wait for `run(ctx, options)` and define-config to land whole?
