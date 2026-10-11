---
plan: rafa-949-cause-codes
title: Cause codes — one list of known error contexts that a project extends
level: minor
---

- errors: rafa now ships one list of cause codes, each `<family>:<leaf>` with a description, a hint and a level, covering every value of the older route, dispatch and skill code lists (which keep their spellings) and the causes behind the largest duplicate-bug clusters; every family also takes `<family>:new-context`, and `unknown:new-context` is the last resort
- config: `errors.codes` adds a project's own cause codes to rafa's list; a code rafa already declares, or one given twice, is refused at load with both places named
- cli: `rafa bug codes` lists the cause codes by family, `--family` narrows the list, `--suggest="<text>"` ranks the codes closest to a cause written in words, and `--check` exits 1 when two codes of one family read alike
