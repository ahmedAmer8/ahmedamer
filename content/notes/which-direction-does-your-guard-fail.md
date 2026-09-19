---
title: Which direction does your guard fail?
slug: which-direction-does-your-guard-fail
summary: >-
  The single most consistent principle I have arrived at: things on the customer's
  path fail open, things that verify correctness fail closed. Nearly every serious
  incident I have worked on is that rule applied backwards.
date: 2026-09-12
status: shipped
category: methodology
magnitude: 9
principle: >-
  Never block a customer; always break a build. Decide a guard's failure direction
  before you write it, and put the reason in the code.
projects: [conversational-commerce-platform]
technologies: [python, django, gemini]
topics: [fail-open, guardrails, silent-failure, observability]
lessons: [validator-blocked-more-orders-than-the-bug, classifier-that-deflected-paying-customers, injection-deflections-stopped-and-i-cannot-explain-it, cost-dashboard-overstated-by-3.8x]
---

Every guard fails. That is not a criticism of guards — it is a property of software
that runs long enough. The question that turns out to matter is not whether it fails
but **which way**, and that is a decision somebody makes, or fails to make, at the
moment the guard is written.

I did not start with a rule. I arrived at one after enough incidents shared a shape.

## The rule

> Things on the customer's path fail **open**. Things that verify correctness fail
> **closed**, loudly, with a non-zero exit.
>
> Never block a customer. Always break a build.

Everything below is why, and where it gets uncomfortable.

## Failing open, on the path

A customer is in a conversation, waiting. Every component between their message and
the reply has the same obligation: if you break, get out of the way.

So the prompt-injection classifier, if it errors, lets the message through. The message
ordering gate, if its store is unreachable, stops gating. The order validator, if it
cannot run, allows placement and sends an alert. The cost accounting, if its schema is
behind the code, swallows the failure rather than taking down the turn. Model
resolution, if the database is unreachable, falls back to a default rather than
refusing to pick.

Each of those is a decision to accept a small, bounded risk — an injection gets
through, an order goes unvalidated — rather than a certain, total failure, which is a
customer who gets nothing.

The uncomfortable part is that this is genuinely a security trade-off, and I want to
be honest about it rather than present it as free. A fail-open injection guard means a
broken guard is indistinguishable from a quiet day. That is not hypothetical: our
deflection rate
[went to zero and I still cannot say whether detection went dark or the guard had been
wrong all along](/ahmedamer/lessons/injection-deflections-stopped-and-i-cannot-explain-it/).
Fail-open is the right default here because the asymmetry of costs is real, but it
buys reliability with observability, and the bill comes due.

## Failing closed, off the path

The same system is uncompromising about anything that checks whether it is telling the
truth.

The command that verifies AI cost recomputes spend from raw usage rows and exits
non-zero if it disagrees with the rollup by more than a cent. The command that checks
model registration exits non-zero when a use case resolves to an unpriced model — or,
in the other direction, when production has run a model the code does not know about.
The command that verifies latency instrumentation checks that accounted time never
exceeds measured duration, that every child span lies inside its parent, that every
model span reconciles with an independently recorded token row. There is an
import-time assertion that every tool advertised to the model has a dispatch entry,
because two production bugs came from that going out of sync.

All of these break a build. None of them can affect a customer, because none of them
run anywhere near one.

::: principle
The same system can hold both stances without contradiction, because they apply to
different populations. A customer experiences unavailability. A developer experiences
a failed command. Only one of those is expensive.
:::

## Where it gets hard: the guard that fails the wrong way

The clean version above is what the system looks like now. Most of the incidents that
produced it were the rule applied backwards.

The order validator is the clearest case. It was built to fail closed — to block an
order it was unsure about — on the entirely reasonable grounds that a wrong order is
worse than a delayed one. In practice it
[blocked 66% of orders the backend had demonstrably accepted](/ahmedamer/lessons/validator-blocked-more-orders-than-the-bug/),
and every one of those blocks reached a customer as a refusal at the moment they had
agreed to pay.

The injection classifier is the same story in miniature:
[132 people scanned a QR code and were told the assistant could not help
them](/ahmedamer/lessons/classifier-that-deflected-paying-customers/).

Both were guards protecting real risks. Both were pointed the wrong way, and in both
cases the damage was larger than the risk they were built to mitigate — and much
harder to see, because a blocked customer produces no error, just a slightly worse
number somewhere nobody was looking.

## What a fail-closed guard needs before it can exist

I have ended up with three requirements before I will point a guard at a customer.

**A quantified false-positive surface.** Not an argument that it should not fire
wrongly — a count against production data of how many existing records it would reject.
Before adding a hard block on customers with no phone number, we checked: zero of
46,166. That number is what made it safe, and it is a sentence rather than a hope.

**A terminal state that is not a loop.** Every ask-the-customer-again path needs a hard
cap and a defined ending. An unbounded retry is a stuck order dressed up as caution.
The validator now has four terminal states and none of them is a permanent block — the
worst case hands off to a person with the order intact.

**Corroboration, if a model is involved.** A model's claim may only act if code can
confirm it against the database. This is the structural version of the rule: rather
than trusting the guard to be right, make it impossible for an uncorroborated claim to
reach a customer. Money in particular is never a model's to judge.

## Say it in the code

The direction is not self-evident to the next reader, and a guard that looks like a
bug is a guard somebody will "fix."

Our message-ordering gate does not gate when its store is unreachable, when no ledger
row exists, or when an earlier message has been pending too long. Every one of those
looks like a missing check. The comment says, in effect: this fails open by design,
do not turn it into a block. Without that line, somebody reasonable would eventually
tighten it, and conversations would stall.

::: principle
A deliberate fail-open is indistinguishable from a missing guard unless you say so.
The comment is not documentation — it is the thing that stops the next person undoing
the decision.
:::

## The test I actually use

When I write anything that can reject, I ask three questions in order:

1. **If this is wrong, who pays?** If the answer is "a customer," it fails open.
2. **If it fails open, how would I know?** If the answer is "I would not," that is a
   monitoring gap to fix now, not later — see the deflection rate that went silently
   to zero.
3. **What is the terminal state?** If I cannot name one, I am not describing a guard,
   I am describing a loop.

Most of what I know about this came from getting question one wrong, repeatedly, in
production, with real orders attached.
