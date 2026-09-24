/**
 * `rafa plan create`: a plan, and its prerequisites, generated from a
 * spec by the phase 0 command in `src/plan.ts`.
 *
 * The command is aliased `plan`, so the phase 0 spelling
 * `rafa plan --spec=<file>` still runs it, after one deprecation line on
 * stderr. An alias spelled as a subject also catches a line under `plan`
 * whose next word is no action of it, `rafa plan` alone included
 * (`src/cli/route.ts`). `src/plan.ts` reads its own flags, and the ones
 * declared here are those it reads: `--spec`, `--stub` and
 * `--no-progress` in that module, and the board's eight words in
 * `src/board/flags.ts`, which records why they sit in one module.
 *
 * Three of them name the one spec a run plans from and are mutually
 * exclusive — `--spec`, `--issue` and `--next` — so none is `required`
 * and a line naming none is refused by the command with its usage.
 *
 * The eleventh flag is read by neither: `hint` is this tree's own
 * ({@link HINT_FLAG_SPEC}), and `endingWith` reads it AFTER `src/plan.ts`
 * has returned, to end a run that wrote a plan by naming the one step
 * that follows — the loop on the plan it has just written
 * (`src/next/ending.ts`). A run that refused writes nothing and ends
 * with no hint, since the refusal travels out of the inner run. The
 * flag is `hint` and not `next` because `--next` is one of the three
 * above, and `parseArgs` reads `--no-next` as false for it.
 *
 * `src/plan.ts` is handed the word along with the rest of the line and
 * reads no flag it does not know, so `--no-hint` reaching its parser
 * changes nothing there.
 */
import { endingWith, HINT_FLAG_SPEC } from '../../next/ending.js';
import plan from '../../plan.js';
import { wrapPhaseZeroCommand } from '../wrap.js';

const wrapped = wrapPhaseZeroCommand({
  name: 'plan create',
  subject: 'plan',
  action: 'create',
  summary: 'generate a plan, and its prerequisites, from a spec',
  description: 'Hands the spec to a Claude Code session that writes `PLAN-<stub>.md` in `plan.dir`,'
    + ' `.rafa/plans` unless the config names another, and `PREREQUISITES-<stub>.md` beside it when the'
    + ' spec needs setup no task can do. The spec is a file (`--spec`), a GitHub issue (`--issue`) or the'
    + ' first undone line of the roadmap issue (`--next`); the two board routes write the issue body to a'
    + ' snapshot under `specs.dir`, plan from that file, and record `issue: <n>` in the plan. The stub is'
    + ' the basename of the spec unless `--stub` names one, and the command refuses when that plan already'
    + ' exists. On the two board routes the references the snapshot names are read against the stamps its'
    + ' saved copy keeps, and one missing or changed since the spec was read refuses the run before any'
    + ' session starts unless `--accept-refs` re-stamps them. The findings in `progress.txt` are handed to the session as advisory context unless'
    + ' `--no-progress` is given. The session loads the setting sources `loop.settingSources` names, and a'
    + ' config the loop cannot run on refuses the command before any session starts.',
  args: [],
  flags: [
    {
      name: 'spec',
      description: 'The spec to plan from, relative to the project root, or under `specs.dir`'
        + ' (`.rafa/specs` unless the config names another) when the root holds no such file.',
      type: 'string',
    },
    {
      name: 'issue',
      description: 'The number of the `type:spec` issue to plan from. Its body is written to a snapshot'
        + ' under `specs.dir`, with `rafa-<n>-notes.md` beside it appended, and the planner reads that file.',
      type: 'number',
    },
    {
      name: 'next',
      description: 'Plans the first line of the roadmap issue that is neither done nor taken, then as'
        + ' `--issue`. The roadmap is `roadmap.issue` in the config, else the pinned issue titled `Roadmap`;'
        + ' `--next=<n>` reads issue `<n>` as the roadmap instead.',
      type: 'boolean',
    },
    {
      name: 'refresh',
      description: 'Rebuilds a snapshot that no longer matches the issue without asking; the old copy moves under'
        + ' `previous/`.',
      type: 'boolean',
    },
    {
      name: 'dry-run',
      description: 'Reads and refuses everything and writes nothing: no snapshot, no session. Prints what'
        + ' a real run would have planned from.',
      type: 'boolean',
    },
    {
      name: 'skip-review',
      description: 'Plans without the planner judging the spec first. The label and the code checks still'
        + ' run, and the plan records `review: skipped`.',
      type: 'boolean',
    },
    {
      name: 'accept-refs',
      description: 'Re-stamps every reference the spec names as reviewed and plans past the dangling and'
        + ' suspect ones check 4 would refuse, on this run only; `dangerous.acceptStaleRefs: true` in the'
        + ' config does it on every run.',
      type: 'boolean',
    },
    {
      name: 'comment',
      description: 'Posts the gaps of a spec judged not ready on its issue; `--no-comment` prints them and'
        + ' writes nothing on the board. Whatever the verdict does to the labels is unchanged by it.',
      type: 'boolean',
      default: true,
    },
    {
      name: 'stub',
      description: 'The plan stub, which names `PLAN-<stub>.md`. Defaults to the basename of the spec.',
      type: 'string',
    },
    {
      name: 'progress',
      description: 'Hands the findings in `progress.txt` to the session; `--no-progress` leaves them out.',
      type: 'boolean',
      default: true,
    },
    HINT_FLAG_SPEC,
  ],
  examples: [
    {
      cmd: 'rafa plan create --spec=.rafa/specs/my-feature.md',
      note: 'Writes .rafa/plans/PLAN-my-feature.md from the spec.',
    },
    {
      cmd: 'rafa plan create --spec=my-feature.md --stub=my-feature-v2 --no-progress',
      note: 'Reads .rafa/specs/my-feature.md when the project root holds no my-feature.md, and writes'
        + ' .rafa/plans/PLAN-my-feature-v2.md without the findings in progress.txt.',
    },
    {
      cmd: 'rafa plan create --issue=20',
      note: 'Snapshots the body of issue 20 to .rafa/specs/rafa-20-<slug>.md and plans from it, recording'
        + ' issue: "20" in the plan. Refuses an issue that is closed or unlabelled; one that is not marked'
        + ' spec:ready is offered the label where there is a terminal, and refused where there is not.',
    },
    {
      cmd: 'rafa plan create --next --dry-run',
      note: 'Prints the first roadmap line that is neither done nor taken, with what it skipped to reach'
        + ' it, and stops without writing a snapshot or starting a session.',
    },
    {
      cmd: 'rafa plan create --issue=20 --refresh --skip-review --no-comment',
      note: 'Takes issue 20 as it reads now over the snapshot already there, plans without the planner'
        + ' judging the spec first, and keeps any gaps off the board.',
    },
  ],
  aliases: ['plan'],
  outputs: ['text', 'json'],
  spends: { when: 'always', what: 'one planning session' },
}, plan);

export default endingWith(wrapped);
