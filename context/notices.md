## Standing notices

Two notices exist, `alpha` and `danger`, both about consent rather than a
fault (`src/notices/notices.ts`): the package is alpha software, and
every session rafa spawns runs with `--dangerously-skip-permissions`
under the person's accounts. Before you run a plan, use `rafa plan risk`
to see what it may do on this machine and under your accounts; this is
not a sandbox, but a reading of what the plan and its skills say.

### Where they are shown

`src/notices/run.ts` wires the real process, and two commands call it,
each ahead of the first thing that costs money:

- `loop start` (`src/start.ts`): after the branch offer and the branch
  guard, so a refused run says only why it was refused, and before the
  session record. A cancel leaves the run on the branch the offer may
  have created, with nothing run on it.
- `plan create` (`src/plan.ts`): before the planner session.

On a terminal the pending notices are printed and ONE question follows:
`y` continues, `d` continues and dismisses what was shown, anything else
(an empty line and an ended input included) cancels with exit 1. Without
a terminal they are written as warnings and the run goes on, because a
loop is usually started unattended on purpose.

### Dismissal

`~/.rafa/notices.json`, `{"dismissed": ["alpha", "danger"]}`, in the
USER scope: the notices are about the machine and the account. A missing
or damaged file dismisses nothing. There is no command for it; deleting
the file brings the notices back.

### What a test's HOME must hold

A spawned `loop start` or `plan create` under an empty scratch HOME
prints the notices as warnings, which breaks any case that compares the
run's output exactly. So the planting helpers of
`src/tests/loop-output.test.ts` and `src/plan.test.ts` call
`writeDismissed(home, NOTICE_IDS)` by default, and one case in
`loop-output.test.ts` plants `notices: 'pending'` to read them. A new
suite that spawns either command does the same.

### Adding a notice

Add the id to `NOTICE_IDS` (the order is the print order), its lines to
`noticeLines`, a case to `notices.test.ts`, and the sentence to the
README. `--no-danger`, which would remove the reason for the second
notice, is not built.
