---
title: Robusta Technology Group
slug: robusta
summary: >-
  Joined as an AI intern to work on generative AI use cases. Fourteen months later the
  work is production systems engineering, and most of what I learned came from things
  breaking in ways I had not imagined.
org: Robusta Technology Group
period: 2025 —
weight: 1
technologies: [python, django, celery, gemini, langchain, mysql, sqs, lambda, batch, ec2, cdk, docker, whatsapp]
topics: [multi-tenancy, latency, cost, guardrails, observability, evaluation, bilingual]
projects: [conversational-commerce-platform]
chapters:
  - title: Arriving as an intern on a live product
    lesson: menu-that-cost-19369-queries
    body: |
      I was brought in for generative AI work and put on a platform that was already
      carrying real orders for real restaurants. There is no gentle version of that.
      The first thing I had to unlearn was treating the model as the interesting part.

      Almost everything I was asked to fix in the first months turned out to be
      ordinary engineering wearing an AI costume — a query in a loop, a cache
      invalidation that never fired, a scope missing from a database filter. The model
      was rarely the defect. It was frequently the *symptom*, because a model given bad
      inputs produces confident nonsense rather than an exception, and confident
      nonsense does not page anyone.
  - title: Learning that a guard can be the incident
    lesson: validator-blocked-more-orders-than-the-bug
    body: |
      I worked on the validation layer that checks an agent's order before it is
      created. It was built to stop the agent confirming orders it had never placed,
      which was a real problem — fourteen customers had been told an order was
      confirmed when none existed.

      Then I measured it, and it was rejecting two-thirds of legitimate orders. Its 143
      unit tests passed because they stubbed the exact model call that was broken.

      This changed how I think about safety mechanisms more than anything else I have
      worked on. A guard is not free, its failures are usually invisible, and the ones
      pointed at customers need a quantified false-positive rate before they ship.
  - title: Building the instruments
    lesson: measurement-inverted-my-own-conclusions
    body: |
      I had written a careful latency analysis reconstructed from log timestamps. When
      I built the actual tracing — a span for every model call, tool, outbound request
      and prompt build — two of that document's recommendations turned out to be
      inverted, and the single largest cost in the system had not appeared in it at all.

      I built the cost model the same way and found we had been overstating spend by
      3.8× for eight months.

      What I took from this is narrower than "measure things." It is that a measurement
      needs a second, independent path that can disagree with it. Both systems now have
      a command that recomputes their headline number from raw data and fails a build
      on a discrepancy.
  - title: Moving work off the customer's path
    body: |
      I contributed to the platform's architecture moving from one shared worker pool
      to tiers: a thin ingress function that acknowledges the platform in about 25
      milliseconds, one isolated queue that carries only the customer conversation, and
      separate compute for everything else.

      The design decision I keep returning to is a refusal rather than a feature. There
      is deliberately no fallback from the new paths back onto the old worker. If the
      task queue is misconfigured, dispatch raises. A silent fallback would have
      reintroduced exactly the load the split exists to remove, and nobody would have
      noticed until latency drifted back.

      Its counterpart matters equally: two operations that used to be queued tasks are
      now plain function calls, because a queue hop cost more than the work did.
  - title: Finding a platform change nobody had announced
    lesson: meta-stopped-sending-the-phone-number
    body: |
      WhatsApp began rolling out usernames. Senders who adopted one arrived with no
      phone number in the payload at all, and our ingest discarded those messages with
      a bare `continue` — no log, no row, no alert. About twenty people a day across
      seven tenants were messaging restaurants and getting silence.

      I found it, established the scope against production data, verified the
      platform's actual behaviour by probing the API rather than reading the
      documentation, and built the identity resolution.

      The habit it left me with is a diagnostic one: when input goes missing, query the
      earliest artifact you persist before your own logic can discard anything.
      Everything downstream cannot distinguish "never arrived" from "arrived and was
      thrown away."
  - title: What changed about how I work
    body: |
      I came in thinking the hard part of applied AI was the model. The hard part is
      the seam — where a probabilistic component sits inside a transactional one, and
      you have to decide what it is allowed to assert versus what it has to prove.

      Three habits came out of that, and they are the ones I would keep in any job.
      Decide a guard's failure direction before writing it, and say so in the code.
      Put a constraint in something that refuses — a build, a deploy, a plan — rather
      than in a document. And never trust a test that stubs the component under test.
---

I joined as an AI intern in July 2025 and now work as an AI engineer on the same
product. The title changed; more usefully, what I think the job is changed.

The product is a multi-tenant conversational commerce platform: customers order food
over WhatsApp, an agent handles the conversation and takes payment, and the order
appears in the restaurant's point-of-sale system. Several established food and
beverage brands run on it.

It is a team product with a team architecture, led by our AI manager. What follows is
scoped to what I owned or found, and where something was a collective design I have
tried to say so rather than absorb it.
