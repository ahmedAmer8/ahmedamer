#!/usr/bin/env python3
"""Static site generator for ahmedamer.

Reads markdown + YAML frontmatter from content/, renders through Jinja2
templates, writes dist/. Relationships between entries are declared by slug in
frontmatter and validated here, so a broken internal link fails the build
instead of shipping.

    python build.py            build into dist/
    python build.py --check    validate content only, write nothing
    python build.py --serve    build, then serve dist/ on :8000
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path

import yaml
from jinja2 import Environment, FileSystemLoader, StrictUndefined
from markdown_it import MarkdownIt
from pygments import highlight
from pygments.formatters import HtmlFormatter
from pygments.lexers import get_lexer_by_name
from pygments.util import ClassNotFound

ROOT = Path(__file__).parent
CONTENT = ROOT / "content"
DIST = ROOT / "dist"

SITE = yaml.safe_load((CONTENT / "meta" / "site.yml").read_text())
BASE = SITE["base_path"].rstrip("/")

COLLECTIONS = ("projects", "lessons", "notes", "experience")
STATUSES = ("fixed", "unfixed", "unresolved", "ongoing", "shipped", "archived")
CATEGORIES = (
    "incident", "discovery", "failed-experiment", "trade-off",
    "methodology", "infrastructure", "cost", "latency", "data-integrity",
    "deployment", "ai-agent-behavior",
)
TRACE_STAGES = (
    "observation", "assumption", "probe", "dead-end",
    "root-cause", "fix", "verification",
)


class ContentError(Exception):
    pass


# --------------------------------------------------------------------------
# Markdown
# --------------------------------------------------------------------------

_FORMATTER = HtmlFormatter(nowrap=True)


def _highlight(code: str, lang: str, _attrs) -> str:
    try:
        lexer = get_lexer_by_name(lang)
    except ClassNotFound:
        return f'<pre class="code"><code>{html.escape(code)}</code></pre>'
    body = highlight(code, lexer, _FORMATTER)
    label = f'<span class="code-lang">{html.escape(lang)}</span>'
    return f'<pre class="code" data-lang="{html.escape(lang)}">{label}<code>{body}</code></pre>'


MD = MarkdownIt("commonmark", {"highlight": _highlight, "typographer": True})
MD.enable(["table", "strikethrough", "replacements", "smartquotes"])

# ::: kind [title] ... ::: -> a semantic callout block
_CALLOUT_OPEN = re.compile(r"^:::\s*([a-z-]+)(?:\s+(.*))?\s*$")


def _render_callouts(text: str) -> str:
    """Expand ::: containers, rendering their bodies recursively."""
    lines = text.split("\n")
    out, i = [], 0
    while i < len(lines):
        m = _CALLOUT_OPEN.match(lines[i])
        if not m:
            out.append(lines[i])
            i += 1
            continue
        kind, title = m.group(1), (m.group(2) or "").strip()
        depth, body, i = 1, [], i + 1
        while i < len(lines):
            if _CALLOUT_OPEN.match(lines[i]):
                depth += 1
            elif lines[i].strip() == ":::":
                depth -= 1
                if depth == 0:
                    i += 1
                    break
            body.append(lines[i])
            i += 1
        head = f'<p class="callout-title">{html.escape(title)}</p>' if title else ""
        inner = render_markdown("\n".join(body))
        out.append(f'<aside class="callout callout--{kind}">{head}{inner}</aside>')
    return "\n".join(out)


def render_markdown(text: str) -> str:
    if not text or not text.strip():
        return ""
    if ":::" in text:
        text = _render_callouts(text)
    out = MD.render(text)
    # Wrap Arabic runs so the Arabic face and direction apply.
    out = re.sub(
        r"([؀-ۿݐ-ݿ][؀-ۿݐ-ݿ\s،؟،؛?!.\d]*)",
        lambda m: f'<span class="ar" lang="ar" dir="rtl">{m.group(1)}</span>',
        out,
    )
    return out


# --------------------------------------------------------------------------
# Content model
# --------------------------------------------------------------------------

@dataclass
class Entry:
    slug: str
    kind: str
    meta: dict
    body: str
    source: Path
    html: str = ""
    trace: list = field(default_factory=list)

    def __getattr__(self, name):
        try:
            return self.__dict__["meta"][name]
        except KeyError:
            raise AttributeError(name) from None

    def get(self, name, default=None):
        return self.meta.get(name, default)

    @property
    def url(self) -> str:
        return f"{BASE}/{self.kind}/{self.slug}/"

    @property
    def date(self):
        return self.meta.get("date")

    @property
    def is_open(self) -> bool:
        return self.meta.get("status") in ("unfixed", "unresolved")

    @property
    def reading_minutes(self) -> int:
        return max(1, round(len(self.body.split()) / 220))


_FM = re.compile(r"^---\n(.*?)\n---\n?(.*)$", re.S)


def parse_entry(path: Path, kind: str) -> Entry:
    raw = path.read_text(encoding="utf-8")
    m = _FM.match(raw)
    if not m:
        raise ContentError(f"{path}: missing YAML frontmatter")
    try:
        meta = yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError as exc:
        raise ContentError(f"{path}: invalid frontmatter — {exc}") from None
    if not isinstance(meta, dict):
        raise ContentError(f"{path}: frontmatter must be a mapping")
    slug = meta.get("slug") or path.stem
    return Entry(slug=slug, kind=kind, meta=meta, body=m.group(2), source=path)


def load_all() -> dict:
    entries, errors = {k: [] for k in COLLECTIONS}, []
    for kind in COLLECTIONS:
        d = CONTENT / kind
        if not d.exists():
            continue
        for path in sorted(d.glob("*.md")):
            try:
                entry = parse_entry(path, kind)
            except ContentError as exc:
                errors.append(str(exc))
                continue
            if entry.get("draft"):
                continue
            entries[kind].append(entry)
    return entries, errors


def validate(entries: dict, taxonomy: dict) -> list:
    errors = []
    by_slug = {}
    for kind, items in entries.items():
        for e in items:
            key = (kind, e.slug)
            if key in by_slug:
                errors.append(f"duplicate slug {kind}/{e.slug}")
            by_slug[key] = e

    known_tech = set(taxonomy["technologies"])
    known_topic = set(taxonomy["topics"])

    for kind, items in entries.items():
        for e in items:
            where = f"{e.source.relative_to(ROOT)}"
            for req in ("title", "summary"):
                if not e.get(req):
                    errors.append(f"{where}: missing required field '{req}'")
            status = e.get("status")
            if status and status not in STATUSES:
                errors.append(f"{where}: unknown status '{status}' (expected one of {', '.join(STATUSES)})")
            cat = e.get("category")
            if cat and cat not in CATEGORIES:
                errors.append(f"{where}: unknown category '{cat}'")
            for rel_kind, field_name in (("projects", "projects"), ("lessons", "lessons"),
                                         ("notes", "notes")):
                for ref in e.get(field_name, []) or []:
                    if (rel_kind, ref) not in by_slug:
                        errors.append(f"{where}: {field_name} -> unknown {rel_kind}/{ref}")
            for t in e.get("technologies", []) or []:
                if t not in known_tech:
                    errors.append(f"{where}: unknown technology '{t}' (add it to content/meta/technologies.yml)")
            for t in e.get("topics", []) or []:
                if t not in known_topic:
                    errors.append(f"{where}: unknown topic '{t}' (add it to content/meta/topics.yml)")
            for i, step in enumerate(e.get("trace", []) or []):
                if step.get("stage") not in TRACE_STAGES:
                    errors.append(f"{where}: trace[{i}] unknown stage '{step.get('stage')}'")
                if not step.get("label"):
                    errors.append(f"{where}: trace[{i}] missing label")
    return errors


# --------------------------------------------------------------------------
# Derived structures
# --------------------------------------------------------------------------

def build_index(entries, taxonomy):
    """Everything the templates and the client-side search need."""
    by_slug = {(k, e.slug): e for k, items in entries.items() for e in items}

    back = {}
    for kind, items in entries.items():
        for e in items:
            for ref in e.get("projects", []) or []:
                back.setdefault(("projects", ref), {}).setdefault(kind, []).append(e)
            for ref in e.get("lessons", []) or []:
                back.setdefault(("lessons", ref), {}).setdefault(kind, []).append(e)
            for ref in e.get("notes", []) or []:
                back.setdefault(("notes", ref), {}).setdefault(kind, []).append(e)

    tech_use, topic_use = {}, {}
    for kind, items in entries.items():
        for e in items:
            for t in e.get("technologies", []) or []:
                tech_use.setdefault(t, []).append(e)
            for t in e.get("topics", []) or []:
                topic_use.setdefault(t, []).append(e)

    return {"by_slug": by_slug, "backlinks": back,
            "tech_use": tech_use, "topic_use": topic_use, "taxonomy": taxonomy}


def search_index(entries, idx):
    docs = []
    for kind, items in entries.items():
        for e in items:
            text = re.sub(r"[#*`>\[\]()_\-]+", " ", e.body)
            text = re.sub(r"\s+", " ", text).strip()
            docs.append({
                "t": e.title, "u": e.url, "k": kind,
                "s": e.get("summary", ""),
                "st": e.get("status", ""),
                "c": e.get("category", ""),
                "p": e.get("principle", ""),
                "tg": (e.get("technologies") or []) + (e.get("topics") or []),
                "b": text[:1600],
            })
    terms = []
    for name, users in idx["tech_use"].items():
        label = idx["taxonomy"]["technologies"].get(name, {}).get("label", name)
        terms.append({"t": label, "u": f"{BASE}/map/#tech-{name}", "k": "technology",
                      "s": f"Used in {len(users)} entries",
                      "st": "", "c": "", "p": "", "tg": [],
                      "rel": [{"t": e.title, "u": e.url, "k": e.kind} for e in users[:6]]})
    for name, users in idx["topic_use"].items():
        label = idx["taxonomy"]["topics"].get(name, {}).get("label", name)
        terms.append({"t": label, "u": f"{BASE}/map/#topic-{name}", "k": "topic",
                      "s": f"{len(users)} entries", "st": "", "c": "", "p": "", "tg": [],
                      "rel": [{"t": e.title, "u": e.url, "k": e.kind} for e in users[:6]]})
    return docs + terms


def graph_data(entries, idx):
    nodes, links = [], []
    seen = set()

    def add(nid, label, group, url=None, weight=1, status=""):
        if nid in seen:
            return
        seen.add(nid)
        nodes.append({"id": nid, "label": label, "group": group,
                      "url": url, "w": weight, "status": status})

    for e in entries["projects"]:
        add(f"projects/{e.slug}", e.title, "project", e.url, 4, e.get("status", ""))
    for e in entries["lessons"]:
        add(f"lessons/{e.slug}", e.title, "lesson", e.url, 2, e.get("status", ""))
    for e in entries["notes"]:
        add(f"notes/{e.slug}", e.title, "note", e.url, 2, e.get("status", ""))
    for name, users in idx["tech_use"].items():
        label = idx["taxonomy"]["technologies"].get(name, {}).get("label", name)
        add(f"tech/{name}", label, "technology", None, 1 + len(users) * 0.3)
    for name, users in idx["topic_use"].items():
        label = idx["taxonomy"]["topics"].get(name, {}).get("label", name)
        add(f"topic/{name}", label, "topic", None, 1 + len(users) * 0.3)

    for kind, items in entries.items():
        if kind == "experience":
            continue
        for e in items:
            src = f"{kind}/{e.slug}"
            for ref in e.get("projects", []) or []:
                links.append({"s": src, "t": f"projects/{ref}", "k": "belongs"})
            for ref in e.get("lessons", []) or []:
                links.append({"s": src, "t": f"lessons/{ref}", "k": "relates"})
            for t in e.get("technologies", []) or []:
                links.append({"s": src, "t": f"tech/{t}", "k": "uses"})
            for t in e.get("topics", []) or []:
                links.append({"s": src, "t": f"topic/{t}", "k": "about"})
    links = [l for l in links if l["s"] in seen and l["t"] in seen]
    return {"nodes": nodes, "links": links}


# --------------------------------------------------------------------------
# Render
# --------------------------------------------------------------------------

def make_env():
    env = Environment(
        loader=FileSystemLoader(ROOT / "templates"),
        autoescape=True,
        undefined=StrictUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.filters["markdown"] = lambda t: render_markdown(t or "")
    env.filters["inline_md"] = lambda t: re.sub(r"</?p>", "", render_markdown(t or "")).strip()

    def fmt_date(d, style="long"):
        if not d:
            return ""
        if isinstance(d, str):
            try:
                d = dt.date.fromisoformat(d)
            except ValueError:
                return d
        return d.strftime("%B %Y") if style == "month" else d.strftime("%-d %B %Y")

    env.filters["date"] = fmt_date
    env.filters["iso"] = lambda d: d.isoformat() if hasattr(d, "isoformat") else (d or "")
    env.globals.update(site=SITE, base=BASE, now=dt.date.today())
    return env


def write(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def build(check_only=False):
    taxonomy = {
        "technologies": yaml.safe_load((CONTENT / "meta" / "technologies.yml").read_text()),
        "topics": yaml.safe_load((CONTENT / "meta" / "topics.yml").read_text()),
    }
    entries, errors = load_all()
    errors += validate(entries, taxonomy)
    if errors:
        print(f"\n  {len(errors)} content error(s):\n", file=sys.stderr)
        for e in errors:
            print(f"    {e}", file=sys.stderr)
        print(file=sys.stderr)
        return 1

    for kind, items in entries.items():
        for e in items:
            e.html = render_markdown(e.body)
            for step in e.get("trace", []) or []:
                step["body_html"] = render_markdown(step.get("body", ""))
                step["evidence_html"] = render_markdown(step.get("evidence", ""))

    idx = build_index(entries, taxonomy)

    def by_date(items):
        return sorted(items, key=lambda e: (e.date or dt.date.min), reverse=True)

    lessons = by_date(entries["lessons"])
    notes = by_date(entries["notes"])
    projects = sorted(entries["projects"], key=lambda e: e.get("weight", 50))
    experience = sorted(entries["experience"], key=lambda e: e.get("weight", 50))

    if check_only:
        total = sum(len(v) for v in entries.values())
        print(f"  content ok — {total} entries "
              f"({len(projects)} projects, {len(lessons)} lessons, "
              f"{len(notes)} notes, {len(experience)} roles)")
        return 0

    env = make_env()
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)
    shutil.copytree(ROOT / "static", DIST / "static")

    ctx = dict(projects=projects, lessons=lessons, notes=notes,
               experience=experience, idx=idx, taxonomy=taxonomy,
               open_lessons=[e for e in lessons if e.is_open])

    pages = [
        ("index.html", "home.html", {}),
        ("work/index.html", "work.html", {}),
        ("lessons/index.html", "lessons.html", {}),
        ("notes/index.html", "notes.html", {}),
        ("map/index.html", "map.html", {}),
        ("experience/index.html", "experience.html", {}),
        ("about/index.html", "about.html", {}),
        ("resume/index.html", "resume.html", {}),
        ("contact/index.html", "contact.html", {}),
        ("colophon/index.html", "colophon.html", {}),
        ("404.html", "404.html", {}),
    ]
    urls = []
    for out, tpl, extra in pages:
        page_url = f"{BASE}/" + ("" if out == "index.html" else out.replace("index.html", ""))
        write(DIST / out, env.get_template(tpl).render(
            page_url=page_url, **ctx, **extra))
        if not out.endswith("404.html"):
            urls.append(page_url)

    templates = {"lessons": "lesson.html", "projects": "project.html",
                 "notes": "note.html", "experience": "role.html"}
    for kind, tpl in templates.items():
        for e in entries[kind]:
            related = idx["backlinks"].get((kind, e.slug), {})
            write(DIST / kind / e.slug / "index.html",
                  env.get_template(tpl).render(entry=e, related=related,
                                               page_url=e.url, **ctx))
            urls.append(e.url)

    write(DIST / "search-index.json", json.dumps(search_index(entries, idx), separators=(",", ":")))
    write(DIST / "graph.json", json.dumps(graph_data(entries, idx), separators=(",", ":")))
    write(DIST / "static/css/pygments.css", HtmlFormatter().get_style_defs(".code code"))

    origin = SITE["origin"].rstrip("/")
    sitemap = ['<?xml version="1.0" encoding="UTF-8"?>',
               '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for u in urls:
        sitemap.append(f"  <url><loc>{origin}{u}</loc></url>")
    sitemap.append("</urlset>")
    write(DIST / "sitemap.xml", "\n".join(sitemap))
    write(DIST / "robots.txt", f"User-agent: *\nAllow: /\nSitemap: {origin}{BASE}/sitemap.xml\n")
    write(DIST / ".nojekyll", "")

    print(f"  built {len(urls)} pages -> dist/")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="validate content, write nothing")
    ap.add_argument("--serve", action="store_true", help="build then serve on :8000")
    args = ap.parse_args()
    code = build(check_only=args.check)
    if code == 0 and args.serve:
        import http.server, os, socketserver
        os.chdir(DIST)
        socketserver.TCPServer.allow_reuse_address = True
        with socketserver.TCPServer(("", 8000), http.server.SimpleHTTPRequestHandler) as s:
            print(f"  serving http://localhost:8000{BASE}/")
            s.serve_forever()
    sys.exit(code)
