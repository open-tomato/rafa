### First: does a later task build on this one?

When a later open task imports, extends or tests what this task builds,
never `jump` or `defer` past it: those later tasks would run on a gap.
Choose `retry` or `stop`.

### `stop`

- The task text is contradicted by measured behaviour: what it asks for
  does not match what the code or its tests do, so a person has to
  rewrite the task.
- The blocker asks for a design decision, for example which version of
  a skill to pin, or how a native mode is wired. A person decides it.

### `jump`

- The task is a check or a gate on a prerequisite a person owns: a file
  a person writes, an environment variable, an external account. No
  later task depends on its output.

### `defer`

- The blocker names something a later open task provides. `after` is
  that task's line number.

### `retry`

- Only when the blocker names a concrete alternative the task can take
  inside its own scope: another file, another command, a foreground run
  instead of waiting on a background one. The `approach` says what to do
  differently, not what to try again.
