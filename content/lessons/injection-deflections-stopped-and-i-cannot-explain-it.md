---
title: The security signal went to zero and both explanations are bad
slug: injection-deflections-stopped-and-i-cannot-explain-it
summary: >-
  A steady 3.4% prompt-injection deflection rate fell to zero over two days. No
  deploy, no model change, no errors. Either detection went dark, or we had been
  turning away real customers for weeks. I still do not know which.
date: 2026-08-31
status: unresolved
category: discovery
magnitude: 8
principle: >-
  A monitored rate falling to zero is an event. Design the alert for "this signal
  stopped" as carefully as the one for "this signal spiked."
projects: [conversational-commerce-platform]
technologies: [gemini, python]
topics: [prompt-injection, instrument-error, observability, silent-failure, llm-behaviour]
lessons: [classifier-that-deflected-paying-customers]
trace:
  - stage: observation
    label: A stable rate went to zero in two days and stayed there.
    weight: 2
    body: >-
      The prompt-injection classifier had deflected a consistent share of messages for
      as long as we had been measuring it. Then it did not.
    evidence: |
      Daily deflection rate:

      ```
      3.8%  2.8  3.4  3.6  3.7  3.4  3.3  1.9   1 turn   0   0
      Aug 23                              Aug 30  Aug 31
      ```

      Not a decay. A cliff with one day of transition.
  - stage: assumption
    label: We assumed the guard had broken and was failing open.
    weight: 2
    wrong: true
    body: >-
      This layer is deliberately fail-open: if the classifier errors, the message goes
      through. A retired model or a credentials problem would produce exactly this —
      silent, total, invisible. It is the explanation the design makes most likely, so
      it was the first thing to rule out.
  - stage: probe
    label: Rule out each mechanical cause by query rather than by reasoning.
    weight: 3
    body: >-
      Five candidate causes, five queries. All five came back negative, which is the
      part that makes this entry unresolved rather than fixed.
    evidence: |
      | Hypothesis | Test | Result |
      |---|---|---|
      | Failing open silently | span still runs at ~1.00 calls/turn, status ok | still running |
      | Errors being swallowed | error count per day | 0–2, unchanged |
      | Model swapped | resolved model id per call | unchanged |
      | Deploy changed behaviour | release history for the window | no deploy |
      | One attacker stopped | deflections were ~1/chat across ~90 customers/day | not one source |

      The classifier is running, on every turn, without errors, on the same model,
      and returning safe every single time.
  - stage: root-cause
    label: Unknown. Two candidates, and the data cannot separate them.
    weight: 3
    body: >-
      Either the model drifted server-side behind a fixed identifier, and our injection
      detection is now dark without anything registering that — or the classifier had a
      3.4% false-positive rate all along and was deflecting real customers for weeks,
      and something upstream changed to stop feeding it the inputs it mishandled.
      Both are serious. They imply opposite remediations.
  - stage: verification
    label: Not yet. The deciding test is a replay, and I have not run it.
    weight: 1
    body: >-
      Take a labelled corpus of known injection attempts and known-safe messages, and
      run it against the classifier today. If it still catches the attacks, detection
      is fine and the earlier deflections were false positives. If it does not, the
      model drifted. Nothing in the stored data can answer this, because the stored
      data only contains what the classifier decided, not what it should have decided.
margin:
  - title: Why it stays open
    body: |
      Marking this fixed would require picking the explanation I prefer. Both remain
      consistent with everything measured.
  - title: Related
    body: |
      The deflections that *were* false positives are documented separately — a QR code
      prefill that looked like an injection. That fix landed near this window, which is
      itself a candidate explanation and not a proven one.
---

## What I know

A rate that had been stable for as long as it had been measured went to zero, over
two days, and stayed there.

The classifier is still running. It is invoked on essentially every turn, its spans
record success, its error count is unchanged at zero to two a day, it resolves to the
same model, and no deploy touched it in the window. The deflections it used to produce
came from roughly ninety different customers a day, about one per conversation, so it
was not one determined attacker who got bored.

Everything mechanical I can test comes back normal. The guard is running and it is
returning safe, always.

## Why both explanations are bad

**If the model drifted**, then our prompt-injection detection is now effectively
disabled, and nothing in the system registered that. The model identifier is the same
string; the behaviour behind it is not something we control or can pin. This is the
worse operational outcome, and it is the one the fail-open design makes hardest to
notice — a guard that is not catching anything and a guard that has nothing to catch
produce identical telemetry.

**If the classifier was false-positiving all along**, then for weeks we were deflecting
around 3.4% of real customers with a polite refusal to engage, and something upstream
changed to stop feeding it the inputs it got wrong. This is the worse product outcome,
and there is a candidate: a fix landed near this window that stopped a QR-code prefill
from reaching the classifier at all. But "near" is not "because," and I have not
established the causal link.

## Why the stored data cannot settle it

This is the part I find most useful, and the most annoying.

We store what the classifier decided. We do not store what it *should* have decided,
because there is no label — the whole point of the classifier is that nobody is
labelling this traffic by hand. So the historical record contains the verdicts and not
their correctness, and no amount of querying it will tell me which of the two stories
is true.

::: principle
Telemetry that records a judgement without recording any way to check the judgement can
tell you that behaviour changed. It cannot tell you which direction was correct. If a
model makes a call you cannot later audit, keep a labelled corpus alongside it.
:::

## The test I need to run

Take a fixed set of known injection attempts and known-safe messages, and run it
against the classifier as it behaves today. That is the only thing that separates the
two explanations, because it supplies the labels the production data lacks.

I have not run it, which is the honest reason this entry says unresolved rather than
fixed.

## What I have changed regardless

The alerting. A monitored rate falling to zero now fires, in the same way a spike
does. I had built alerts for this signal going up and none for it going flat, which
in hindsight is the wrong way round: a spike is visible to anybody looking at a chart,
and a quiet metric looks exactly like a healthy one.

::: principle
Every alert on a rate needs a companion alert on that rate *stopping*. Absence of a
signal is the failure mode nobody builds a dashboard for, because the dashboard looks
fine.
:::
