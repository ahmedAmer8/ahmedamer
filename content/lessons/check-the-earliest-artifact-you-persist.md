---
title: I was wrong three times before I asked the right question
slug: check-the-earliest-artifact-you-persist
summary: >-
  Messages were disappearing. Three careful hypotheses, all disproven, before a single
  query settled it. The generalisable move is asking what the earliest thing you write
  down is, before your own logic can discard anything.
date: 2026-08-14
status: fixed
category: methodology
magnitude: 7
principle: >-
  When input goes missing, query the earliest artifact you persist before business
  logic runs. Everything downstream cannot distinguish "never arrived" from "arrived
  and was discarded."
projects: [conversational-commerce-platform]
technologies: [sqs, python, django]
topics: [silent-failure, instrument-error, observability]
lessons: [meta-stopped-sending-the-phone-number]
---

## Three wrong answers

Messages were not being replied to. I had three hypotheses, in order, each reasonable
and each supported by something:

1. **The queue is losing them.** Plausible — there had been a redelivery incident
   before. Disproven by the queue metrics.
2. **The platform is not calling us.** Plausible — configuration drifts, tokens
   expire, apps sit in development mode. Disproven, eventually, but it took longest
   because our own runbook recommends it.
3. **A worker is crashing mid-turn.** Plausible — an out-of-memory kill would produce
   exactly this shape, with the message redelivered and lost again. Disproven by the
   absence of restarts.

All three were careful. All three were wrong. The fourth thing I did took one query.

## What the queue metrics said

This is the part worth keeping, because the metrics were not broken. They were
accurate and they were irrelevant.

```
sent      32
received  32
deleted   32
dead-letter queue  empty
```

Thirty-two in, thirty-two out, nothing parked. A perfect record — of the messages that
made it as far as the queue. The discard was happening *inside* the consuming process,
after the message had been received and before anything was written down. From the
queue's point of view that is indistinguishable from successful processing, because
the process did acknowledge it. It just did not do anything first.

::: principle
"Received and deleted" means a process took responsibility for a message. It does not
mean the message produced an effect. Those are different claims, and only the second
one is what you care about.
:::

## The question that worked

Eventually I asked something different from "where is it going." I asked:

> What is the earliest thing we write down, before any of our own logic could throw
> it away?

For us that is a deduplication row, written on receipt of the webhook and before
routing. It exists specifically so a redelivered message is not processed twice, which
means it is written unconditionally and early — which in turn makes it, accidentally,
the best diagnostic surface in the system.

The rows were there. With an empty sender field. That single result eliminated all
three hypotheses at once and pointed straight at
[a bare `continue` in our own parser](/ahmedamer/lessons/meta-stopped-sending-the-phone-number/).

## Why I had not asked it sooner

Because the shape of the problem suggested the boundaries. When input goes missing,
attention goes to the edges — the network, the platform, the queue — and not to the
code that runs after the input has safely arrived. The mental model was "something
between them and us." The reality was "something in us, immediately."

An early unconditional write breaks that framing, because it is *inside* our system
but *before* our interpretation. It answers "did it reach us" without depending on
anything that could have discarded it.

## The number that reframed the priority

The loss was about 0.06% of traffic.

That is below every alarm threshold we had, and it would have stayed below them
indefinitely. It was also, for the roughly twenty people a day it affected, a total
failure — they messaged a restaurant and got nothing. A rate that rounds to zero
globally is not a small problem for anyone inside it.

::: principle
A percentage is the wrong unit for a failure that is total for the affected user.
Count the people, not the ratio.
:::

## What I do now

When something is missing, before forming hypotheses, I ask what the earliest
persisted artifact is and whether it exists for the case in question. It is one query
and it partitions the entire problem space in half: if the row is there, the fault is
ours and downstream; if it is not, the fault is upstream.

Three careful hypotheses cost a day. That question costs a minute, and I should have
spent the minute first.
