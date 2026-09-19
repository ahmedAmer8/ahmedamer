---
title: The guard blocked more orders than the bug it was built to stop
slug: validator-blocked-more-orders-than-the-bug
summary: >-
  A safety stage added to stop the agent from confirming orders it had never placed
  turned out to be rejecting two-thirds of legitimate orders. Its unit tests passed
  because they stubbed the exact component that was broken.
date: 2026-07-14
status: fixed
category: incident
magnitude: 10
principle: >-
  A stage whose verdict nothing can corroborate is the stage that will produce your
  false positives, however carefully its prompt is written.
projects: [conversational-commerce-platform]
technologies: [gemini, python, django, mysql]
topics: [guardrails, false-positives, measurement, baselines, llm-behaviour]
lessons: [the-slowest-call-was-the-guard]
trace:
  - stage: observation
    label: Orders that should have gone through were ending in human handoff.
    weight: 2
    body: >-
      The validator sits between the agent deciding to place an order and the order
      actually being created. It was blocking, and the blocks were reaching customers
      as "let me get someone to help you with that" — at the exact moment they had
      agreed to pay.
    evidence: |
      Terminal outcomes across the audited window:

      ```
      placed         30 %
      human handoff  64 %
      ```

      Two thirds of conversations that reached a placement attempt ended with a person
      having to intervene.
  - stage: assumption
    label: We assumed the validator was catching real defects, and the agent was the problem.
    weight: 1
    wrong: true
    body: >-
      This was the comfortable reading, and it had supporting evidence. The validator
      *did* catch real defects — hallucinated payment methods, modifier identifiers
      belonging to the wrong product. It had 143 passing unit tests and a backtest
      across 31 recorded conversations. Everything said it was working.
  - stage: probe
    label: Replay every recorded placement through the real validator, not a stub.
    weight: 3
    body: >-
      The decisive move was refusing to trust the tests. Instead of asserting on the
      validator's routing given a fixed model verdict, replay each real payload and
      its real transcript through the live model and compare against a fact that needs
      no judgement: did the backend actually accept this order?
    evidence: |
      616 validator runs across 425 conversations, producing 626 placement attempts.
      For 358 of those, the order creation path had **demonstrably accepted** the
      payload — the order row exists.

      Of those 358, the validator would have blocked **235 (65.6%)**.
  - stage: root-cause
    label: One stage judged whether the customer had confirmed, using nothing but its own reading.
    weight: 3
    body: >-
      A first stage asked the model whether the assistant's last message had restated
      the whole order and whether the customer's reply accepted it. Every other check
      compared the payload against the database. This one compared a transcript against
      an opinion — and it was the only stage whose verdict could act with no
      corroboration at all.
    evidence: |
      Its `confirmation_shown = false` verdict was wrong in **178 of 180** cases where
      it could be adjudicated. The total *was* in the assistant's recent messages, every
      time.

      The dominant failure shape, 164 of 228 blocks:

      ```
      confirmation_shown = false   ← the model's claim
      backend_accepted   = true    ← the fact
      ```
  - stage: dead-end
    label: Trying to fix the prompt.
    weight: 1
    body: >-
      The first instinct was to rewrite the stage's instructions — be more explicit
      about what counts as a confirmation, give it examples, widen the window of
      messages it reads. This is the reflex that wastes the most time in LLM work. The
      stage was not misreading its instructions. It was being asked to make a judgement
      call, at scale, with no ground truth available to check itself against, and then
      being allowed to act on it.
  - stage: fix
    label: Delete the stage. Gate every remaining model claim on database evidence.
    weight: 2
    body: >-
      Removing it loses nothing: a genuinely cancelled order is still caught by the
      argument review, which reads the same transcript but whose claims must survive
      corroboration. Around that, a set of drop rules — each traceable to a specific
      production incident — discard any model claim the database cannot confirm.
      Dropped claims are logged rather than silently ignored, because that is also the
      only way a genuine catch could disappear.
    evidence: |
      Claims the model is no longer permitted to make:

      ```python
      _MODEL_FORBIDDEN_FIELDS = {
          "total", "order_total", "price", "prices",
          "fee", "fees", "subtotal",
      }
      ```

      Money is computed in Python by the same function that creates the order. In one
      conversation the model had insisted a stale figure was authoritative and blocked
      the correct one **eight times**.
  - stage: verification
    label: Block rate 68.4% to 3.9%, with zero new blocks.
    weight: 2
    body: >-
      Measured the same way as the diagnosis — replaying real payloads against the
      real model — so the before and after numbers are comparable.
    evidence: |
      | | Before | After |
      |---|---|---|
      | Blocked, of 408 accepted attempts | 279 (68.4%) | **16 (3.9%)** |
      | Newly blocked (regressions) | — | **0** |
      | Recovered | — | **263** |
      | Terminal outcome: placed | 30% | **86%** |
      | Terminal outcome: human handoff | 64% | **1%** |

      Authoritative total matched the amount charged in 258 of 258 cases, before
      and after.
