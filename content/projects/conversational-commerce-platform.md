---
title: A conversational ordering platform
slug: conversational-commerce-platform
summary: >-
  A multi-tenant system where customers order food by chatting on WhatsApp, an LLM
  agent builds the cart and takes payment, and the order lands in the restaurant's
  point-of-sale. Several established food and beverage brands run on it.
weight: 1
status: ongoing
timeframe: 2025 — present
role: AI Engineer
magnitude: 10
ownership: >-
  A team product. I built the latency instrumentation and the cost model end to end,
  hardened the pre-placement validator, found and fixed the inbound-identity failure,
  and contributed to the tiered architecture. The architecture as a whole was a team
  design, led by our AI manager.
technologies: [python, django, celery, gemini, langchain, mysql, sqs, lambda, batch, dynamodb, ec2, cdk, docker, qdrant, whatsapp, redis]
topics: [multi-tenancy, latency, cost, guardrails, observability, queueing, bilingual, evaluation]
lessons: [validator-blocked-more-orders-than-the-bug, the-slowest-call-was-the-guard, menu-that-cost-19369-queries, meta-stopped-sending-the-phone-number, cost-dashboard-overstated-by-3.8x]
trace:
  - stage: observation
    label: Replies were arriving tens of seconds late, and the LLM was not the reason.
    weight: 2
    body: >-
      Customers were waiting. The obvious suspect was the agent — it is the slow,
      expensive, probabilistic part of the system, and it is what everybody looks at
      first. But the agent's own timings did not account for the gap between a message
      arriving and a reply going out.
    evidence: |
      Two spans, measured on a single message with every queue empty:

      ```
      mark_seen   20 s
      parse       40 s
      ```

      Neither call does meaningful work. A 40-second parse is not a slow parse.
  - stage: assumption
    label: We assumed the delay was load — too much work for too few workers.
    weight: 1
    wrong: true
    body: >-
      The plausible story was saturation: one worker pool draining several queues,
      bulk campaign sends crowding out live conversations. That story was true about
      the architecture and false about this particular delay. Adding capacity would
      not have fixed it, because the workers were not busy.
  - stage: probe
    label: Measure a single message through an entirely idle system.
    weight: 2
    body: >-
      If the delay survives with zero competing work, it is not contention. It
      reproduced immediately: one message, empty queues, tens of seconds before the
      task even started.
  - stage: root-cause
    label: The broker polled each queue in series, and each empty queue cost a full long-poll.
    weight: 3
    body: >-
      Celery's SQS transport polls its predefined queues sequentially. With
      `wait_time_seconds = 20` — a sensible-looking default that reduces API calls —
      a message ready on one queue waited behind a full twenty-second long poll on
      every other queue that happened to be empty. More queues meant more waiting.
      We had added queues to isolate workloads, and each one had made the latency worse.
    evidence: |
      The configuration that caused it looked entirely reasonable:

      ```python
      broker_transport_options = {
          "wait_time_seconds": 20,    # long-poll: fewer, cheaper API calls
          "polling_interval": 1.0,
      }
      ```

      Nothing here is wrong in isolation. It is wrong in the presence of more than
      one queue.
  - stage: fix
    label: Shorten the poll, accept more empty receives.
    weight: 1
    body: >-
      `wait_time_seconds = 1`, `polling_interval = 0.3`. The trade is more empty
      `ReceiveMessage` calls against SQS, which at our volume costs a negligible
      amount of money to buy back tens of seconds of a customer's time.
  - stage: verification
    label: Each hop went to roughly one second, and stayed there.
    weight: 2
    body: >-
      Re-measured on the same two spans, then watched in production. Infrastructure
      now contributes one to two seconds on top of the agent turn.
    evidence: |
      | Span | Before | After |
      |---|---|---|
      | `mark_seen` | 20 s | 0.3 s |
      | `parse` | 40 s | 0.05 s |

      These values now live in the deployed environment's parameter store, not in
      `settings.py`. Reading the defaults in code will tell you the wrong thing.
margin:
  - title: Not published here
    body: |
      Client names, account identifiers, customer data and revenue figures are
      deliberately absent. Every number quoted is an engineering measurement.
---

A customer opens WhatsApp, messages a restaurant, and has a conversation. At the end
of it there is an order in the restaurant's point-of-sale system, paid for, with the
right modifiers on the right items going to the right branch. Nobody on the restaurant
side typed anything.

