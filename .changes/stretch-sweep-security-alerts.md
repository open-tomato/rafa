---
plan: stretch-sweep-security-alerts
title: The stretch sweep reads the repository's security alerts and settings
level: patch
---

- operators: the stretch sweep reads open code scanning, secret scanning and Dependabot alerts, the security settings and `bun audit`, and routes each finding: secrets and code alerts to the person, dependency advisories to fix slots
