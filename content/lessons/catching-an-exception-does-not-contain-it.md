---
title: Catching an exception does not contain it
slug: catching-an-exception-does-not-contain-it
summary: >-
  A best-effort helper that swallowed its own errors still broke the caller's next
  query, because the failed statement had already marked the transaction for rollback.
  It never reproduced locally, for an instructive reason.
date: 2026-08-05
status: fixed
category: incident
magnitude: 6
principle: >-
  A caught database exception still poisons the surrounding transaction. Only a
  savepoint contains it — try/except contains the control flow, not the connection
  state.
projects: [conversational-commerce-platform]
technologies: [django, mysql, python, qdrant]
topics: [silent-failure, data-integrity]
trace:
  - stage: observation
    label: An unrelated admin save started returning 500.
    weight: 2
    body: >-
      The failing query had nothing to do with the code that had changed. It was the
      *next* query after a helper that, by design, could not raise.
  - stage: assumption
    label: We assumed the helper was fine, because it caught everything.
    weight: 2
    wrong: true
    body: >-
      The helper was written to be best-effort and explicitly wrapped in a broad
      try/except. A function that cannot raise cannot break its caller — which is true
      of Python control flow and false of database connection state.
  - stage: root-cause
    label: A failed statement marks the transaction for rollback, regardless of who catches the error.
    weight: 3
    body: >-
      A value of the wrong type reached a JSON column. The insert failed. The
      exception was caught and discarded as intended — but the framework had already
      flagged the transaction as needing rollback, so every subsequent query in the
      same request raised, including ones that were entirely valid.
  - stage: dead-end
    label: Trying to reproduce it locally.
    weight: 2
    body: >-
      It would not reproduce, and the reason turned out to be the most useful part of
      the investigation. Locally, a dependency the helper calls first was not running.
      So the helper returned early, never reached the failing insert, and the bug was
      structurally unreachable on every developer machine.
  - stage: fix
    label: Wrap the fallible write in a savepoint.
    weight: 1
    body: >-
      An atomic block around the statement gives it its own savepoint, so a failure
      rolls back to that point and leaves the outer transaction usable. This is what
      "best effort" actually requires when the effort touches a database.
  - stage: verification
    label: Reproduced deliberately by starting the missing dependency.
    weight: 1
    body: >-
      Once the local environment matched production closely enough to reach the code,
      the failure appeared immediately and the savepoint fix was directly observable.
---

## The surprising part

```python
try:
    Thing.objects.create(payload=value)   # value has the wrong type
except Exception:
    pass                                  # best effort, never raises
```

This function does not raise. It also breaks the caller's *next* query, and the one
after that, until the request ends.

Once a statement fails inside a transaction, the connection is marked as needing
rollback. Catching the Python exception changes what happens to your control flow. It
does not change what the database now thinks about this transaction. Every subsequent
query raises, and the traceback points at code that is completely fine.

The fix is a savepoint — an atomic block around the fallible statement — so the failure
rolls back only to that point:

```python
try:
    with transaction.atomic():
        Thing.objects.create(payload=value)
except Exception:
    logger.warning("…", exc_info=True)
```

::: principle
`try/except` around a database write contains the exception, not the transaction. If
a helper is described as "never raises," it needs a savepoint, or the promise is only
true for its own caller and false for everyone after it.
:::

## Why it never reproduced locally

This is the part I would want somebody else to take away.

The helper's first action is a call to a vector search service. On developer machines,
that service was not running. So the helper failed early, returned, and never reached
the insert that was the actual bug.

The bug was structurally unreachable in every environment where anybody could have
found it, *because* a dependency was broken there.

::: principle
A locally broken dependency does not just hide bugs behind it — it makes them
unreachable, which is worse, because "I cannot reproduce it" reads as evidence about
the code rather than evidence about the environment. Environment disagreement is
information about reachability.
:::

I now treat "it does not reproduce locally" as a question about what my local
environment is skipping, not as a fact about the code. The first thing to check is
which early returns my environment is triggering that production never triggers.

## The shape this belongs to

The helper was best-effort by design, for a good reason: it writes an analytics record,
and analytics must never cost a customer their reply. That instinct is right and it is
used deliberately throughout this system.

What was wrong was the implementation of *how much* it should swallow. "Never raise" and
"never affect anything" are different guarantees, and only the first one was
implemented.
