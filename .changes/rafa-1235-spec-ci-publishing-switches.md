---
plan: rafa-1235-spec-ci-publishing-switches
title: CI publishing waits for one repository variable
level: minor
---

- release: The `publish` job of every release ladder template (`release-publish.yml`, `release-tag.yml`, `release-settle.yml`) now runs only when the repository variable `RAFA_RELEASE_PUBLISH` is `ci`, through a job-level `if`; with the variable unset or holding anything else GitHub skips the job and the run stays green, while tagging and settling run either way. The name is exported once as `PUBLISH_SWITCH_VARIABLE` from `src/release/ladder.ts`, and `rafa release tag` under `release.publish: ci` now says the pushed tag publishes when the repository variable `RAFA_RELEASE_PUBLISH` is `ci`.
- doctor: The `Release ladder:` row of `rafa doctor` reminds, from level 2 up, that publishing waits for the repository variable `RAFA_RELEASE_PUBLISH` set to `ci`, which doctor cannot read from the checkout; the row's level and its missing list are unchanged.
- docs: The README's level 2 setup gains the variable as its fourth step, `docs/ci-release-settle.md` shows the level 4 publish job's conjoined `if`, and `context/release.md` names the switch in the ladder, template, tag and doctor-row paragraphs along with the two rejected alternatives.
