---
title: A menu that cost 19,369 queries
slug: menu-that-cost-19369-queries
summary: >-
  The single largest latency problem in the product was not in the latency document,
  because nobody had measured it. One translated label, one query — repeated across
  the whole catalogue, on every turn.
date: 2026-08-25
status: fixed
category: latency
magnitude: 9
principle: >-
  An N+1 is invisible on a development dataset and linear in production data. Profile
  against a realistic catalogue, not a seeded one.
projects: [conversational-commerce-platform]
technologies: [django, mysql, python]
topics: [latency, measurement, observability]
lessons: [measurement-inverted-my-own-conclusions]
---

## The number

One call to render a menu: **19,369 database queries, about 30 seconds.**

After the fix, the same call, producing byte-identical output: **12 queries.**

## Why nobody had noticed

Translatable text — product names, category names, descriptions — lives in separate
per-language tables. Resolving one label means one lookup. The renderer did that
lookup per label, unprefetched, in a loop.

On a development database with a dozen products this is imperceptible. On a real
catalogue it is linear in the number of labels, and a bilingual menu has a great many
labels. The cost only exists at production scale, which is exactly where nobody was
running a query counter.

It got worse than a single render. A tool whose entire job was to return the details
of *one* item built the whole bilingual menu and then scanned it for the identifier it
wanted. One call: 19,369 queries and 7.66 seconds, to look up one product. A six-item
bundle did it six times — **116,214 queries, 52.7 seconds.**

## The part that was not a performance bug

While fixing this I found something worse in the same code path, and it had nothing to
do with speed.

One prompt built its menu without the tenant scope and in a language string that
matched no stored row. So every label resolution failed and fell back to a placeholder.
All 165 modifier groups and 2,720 options reached the model as `ModifierGroup #<id>` —
nameless.

That prompt's job was repairing incorrect modifier identifiers. It was being asked to
correct identifiers while being shown nothing but identifiers.

Fixing the scope took the prompt from 344,551 characters to 47,566 — roughly 86,000
tokens down to 12,000 — and from 20,403 queries to 44.

::: principle
A silent fallback in a translation layer does not look like an outage. It looks like
data. The prompt was well-formed, the call succeeded, the model answered, and the
answer was built on nothing.
:::

## Why it was not in the latency analysis

I had written a considered document about where turn time was going. It contained six
prioritised recommendations. It did not contain this, because it was reconstructed from
timestamps in token logs — which can tell you how long a model call took, and cannot
tell you anything about what happened before the call was made.

This one item was worth roughly a third of all turn time. It was larger than everything
in the document put together.

That is the argument for instrumenting the boring parts. The model call is the
expensive, interesting, obviously-worth-measuring thing, so it gets measured. Prompt
construction is plumbing, so it does not — and the plumbing was the problem.

## What I check now

When a system assembles a prompt from a database, I count the queries that assembly
costs before I look at anything else. It is one counter and it has never once told me
what I expected.