That is the product. Everything below is what it takes to make that reliable enough
that a business will run on it.

## Why this is harder than it sounds

The difficulty is not the conversation. Language models are good at conversation. The
difficulty is that the conversation terminates in a **transaction**, and transactions
have no tolerance for the things models are bad at.

A model that invents a menu item produces a customer expecting food that does not
exist. A model that attaches the wrong modifier identifier produces an order the
kitchen cannot fill. A model that confirms an order it never placed produces a
customer waiting for a delivery that will never arrive — and we did deliver fourteen
of those before the guards that now prevent it existed.

So the system is built around a single question: **where is the model allowed to
decide, and where does it have to prove its claim against the database?**

## Shape of a turn

<figure class="diagram">
<svg viewBox="0 0 700 250" role="img" aria-label="A message travels from WhatsApp through Meta to an ingress Lambda, onto a queue, into an agent worker that calls the model and its tools, and produces an order pushed to the point-of-sale.">
  <g class="d-line-hot" stroke-width="1.2">
    <path d="M96 40 H160" marker-end="url(#a)"/>
    <path d="M232 40 H296" marker-end="url(#a)"/>
    <path d="M356 40 V78" marker-end="url(#a)"/>
    <path d="M356 118 V156" marker-end="url(#a)"/>
  </g>
  <defs>
    <marker id="a" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0 0 L8 4 L0 8 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect class="d-box" x="8" y="24" width="88" height="32"/>
  <text x="52" y="44" text-anchor="middle">customer</text>
  <rect class="d-box" x="160" y="24" width="72" height="32"/>
  <text x="196" y="44" text-anchor="middle">Meta</text>
  <rect class="d-box-hot" x="296" y="24" width="120" height="32"/>
  <text class="d-label" x="356" y="44" text-anchor="middle">ingress λ</text>
  <text x="426" y="44">~25 ms, then ACK</text>
  <rect class="d-box" x="296" y="78" width="120" height="32"/>
  <text x="356" y="98" text-anchor="middle">queue</text>
  <text x="426" y="98">agent path only</text>
  <rect class="d-box-hot" x="266" y="156" width="180" height="76"/>
  <text class="d-label" x="356" y="176" text-anchor="middle">agent turn</text>
  <text x="356" y="194" text-anchor="middle">model · 22 tools</text>
  <text x="356" y="210" text-anchor="middle">validator · guards</text>
  <text class="d-open" x="356" y="226" text-anchor="middle">~7.7 s mean</text>
  <text x="470" y="180">order → point-of-sale</text>
  <text x="470" y="198">payment → gateway</text>
  <text x="470" y="216">reply → customer</text>
</svg>
<figcaption>The budget is unforgiving. Meta's own delivery costs about 2.3 seconds
each way and the agent turn costs about 7.7 seconds on average. Everything the
infrastructure does has to fit in one to two seconds.</figcaption>
</figure>

The ingress function is deliberately the thinnest thing in the system. It stamps an
arrival time, writes a ledger row, puts the message on a queue, and acknowledges Meta
— without booting the application, touching the database, or entering a VPC. It
returns in about 25 milliseconds warm. Everything that is not required to produce
*this specific reply* happens somewhere else.

## Three architectures

The interesting part of this system is not its current shape. It is that the current
shape is the third one, and each change was forced by a specific failure.

### One box, shared everything

The first version ran the customer webhook and the staff dashboard on the same two
web workers, and ran the agent alongside voice transcription, campaign sends and
background jobs on four Celery slots. One uncached dashboard page load consumed half
the HTTP capacity. A marketing campaign starved live conversations.

The budget, per instance, was two web workers, two hot-path slots, and two slots for
literally everything else. It worked until it was used.

### Seven services, one image

The second version split the workloads into separate services — ingress, admin,
orders, voice, background, bulk, scheduler — each with its own scaling policy, all
running the same container image with a role variable selecting the behaviour.

The most useful thing I learned from that version had nothing to do with containers:

::: principle
Memory, not CPU, was the constraint. Every Celery slot forks a full application
process — Django, the model client, the whole import graph — at roughly 300 MB.
Measured CPU across the fleet was under 1%, while memory sat between 34% and 77%.
:::

So the infrastructure definition validated `concurrency + 1` resident processes at
plan time. Raising concurrency without raising memory failed the deploy instead of
producing an out-of-memory kill in production at 9 p.m. That is the right place for a
constraint like this: in the thing that refuses to apply, not in a runbook.

