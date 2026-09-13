---
name: dev-planner
description: Use when producing or parsing a plan document (PLAN-<stub>.md, PREREQUISITES-<stub>.md) for the rafa agent loop — establishes the structured plan format with fenced blocks, task declaration syntax, and report format the loop parses and the planner generates.
---

# dev-planner — Structured Plan Format Specification

This skill specifies the format of plan documents produced for feature development work and consumed by the rafa agent loop (`src/rafa.ts`). It does not define agent behavior, personas, or workflow — those belong in agent profiles.

---

## Files produced by a planning session

| File | Purpose |
| --- | --- |
| `PLAN-<stub>.md` | Full task checklist with structured blocks and technical context |
| `PREREQUISITES-<stub>.md` | Non-automatable setup steps required before the plan can run (only when any exist) |

Plans are generated with `bun run rafa plan --spec=.specs/<file>.md` (optionally `--stub=<name>`; the stub defaults to the spec's basename) and live at the repo root. The unstubbed form `PLAN.md` / `PREREQUISITES.md` are also valid and are the loop's default (`bun run rafa start` with no `--plan`).

Execute a plan with `bun run rafa start --plan=PLAN-<stub>.md`.

---

## Structured PLAN.md format

`PLAN-<stub>.md` is the human-readable plan. It consists of:

1. A `# Plan:` heading
2. Optional structured blocks (`rafa:*` fenced code blocks)
3. One or more `# Stage:` sections with tasks

```markdown
# Plan: {Feature Title}

```rafa:plan
stub: my-feature
issue: OPT-123
spec: .specs/my-feature.md
```

```rafa:context
Prose injected into the context of EVERY task in this plan.
Useful for linking to related files or stating common constraints.
```

## Description

{Technical context and background. No behavioral instructions.}

# Stage: {Stage Name}

```rafa:stage-context
Prose injected only into tasks under THIS stage heading.
Links to files relevant to this stage, domain-specific guidelines, etc.
```

- [ ] Task one  {agent=loop-implementer effort=high skills=skill-name}
- [ ] Task two  {model=haiku}

# Stage: {Next Stage}

- [ ] Task three  {agent=tdd-guide effort=medium}
```

---

## Structured blocks (`rafa:*` fenced code blocks)

Structured blocks are optional fenced code blocks that provide metadata and context to the loop. They are **stripped from any output the loop quotes back** (prompt headers, commit messages, operator logs, etc.), so they carry information only for the loop and the planner.

### `rafa:plan`

Header metadata for the entire plan. Fields are YAML key-value pairs.

```
```rafa:plan
stub: my-feature
issue: OPT-123
spec: .specs/my-feature.md
```
```

Recognized fields:
- `stub` — The plan identifier (string). Used to organize findings and dedupe rows across runs.
- `issue` — Optional GitHub issue number (string, e.g., `"OPT-123"`). Links the work back to a tracker.
- `spec` — Optional path to the specification document that guided the plan.

Unknown keys are retained and ignored by the loop; they do not cause parsing to fail.

### `rafa:context`

Prose that the loop injects into the context of **every task** in the plan. Appears between the plan-wide description and the task prompt.

```
```rafa:context
This plan rewrites the authentication layer. See auth-design.md.
All tasks share the test fixtures in tests/auth-fixtures.ts.
```
```

One `rafa:context` block per plan. Appears at the top level (not inside a stage).

### `rafa:stage-context`

Prose that the loop injects into the context of **only the tasks in the immediately following stage**. Appears before the first task of that stage.

```
# Stage: Database Schema

```rafa:stage-context
All schema changes go in migrations/ under a new timestamped file.
Run tests/schema-integration.test.ts after each migration.
```

- [ ] Add users table
- [ ] Add posts table
```
```

One `rafa:stage-context` block per stage (optional). If present, it must appear immediately after the `# Stage:` heading and before the first task line.

### `rafa:report` (agent output only)

Agents return a structured report block at the end of their output. The loop parses this to record findings, blockers, and other metadata.

```
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
blockers:
  - what: "Concurrent writes to NDJSON file"
    artifact: "EBADF: bad file descriptor"
out_of_scope_bugs:
  - what: "bun:sqlite connection pooling"
    artifact: "SQLITE_MISUSE"
    security: false
```
```

Report fields:

| Field | Type | Description |
| --- | --- | --- |
| `status` | string | The session's claim for its task: `done` or `blocked`. Required |
| `feedback` | string | One block of prose describing what was done and how it went |
| `findings` | list of objects | Findings discovered during the task (see below) |
| `skills_used` | list of strings | Names of skills referenced or applied |
| `blockers` | list of objects | What blocked the task (only if status is `blocked`) |
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

## Task declaration syntax

Each task line ends with a **declaration** — a comma-separated list of key-value pairs in curly braces.

```markdown
- [ ] Add Zod schema for CreateJobRequest  {agent=loop-implementer effort=high skills=zod-schemas model=sonnet tools=Read,Write,Edit}
```

Recognized keys:

| Key | Values | Purpose |
| --- | --- | --- |
| `agent` | agent name | Dispatch to a specific agent. Default: `loop-implementer` |
| `effort` | `low`, `medium`, `high` | Task complexity estimate |
| `model` | `haiku`, `sonnet`, `opus` | Model override for this task |
| `skills` | comma-separated list | Skills this task applies or tests |
| `tools` | comma-separated list | Tools the agent will need |

Unknown keys (not in the table above) are retained in the task's extras map and do not cause parsing to fail. They serve as extensibility points for future phases.

### `skills=` declaration

The `skills=` key lists skills the task applies or tests, comma-separated. These are referenced (not implemented) in phase 0; phase 3 resolves them into manifest entries.

```markdown
- [ ] Port vitest tests to bun:test  {skills=bun-testing,vitest-migration}
```

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

`PREREQUISITES-<stub>.md` lists non-automatable setup steps. It is not parsed by the loop — it is a human checklist.

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

## Task granularity guidelines

- One atomic action per task. Each task must be completable in a single focused session without depending on another task being partially done.
- No compound tasks joined by "and". Split "implement X and write tests for X" into two tasks.
- Tasks must be independently completable in the order listed.
- Use imperative, specific wording: "Add Zod schema for `CreateJobRequest`" rather than "Handle input validation".

---

## Testing task insertion patterns

- Add a test task at the end of each stage at minimum.
- For large refactors or multi-file additions, add test tasks at smaller increments — logical sub-chunks that can be verified independently.
- Write negative tests before positive tests (error paths, early exits, edge cases).
- Write unit tests before integration tests.
- Place test tasks in the same stage as the code they cover, not in a separate testing stage.

---

## Block retention and stripping

Every `rafa:*` block is **stripped from the output the loop quotes back**. This means:

- A block planted in a task line does not appear in the dispatched prompt header
- A block in a stage description does not appear in the operator log line
- A block anywhere in the plan does not appear in a commit subject or commit body

The rule is universal: any fenced `rafa:*` block at any nesting level is removed before quoting.

Unknown block kinds (e.g., `rafa:design-notes`) are retained by the parser and ignored, following the same rule as unknown declaration keys. They do not cause parsing to fail and are stripped on output.

---

## Format validation and parser contract

The loop parses plan files through `src/plan/parse.ts`:

- **Block parsing** (`src/plan/blocks.ts`): Reads fenced `rafa:*` blocks. Tolerates documents with no blocks. Retains unknown kinds.
- **Plan parsing** (`src/plan/parse.ts`): Builds the plan model over blocks and the checklist grammar. Each stage captures the tasks under it and any `rafa:stage-context` block immediately after the heading.
- **Declaration parsing**: Splits task lines on `{...}` and parses the contents as a map of `key=value` pairs.
- **Report parsing** (`src/report/parse.ts`): Reads the last `rafa:report` block from agent output and parses its YAML body. Answers an explicit absence record if no block is present.

The parser is liberal with unknown input: unknown block kinds are kept, unknown declaration keys are kept, unknown YAML keys are kept. A report yields no report only when its last `rafa:report` block is missing, never closed, not valid YAML, or not a mapping. A field that is missing, or holds a value it cannot take (a `findings` that is not a list, a `signal` other than `loud` or `silent`), is reported as an issue and the rest of the report is still read. Quote every string value in a report: an unquoted value that opens with a backtick, `@`, `%` or `[` makes the whole block unreadable, and a `#` after a space starts a comment that silently cuts the value short.

---

## Examples

### Minimal plan with no structured blocks

```markdown
# Plan: Add API logging

## Description

We need request/response logging on all endpoints.

# Stage: Core logger

- [ ] Add logger utility to src/lib/logger.ts  {effort=low}
- [ ] Wire logger to request handler middleware  {effort=medium}

# Stage: Testing

- [ ] Add tests for logger output format  {effort=medium}
```

### Plan with full structured blocks and multiple stages

```markdown
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

- [ ] Add cryptographic identity module at src/auth/identity.ts  {agent=loop-implementer effort=high skills=crypto}
- [ ] Add identity unit tests  {agent=tdd-guide effort=medium}

# Stage: Session management

```rafa:stage-context
Sessions are keyed by session ID, never by user. One session can hold multiple identities (e.g., impersonation for debugging).
```

- [ ] Rewrite session store to decouple from identity  {agent=loop-implementer effort=high}
- [ ] Migrate session tests to new store API  {agent=tdd-guide effort=medium}

# Stage: Access control

- [ ] Implement role-based access control gating  {agent=loop-implementer effort=medium skills=rbac}
- [ ] Add RBAC integration tests  {agent=tdd-guide effort=high}
```

---

## Hand-written vs. generated plans

Both follow the same structured format. The difference is:

- **Hand-written plans** (by a planner agent): Prose in the description, stage contexts, and task granularity reflect careful thought about the work.
- **Generated plans** (by `bun run rafa plan`): Produced from a spec document; structure is the same.

A hand-written plan read by `src/plan/parse.ts` produces the same data model as a generated one. This is the property the structured format enforces.
