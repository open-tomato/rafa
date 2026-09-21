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
 * `--no-progress` in that module, and the board's seven words in
 * `src/board/flags.ts`, which records why they sit in one module.
 *
 * Three of them name the one spec a run plans from and are mutually
 * exclusive — `--spec`, `--issue` and `--next` — so none is `required`
 * and a line naming none is refused by the command with its usage.
 */
import plan from '../../plan.js';
import { wrapPhaseZeroCommand } from '../wrap.js';

export default wrapPhaseZeroCommand({
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
    + ' exists. The findings in `progress.txt` are handed to the session as advisory context unless'
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
      description: 'Rewrites a snapshot that no longer matches the issue, which is otherwise refused.',
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
      name: 'comment',
      description: 'Posts the gaps of a spec judged not ready on its issue; `--no-comment` prints them and'
        + ' writes nothing on the board. The labels move either way.',
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
}, plan);