margin:
  - title: Precision, audited
    body: |
      A separate audit of 616 production runs scored the validator's claims by type.
      Two categories scored **0%**: disputed order totals, and zone-name mismatches.
      Both were claims about things the model could not see.
  - title: Enforcement multiplies
    body: |
      The same claim, made advisory, had a 28.8% false-positive rate. Enforced, 61.4%.
      Enforcement creates retry loops, and each retry generates another wrong claim.
---

## The comfortable version of this story

An AI agent sometimes confirmed orders it had not actually placed. We built a guard.
The guard worked.

Both sentences are true. The guard did catch hallucinated payment methods and modifier
identifiers belonging to other products. It is still in the system. What is missing is
that while it was catching those, it was also destroying about two-thirds of the
legitimate orders that reached it, and we did not know for months.

## Why the tests did not catch it

This is the part I think generalises furthest.

There were 143 unit tests over the validator and they all passed. There was a backtest
across 31 real conversations and it passed too. Both of them **stubbed the model call**.

That is a reasonable thing to do. Model calls are slow, expensive and
non-deterministic, and a test suite that hits a live API is a test suite nobody runs.
So the tests supplied a fixed verdict and asserted that the validator routed it
correctly. Which it did, perfectly, every time.

::: principle
A test that stubs the model tests your routing. It cannot tell you anything about
detection. If the component under test contains a model, the only measurement that
means anything is a replay against the real one.
:::

The backtest was worse, and more subtly so. It injected the model's claims and checked
what the validator did with them — so it was measuring the same thing the unit tests
measured, with more ceremony. It looked like an end-to-end validation and was not one.

## Finding a ground truth that needed no judgement

The thing that unlocked this was realising there was an oracle available that involved
no opinion at all.

The order creation path either accepts a payload or it does not. If it accepted one,
then by definition that payload was well-formed enough to become a real order that a
real kitchen cooked. So: take every recorded placement attempt, find the ones the
backend accepted, and ask what the validator *would have done* to them.

That question has an unambiguous answer, and the answer was 65.6%.

I want to be precise about why this worked, because "find a ground truth" is easy
advice and usually unavailable. It worked because the system already contained a
component that made the same decision by different means, deterministically, and
recorded its result. The validator and the order creation path both answer "is this
payload acceptable." One of them writes a row when it says yes.

## What the fix actually was

Not a better prompt. A structural rule about which claims are allowed to act.

Every check now falls into one of two categories. **Deterministic checks** compare the
payload against the database — does this identifier exist, does this modifier belong
to a group of its own product, does this delivery zone contain these coordinates. These
run before the model is consulted and they cannot produce a false positive, because
they are not opinions.

**Model claims** may only act if Python can corroborate them. Each drop rule came from
a specific incident:

- A claim about money is discarded outright. Totals are computed in code.
- A claim about a missing branch on a *delivery* order is discarded, because branches
  only apply to pickup.
- A claim that a field is missing when the payload visibly populates it is discarded —
  this one had produced an infinite loop, because nothing the agent re-sent could ever
  satisfy it.
- A claim that the correct value is X, where X resolves to the identifier the payload
  already contains, is discarded. This is the catalogue-misspelling case: the customer
  spelled a place name correctly, our catalogue spelled it wrong, and the model
  faithfully reported a mismatch between two spellings of the same thing.
- Every claim about a delivery zone is discarded, always. The customer never names a
  zone. A map pin does, through a geofence.

And there is no permanent block. Four terminal states, and the worst of them hands off
to a human with the order intact rather than looping.

## The general shape

I have come to think of this as the defining question for any guard with a model in
it. Not "is the prompt good" but: **if this stage is wrong, what stops it?**

For the deterministic checks, the database stops them. For the argument review, the
corroboration rules stop it. For the confirmation gate, nothing stopped it — which is
precisely why it, alone among the stages, went wrong at scale and stayed wrong.

The prompt was not the variable. The absence of a check on the prompt's output was.
