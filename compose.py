"""Assemble the explorer page from web/ (template + css + js). Shared by serve.py and bundle.py."""
from __future__ import annotations

from pathlib import Path

WEB = Path(__file__).resolve().parent / "web"

STANDALONE_HEAD = (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
    "<style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}"
    "body{margin:0;font:14px system-ui,sans-serif;background:#f9f9f7}img{max-width:100%}[hidden]{display:none!important}</style>"
    "</head><body>"
)


def read_parts():
    css = "\n".join(p.read_text(encoding="utf-8") for p in sorted((WEB / "css").glob("*.css")))
    js = "\n".join(p.read_text(encoding="utf-8") for p in sorted((WEB / "js").glob("*.js")))
    return (WEB / "index.html").read_text(encoding="utf-8"), css, js


def compose(mode: str, data_b64: str = "", standalone: bool = False) -> str:
    """mode: 'local' (talks to serve.py) or 'snapshot' (dataset embedded). Fragment form is what the Artifact tool wants."""
    tpl, css, js = read_parts()
    js = js.replace("</script", "<\\/script")
    out = (tpl.replace("/*@CSS@*/", css).replace("/*@MODE@*/", mode)
           .replace("/*@DATA@*/", data_b64).replace("/*@JS@*/", js + "\nboot();"))
    return STANDALONE_HEAD + out + "</body></html>" if standalone else out
