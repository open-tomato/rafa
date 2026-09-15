---
name: dev-planner
description: Use when producing or parsing a plan document (PLAN-<stub>.md, PREREQUISITES-<stub>.md) for the rafa agent loop — establishes the structured plan format with fenced blocks, task declaration syntax, and report format the loop parses and the planner generates.
---

# dev-planner — Structured Plan Format Specification

This skill specifies the format of plan documents produced for feature development work and consumed by the rafa agent loop (`src/rafa.ts`). It does not define agent behavior, personas, or workflow — those belong in agent profiles.

This file is the single source of that format. `rafa plan` inlines it, without its frontmatter, into the plan-generation prompt (`src/plan-prompt.md`), and the build copies it into `dist/` beside that prompt, so an installed rafa hands the format to projects that carry no dev-planner skill of their own. A rule of the format changes here; the prompt restates none of them.

---

## Files produced by a planning session

| File | Purpose |
| --- | --- |
| `<plan.dir>/PLAN-<stub>.md` | Full task checklist with structured blocks and technical context |
| `<plan.dir>/PREREQUISITES-<stub>.md` | Non-automatable setup steps required before the plan can run (only when any exist) |

`plan.dir` is `.rafa/plans` unless the project's `.rafa/config.yaml` names another directory. `rafa plan --spec=<spec>.md` generates both files (optionally `--stub=<name>`; the stub defaults to the spec's basename) and writes them into `plan.dir`, creating the directory when it is missing. It reads the spec from the project root, or from `specs.dir` (`.rafa/specs` by default) when the root holds no such file, and refuses to run when `<plan.dir>/PLAN-<stub>.md` already exists.

Execute a plan with `rafa start --plan=.rafa/plans/PLAN-<stub>.md`. With no `--plan`, `rafa start` runs `PLAN.md` in `plan.dir`, and falls back to a hand-written `PLAN.md` at the project root only when `plan.dir` holds no `PLAN.md`.

---

## Structured plan format (parser contract)

* Every task is a flat `- [ ]` checklist line. The loop's parser only reads
  lines starting with `- [ ]` / `- [BLOCKED]` — anything else (headings,
  prose, code blocks) is invisible to it, so never encode a task any other
  way, and never nest tasks.
* Group tasks under `# Stage: {name}` headings (top-level `#`). Stage
  headings are visual separators only; the checklist must read as one flat
  sequence across stages.
* One atomic action per task; no compound tasks joined by "and". Tasks must
  be independently completable in the order listed. A module-sized
  deliverable (see Task sizing below) counts as one atomic action.
* Use imperative, specific wording ("Add Zod schema for `CreateJobRequest`",
  not "Handle input validation").
* Avoid the words "current", "previous" and "next" in task text — the loop
  injects task text into agent prompts, and relative references confuse the
  agent about what is already done.
* Keep the plan focused on tasks and technical context only — no behavioral
  instructions, opinions, or questions for follow-up. Link to relevant
  `.claude/skills/` files where they clarify a task.
* Add a test task at the end of each stage at minimum; for larger stages,
  test in smaller increments. Negative tests before positive tests; unit
  tests before integration tests; test tasks live in the stage they cover.
  Stage-end test tasks cover cross-module/integration behavior — a module's
  own unit tests ride inside its module task (Task sizing below).

### Plan layout

A plan document consists of:

1. A `# Plan:` heading
2. Optional structured blocks (`rafa:*` fenced code blocks)
3. An optional `## Description` of technical context and background
4. One or more `# Stage:` sections with tasks

### Structured blocks

A plan document may contain fenced blocks of the form `` ```rafa:*``` `` that
carry metadata and context. Three kinds are read in phase 0:

* `rafa:plan` — Header fields in YAML format: `stub`, `issue` (optional),
  `spec` (optional). The stub identifies the plan and defaults to the spec's
  basename or "untitled". The loop uses the spec path to link the plan to the
  change that prompted it.
* `rafa:context` — Markdown prose injected into the prompt of EVERY task under
  this plan.
* `rafa:stage-context` — Markdown prose injected only into tasks under the
  nearest `# Stage:` heading above it, providing stage-specific background.

Unknown `rafa:*` block kinds are retained and ignored — they do not cause
parse failures. This rule mirrors the declaration extras rule: an
unrecognized key in a task line does not prevent the line from being
dispatched.

