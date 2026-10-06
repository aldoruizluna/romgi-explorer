"""Assemble the explorer page from web/ (template + css + js). Shared by serve.py and bundle.py."""
from __future__ import annotations

from pathlib import Path

WEB = Path(__file__).resolve().parent / "web"

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


def compose(mode: str, data_b64: str = "", standalone: bool = False, pages: bool = False) -> str:
    """mode: 'local' (talks to serve.py) or 'snapshot' (dataset embedded). Fragment form is what the Artifact tool wants."""
    tpl, css, js = read_parts()
    js = js.replace("</script", "<\\/script")
    out = (tpl.replace("/*@CSS@*/", css).replace("/*@MODE@*/", mode)
           .replace("/*@DATA@*/", data_b64).replace("/*@JS@*/", js + "\nboot();"))
    head = STANDALONE_HEAD.replace("<style>", ROBOTS + "<style>", 1) if pages else STANDALONE_HEAD
    return head + out + "</body></html>" if standalone else out