That version also taught us that a scale-to-zero lane must never carry a message a
customer is waiting on, and that a metric which stops being published at zero
instances cannot be used to scale from zero — the autoscaler evaluates missing data
and never wakes the service up.

### Tiers, by what the work is

The current architecture sorts work by what it *is*, not by where the caller happens
to sit:

| Work | Runs on | Why |
|---|---|---|
| Parse and the agent turn | One dedicated queue and worker | A customer is waiting. Nothing else is allowed on it. |
| Everything else asynchronous | A task-worker Lambda | Media, notifications, point-of-sale pushes, reminders, syncs. |
| Heavy and bulk | AWS Batch, scaling from zero | Campaign launches, catalogue syncs. |
| Periodic sweeps | One consolidated cron process | Previously twelve separate processes. |
| Speech transcription | A dedicated Lambda | 5 MB of code instead of a 1.8 GB image. |

The rule that makes it hold is a refusal rather than a feature: **there is no
fallback to the old path.** If the task queue is not configured, dispatch raises. It
does not quietly route back onto the worker, because a silent fallback would
reintroduce exactly the load the split exists to remove, and nobody would notice
until latency drifted back.

The counter-rule matters just as much. Two operations that used to be queued tasks —
marking a message seen, sending a text — are now plain synchronous calls. A queue hop
cost more than the call did. Not everything benefits from being asynchronous, and
"put it on a queue" is not a free action.

## The parts I own

### Measuring the turn

I built the tracing layer. A trace is one unit of work; inside it every measured
interval is a span, recorded for each model call by type, each tool, each outbound
API request, transcription, and prompt construction.

A few decisions in it were load-bearing:

- **Monotonic clocks throughout**, so a clock adjustment cannot corrupt a duration.
- **Every span stores its offset from the trace origin**, so the waterfall can be
  reconstructed exactly and overlapping spans are *unioned* rather than summed.
  Summing would double-count the moment we run two calls concurrently.
- **Nothing touches the database until the reply has already gone out.** Recording a
  span is a variable read and a list append.
- **Recording never raises.** This code sits on the ordering path, where an exception
  costs a real order, so failures inside the recorder are counted on the trace instead
  of thrown.
- **A hard cap on spans per trace.** A pathological loop shows up as unaccounted time,
  not as an out-of-memory kill.

The measurement that matters most is the one nobody asks for: `duration − accounted`,
the part of the turn no span covers. It is the honest admission of how much you have
not instrumented yet, and it is reported rather than hidden.

There is also a command that checks the instrument against itself — accounted time
never exceeds duration, no negative durations, every child span inside its parent,
every model span reconciling with its independently recorded token row. A latency
number you cannot falsify is not a measurement.

::: wrong What this instrument proved me wrong about
Before it existed I wrote a careful analysis of where turn time was going. When the
spans arrived, two of its recommendations turned out to be **inverted** — including
one about disabling model reasoning, where the saving turns out to be smallest exactly
where it is safe and largest exactly where the reasoning is protecting order accuracy.
That document now carries a header saying which of its own conclusions were wrong.
:::

### Knowing what it costs

Every model identifier — language model, embeddings, transcription, geocoding — is
declared exactly once, mapped to the use case that consumes it, and resolved at call
time so a change takes effect without a restart.

The cost model that sits on top has one rule that produced the largest single
correction I have made to a number anybody was relying on:

::: principle
Cached input tokens are a *subset* of input tokens, not an addition to them, and they
bill at roughly a tenth of the price. 96% of our input was cache reads. Pricing them
at the full input rate overstated real spend by **3.8×**.
:::

Rates are stored per million tokens and effective-dated, so correcting one reprices
history correctly instead of leaving stale totals behind. **Money is never stored** —
only quantities are, and cost is computed on read.

Two commands keep it honest: one fails the build when a model resolves to no active
rate or when production has run a model the code does not declare, and one recomputes
cost from raw rows and asserts it matches the rollup to the cent. At runtime the same
system fails open — a missing rate never breaks a customer's call, it just shows up on
a banner.

### Guarding the order

Before an order is created, a validator checks the agent's arguments: that every
identifier exists in this tenant's catalogue, that each modifier belongs to a group of
its own product, that required choices were made, that the delivery zone actually
contains the customer's coordinates — and, separately, whether the arguments match
what the customer actually asked for.