A `rafa:stage-context` block belongs to the NEAREST `# Stage:` heading above
it. Blocks before the first stage heading have no effect.

#### Block strip rule

Every `rafa:*` block is stripped from the task text before it is quoted
to the agent, the operator log, or the commit message. The fenced block
syntax is a planning annotation, never an instruction.

### Example

Every line is indented by two spaces, because the loop's checklist parser is
line-anchored and fence-blind: a bare `- [ ] ` at column 0 inside prose is
dispatched as a task. Measured on a draft plan, an unindented example line
became the dispatcher's answer for task one. Every example in this skill that
holds a checklist line is indented the same way; a task line in a real plan
starts at column 0.

````markdown
  # Plan: Feature Title

  ```rafa:plan
  stub: my-feature
  issue: OPT-123
  spec: .specs/my-feature.md
  ```

  ```rafa:context
  Context prose injected into every task.
  ```

  ## Description

  Technical context and background. No behavioral instructions.

  # Stage: schema

  ```rafa:stage-context
  Prose specific to the schema stage.
  ```

  - [ ] Add the Zod schema for `CreateJobRequest` with its unit tests  {agent=loop-implementer}
  - [ ] Add a test posting a malformed `CreateJobRequest` to the jobs route  {agent=tdd-guide}
````

---

## Structured blocks (`rafa:*` fenced code blocks)

The parser contract above names the kinds a plan carries and the rule that strips them. This section details each kind, and the report block an agent writes back.

### `rafa:plan`

Header metadata for the entire plan. Fields are YAML key-value pairs.

````markdown
```rafa:plan
stub: my-feature
issue: OPT-123
spec: .specs/my-feature.md
```
````

Recognized fields:
- `stub` — The plan identifier (string). Used to organize findings and dedupe rows across runs.
- `issue` — Optional GitHub issue number (string, e.g., `"OPT-123"`). Links the work back to a tracker.
- `spec` — Optional path to the specification document that guided the plan.

Unknown keys are retained and ignored by the loop; they do not cause parsing to fail.

### `rafa:context`

Prose that the loop injects into the context of **every task** in the plan. Appears between the plan-wide description and the task prompt.

````markdown
```rafa:context
This plan rewrites the authentication layer. See auth-design.md.
All tasks share the test fixtures in tests/auth-fixtures.ts.
```
````

One `rafa:context` block per plan. Appears at the top level (not inside a stage).

### `rafa:stage-context`

Prose that the loop injects into the context of **only the tasks of one stage**: the stage whose `# Stage:` heading is the nearest above the block.

````markdown
  # Stage: Database Schema

  ```rafa:stage-context
  All schema changes go in migrations/ under a new timestamped file.
  Run tests/schema-integration.test.ts after each migration.
  ```

  - [ ] Add the users table migration  {agent=loop-implementer}
  - [ ] Add the posts table migration  {agent=loop-implementer}
````

One `rafa:stage-context` block per stage (optional). The block binds to the nearest `# Stage:` heading above it whether it sits before that stage's tasks or after them, so place it straight after the heading, where a reader looks for it. When one stage holds two, the first is read and each later one is reported as `duplicate-block`. A block above every `# Stage:` heading belongs to no stage: the parser reports it as `orphan-stage-context` and does not read it.

### `rafa:report` (agent output only)

Agents return a structured report block at the end of their output. The loop parses this to record findings, blockers, and other metadata.

````markdown
```rafa:report
status: done
feedback: |
  Implemented the store interface with both NDJSON and SQLite backends.
  All parity tests pass against the sibling's session logs.
findings:
  - trigger: "when appending to an empty NDJSON store"
    kind: gotcha
    what: "file descriptor left open on failed writes"
    cause: "resource cleanup not in finally block"
    resolution: "wrap append in try/finally"
    artifact: "EMFILE: too many open files"
    signal: loud
  - trigger: "SQLite schema migration timing"
    kind: pattern
    what: "migrations run on every store init, not just schema changes"
    cause: "versioning check too coarse"
    resolution: "check both version and table existence"
    artifact: null
    signal: silent
skills_used: [git-workflow, sqlite-patterns]
blockers: []
out_of_scope_bugs:
  - what: "bun:sqlite connection pooling"
    artifact: "SQLITE_MISUSE"
    security: false
```
````

