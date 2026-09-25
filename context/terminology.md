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
