---
plan: rafa-1430-spec-sync-skew-catch
title: Sync skew between a device and its hub — refuse by default, project on opt-in, refill after the upgrade
level: minor
---

- effort store: New migration `held-rows` adds a local `held_rows` table listing the rows a sync brought in cut down to this rafa's schema; a later merge takes each such row whole once it arrives in full, keeps a locally set `findings.tracker_ref`, and records no conflict for the columns it lacked.
- effort sync: Service sync refusals now say which side is behind, name the migrations, and give the next step (`rafa self-update` for a device behind its hub, upgrade the hub for a hub behind the device), on their own line rather than inside `pull over service failed:`. Under `effort.syncSkew: pull-projected` a device behind its hub keeps pulling rows cut to its schema and reports how many columns wait for `rafa self-update`; the first sync after the update refills those rows and prints `refilled <n> rows held back since <date>`. `sync-service.json` moves to version 2, and older files are read with their cursors kept.
- config: New locked key `effort.syncSkew` (`refuse` by default, or `pull-projected`) decides what a service sync does when this rafa and its hub hold different store migrations.
- hub: The sqlite hub store answers a pull naming the device's migrations with rows projected to its schema, and reports the projection capability itself; a hub whose store cannot project refuses such a pull with the migrations the device lacks, and its upgrade refusal on push now lists the migrations it lacks too.
- docs: The README's effort config table lists `effort.syncSkew`.