Its history is the most instructive thing on this page, and it has
[its own entry](/ahmedamer/lessons/validator-blocked-more-orders-than-the-bug/).
The short version: the stage that could act *without database corroboration* was the
stage that misbehaved, and the fix was to make corroboration structural. Every claim
the model makes is now gated on Python evidence before it can act. Money in particular
is never the model's to judge — it is computed in code, by the same function that
creates the order.

### Keeping the injection guard from blocking customers

Three layers sit in front of the agent: a normalising regex guard, an allowlist, and a
small classifier.

The normaliser is the part I find most interesting, because its sharpest rule is a
prohibition. It folds Arabic orthography, strips diacritics and invisible characters,
de-spaces letters typed with gaps, and maps some symbol substitutions — but it must
**never map digits**, because Arabizi (Arabic written in Latin script) uses `2`, `3`,
`5`, `7`, `8` and `9` as letters. Normalising those away would destroy the message it
is trying to read.

The classifier's prompt states its own asymmetry explicitly: a false positive blocks a
real customer, and that costs more than a missed attack. If it is not certain, it
answers safe. The whole layer fails open — if it errors, the message goes through.

That asymmetry was not theoretical. A click-to-chat link from a printed QR code
prefills a message that asserts a role, and the classifier read it as an attack —
[deflecting 132 of 730 arrivals in one month, nondeterministically, on byte-identical
input](/ahmedamer/lessons/classifier-that-deflected-paying-customers/). Every one was
somebody who had scanned a code and never became an order.

### Two languages, no model in the loop

The platform handles Arabic, English, and code-switching between them mid-conversation.
The reply-language decision is made by rules, not by a model call — it is on the
critical path, and it needs to be deterministic and fast.

It classifies Arabic script first, then Latin text containing Franco-Arabic digit
letters or known Arabizi tokens, then Latin that the spellchecker recognises as
English, and finally keeps the existing conversation language for anything else —
names, places, typos, fragments of a shared map link.

That last branch exists because of a real bug: the detector was reading bare order
identifiers, coordinates and customers' own names as Franco-Arabic and flipping the
conversation to Arabic mid-chat. Measured on production data, it was mis-flipping
**8,307 of 57,232** Latin-only messages.

## What went wrong

A site that only lists what worked is not worth reading. Some of the more useful
failures, each with its own entry:

- A guard designed to prevent fake confirmations was blocking **66%** of orders the
  backend demonstrably accepted, and its central verdict was wrong in **178 of 180**
  cases. Its unit tests passed because they stubbed the exact stage that was broken.
- A menu renderer resolved every translated label through its own query. One call:
  **19,369 queries, about 30 seconds.** It was worth roughly a third of all turn time
  and it was not in any latency document, because nobody had measured it.
- A cache-warming job scheduled as `*/55 * * * *` fired **twice an hour**, not every
  fifty-five minutes. That expression means "minute 0 and minute 55."
- Twelve separate scheduled jobs, each booting the full application, drove a
  single-core box to 99% CPU and took the dashboard down with it.
- An undocumented WhatsApp change meant some senders arrived with no phone number at
  all. Our ingest dropped those messages with a bare `continue` — no log, no row, no
  alert. The customer saw two grey ticks and nothing else.

## What I would do differently

**01 — Instrument before optimising, always.** I wrote a detailed latency analysis
before the tracer existed. It was careful, and two of its conclusions were backwards.
The cost of building measurement first would have been a week; the cost of not
building it was a document that sent people in the wrong direction.

**02 — Treat a silent `continue` as a defect on sight.** Every worst incident here
shares a shape: work that does not happen and raises nothing. A healthy dashboard, an
empty dead-letter queue, and a customer who never got a reply are entirely compatible
states. I now write the log line before I write the guard.

**03 — Decide a guard's failure direction before writing it, and write it down.** Half
of these incidents are guards that failed closed when they should have failed open.
The direction is a design decision that deserves a sentence in the code, not something
discovered from a customer complaint.

**04 — Stop trusting tests that stub the component under test.** 143 passing unit
tests and a backtest across 31 conversations both certified a validator stage that was
wrong two-thirds of the time. Both of them stubbed the model call that was the bug.
Anything with a model in it has to be replayed against the real model, or it has
measured the routing and not the behaviour.

**05 — Put the constraint in the thing that refuses.** The memory check that fails a
deploy is worth more than any amount of documentation about process sizing. Where I
could express a rule as something that breaks a build, it has held. Where I wrote it
down instead, it has not.
