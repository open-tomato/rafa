---
plan: rafa-1077-spec-what-plan-broke
title: The loop puts back what its own plan broke
level: minor
---

- report: Out-of-scope entries in a task report now carry a kind (bug, own-fallout, own-gap, convention, docs or machine), and the task prompt explains when each applies; an entry without one still reads as a bug.
- effort store: Added a bug_routes table recording, for each out-of-scope entry, the kind the session said, the kind the loop routed it under and the route taken.
- Triage: The loop now checks each entry's kind against the plan's base and head, adds a repair task for its own fallout or gaps within the retry cap, keeps security entries private, and skips resolving a public tracker when a report files nothing.
- loop: After the last task, leftovers past the repair cap go into a single "Follow-ups of <plan>" issue (later runs append only new lines), and convention notes go into a Conventions section of the pull request body; both are printed when no tracker or provider can take them.
- effort: `rafa effort report` shows one line per plan counting its out-of-scope entries by routed kind and the share filed, also carried in its JSON as bugKinds.
- agents: The bundled loop-implementer and doc-updater agents now say which kind each out-of-scope entry should carry.