Report fields:

| Field | Type | Description |
| --- | --- | --- |
| `status` | string | The session's claim for its task: `done` or `blocked`. Required. `blocked` marks the task `[BLOCKED]` once its work is committed, and stops the run |
| `feedback` | string | One block of prose describing what was done and how it went |
| `findings` | list of objects | Findings discovered during the task (see below) |
| `skills_used` | list of strings | Names of skills referenced or applied |
| `blockers` | list of objects | What blocked the task. Any entry marks the task `[BLOCKED]` whatever `status` says, so write `[]` when nothing did |
| `out_of_scope_bugs` | list of objects | Bugs found that are outside this task's scope |

Finding entry fields:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `trigger` | string | yes | When/how the finding surfaced (e.g., "when running bun test under Docker") |
| `kind` | string | yes | Category: `gotcha`, `pattern`, `location` or `skill-suggestion` |
| `what` | string | yes | The finding itself |
| `cause` | string | no | Root cause or explanation |
| `resolution` | string | no | How to fix or work around it |
| `artifact` | string | no | Error message, file path, or code snippet that signals the finding |
| `signal` | string | yes | `loud` (it surfaced as a failure) or `silent` (it passed while wrong) |

Blocker/bug entry fields:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `what` | string | yes | Description of the blocker or bug |
| `artifact` | string | no | Error message or diagnostic output |
| `security` | boolean | yes (bugs only) | Whether this is a security issue; never defaulted when missing |

---

## Block retention and stripping

The block strip rule means:

- A block planted in a task line does not appear in the dispatched prompt header
- A block in a stage description does not appear in the operator log line
- A block anywhere in the plan does not appear in a commit subject or commit body

The strip happens where the loop reads the next task, `findNextTask` in `src/utils/tracker.ts`, and it follows fences the way a renderer shows them (`src/plan/blocks.ts`):

- Only a closed, top-level `rafa:*` block hides its lines. Every other fence is transparent, so a `- [ ] ` line at column 0 inside a `markdown` or `text` illustration, or inside a `rafa:` fence nested in one, is dispatched as a task. A plan that illustrates the format indents its example lines.
- A `rafa:` fence that is never closed hides nothing, because taking the rest of the document as its body would end the plan with its tasks unrun. `parsePlan` reports it as `unclosed-block`, and each open task line after it as `task-in-block`.
- A caller that builds its own `TaskInfo`, such as a Tracker port implementation, bypasses the strip.
- An example that shows a `rafa:*` fence inside a larger fence needs the larger one to be longer, four backticks as in this skill: inside a three-backtick fence the first inner closing fence closes the outer one, and every later `rafa:` fence becomes a real block to any CommonMark reader.

---

## Task declarations (routing)

* A task line may carry a trailing declaration naming what the loop should
  dispatch it with. Give one to every task.

```text
  - [ ] Add the Zod schema for `CreateJobRequest`  {agent=loop-implementer}
  - [ ] Rewrite the gates page  {agent=doc-updater}
  - [ ] Sweep the changed set  {tools=Read,Grep,Glob model=haiku effort=low}
```

* The block is the LAST brace group on the line, anchored at end of line,
  holding no nested braces and at least one recognised key, and it is
  never the whole task text. Two spaces separate it from the text.
  Anything failing one of those rules stays task text — a task ending on
  a code span carrying `{ "a": 1 }` is not a declaration.
* Its tokens are space-separated `key=value` pairs. Recognised keys are
  `agent`, `model`, `effort` and `tools`; an unrecognised key is kept for
  telemetry and maps to no flag. The key `skills` reserves a comma-separated
  list of skill names for phase 1 resolution and is stored for reporting.
* `agent=<name>` outranks `model` and `tools` — the loop never passes
  `--model` or `--tools` beside `--agent`, the agent definition
  supplying its own model and tool set. `effort` still reaches the
  session: `--effort` joins `--agent` unless the agent's definition
  declares an `effort` of its own in its frontmatter. The outranked keys
  are still recorded, and the loop's routing line names them.
* `model` takes an alias (`opus`, `sonnet`, `haiku`, `fable`),
  `effort` one of `low`, `medium`, `high`, `xhigh`, `max`, and `tools` a
  comma-separated list of tool names with no spaces.
