## Terminology

Names that have a formal spelling and a colloquial one. The formal name
goes in specs, schemas, config keys, command names and anything a reader
has to search for. The colloquial name is what prose reads in once the
formal one has been given, the way AWS documentation says "a bucket"
for an S3 storage location.

### The ledger, lore and hindsight

**The ledger** is the formal name for what #202 builds and #25 and #27
extend: the effort store's findings, blockers, out-of-scope bugs and
mends, the references linking them (`ref_links`), and the sync that
carries them between runs, projects and an orchestrator. It replaces the
working name "distributed learning". Use it in spec headings, config
keys, table and command names, and the first mention on a page.

**Lore** is the colloquial name for the ledger's content as a source of
knowledge: what rafa already knows. Prose introduces it once against
the formal name, then uses it on its own so the page is not flooded
with "ledger":

> In this scenario the ledger MCP acts as rafa's lore: it tells us
> which plans met this failure before. Every time we look in the lore
> ...

**Hindsight** is the colloquial name used only when the reading is
about catching what was missed: a recurrence found after the fact, a
decision that was put off and came back as a blocker, the retrospective
(#58) and tools like it. It is a use of the lore, not a second store.
Write "the lore says this path failed twice" for a lookup and "in
hindsight, #1239 had already put this decision off" for a catch.

**None of the three is a brand.** No package, binary or product is named
`lore` or `hindsight`, and the formal name stays `ledger`. Either word
may later name a subsystem built on the ledger (a hindsight pass inside
the retrospective, say); until then they are words for prose.

### For a documentation or specification task

- The first mention on a page is formal, with the colloquial name tied to
  it: "the ledger, rafa's lore".
- After that, use "lore", or "hindsight" when the sentence is about a
  catch.
- Never use "lore" or "hindsight" in a code identifier, a config key, a
  command, a heading that names a spec, or a table name.

### Boards and positions

**A board** is a GitHub issue labelled `type:roadmap`, holding an ordered
checklist of epics. Most projects have one default board (named by
`roadmap.issue` in `.rafa/config.yaml`). Projects with several teams can
have several boards, each with its own owner and owned folders listed in
`Owner:` and `Owns:` lines. Use "board" in prose once the formal name is
given and in command names, settings and specifications. No colloquial
variant is needed.

**A position** is a (board, epic) pair: where you are in the roadmap. The
file `.rafa/position.json` holds three positions: `current` (where you are
now), `previous` (where you were before the last switch), and `home`
(your anchor, where you came from). Formal use only; no colloquial name.

**Home** is your anchor position, the place a switch made by hand marks
to come back to later with `rafa switch -`. The home moves when you switch
by hand; pass `--no-rehome` to keep it still. Use "home" in prose and in
settings, commands and specifications to name the anchor slot of the
position triple.

### Hopping between epics: the two-hands pattern

**A hop** is a move from the current place to a blocker in another
epic or board, with a return to home when done. The pattern holds two
slots: home (the anchor you hold with one hand) and current (the work
you reach with the other). A hop uses `rafa next --roadmap` to follow a
blocker from `current` to `current`, stepping between epics or boards,
and halts if the blocker is itself blocked (a three-handed reach the
pattern refuses). Use "hop" in prose and command names for the
two-slot reach; the action form is "hopping" or "to hop".

**The hop record** is the file `.rafa/hop.json`, written when a hop
starts to track which issue rafa works and where home is. When
`rafa next` finishes the issue, it deletes the record and returns to
home. A record is stale when the position's home no longer equals the
record's home (a person switched by hand); rafa drops it and follows
the new position.

**The owner gate** is the permission check rafa runs before a hop
into another epic or board. When the target epic's board has an
`Owner:` line and it differs from the current board's owner, rafa
reads which team owns the target code from `CODEOWNERS` and asks for
permission before changing files outside the current team's code.
Rejected hops leave the loop halted with the reason. Use "owner
gate" in prose and specifications; in a test fixture, the rejection
prints `owner review required` as the halt reason.

### Epic lifecycle: the closing gate and the trail

**The closing gate** is the verification step `rafa epic close` runs
before closing an epic. Every member must be closed first. Then rafa
plans a verification-only run from the epic's acceptance criteria,
where each criterion is a check against `origin/main`. If a criterion
cannot be checked (it is prose, not runnable), the close refuses unless
you pass `--accept-unchecked`. If a check fails, the failure is filed
as a bug and the close refuses. On success, the epic closes as
completed. Use "closing gate" in prose and specifications when the
step between "all members done" and "epic closed" is what you mean.
Use "verification" when the step itself, without the "gate" framing,
is the subject. "Acceptance criteria" stays as is (the epic's
acceptance criteria, not the close's verification); they are input,
not the close's own thing.

**The trail** is the comment each epic lifecycle command leaves on the
issue it changes. `rafa epic new` leaves no comment (the issue is new).
`rafa epic defer`, `rafa epic promote`, and `rafa epic move` each
leave one: `Moved now → later: <reason>`, `Moved later → now: <reason>`,
`Moved from epic #A to #B: <reason>`. `rafa epic cancel` leaves one on
the epic it cancels: `Cancelled` or `Cancelled, moved/unblocked its
dependents`. The comment makes the board's history readable: every change
is a line in the issue's thread, not a silent label swap. Use "trail" in
prose when you mean the history a reader sees. Use "comment" for the one
message itself. "Breadcrumb" is colloquial: `rafa epic move` leaves a
breadcrumb comment.
