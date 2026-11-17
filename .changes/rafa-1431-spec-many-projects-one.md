---
plan: rafa-1431-spec-many-projects-one
title: Many projects on one hub, with an api-key identity
level: minor
---

- rafa-hub: One hub now serves many projects: `hub.projects` lists each by root commit id, name, repository and store path, with one store and index file per project; a push or pull naming an unlisted project is refused with a line naming `hub.projects`, `/v1/status` names every served project, search, links and the rebuild after a push follow the request's project, and `rafa-hub index rebuild` rebuilds each project with one line apiece. Left out, the hub serves one default project from `hub.repository` and `hub.storePath` as before. A new `api-key` identity adapter (`hub.auth.adapter: api-key`) serves bearers equal to keys held in the environment variables `hub.auth.apiKeys` names, compared in constant time; the hub refuses a key value in place of a variable name and exits at start when a named variable is unset or empty. The GitHub adapter checks each request against its project's repository, the identity contract suite accepts `{ forbids: false }`, and the README documents projects, api-key auth and a local hub recipe.
- config: New `hub.project` setting names the project a device syncs on the hub; it is unset by default.
- sync: The hub client reads the served projects from the hub's status and names its project on push and pull only to a hub that lists projects.
- effort sync: Service sync names its project as `hub.project` or else the repository's root commit, and refuses to sync from a repository with no commit when `hub.project` is not set.
