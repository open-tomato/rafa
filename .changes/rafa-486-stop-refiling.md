---
plan: rafa-486-stop-refiling
title: Stop refiling one red test as many bugs
level: minor
---

- Triage: A failing test is now tracked by its test file, case and first error line instead of by plan, ignoring line numbers, commit hashes, folders and spacing, so one red test reported by two plans or worded two ways is filed once while two failures in one test stay two bugs; issues filed under the old key are still found. A report worded differently comments on the nearest open bug with its similarity score, a new bug lists its possible duplicates, and a repeat reads its issue's state first: closed as completed files a new issue naming the old one, closed as not planned or duplicate gets a comment, and a failed read files nothing.
- Loop: A run that starts on a red suite no longer files issues for the failures it inherited; it comments on their open issues at most once per run, names each as inherited in the triage notes and events output, and lists them in task prompts by file and case so sessions need not prove them pre-existing.
- Config: New `triage.similarity.threshold` (default 0.3, or `false` to turn the similarity step off) and `triage.similarity.candidates` (default 3, 1 to 10) settings, written commented out by `rafa init`.
- Trackers: Trackers can list the open issues of one type with their text in one call (one `gh issue list` on GitHub, the issue files locally), and a GitHub issue closed as a duplicate now reads as cancelled instead of done.
- Effort store: Stored issue references now answer the newest under a key, the same on both sides of a store merge, and a filed issue's reference can supersede a closed one as a new row; a second superseding write in one session is refused with `SupersedeInSessionRefusal` and nothing written.
- Suite: The run-start suite baseline keeps the first line of each failing test's message, and older baselines still read.
- Documentation: New `context/triage.md` covers the channels, the two-step match and its keys, inherited failures, the state read on a repeat and the similarity settings.
