# Bayut KSA — Talent Acquisition platform

The documentation, in the order it is worth reading.

| | Document | What it answers |
| --: | --- | --- |
| 1 | [Architecture](01-architecture.md) | What shape the system is, and why that shape |
| 2 | [Database](02-database.md) | Every table, key, constraint and trigger — read out of the live schema |
| 3 | [Permissions matrix](03-permissions-matrix.md) | Who may do what, and what each account can see |
| 4 | [Workflows and state machines](04-workflows-and-state-machines.md) | Every transition in the product, and the rule it refuses to break |
| 5 | [Integration matrix](05-integration-matrix.md) | Every outside system, what it does, and what happens without it |
| 6 | [Automation and events](06-automation-and-events.md) | The event vocabulary, the rules, the sweeps and the worker |
| 7 | [KPI and formula catalogue](07-kpi-and-formulas.md) | How every number on every chart is computed |
| 8 | [Migration and parity matrix](08-migration-parity-matrix.md) | Every command and panel, and where the prototype's behaviour went |
| 9 | [Test report](09-test-report.md) | What is tested, and the result of the last run |
| 10 | [Known limitations](10-known-limitations.md) | What is deliberately not here, and what the product does instead |
| 11 | [Deployment and runbook](11-deployment-and-runbook.md) | How to run it, deploy it, and diagnose it |
| 12 | [Environment variables](12-environment-variables.md) | Every setting, whether it is required, and what it defaults to |
| 13 | [Backup and restore](13-backup-and-restore.md) | What to back up, how, and how to prove the backup works |
| 14 | [Security notes](14-security-notes.md) | What protects the personal data in here, and where the sharp edges are |

## Which of these are generated

Documents **2, 3, 5, 6, 7, 8, 9 and 12** are written from the code, the live
schema and the last test run by `npm run docs`. They carry a stamp saying so.

That is deliberate: a permissions matrix somebody types by hand is wrong within
a fortnight, and a document that disagrees with the product is worse than no
document. If one of these is wrong, the generator or the code is wrong.

```bash
npm test          # writes tests/reports/commands.json
npm run visual:compare   # writes tests/reports/visual.json
npm run docs      # rewrites the generated documents from both, plus the code
```

The rest are prose and are maintained by hand.

## The short version, for somebody who has five minutes

This is a Next.js application on PostgreSQL that replaces a browser-only
prototype. Three things define it:

1. **The browser is not the system of record.** Every read applies the viewer's
   scope in SQL at the root it reads from. Every write goes through one server
   action, is authorized before its input is parsed, runs in a transaction, and
   leaves an audit entry.

2. **Business rules live in one place each.** A state machine in
   `lib/services/` owns its rules and never asks who is calling; the command in
   `lib/commands/` answers "who", once. Which means the same transition can be
   driven by a recruiter, by a webhook, by the worker and by a test without four
   copies of the rule.

3. **Nothing fakes success.** A message with no provider is `not_configured`,
   with the missing settings named. A file with no scanner is `skipped`, never
   `clean`. A phone screen with no telephony is refused, not scheduled. An
   assessment result comes from a person or a provider, never from the product.

Start with [the architecture](01-architecture.md).
