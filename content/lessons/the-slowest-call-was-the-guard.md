---
title: The slowest thing in the system was the thing protecting it
slug: the-slowest-call-was-the-guard
summary: >-
  The order validator took 10.38 seconds on average — more than twice the agent turn
  it guards. The cause was not the model. It was reasoning nobody had capped, and
  measuring it correctly required interleaving the two arms.
date: 2026-08-20
status: fixed
category: latency
magnitude: 8
principle: >-
  When a model call is slow, measure its thinking tokens before you change the model.
  The budget is usually the variable, and it is the one you control.
projects: [conversational-commerce-platform]
technologies: [gemini, python]
topics: [latency, measurement, baselines, guardrails, llm-behaviour]
lessons: [validator-blocked-more-orders-than-the-bug, sequential-ab-tests-gave-the-wrong-sign]
trace:
  - stage: observation
    label: One call type dominated the span table.
    weight: 2
    body: >-
      With per-call tracing in place, the mean duration of every model call became a
      column you could sort. Sorting it put the order validator at the top by a
      distance.
    evidence: |
      | call | n | mean | max |
      |---|---|---|---|
      | `prompt_injection` | 20,628 | 0.58 s | 46.6 s |
      | `main` | 20,528 | 4.61 s | 70.3 s |
      | `tool_response` | 7,021 | 4.52 s | 67.6 s |
      | **`order_validation`** | 519 | **10.38 s** | **61.4 s** |

      2.3× the main agent call, on a call whose entire job is to check work that has
      already been done.
  - stage: assumption
    label: We assumed the model was too large for the job.
    weight: 1
    wrong: true
    body: >-
      The validator runs on a stronger model than the agent, deliberately — it is
      checking the agent's work and a weaker checker is not much of a check. So the
      obvious hypothesis was that the model choice was the cost, and the obvious fix
      was to move down a tier and measure the accuracy loss.
  - stage: probe
    label: Split the call's wall clock into thinking and everything else.
    weight: 2
    body: >-
      Before swapping models, attribute the time. The token counts are recorded
      alongside the span, so the reasoning portion is directly measurable rather than
      inferred.
    evidence: |
      Against a separately measured rate of **4.44 s per 1,000 thinking tokens**, and
      a production mean of **1,678** thinking tokens per validation:

      ```
      thinking ≈ 7.4 s  of a 10.38 s call   ≈ 70 %
      ```
  - stage: root-cause
    label: The call had no reasoning budget set at all, so the model used its own default.
    weight: 2
    body: >-
      Every other model call in the system passes an explicit thinking budget. This one
      did not — not by decision, but because it was written later and the omission was
      invisible. The model applied whatever default it liked, on a 35,000-token prompt,
      several times per order.
  - stage: fix
    label: Cap the budget.
    weight: 1
    body: >-
      One configuration value. The judgement call is where to set it: too low and
      reasoning silently switches off entirely, which on this call would mean a guard
      that no longer guards.
  - stage: verification
    label: Median 8.38 s to 5.81 s — measured with the arms interleaved.
    weight: 3
    body: >-
      This is the part that nearly went wrong. A first attempt ran all of the control
      calls, then all of the treatment calls, and reported a 6.8-second improvement. A
      second sequential run, at a busier time of day, reported the change made things
      **1.2 seconds worse**. Same code, opposite conclusions.
    evidence: |
      | Method | Before | After | Reads as |
      |---|---|---|---|
      | sequential, quiet API | 11.52 s | 4.74 s | a 6.8 s win |
      | sequential, congested API | 13.06 s | 14.21 s | a 1.2 s loss |
      | **interleaved, n=8 per arm** | **8.38 s** | **5.81 s** | **−2.57 s** |

      Corroborated against a quantity that does not depend on the network: thinking
      tokens fell 851 → 367, and at temperature zero those counts were *identical on
      every call*. That delta predicts 2.15 s. Observed, 2.57 s.
margin:
  - title: Why not just skip it
    body: |
      There is now a mode that runs only the deterministic database checks when the
      transcript has already been reviewed in the same turn. Re-reading the same
      transcript cannot learn anything new about the customer's intent.
  - title: One turn, three validations
    body: |
      A single production turn spent **53.3 seconds** across three validator calls —
      55% of its total wall clock.
---

## The finding

The guard cost more than the thing it guarded. Not marginally: the order validator
averaged 10.38 seconds against the agent's 4.61, on a call that runs after the work
is already done, while a customer waits.

## Why the obvious fix was the wrong first move

The validator runs on a stronger model than the agent does, and that is a defensible
choice — a checker weaker than the thing it checks is decorative. So "the model is too
big" is the natural hypothesis, and it leads directly to an expensive experiment:
swap the model, build an evaluation harness, measure how much accuracy you lose, argue
about whether the trade is worth it.

Attributing the time first took an afternoon and made that experiment unnecessary.
Seventy per cent of the call was reasoning tokens, and the reasoning budget had never
been set. Every other model call in the system passed one explicitly. This one was
written later and simply did not, so the provider's default applied — on a very large
prompt, several times per order.

::: principle
Before changing which model runs a slow call, find out what fraction of it is
reasoning. The budget is a parameter you control; the model is a decision with
accuracy consequences. Check the cheap variable first.
:::

## The measurement nearly lied twice

I want to dwell on the verification, because it produced two confident, opposite,
completely wrong answers before it produced the right one.

The natural way to A/B a latency change is to run the control arm, then the treatment
arm, and compare. I did that, at a quiet time, and got a 6.8-second improvement — far
too large to be real, though it was flattering enough that it took a moment to
question. Running it again later, when the provider was busier, produced a
1.2-second *regression*.

The provider's own latency drifts by more than the effect being measured. A sequential
design attributes all of that drift to the change.

The fix is to alternate the arms inside a single loop so that both experience the same
conditions, and then — this is the part that makes it trustworthy — **corroborate the
result against something that does not travel over the network.** Thinking tokens at
temperature zero were perfectly stable: 851 on every control call, 367 on every
treatment call. That is not a latency measurement at all, and it predicts the
improvement to within half a second.

::: principle
If your wall-clock delta and your token delta disagree, trust the tokens. One of them
depends on someone else's traffic.
:::

## What I would keep

Two things carried forward into everything I have measured since.

**Attribute before you substitute.** Slow calls have a composition. Finding out what a
call is made of is nearly always cheaper than replacing one of its parts, and it
frequently makes the replacement unnecessary.

**Every A/B against a remote service is interleaved, and reports a second,
network-independent quantity.** If I cannot name that second quantity, I do not
believe the result — including, and especially, when it is a result I wanted.
