---
title: The instrument is usually the bug
slug: the-instrument-is-usually-the-bug
summary: >-
  A collection of cases where the measurement was wrong and the system was fine. If a
  number surprises you, the first hypothesis should be that the number is wrong.
date: 2026-09-14
status: shipped
category: methodology
magnitude: 8
principle: >-
  When a metric is surprising, verify the metric before investigating the system. A
  number you cannot falsify is not a measurement.
projects: [conversational-commerce-platform]
technologies: [mysql, django, python, sentry, docker]
topics: [instrument-error, measurement, observability, baselines]
lessons: [cost-dashboard-overstated-by-3.8x, du-lies-about-sparse-files, measurement-inverted-my-own-conclusions, check-the-earliest-artifact-you-persist]
---

A surprising share of the worst bugs I have worked on were not in the system. They
were in the thing measuring the system, and the system was fine.

This is worth naming as a category, because the instinct on seeing a strange number is
to go and investigate the strangeness. That instinct spends a day on a problem that
does not exist often enough to be worth a habit against.

## Eight of them

**The cost dashboard was wrong by 3.8×.** Cached tokens were being priced as an
addition to input tokens rather than a discounted subset. Reported spend was almost
four times actual.
[Full entry](/ahmedamer/lessons/cost-dashboard-overstated-by-3.8x/).

**`du` reported 296 KB for a directory that added 466 MB to an image.** Sparse files
have an allocated size and an apparent size, and a build context archives the apparent
one.
[Full entry](/ahmedamer/lessons/du-lies-about-sparse-files/).

**Date bucketing silently returned nothing.** The database's timezone tables were not
loaded, so the framework's date-truncation functions returned null, collapsing every
date-bucketed aggregate into a single empty bucket. Charts were not wrong, they were
blank, and a blank chart reads as "no data" rather than "broken query." Three separate
models in this system now exist specifically to bucket dates in application code and
persist a real date column.

**The verification command failed on correct data.** The tool that checks the latency
instrumentation reported mismatches — and it was the tool that was broken, not the
data. Partitioning by the condition that makes its comparison unambiguous settled it:
single-turn conversations, 232 sampled, **zero** mismatches. Multi-turn, 65%. The
lookup was not scoped to the turn, so every span was compared against the same row. The
fix was scoping the comparison, not widening the tolerance — widening it would have
silenced a real matching bug.

**Queue metrics showed a perfect record while messages were being discarded.** 32 sent,
32 received, 32 deleted, empty dead-letter queue — all accurate, all irrelevant,
because the discard happened inside the consuming process after acknowledgement.
[Full entry](/ahmedamer/lessons/check-the-earliest-artifact-you-persist/).

**A count metric was being read as a maximum.** The same incident reported "1 message"
where the correct aggregation showed 26. One dropdown.

**An empty log search was treated as evidence.** There was no logging configuration on
one deployment, so an entire category of log line was being discarded before it
reached anything searchable. Grepping for an event and finding nothing means the grep
found nothing. It does not mean the event did not happen.

**Error reports pointed at the wrong machine.** The environment tag was hardcoded and
the hostname came from a shared machine image, so every report claimed to come from the
same place. The only reliable way to tell which environment an error came from was
whether that environment's database contained the record identifier in the message.

## The pattern

These have one thing in common: **the measurement was plausible.** None of them looked
broken. A cost figure, a directory size, an empty chart, a queue counter, a log search
returning nothing — all of them are exactly what a working instrument looks like when
there is nothing to report.

That is the difficulty. A broken instrument that returns an obvious error gets fixed
in ten minutes. A broken instrument that returns a *reasonable* value gets believed,
sometimes for months, and every decision made from it is quietly wrong.

::: principle
Instruments fail toward plausibility. The failure mode is not an error, it is a number
that looks like the number you expected to see.
:::

## What I do now

**Make numbers falsifiable.** For each headline figure, build the independent path that
recomputes it and disagrees loudly. Our cost rollup is checked by a command that
recalculates from raw rows and fails on a one-cent difference. Our latency spans are
checked by a command asserting accounted time never exceeds measured duration and that
every model span reconciles with an independently recorded token count. Neither of
those makes the primary number more accurate. They make it *checkable*, which is a
different and more valuable property.

**Test the invariant the wrong reading forbids.** Where two interpretations of a field
are possible, find the thing one of them makes impossible and check it against your
own data. Is `cached > input` ever true? Zero times in 391,479 rows. That is a stronger
answer than any documentation.

**Partition until the comparison is unambiguous.** When a check reports a high error
rate, split the data by the condition that makes matching certain. If the error rate
goes to zero in the unambiguous partition, the measurement is fine and the *comparison*
is broken. This is what saved a week of chasing a non-existent instrumentation bug.

**Report what did not move.** A measurement write-up that contains only improvements
has been filtered, and you cannot tell by how much. One optimisation we were confident
about produced no measurable effect at all, and saying so in the same table as the wins
is the main reason the wins are believable.

**Count people, not percentages.** A failure affecting 0.06% of traffic is below every
alarm threshold and total for everyone inside it.

## Where this leaves me

I have not become suspicious of measurement. The opposite: nearly everything useful I
have done here came from measuring something that was previously argued about.

But there is a specific discipline that has to come with it, which is that an
instrument is a piece of software like any other, written by somebody in a hurry,
usually with no tests, and never with a second implementation to check it against.
Given that, it is strange that we grant its output more authority than we grant the
system it observes.

The first question when a number is surprising is not *why is the system doing this*.
It is *is the system doing this*.
