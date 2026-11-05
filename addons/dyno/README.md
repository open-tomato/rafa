# dyno

A proof of concept, not shipped. A dyno, a dynamometer, holds an engine
on a test bench and measures what it delivers. This add-on does the same
for the lesson door: the `## Lessons from earlier tasks` text a dispatched
task is handed.

Each case pushes fixture lessons through the real `merge` and `bless`,
runs one task text through `selectLessons` and `renderLessonsSection`,
and matches the rendered text token by token. No model and no judge are
involved. The strategy comes from adebench's door reading; no code or
case of adebench is used.

`src/lesson-door.golden.test.ts` says what each case kind checks and how
the guards keep a check from passing for the wrong reason.

Run it from this folder, or from the repository root by path:

```bash
bun test
```

If the checks earn their place, the add-on stays; if not, the branch is
dropped.
