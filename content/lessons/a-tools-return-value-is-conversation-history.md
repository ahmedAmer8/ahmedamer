---
title: A tool's return value is conversation history, forever
slug: a-tools-return-value-is-conversation-history
summary: >-
  An instruction written into a tool's return string — "do not call this again" — was
  replayed into every subsequent turn, so the agent obeyed a months-old prohibition
  and silently sent nothing.
date: 2026-08-18
status: fixed
category: ai-agent-behavior
magnitude: 6
principle: >-
  Turn-local state belongs in process state, policy belongs in the system prompt, and
  neither belongs in a tool's return value. Whatever a tool returns is replayed as
  history for the life of the conversation.
projects: [conversational-commerce-platform]
technologies: [gemini, langchain, python]
topics: [llm-behaviour, silent-failure]
---

## The bug

A tool that sends a product carousel returned a string that ended, roughly:

> Carousel sent successfully. Do not call this tool again for this category.

The intent was reasonable: stop the agent from sending the same carousel twice in one
turn. The instruction worked perfectly for that, and then kept working, for the rest of
the conversation's life.

## Why it persists

A tool call and its result are appended to the message history. That history is
replayed into the model on every subsequent turn. So an instruction placed in a return
value is not a one-time signal to the current turn — it is a permanent addition to the
conversation's context, carrying the same authority as everything else in it.

Weeks later, a customer asking to see that category again produced an agent that
consulted its history, found a clear instruction not to call the tool, and complied.

## The symptom was worse than not sending

It did not fail loudly. It did not fail at all, in any sense a monitoring system could
detect.

The agent called no tool, so there was no tool error. It produced a reply, so there was
no empty-response event. The reply was a paraphrase of the example sentence from the
tool's own description, because that was the most relevant text about carousels in its
context.

So the customer asked to see the menu, and received a sentence about menus, and no
menu. Nothing was logged, because from the system's point of view a turn completed
normally.

::: principle
An agent that decides not to act produces no error. The absence of a tool call is
indistinguishable from a turn that legitimately needed none, so this class of bug
cannot be found in error rates — only by reading conversations.
:::

## Where the three kinds of state belong

The fix was less about this one string and more about a rule I did not previously have
written down:

- **Turn-local state** — "already sent in this turn" — belongs in process state for the
  duration of the turn. It should not survive into history at all.
- **Policy** — "only offer the full menu once per conversation" — belongs in the system
  prompt, where it is stated once, versioned, reviewable, and applies uniformly.
- **Facts** — "the carousel was delivered, here is its identifier" — belong in the
  return value. Facts are what a return value is for.

The test I apply now: *would this sentence still be correct if the model read it in six
weeks, in a different context?* If not, it is not a fact, and it does not go in the
return value.

## A related habit

The same reasoning applies to error strings handed back to a model. An error that says
"this failed, do not retry" is a policy statement that will outlive the failure. An
error that says "this failed because the identifier was not found" is a fact, and it
stays true.
