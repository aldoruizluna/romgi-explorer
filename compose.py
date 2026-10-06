"""Assemble the explorer page from web/ (template + css + js). Shared by serve.py and bundle.py."""
from __future__ import annotations

import html
import json
from pathlib import Path

import pwa

WEB = Path(__file__).resolve().parent / "web"

GOOGLE_FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700'
    '&family=JetBrains+Mono:wght@400;500;600&family=Pixelify+Sans:wght@500;700&display=swap">\n')


def self_hosted_fonts() -> str:
    """Same typefaces served from this site: no third-party request, and preloaded so the first paint already uses them."""
    css = (WEB / "fonts" / "fonts.css").read_text(encoding="utf-8")
    links = "".join(f'<link rel="preload" href="fonts/{p.name}" as="font" type="font/woff2" crossorigin>\n'
                    for p in sorted((WEB / "fonts").glob("*.woff2")))
    return links + f"<style>\n{css}</style>\n"

FAVICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' shape-rendering='crispEdges'%3E"
           "%3Cpath fill='%233987e5' fill-rule='evenodd' d='M3 1h10v1h1v1h1v10h-1v1h-1v1H3v-1H2v-1H1V3h1V2h1V1zm1 2v1H3v8h1v1h8v-1h1V4h-1V3H4z'/%3E"
           "%3Cpath fill='%233987e5' d='M4 4h2v2H4zm6 0h2v2h-2zM7 7h2v2H7zm-3 3h2v2H4zm6 0h2v2h-2z'/%3E%3C/svg%3E")
ROBOTS = '<meta name="robots" content="noindex, nofollow">'

STANDALONE_HEAD = (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
    f'<link rel="icon" href="{FAVICON}">'
    "<style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}"
    "body{margin:0;font:14px system-ui,sans-serif;background:#f9f9f7}img{max-width:100%}[hidden]{display:none!important}</style>"
    "</head><body>"
)


def read_parts():
    css = "\n".join(p.read_text(encoding="utf-8") for p in sorted((WEB / "css").glob("*.css")))
    js = "\n".join(p.read_text(encoding="utf-8") for p in sorted((WEB / "js").glob("*.js")))
    return (WEB / "index.html").read_text(encoding="utf-8"), css, js


def og_meta(site_url: str) -> str:
    """Description and link-preview tags (the social card is web/og/og.png). They work even though the page asks not to be indexed."""
    u = html.escape(site_url, quote=True)
    desc = "Every release and every link in the romgi ROM catalogue, sliceable and pivotable."
    return (f'<meta name="description" content="{desc}"><meta property="og:type" content="website">'
            f'<meta property="og:title" content="romgi catalogue explorer"><meta property="og:description" content="{desc}">'
            f'<meta property="og:url" content="{u}"><meta property="og:image" content="{u}og.png">'
            f'<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
            f'<meta name="twitter:card" content="summary_large_image">')


def hero_html(h: dict) -> str:
    """The numbers a visitor sees while the catalogue is still downloading: plain HTML, painted with the first bytes. The numbers are also
    attributes, so the small script that settles the language (web/lang/boot.js) can write the headline in Spanish before anything else runs."""
    n = lambda k: f"{int(h[k]):,}"
    v = html.escape(str(h.get("version", "")), quote=True)
    return (f'      <div class="lhero" data-entries="{int(h["entries"])}" data-platforms="{int(h["platforms"])}" data-links="{int(h["links"])}" '
            f'data-sources="{int(h["sources"])}" data-version="{v}"><div class="lh-big">{n("entries")}</div>'
            f'<div class="lh-cap">releases across {n("platforms")} platforms, offered through {n("links")} links from {n("sources")} sources</div>'
            f'<div class="lh-snap">snapshot {v}</div></div>\n')


def compose(mode: str, data_b64: str = "", standalone: bool = False, pages: bool = False,
            data_url: str = "", hero: dict | None = None, art_url: str = "", site_url: str = "", sql: dict | None = None, data_bytes: int = 0,
            detail_url: str = "", detail_bytes: int = 0, built_at: str = "", latest: dict | None = None, lang_urls: dict | None = None) -> str:
    """mode: 'local' (talks to serve.py) or 'snapshot' (dataset embedded, or fetched from data_url).
    Fragment form is what the Artifact tool wants; pages=True adds noindex, serves the fonts from the site and makes it installable."""
    tpl, css, js = read_parts()
    js = js.replace("</script", "<\\/script")
    lang_urls = lang_urls or {}
    boot = (WEB / "lang" / "boot.js").read_text(encoding="utf-8").replace("/*@LANGURL@*/", html.escape(lang_urls.get("es", ""), quote=True))
    # one file per language on the hosted site (fetched only by the people who need it); inline everywhere else, where there is nothing to fetch
    dictionary = "" if lang_urls else "<script>\n" + (WEB / "lang" / "es.js").read_text(encoding="utf-8").replace("</script", "<\\/script") + "</script>\n"
    out = (tpl.replace("<!--@FONTS@-->", self_hosted_fonts() if pages else GOOGLE_FONTS)
           .replace("/*@CSS@*/", css).replace("/*@MODE@*/", mode).replace("/*@DATAURL@*/", html.escape(data_url, quote=True)).replace("/*@ARTURL@*/", html.escape(art_url, quote=True))
           .replace("/*@DATABYTES@*/0", str(int(data_bytes))).replace("/*@DETAILURL@*/", html.escape(detail_url, quote=True))
           .replace("/*@DETAILBYTES@*/0", str(int(detail_bytes))).replace("/*@BUILTAT@*/", html.escape(built_at or "", quote=True))
           .replace("/*@LATEST@*/null", json.dumps(latest).replace("</", "<\\/") if latest else "null")
           .replace("/*@SQL@*/null", json.dumps(sql).replace("</", "<\\/") if sql else "null")
           .replace("<!--@HERO@-->", hero_html(hero) if hero else "")
           .replace("<!--@LANGDICT@-->", dictionary).replace("/*@LANGBOOT@*/", boot)
           .replace("/*@DATA@*/", data_b64).replace("/*@JS@*/", js + "\nboot();"))
    head = STANDALONE_HEAD
    if pages:
        head = head.replace("<style>", ROBOTS + (og_meta(site_url) if site_url else "") + pwa.head_tags() + "<style>", 1)
    return head + out + "</body></html>" if standalone else out