* A value the loop cannot use maps to no flag rather than failing the
  task, so a misspelled level costs the routing silently. Spell each one
  from the lists above.
* The loop strips the block before the task text reaches the agent's
  prompt, the operator log and the commit message: a declaration is a
  planning annotation, never an instruction.
* Pick the agent by the task's SHAPE — not its subject or its verb —
  from the `### Task shape to agent` table in `context/workflow.md`.
  Prefer a row whose third column names a tracked
  `.claude/agents/<name>.md` file, since a `user-level` row does not
  travel with a fresh clone. Where no row fits, declare the granular
  keys instead of an agent.

There is no default agent. A task with no declaration passes no routing flag and runs at the loop's defaults, as does one whose every value failed to parse.

The recognised keys are the `DECLARATION_KEYS` of `src/utils/declaration.ts`, whose `MODEL_ALIASES` and `EFFORT_LEVELS` hold the aliases and levels above; that module is the authority for this section, so change the two together.

### `skills=` declaration

`skills` is an extras key rather than a recognised one, so give the task a recognised key beside it: `{skills=bun-testing}` alone is not a declaration and stays in the task text.

```markdown
  - [ ] Port vitest tests to bun:test  {agent=build-error-resolver skills=bun-testing,vitest-migration}
```

---

## Task sizing (session economics)

* One task = one full agent session, so task COUNT is the plan's
  wall-clock. Target **≤80 tasks**; exceed it only when the spec genuinely
  enumerates more independent deliverables, and say so in the Description.
* A module ships as ONE task: implementation + its TSDoc + its colocated
  unit tests together. Never split creation from documentation, or from
  the tests that cover only that module.
* Documentation-only updates fold into the task whose change they document
  (the same-commit doc law already requires the pairing).
* When several tasks wire into one file, give one of them the file's split
  before the file nears the 800-line cap. No single "wire X into
  `src/start.ts`" task grows it enough for its own diff to flag, and phase
  0's six took `src/start.ts` from 798 lines to 960 with no task owning the
  split; only a whole-change-set review caught it.
* Keep as SEPARATE tasks: cross-cutting verification (fan-out gates,
  invariant sweeps), live-seam runs, migrations, and close-out — these
  preserve resumability where a halt is most likely.
* The RUNNER owns the push, the pull request, the merge with the base,
  and the wait for CI. After the last task it runs a wrap-up session
  that promotes findings, compacts `progress.txt`, merges `origin/main`,
  commits, pushes and opens (or updates) the PR — and then polls that
  PR's checks, spending repair sessions on a red or conflicting result.
  So a plan must NOT carry a task that opens a PR, resolves a merge
  conflict, waits on CI, or compacts `progress.txt`. Two openers race:
  measured, one run cut a second branch and opened a second PR for a
  single plan. A close-out task SHOULD still take the mergeability
  reading (`git merge-tree --write-tree origin/main HEAD`) and assemble
  the body material — the gate captures, the test plan, the recorded
  debt — into the plan's close-out notes for that wrap-up session to
  use.

---

## Three task-context injection modes

The loop supports three modes of injecting task context, configured at plan start via `--inject=` or in `.rafa/config.yaml`:

| Mode | Contents | Use case |
| --- | --- | --- |
| `full` | Whole plan (title, description, all stages, all tasks) | Wrap-up session; full context for retrospective |
| `stage` | Plan context, stage context, stage's checklist with earlier tasks shown as done, stage list | Task session; focused scope |
| `task` | Plan context, stage context, single task line | Minimal task focus (not used in phase 0) |

The wrap-up session always receives `full` regardless of the configured mode.

---

## PREREQUISITES.md format

`<plan.dir>/PREREQUISITES-<stub>.md` lists non-automatable setup steps. It is not parsed by the loop — it is a human checklist.

```markdown
  # Prerequisites

  ## Services
  - [ ] {Service name} running on port {n}

  ## Environment Variables
  - `VAR_NAME` — description and where to obtain it

  ## Credentials
  - [ ] {Credential description}
```

Rules:
- Only include prerequisites that are genuinely non-automatable (installed services, external credentials, manual env var setup).
- Do not duplicate steps already documented in the repo's contributor docs (README, CONTRIBUTING, and the like).
- For example: do not mark `bun install` as a prerequisite if it is already documented as a required step for all development work.
- Link to the prerequisites file from the plan.

---

## Format validation

