---
title: The schedule fired twice an hour, not every fifty-five minutes
slug: a-cron-expression-that-meant-something-else
summary: >-
  `*/55 * * * *` does not mean "every 55 minutes." It means minute 0 and minute 55.
  The job it scheduled rewrote a 30,000-token cache each time, for months.
date: 2026-09-08
status: fixed
category: cost
magnitude: 5
principle: >-
  A step value in a cron field steps within that field's range and resets at its
  boundary. Any interval that does not divide its unit evenly does not mean what it
  reads like.
projects: [conversational-commerce-platform]
technologies: [python, django, gemini]
topics: [cost, caching, silent-failure]
---

## The expression

```
*/55 * * * *
```

Read casually, that is "every fifty-five minutes." It is not. The step applies within
the minute field, which runs 0–59, and resets at the top of every hour. So it fires at
minute 0 and minute 55 — twice an hour, five minutes apart, then a fifty-five minute
gap.

Any step that does not divide its field's range evenly has this property. `*/55`,
`*/7`, `*/45` all read like intervals and behave like a short pair followed by a long
gap.

## What it was scheduling

A job that mints the agent's cached system prompt — the menu, the tool definitions, the
whole bilingual catalogue — so that no customer's turn has to pay the cold creation
cost.

Each mint writes roughly 30,000 tokens. Cache writes bill at the full input rate.

There was a second defect layered on it: the job re-minted unconditionally, without
checking whether the current cache was still live and its inputs unchanged. So the
extra firings were not merely extra, they were entirely redundant.

```
~840 cache writes/day    →    ~384
```

## Why nothing caught it

Every individual component reported success. The job ran, the cache was created, the
customer-facing behaviour was correct — arguably better than correct, since the cache
was always extremely fresh.

The only symptom was money, in a line item that was itself being
[mis-attributed by a factor of 3.8](/ahmedamer/lessons/cost-dashboard-overstated-by-3.8x/).
A cost bug hiding inside a cost-reporting bug is not a coincidence — the reason nobody
was scrutinising the cache-write line was that the whole spend figure was known to be
untrustworthy.

::: principle
Waste does not raise. Every check that asks "did this succeed" answers yes, because it
did succeed — repeatedly, and more often than intended. Correctness monitoring cannot
see redundancy.
:::

## The fix, and one more trap

The schedule became an explicit single minute, and the cache lifetime was extended so
that the refresh window keeps a sensible overlap margin rather than racing expiry.

The trap that nearly undid it: the scheduling table is only read at install time. The
source file said one thing and the machine was running another, because nobody had
reinstalled it since the change. Editing a schedule and verifying the file is not
verifying the schedule — you have to read what the machine actually holds.

That is a specific instance of a pattern that has cost me more time than any other
single thing in this system:
[the deployed artifact is not the artifact you deployed](/ahmedamer/lessons/two-schedulers-ran-the-same-job/).
