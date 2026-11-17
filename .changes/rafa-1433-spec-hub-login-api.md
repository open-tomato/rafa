---
plan: rafa-1433-spec-hub-login-api
title: A login on the hub, and API keys kept hashed in its store
level: minor
---

- rafa-hub: Under `hub.auth.adapter: api-key` the hub now keeps API keys hashed in its own `rafa-hub.keys.sqlite` and checks them on every request: a paused key is refused as forbidden by name, a deleted one as unauthenticated, and each key's last use is stamped. Keys are managed behind a new login (`hub.auth.login`: basic by default, set through `rafa-hub login` or `RAFA_HUB_LOGIN_USER`/`RAFA_HUB_LOGIN_PASSWORD`, or OAuth with an allow-list and an optional public `callbackUrl`), through the `/v1/keys` routes, the `/login` page and `rafa-hub keys create|list|pause|delete`; the login is never accepted on push, pull or status, and the hub warns once when basic listens on a non-loopback address.
- docs: The hub README documents the login, the key lifecycle, the key commands and the TLS condition for the basic login.