The loop parses plan files through `src/plan/parse.ts`:

- **Block parsing** (`src/plan/blocks.ts`): Reads fenced `rafa:*` blocks. Tolerates documents with no blocks. Retains unknown kinds.
- **Plan parsing** (`src/plan/parse.ts`): Builds the plan model over blocks and the checklist grammar. Each stage captures the tasks under it and the first `rafa:stage-context` block between its heading and the next `# Stage:` heading.
- **Declaration parsing** (`src/utils/declaration.ts`): Takes a trailing `{...}` block off a task line and reads its `key=value` entries. The block counts only when one of its keys is a recognized key (see Task declarations).
- **Report parsing** (`src/report/parse.ts`): Reads the last `rafa:report` block from agent output and parses its YAML body. Answers an explicit absence record if no block is present.

The parser is liberal with unknown input: unknown block kinds are kept, unknown declaration keys are kept, unknown YAML keys are kept. A report yields no report only when its last `rafa:report` block is missing, never closed, not valid YAML, or not a mapping. A field that is missing, or holds a value it cannot take (a `findings` that is not a list, a `signal` other than `loud` or `silent`), is reported as an issue and the rest of the report is still read. Quote every string value in a report: an unquoted value that opens with a backtick, `@`, `%` or `[` makes the whole block unreadable, and a `#` after a space starts a comment that silently cuts the value short.

Line numbers count two ways. A block's `span` (`readRafaBlocks`) and a `PlanIssue.line` count from one; `TaskInfo.lineNum` and the stage and task `lineNum` of the plan model count from zero, so compare `lineNum + 1` against either.

The report rules in this skill restate `src/report/parse.ts`, which is the authority: change the two together.

---

## Examples

Each module task below carries its own unit tests, and each stage closes on a test task over what its modules do together.

### Minimal plan with no structured blocks

```markdown
  # Plan: Add API logging

  ## Description

  We need request/response logging on all endpoints.

  # Stage: Core logger

  - [ ] Add the logger utility at src/lib/logger.ts with its unit tests  {agent=loop-implementer effort=low}
  - [ ] Wire the logger into the request handler middleware  {agent=loop-implementer effort=medium}
  - [ ] Add an integration test holding one request and its response to the logged format  {agent=tdd-guide effort=medium}
```

### Plan with full structured blocks and multiple stages

````markdown
  # Plan: Refactor authentication layer

  ```rafa:plan
  stub: refactor-auth
  issue: OPT-456
  spec: .specs/auth-refactor.md
  ```

  ```rafa:context
  All changes live under src/auth/. Test fixtures in tests/auth-fixtures.ts.
  See docs/AUTH_ARCHITECTURE.md for the domain model.
  ```

  ## Description

  The current auth system couples user identity to session state. This refactor separates concerns into three modules: identity verification, session management, and role-based access control.

  # Stage: Identity layer

  ```rafa:stage-context
  Identity is stateless. Each module imports its own verification logic, never reaching back to sessions.
  ```

  - [ ] Add the cryptographic identity module at src/auth/identity.ts with its unit tests  {agent=loop-implementer effort=high skills=crypto}
  - [ ] Add identity integration tests verifying a signature across a key rotation  {agent=tdd-guide effort=medium}

  # Stage: Session management

  ```rafa:stage-context
  Sessions are keyed by session ID, never by user. One session can hold multiple identities (e.g., impersonation for debugging).
  ```

  - [ ] Rewrite the session store to decouple it from identity, moving its unit tests to the new store API  {agent=loop-implementer effort=high}
  - [ ] Add session integration tests holding two identities in one session  {agent=tdd-guide effort=medium}

  # Stage: Access control

  - [ ] Add role-based access control gating at src/auth/rbac.ts with its unit tests  {agent=loop-implementer effort=medium skills=rbac}
  - [ ] Add RBAC integration tests across the identity and session modules  {agent=tdd-guide effort=high}
````

---

## Hand-written vs. generated plans

Both follow the same structured format. The difference is:

- **Hand-written plans** (by a planner agent): Prose in the description, stage contexts, and task granularity reflect careful thought about the work.
- **Generated plans** (by `rafa plan`): Produced from a spec document; structure is the same.

A hand-written plan read by `src/plan/parse.ts` produces the same data model as a generated one. This is the property the structured format enforces.
