---
title: Side projects, honestly scoped
slug: applied-ml-side-projects
summary: >-
  Five applied-ML builds from before and alongside the production work. They were good
  for learning the tools and they were not production systems. Both halves of that are
  worth saying.
weight: 2
status: archived
timeframe: 2024 — 2025
role: Sole author
magnitude: 3
technologies: [python, streamlit, gradio, fastapi, crewai, faiss, groq, openai, docker, pytorch]
topics: [llm-behaviour, evaluation]
links:
  - {label: "Multi-agent content generation", url: "https://github.com/ahmedAmer8/Multi-Agent-Content-Generation-System"}
  - {label: "Groq chatbot", url: "https://github.com/ahmedAmer8/groq-chatbot"}
  - {label: "Voice translation with cloning", url: "https://github.com/ahmedAmer8/translation-with-voice-cloning"}
  - {label: "Medical image chatbot", url: "https://github.com/ahmedAmer8/AI-medical-chatbot"}
  - {label: "Chat with your PDFs", url: "https://github.com/ahmedAmer8/chat_with_your_pdf"}
ownership: >-
  Written entirely by me, for learning. None of them carried traffic from anyone who
  was not me.
---

Most portfolios present work like this as though it were equivalent to production
engineering. It is not, and pretending otherwise is the fastest way to lose the trust
of anyone who has done both. So: here is what these were, and what I actually got out
of them.

## What they are

**Multi-agent content generation** — a researcher agent and a writer agent coordinated
through an orchestration framework to produce an article from a topic. Streamlit
front-end, search API for retrieval.

**Chat with your PDFs** — retrieval-augmented generation over a document collection,
with a vector index and an LLM answering from retrieved chunks.

**Voice translation with cloning** — English speech in, six languages out, preserving
the speaker's voice, by chaining a transcription API and a synthesis API.

**Medical image chat** — a vision-language model answering questions about an uploaded
image, with selectable backends and a chat interface.

**Groq chatbot** — a chat application with a separate API backend and front-end,
containerised and deployed, with conversation history and token accounting.

## What they actually taught me

The useful thing was not the models. It was everything around them.

**Containerising the chatbot and having it fail in deployment** was worth more than the
chatbot. The difference between "works on my machine" and "works in a container
somebody else runs" is where most of the real content is, and I would not have learned
it by reading.

**Token accounting in the Groq project** turned out to be direct preparation for
building a cost model over hundreds of thousands of production usage rows — including
the instinct to record quantities rather than computed costs, though I did not know
why that mattered until much later.

**The RAG project taught me how retrieval fails**, which is more useful than knowing
how it works. It fails by returning plausible, adjacent, wrong chunks, and the answer
built on them reads exactly like an answer built on correct ones. That is the same
failure mode that
[produced an agent confidently selling a promotion that did not
exist](/ahmedamer/lessons/told-the-agent-to-sell-something-that-did-not-exist/) — the
model does not signal when its inputs are bad.

## What they did not teach me

Everything that only appears under real use.

There was no concurrency, because there was one user. No multi-tenancy, no data
isolation, no question of whose data this is. No latency budget, because nobody was
waiting in a queue behind anyone else. No failure direction to decide, because the only
person a failure affected was me, and I could restart it. No deployment drift, no
schema migrations against live data, no incident where the instrument was the thing
that was broken.

Most importantly: no consequence for being wrong. A demo that hallucinates is a funny
screenshot. An ordering agent that hallucinates is a customer waiting for food that is
never coming, and I did not understand the difference between those until I had caused
the second one.

::: principle
Side projects teach you the tools. They cannot teach you the failure modes, because
the failure modes are properties of scale, concurrency, and consequence — and a
project with one user has none of the three.
:::

## Why they are still here

Because the progression is the point of this site. These are where I learned to build
the things, and the production work is where I learned what building them actually
costs. Presenting only the second half would suggest I arrived knowing it.
