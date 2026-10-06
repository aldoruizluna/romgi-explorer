"""The installable-app parts of the hosted site: the web app manifest and the service worker (web/sw.js). Used by bundle.py."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import icons

WEB = Path(__file__).resolve().parent / "web"
THEME = "#%02x%02x%02x" % icons.BACKGROUND      # the dark theme's background; the page keeps the meta tag in step with the theme in use
FILES_TOKEN = "/*@FILES@*/{ required: [], optional: [] }"


def manifest(description: str) -> dict:
    """Relative URLs throughout, so the app works wherever the site is hosted (a project page, a custom domain)."""
    return {
        "name": "Romgi Catalog Explorer", "short_name": "romgi", "description": description,
        "id": "./", "start_url": "./", "scope": "./", "display": "standalone", "lang": "en",
        "background_color": THEME, "theme_color": THEME, "categories": ["utilities", "games"],
        "icons": [
            {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }


def head_tags() -> str:
    """What the page's <head> needs to be installable."""
    return ('<link rel="manifest" href="manifest.webmanifest">' f'<meta name="theme-color" content="{THEME}">'
            '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">'
            '<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes">'
            '<meta name="apple-mobile-web-app-title" content="romgi">')


def service_worker(site: Path, data: str, detail: str, art: str, info: dict, stamp: str = "") -> tuple[str, dict]:
    """The worker for the site written in `site`. Returns its text and the lists it saves. Its build id changes whenever the page, the
    data, or the worker changes (a hash of all of them), so a browser that has an older one installs this and the page offers a reload.
    stamp (digits from the build time) leads the id so ids sort in the order they were built."""
    required = ["./", data, detail]
    optional = [p for p in [art, "manifest.webmanifest", "icons/icon-192.png", "icons/apple-touch-icon.png",
                            *sorted(f"fonts/{f.name}" for f in (site / "fonts").glob("*.woff2"))] if p]
    template = (WEB / "sw.js").read_text(encoding="utf-8")
    if FILES_TOKEN not in template or "/*@BUILD@*/" not in template or "/*@INFO@*/{}" not in template:
        raise SystemExit("web/sw.js lost one of its three placeholders")
    h = hashlib.sha256(template.encode())
    for p in [*required, *optional]:
        h.update(p.encode())
        h.update(hashlib.sha256((site / ("index.html" if p == "./" else p)).read_bytes()).digest())
    build = (re.sub(r"\D", "", stamp)[:14] or "0" * 14) + "-" + h.hexdigest()[:10]
    files = {"required": required, "optional": optional}
    text = (template.replace("/*@BUILD@*/", build).replace(FILES_TOKEN, json.dumps(files))
            .replace("/*@INFO@*/{}", json.dumps({**info, "build": build})))
    return text, files
