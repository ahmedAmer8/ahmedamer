---
title: We told the agent to sell something that did not exist
slug: told-the-agent-to-sell-something-that-did-not-exist
summary: >-
  A cluster of conversations where the agent invented offers had a single, entirely
  non-AI cause: a configuration field instructing it to reference a promotion that
  only existed on a different tenant's menu.
date: 2026-09-05
status: unfixed
category: ai-agent-behavior
magnitude: 8
principle: >-
  When a model hallucinates consistently in one domain, audit what its configuration
  promises against what its data contains. Instructing a model to cite a nonexistent
  thing while forbidding invention leaves it one option.
projects: [conversational-commerce-platform]
technologies: [gemini, mysql, django]
topics: [llm-behaviour, two-sources, data-hygiene, multi-tenancy]
trace:
  - stage: observation
    label: A cluster of conversations where the agent offered a promotion nobody could order.
    weight: 2
    body: >-
      Eight separate conversations. The agent named a promotion, gave it a price,
      affirmed it existed when challenged, then denied it existed, then affirmed it
      again within the same conversation.
  - stage: assumption
    label: I read it as the agent substituting one menu item for another.
    weight: 2
    wrong: true
    body: >-
      My first analysis classified these as item-substitution errors — the model
      reaching for a similar product when it could not find the one requested. That
      reading is wrong, and it sent me looking at prompt design and retrieval when the
      cause was in a database row.
  - stage: probe
    label: Search every catalogue table in the entire database for the promised name.
    weight: 3
    body: >-
      Instead of asking why the model was inventing this, ask whether it was inventing
      it. Full search across products, categories, modifier options, offers and
      knowledge-base entries, across every tenant.
    evidence: |
      Exactly one match in the entire database — and it belonged to **a different
      tenant's** catalogue. Nothing on the tenant where the agent was offering it.

      The customers were asking for a promotion the configuration promised and the
      catalogue did not contain.
  - stage: root-cause
    label: A per-tenant configuration field instructs the agent to reference a product that is not there.
    weight: 3
    body: >-
      A free-text settings field, injected into the system prompt, tells the agent
      there is an active promotion and to refer the customer to a menu item by name.
      The same field ends with an instruction not to invent offer details.
    evidence: |
      The agent's own visible reasoning, from one of the conversations:

      > the system prompt mentions this offer … the instructions clearly direct me to
      > reference it

      It was not malfunctioning. It was following an instruction that could not be
      satisfied, and it resolved the contradiction the only way available to it.
  - stage: fix
    label: Not a code change. Either create the promotion or delete the instruction.
    weight: 1
    body: >-
      This is a data problem with an operational owner, which is why it is still open.
      The engineering follow-up is separate and more interesting: nothing validates
      that a free-text configuration field refers to things that exist.
margin:
  - title: Still open
    body: |
      The configuration row is unchanged. The engineering guard — checking that
      prompt-injected configuration references resolvable catalogue entries — is not
      built.
---

## The shape of the mistake I made

Eight conversations where the agent offered a promotion that could not be ordered. My
first pass classified them as the model substituting a similar item for a missing one
— a known failure mode, plausible, and completely wrong.

That misclassification cost real time, because it pointed at prompt engineering and
retrieval quality. The actual cause was a row in a settings table.

## What was actually there

A per-tenant free-text configuration field, injected verbatim into the system prompt,
says roughly: there is an active promotion running, refer the customer to the menu item
called *X*, and do not make up any offer details that are not provided.

There is no menu item called *X* on that tenant. There is exactly one product with
that name anywhere in the database, and it belongs to a different restaurant entirely
— a separate tenant with a separate catalogue.

So the instruction set is:

1. Tell customers about *X*.
2. Do not invent details about *X*.
3. *X* does not exist.

These cannot all be satisfied. The model took the first instruction as binding, since
it was the actionable one, and supplied the details from the nearest thing it could
find — producing a price borrowed from an unrelated promotion, five confident
affirmations that the offer existed, one denial, and then another affirmation.

::: principle
An instruction to cite something, combined with a prohibition on invention, combined
with the thing's absence, is not three constraints. It is a contradiction, and the
model will resolve it by inventing. The guardrail against hallucination was part of
the cause.
:::

## What the agent's own reasoning said

The thought summaries are recorded server-side, and one of them reads:

> the system prompt mentions this offer … the instructions clearly direct me to
> reference it

I find this clarifying in a way that changed how I debug these. The model was not
confused, not under-prompted, not reaching. It was doing what it was told, and
reporting accurately that it was doing what it was told.

## The general habit

Nearly every "the agent hallucinated" investigation I have run has resolved to
configuration, data, or plumbing:

- A detector that flipped the reply language was reading order identifiers as Arabic
  transliteration.
- A bundle whose required modifier group had a minimum of two and only one active
  option produced an order that could never validate.
- A tool that returned an instruction in its result string had that instruction
  replayed as conversation history forever.

::: principle
When an agent misbehaves consistently in one domain, diff what its configuration
promises against what its database contains before touching the prompt. Consistency
is the signal — genuine model unreliability is not reliably wrong about the same
thing.
:::

## Why this is still open

The fix is a data change with an operational owner, not a code change, and it has not
been made.

The engineering follow-up interests me more and is also not built: nothing validates
that free-text configuration injected into a prompt refers to entities that exist. A
field that names a product should fail loudly at save time if that product is not in
this tenant's catalogue. That guard would have caught this before any customer saw it,
and it is the kind of check I now look for everywhere configuration meets a prompt.
