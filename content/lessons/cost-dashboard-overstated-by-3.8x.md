---
title: The cost dashboard was wrong by 3.8x, confidently
slug: cost-dashboard-overstated-by-3.8x
summary: >-
  We were reporting $6,712 of model spend against $1,767 of actual spend, because the
  pricing treated cached input tokens as an addition to input tokens rather than a
  discounted subset of them.
date: 2026-08-28
status: fixed
category: cost
magnitude: 8
principle: >-
  Derive a billing model from the provider's own usage rows, not from the shape the
  API response suggests. A plausible reading of a field is not a measurement of it.
projects: [conversational-commerce-platform]
technologies: [gemini, python, mysql, django]
topics: [cost, instrument-error, measurement, observability]
trace:
  - stage: observation
    label: Reported spend did not match the invoice.
    weight: 1
    body: >-
      The internal dashboard and the provider's bill told different stories, by a
      factor large enough that it could not be rounding or timing.
    evidence: |
      ```
      reported   $6,712.00
      actual     $1,766.90
      window     Dec 2025 – Jul 2026
      ratio      3.80x
      ```
  - stage: assumption
    label: We assumed the rates were stale.
    weight: 1
    wrong: true
    body: >-
      The obvious cause of a wrong bill is a wrong price. Model prices change, and a
      hardcoded rate from six months ago would explain an error of roughly this size.
      The rates were current. The arithmetic was the problem.
  - stage: probe
    label: Test the field's relationship against every usage row we had.
    weight: 3
    body: >-
      Rather than reading the API documentation and reasoning about what `cached_tokens`
      probably means, check it directly: if cached tokens are a subset of input tokens,
      then `cached > input` should never occur. If they are an addition, it should occur
      constantly.
    evidence: |
      Across **391,479** production usage rows:

      ```
      rows where cached_tokens > input_tokens:  0
      share of input tokens that are cache reads:  96.2 %
      ```

      Zero violations in 391,479 rows is not a coincidence. It is a subset.
  - stage: root-cause
    label: Cached input was being billed at the full input rate, and counted twice over.
    weight: 2
    body: >-
      Cached input bills at roughly a tenth of fresh input. With 96.2% of our input
      served from cache, pricing all input at the fresh rate inflates the total by
      almost exactly the factor we were seeing.
  - stage: fix
    label: Price the three token classes separately, and never store money.
    weight: 2
    body: >-
      Fresh input, cached input and output each get their own rate. Rates are stored
      per million tokens because that is how providers publish them, and are
      effective-dated so a price change applies to the right days. Only quantities are
      persisted — cost is computed on read, so correcting a rate reprices history
      instead of leaving stale totals behind.
    evidence: |
      Two further rules fell out of the same audit:

      - Reasoning tokens bill as output, and are usually already inside the output
        count — except on one code path, where they are reported separately. That
        showed up as 614 rows where reasoning exceeded output.
      - Cache *writes* bill at the fresh input rate and report zero cached tokens, so
        the subset rule handles them without a special case.
  - stage: verification
    label: A command that recomputes the total from raw rows and fails if it disagrees.
    weight: 2
    body: >-
      The dashboard is no longer trusted on its own account. A separate command
      recalculates cost independently from the usage rows, applying the pricing rules
      from scratch, and fails if it differs from the rollup by more than a cent —
      overall, per model, and per call type.
    evidence: |
      A second command checks the other direction: that every use case resolves to a
      model with an active rate, **and** that every model and call type present in
      production data is known to the code. Production had been running models that
      appeared nowhere in the source. It exits non-zero, so it breaks a build rather
      than waiting to be noticed.
margin:
  - title: Fails open at runtime
    body: |
      An unpriced model shows a banner on the dashboard. It never raises during a
      customer's call. Verification fails closed; runtime fails open.
---

## The error

For eight months the internal dashboard reported roughly $6,700 of model spend. The
actual figure was roughly $1,770.

Being wrong by 3.8× in the direction of *overstating* cost sounds harmless. It is not.
Every decision that spend informed was made against a number that was almost four
times too large: which model to use, whether caching was worth its complexity, whether
a feature could afford another call. A confidently wrong number is worse than an
absent one, because an absent one gets questioned.

## Why it was wrong

The usage response reports `input_tokens` and `cached_tokens`. There are two readings:

- **Addition** — total input is `input + cached`, and cached tokens are extra.
- **Subset** — `cached` is the portion of `input` that came from cache, billed cheaper.

We had implemented the first. The truth is the second. And because cached input bills
at about a tenth of fresh input, while 96.2% of our input was cache reads, the two
readings diverge by almost exactly the factor we observed.

The documentation is not especially explicit about this. But the data is.

## The move that settled it

Rather than reading the documentation more carefully, I tested the relationship
against every usage row in the database. The subset hypothesis makes a falsifiable
prediction: `cached_tokens > input_tokens` should be **impossible**. The addition
hypothesis makes it commonplace.

```
rows examined                        391,479
rows where cached > input                  0
```

Zero in 391,479 is not ambiguous.

::: principle
When two readings of an API field imply different invariants, find the invariant that
one of them forbids and test it against your own data. You usually have far more
evidence about a provider's behaviour than the provider's documentation contains.
:::

## Making the number falsifiable

The lasting change is not the pricing fix. It is that the number can now be checked
by something other than itself.

One command recomputes total cost directly from raw usage rows, applying the pricing
rules independently, and asserts it matches the stored rollup to the cent — overall,
per model, and per call type. Another checks the registry in both directions: that
every declared use case resolves to a priced model, and that every model and call type
actually present in production data is declared in the code. That second direction
found models running in production that appeared nowhere in the source.

Both exit non-zero. They break a build.

## Storing quantities, not money

The other decision I would make again: the database stores token counts, never
currency. Rates live separately, per million tokens, with effective dates.

This means correcting a rate — or discovering, as we did, that the transcription
service was priced 2.7× below list — reprices all of history correctly and
immediately. If we had stored computed costs, every correction would have left a
sediment of stale totals that nobody would ever go back and fix.

::: principle
Store the quantities you measured, not the money you calculated. Prices are someone
else's variable and they will change, including retroactively in your understanding
of them.
:::
