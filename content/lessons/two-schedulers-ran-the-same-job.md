---
title: Two machines were running the same scheduler, and customers got everything twice
slug: two-schedulers-ran-the-same-job
summary: >-
  The scheduling tool writes per-host entries, so every instance that boots installs
  its own copy. Two boxes meant two of every sweep — including the ones that message
  customers.
date: 2026-09-10
status: unfixed
category: infrastructure
magnitude: 6
principle: >-
  A scheduler that installs itself at boot has no concept of a fleet. Exactly-one has
  to be enforced by a lease, not by the number of machines you believe you have.
projects: [conversational-commerce-platform]
technologies: [ec2, django, mysql]
topics: [concurrency, idempotency, deployment-drift, two-sources]
trace:
  - stage: observation
    label: Queue depth snapshots were arriving in pairs.
    weight: 2
    body: >-
      A periodic sweep records a snapshot of queue depths. The rows were landing two
      at a time, seconds apart, on a schedule that should produce one.
    evidence: |
      ```
      11:01:35   and   11:02:02
      11:06:31   and   11:06:59
      ```

      About 28 seconds apart — the difference between two machines' boot times, not
      anything in the schedule.
  - stage: root-cause
    label: The scheduler installs itself into the host's crontab on boot.
    weight: 2
    body: >-
      The instance startup script installs the schedule. Two instances in the group,
      two installations, two independent schedulers — each unaware of the other, each
      running every sweep.
  - stage: fix
    label: Not yet fixed. It needs a lease, and the lease has to be right.
    weight: 1
    body: >-
      The duplicate snapshot rows are cosmetic. The duplicated customer reminders are
      not — an abandoned-cart nudge sent twice is a real message to a real person. The
      correct fix is a short database lease claimed before each sweep, so the second
      scheduler finds the work taken and exits.
margin:
  - title: Precedent
    body: |
      The same shape already caused a worse incident elsewhere: two schedulers fired
      monthly billing at the same minute, against a transaction path with no row lock.
---

## The signature

Rows arriving in pairs, about 28 seconds apart, on a schedule meant to produce one.
That gap is not a jitter setting or a retry — it is the difference between when two
machines finished booting.

Once you have seen that signature it is unmistakable. A duplicate caused by a retry
clusters tightly or backs off exponentially. A duplicate caused by two independent
schedulers sits at a fixed, arbitrary offset that never changes, because it is the
distance between two clocks that were started at different moments and are otherwise
running correctly.

## Why the tool cannot help

The scheduling library writes into the host's own crontab. That is entirely reasonable
for one machine and has no meaning at all for a group of them. There is no
coordination, because from the tool's point of view there is nothing to coordinate
with — it does not know other hosts exist.

The instance startup script installs the schedule at boot. So the number of schedulers
is the number of instances, and the number of instances is an autoscaling decision
nobody thinks of as a scheduling decision.

::: principle
Any component that installs itself at boot scales with your fleet whether or not that
makes sense. Ask of every boot-time action: what happens if this runs on three
machines at once?
:::

## What actually matters here

The duplicate snapshot rows are harmless — a monitoring table with twice the rows it
needs.

The same schedule also runs the customer-facing sweeps. Abandoned-cart reminders.
Browse reminders. Order follow-ups. Those went out twice, to real people, and no
counter anywhere reflects that, because each scheduler completed its work correctly.
Two correct executions of a job that should have run once is a product failure that is
invisible to every operational metric you would think to build.

## Why it is still open

The fix is a lease: claim a short exclusive hold in the database before running a
sweep, and exit quietly if it is already held. That is a small piece of code and it is
easy to get subtly wrong — a lease that is too short lets both run anyway, one that is
too long means a crashed scheduler stops all sweeps until it expires, and one that is
not released on every exit path deadlocks the whole thing.

The precedent for taking it seriously is a worse instance of the same pattern: two
schedulers once fired monthly billing at the same minute, against a transaction path
with no row-level lock. That is a double charge to a customer's card.

I would rather leave this entry marked unfixed than write a lease quickly and believe
it works.
