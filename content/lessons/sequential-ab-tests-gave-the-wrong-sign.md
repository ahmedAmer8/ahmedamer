---
title: The same change measured as a 6.8-second win and a 1.2-second loss
slug: sequential-ab-tests-gave-the-wrong-sign
summary: >-
  Benchmarking against a remote model by running one arm then the other lets the
  provider's own load drift decide the result. Twice it decided wrongly, in opposite
  directions.
date: 2026-08-21
status: fixed
category: methodology
magnitude: 6
principle: >-
  Any A/B against a service you do not control must interleave its arms and report a
  second quantity that does not depend on the network.
projects: [conversational-commerce-platform]
technologies: [gemini, python]
topics: [measurement, baselines, latency]
lessons: [the-slowest-call-was-the-guard]
---

## The numbers

One code change. Three ways of measuring it:

| Method | Before | After | Conclusion it supports |
|---|---|---|---|
| sequential, n=4, quiet API | 11.52 s | 4.74 s | ship it, huge win |
| sequential, n=6, congested API | 13.06 s | 14.21 s | revert it, regression |
| interleaved, n=8 per arm | 8.38 s | 5.81 s | ship it, −2.57 s |

The first two are the same experiment run at different times of day. They disagree
about the sign.

## Why sequential designs fail here

A remote model's latency is not a property of your request. It is a property of your
request *and* everyone else's, at that moment, on that provider's hardware. That
component drifts on a timescale of minutes to hours — and for most changes worth
making, it drifts by more than the change is worth.

Run all of arm A and then all of arm B, and every bit of that drift lands in the
difference between them. You are not measuring your change; you are measuring your
change plus whatever happened to the provider in between, with no way to separate the
two.

Interleaving does not remove the drift. It distributes it across both arms, so it
shows up as variance rather than as bias.

## The part that makes it trustworthy

Interleaving alone would still have left me with two numbers and a hope. What settled
it was finding a quantity that measures the same change and cannot be contaminated by
network conditions.

At temperature zero, the model's thinking-token counts were perfectly stable: 851 on
every call in one arm, 367 on every call in the other. Not an average — the same value
each time. Against a separately measured rate of 4.44 seconds per thousand thinking
tokens, that delta predicts 2.15 seconds. The interleaved wall clock said 2.57.

Two independent measurements agreeing within half a second is evidence. One
measurement, however carefully taken, is a hope.

::: principle
Report a network-independent corroborating quantity alongside every remote latency
result. Tokens, query counts, bytes, iterations — anything computed locally. If you
cannot name one, you have a single-source number and should say so.
:::

## Where this applies beyond models

The same failure appears wherever a benchmark crosses a boundary you do not own:
a shared CI runner, a database someone else is also querying, an object store, a
cloud instance whose neighbours change. In all of those cases the honest design is the
same — alternate the arms, and find something to count that does not travel.
