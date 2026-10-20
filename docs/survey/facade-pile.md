# Facade pile

This is the ordered pile pass 3 reads for the six feature-package facades: the passing facades in move order with the counts `scripts/survey/facade-names.ts` gives them, read at commit fb2acc8, and then the failing ones, of which there are none at that commit.

- `rafa-effort`: passes — 38 names (31 values, 7 types) from 18 files; `bun -e "await import('@open-tomato/rafa-effort')"` exits 0
- `rafa-inventory`: passes — 154 names (98 values, 56 types) from 45 files; `bun -e "await import('@open-tomato/rafa-inventory')"` exits 0
- `rafa-board`: passes — 282 names (185 values, 97 types) from 86 files; `bun -e "await import('@open-tomato/rafa-board')"` exits 0
- `rafa-release`: passes — 106 names (72 values, 34 types) from 29 files; `bun -e "await import('@open-tomato/rafa-release')"` exits 0
- `rafa-pr`: passes — 173 names (100 values, 73 types) from 37 files; `bun -e "await import('@open-tomato/rafa-pr')"` exits 0
- `rafa-run`: passes — 297 names (173 values, 124 types) from 74 files; `bun -e "await import('@open-tomato/rafa-run')"` exits 0

The file counts are the distinct `from` sources of each facade's rendered entry (`bun scripts/survey/facade-names.ts --package=rafa-<name> --entry`). Each facade's own `index.test.ts` passed three of three at this commit, and no facade has a failing reading, so no failing row is listed below this line.
