# ahmedamer

My personal engineering site: a record of production systems I have worked on —
what broke, what I believed at the time, how I proved otherwise, and what was
left over worth reusing.

**https://ahmedamer8.github.io/ahmedamer/**

## How it is built

Markdown with YAML frontmatter, rendered through Jinja2 by a single `build.py`.
No framework, no bundler, no Node. Four hand-written JavaScript behaviours
(search, the trace interaction, the relationship graph, the section rail), none
of which the content depends on.

```
content/
  projects/   lessons/   notes/   experience/
  meta/       site.yml, technologies.yml, topics.yml
templates/    Jinja2
static/       css, js, self-hosted fonts
build.py      generator + content validator
```

Entries declare their relationships by slug. The graph, the search index, the
tag pages and the "see also" blocks are all derived from those declarations at
build time, so nothing is maintained by hand and nothing can point at a page
that does not exist.

## Running it

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python build.py --check    # validate content, write nothing
.venv/bin/python build.py            # build into dist/
.venv/bin/python build.py --serve    # build, then serve on :8000
```

`--check` fails on a missing required field, an unknown status or category, a
relationship pointing at a slug that does not exist, or a technology or topic
absent from the taxonomy. It runs in CI before the build.

## Adding an entry

Drop a markdown file into the matching `content/` directory:

```yaml
---
title: What happened
slug: what-happened
summary: One sentence that will appear in indexes and search.
date: 2026-09-19
status: fixed          # fixed | unfixed | unresolved | ongoing | shipped | archived
category: incident     # incident | discovery | failed-experiment | trade-off | ...
principle: The transferable version, one sentence.
projects: [conversational-commerce-platform]
technologies: [python, django]
topics: [measurement]
trace:
  - {stage: observation, label: "What was seen", weight: 2, body: "...", evidence: "..."}
  - {stage: assumption,  label: "What I believed", weight: 1, wrong: true, body: "..."}
---

Body in markdown.
```

A `trace` renders as the span waterfall readers can step through. Stages:
`observation`, `assumption`, `probe`, `dead-end`, `root-cause`, `fix`,
`verification`. `wrong: true` marks an assumption that was overturned.

Callouts use `::: kind` … `:::` — `principle`, `wrong`, `incident`, `experiment`.

## Deploying

Push to `main`. GitHub Actions validates, builds and publishes to Pages.

## Fonts

`static/fonts/` holds self-hosted woff2 subsets (Newsreader, IBM Plex Mono, IBM
Plex Sans Arabic — six faces, 252 KB). Regenerate with `python fetch_fonts.py`.
