"""Download self-hosted woff2 subsets from Google Fonts. Run once; output is committed."""
import re, pathlib, urllib.request

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")
OUT = pathlib.Path("static/fonts")
OUT.mkdir(parents=True, exist_ok=True)

FAMILIES = [
    ("newsreader", "Newsreader:ital,opsz,wght@0,6..72,300..700;1,6..72,300..500", {"latin"}),
    ("plexmono", "IBM+Plex+Mono:wght@400;500;600", {"latin"}),
    ("plexarabic", "IBM+Plex+Sans+Arabic:wght@400;600", {"arabic"}),
]

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=60).read()

faces = []
for slug, query, wanted in FAMILIES:
    css = fetch(f"https://fonts.googleapis.com/css2?family={query}&display=swap").decode()
    n = 0
    for block in css.split("@font-face")[1:]:
        subset = re.search(r"/\*\s*([a-z0-9\-\[\]]+)\s*\*/", block)
        subset = subset.group(1) if subset else "?"
        if subset not in wanted:
            continue
        url = re.search(r"url\((https://[^)]+\.woff2)\)", block).group(1)
        style = "italic" if "font-style: italic" in block else "normal"
        weight = re.search(r"font-weight:\s*([^;]+);", block).group(1).strip()
        stretch = re.search(r"font-stretch:\s*([^;]+);", block)
        urange = re.search(r"unicode-range:\s*([^;]+);", block).group(1).strip()
        name = f"{slug}-{style}-{weight.replace(' ', '_')}-{n}.woff2"
        (OUT / name).write_bytes(fetch(url))
        faces.append(dict(slug=slug, file=name, style=style, weight=weight,
                          stretch=stretch.group(1).strip() if stretch else None,
                          urange=urange, subset=subset))
        n += 1
    print(f"{slug}: {n} face(s)")

FAMILY_NAME = {"newsreader": "Newsreader", "plexmono": "IBM Plex Mono",
               "plexarabic": "IBM Plex Sans Arabic"}
css_out = ["/* Self-hosted subsets. Regenerate with `python fetch_fonts.py`. */"]
for f in faces:
    decl = [f'  font-family: "{FAMILY_NAME[f["slug"]]}";',
            f'  font-style: {f["style"]};',
            f'  font-weight: {f["weight"]};']
    if f["stretch"]:
        decl.append(f'  font-stretch: {f["stretch"]};')
    decl += ['  font-display: swap;',
             f'  src: url("../fonts/{f["file"]}") format("woff2");',
             f'  unicode-range: {f["urange"]};']
    css_out.append("@font-face {\n" + "\n".join(decl) + "\n}")
pathlib.Path("static/css/fonts.css").write_text("\n".join(css_out) + "\n")
print(f"\nwrote static/css/fonts.css ({len(faces)} faces)")
