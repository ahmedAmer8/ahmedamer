---
title: I wrote a careful latency analysis, then measured it and two conclusions flipped
slug: measurement-inverted-my-own-conclusions
summary: >-
  Six prioritised recommendations, reconstructed from log timestamps. When the tracing
  arrived, one was inverted, one was overstated by 3x, and the largest problem in the
  system was not in the document at all.
date: 2026-09-01
status: fixed
category: methodology
magnitude: 9
principle: >-
  An estimate reconstructed from adjacent data is a hypothesis. Label it as one, and
  keep it visible after the measurement so the correction is legible.
projects: [conversational-commerce-platform]
technologies: [gemini, python, django]
topics: [measurement, baselines, latency, instrument-error, observability]
lessons: [menu-that-cost-19369-queries, the-slowest-call-was-the-guard]
trace:
  - stage: observation
    label: Replies were slow and there was no per-segment measurement of a turn.
    weight: 1
    body: >-
      We had token logs with timestamps, which bracket model calls. Everything between
      them — prompt construction, tool bodies, database work — was unmeasured.
  - stage: assumption
    label: Timestamps around the model calls would be enough to find the problem.
    weight: 2
    wrong: true
    body: >-
      I reconstructed a per-segment picture from the gaps between token-log entries.
      It is a reasonable technique and it produced a document with six prioritised
      recommendations, each with an estimated saving. The reasoning was careful. The
      inputs could only see model calls.
  - stage: probe
    label: Build the tracer and record every segment, including the boring ones.
    weight: 3
    body: >-
      Spans for every model call by type, every tool, every outbound request,
      transcription, prompt construction — and the measured remainder that no span
      covers, so the unmeasured portion is reported rather than assumed to be zero.
  - stage: root-cause
    label: The technique could only see the thing it was reconstructed from.
    weight: 2
    body: >-
      Timestamps around model calls tell you about model calls. The largest cost in
      the system was in prompt construction, which produced no log line at all, and
      so had an implied cost of zero in every estimate.
    evidence: |
      What measurement did to the document's own recommendations:

      | Proposed | What the spans showed |
      |---|---|
      | Disable model reasoning on the main call | **Inverted.** A greeting spends ~120 reasoning tokens; a complex order spends 627. The saving is smallest where it is safe and largest where the reasoning is protecting order accuracy. Not done, deliberately. |
      | Remove the injection classifier from the path | Right conclusion, wrong magnitude — measured at **514 ms**, not the estimated 1–1.5 s. |
      | Cap the conversation history window | Overstated. Time-to-first-token barely moves with input size. |
      | Not in the document at all | A menu loader running **19,369 queries**, worth ~33% of all turn time. |
  - stage: fix
    label: Keep the wrong document, with a header saying which parts were wrong.
    weight: 1
    body: >-
      Rather than deleting or quietly rewriting it, the analysis now opens with a block
      stating that its estimates predate the instrumentation, and tabulating which of
      its own recommendations measurement inverted.
  - stage: verification
    label: Tail latency fell by two thirds once the real costs were visible.
    weight: 2
    body: >-
      The fixes that mattered were the ones the estimate could not see.
    evidence: |
      ```
      p90 reply latency   38.4 s  →  11.9 s
      replies over 30 s    14.0 %  →   0.6 %
      ```

      Of the improvement: prompt construction −2.38 s, tool bodies −1.77 s, model calls
      −0.80 s. The model calls were the smallest share, and the only part the original
      estimate could measure.
margin:
  - title: What did not move
    body: |
      Reusing one HTTPS connection for outbound sends produced **no measurable win** —
      580 ms before, 609 ms after, inside the pre-existing band. Reporting the null
      result is what makes the other numbers worth believing.
---

## The document

Before the tracing existed I wrote an analysis of where an agent turn's time was
going. It had six prioritised fixes, each with an estimated saving and a rationale. It
was cited in planning. It was careful work.

It was reconstructed from timestamps in token logs, which bracket model calls and
nothing else.

## What measurement did to it

Two conclusions inverted, one was out by a factor of three, and the single largest
problem in the system did not appear anywhere in it.

The inversion is the one I think about most. The document recommended disabling the
model's reasoning budget on the main call, reasoning that it was pure overhead on a
conversational turn. The spans showed that a greeting spends about 120 reasoning
tokens, while a complex multi-item order spends 627.

So the saving is smallest exactly where disabling it would be safe — on a greeting —
and largest exactly where the reasoning is doing the work that keeps an order correct.
That recommendation is now marked *not done, deliberately*, which is a stronger
statement than *not done*.

## The thing the technique could not see

Reconstructing from token logs means your measurement surface is exactly the set of
things that write token logs. Model calls do. Prompt construction does not.

So prompt construction had an implied cost of zero in every estimate in the document.
It was, in fact,
[19,369 database queries and about a third of all turn time](/ahmedamer/lessons/menu-that-cost-19369-queries/).

::: principle
Any measurement reconstructed from a proxy can only see what the proxy emits.
Everything silent is scored zero, and the silent things are exactly the ones nobody
has thought about yet.
:::

## Keeping the wrong document

The instinct after this was to rewrite the analysis so it said the right things. I
did not, and I think that was the better call.

It now opens with a block stating plainly that its estimates predate the
instrumentation and should not be trusted over the spans, followed by a table of which
of its own recommendations measurement inverted. Anyone who read it before can see
what changed and why. Anyone reading it now gets the correction before the content.

A silently corrected document teaches nobody anything, including its author. It also
quietly destroys the record of *how* the estimate went wrong, which is the part worth
keeping — the failure mode was not carelessness, it was a measurement surface that
could not see past its own instrument.

## Reporting what did not move

One more habit came out of this. The same analysis measured a change we had expected
to help — reusing a single HTTPS connection for outbound sends — and found no effect
at all. 580 ms before, 609 ms after, both inside the band of ordinary daily variation.

That null result is in the write-up, in the same table as the wins. It costs nothing
to include and it is the main reason I believe the other numbers: a report that only
contains improvements is a report that has been filtered, and you cannot tell by how
much.
