---
plan: atlas-flaky-and-wiring
title: Atlas wires four more live cards and says when no check is flaky
level: minor
---

- atlas: a new metric, `pm.minutes-per-agent`, sums the task session minutes per agent over the window. It is a proxy for resource utilization (catalogue entry 10), since the store records no capacity to divide the minutes by.
- atlas demo: the live page draws four more cards from the replica. Hours per agent, Task minutes distribution, Open bug issues and Defect density no longer show "not wired yet". The hours card is titled "Hours per agent", and the live page draws no limit line on it.
- atlas demo: over a range with no flaky reading, the flaky checks card says so in place of a table with no rows.
