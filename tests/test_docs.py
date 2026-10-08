"""The documentation stays connected and true. Standard library only; reads files, fetches nothing, needs no catalogue.

Links and anchors resolve, every document is in the map and in llms.txt, llms-full.txt is current, every document opens with a TL;DR and closes with a Related line, a few
claims in the README match the code (the tab shortcuts, the number of collections), TESTING.md names every test file, and, when ROMGI_PRIVATE_NAMES lists them, the public repository names no private project.

  python3 tests/test_docs.py
"""
import os, re, subprocess, sys, unittest
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
RAW = "https://raw.githubusercontent.com/aldoruizluna/romgi-explorer/main/"


def tracked(*patterns):
    r = subprocess.run(["git", "-C", str(ROOT), "ls-files", "-co", "--exclude-standard", *patterns], capture_output=True, text=True)
    if r.returncode:
        return sorted(str(p.relative_to(ROOT)) for pat in patterns for p in ROOT.rglob(pat))
    return sorted(r.stdout.split())


MD = tracked("*.md")
FENCE = re.compile(r"^(```|~~~)")
LINK = re.compile(r"(?<!\!)\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")


def strip_code(text):
    out, fenced = [], False
    for line in text.splitlines():
        if FENCE.match(line.strip()):
            fenced = not fenced
            continue
        if not fenced:
            out.append(re.sub(r"`[^`]*`", "", line))
    return "\n".join(out)


def slug(heading):
    h = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", heading)
    h = re.sub(r"[`*~]", "", h).strip().lower()
    return re.sub(r"[^\w\- ]", "", h, flags=re.UNICODE).replace(" ", "-")


def anchors(path):
    seen, out, fenced = {}, set(), False
    for line in Path(path).read_text().splitlines():
        if FENCE.match(line.strip()):
            fenced = not fenced
        if fenced:
            continue
        m = HEADING.match(line)
        if m:
            s = slug(m[2])
            n = seen.get(s, 0)
            seen[s] = n + 1
            out.add(s if n == 0 else f"{s}-{n}")
    return out


class Links(unittest.TestCase):
    def test_every_relative_link_and_anchor_resolves(self):
        bad = []
        for rel in MD:
            src = ROOT / rel
            for text, target in LINK.findall(strip_code(src.read_text())):
                if re.match(r"^(https?:|mailto:|data:)", target):
                    continue
                path, _, frag = target.partition("#")
                dest = src if not path else (src.parent / path).resolve()
                if not dest.exists():
                    bad.append(f"{rel}: [{text}]({target}) -> missing file")
                elif frag and dest.suffix == ".md" and frag not in anchors(dest):
                    bad.append(f"{rel}: [{text}]({target}) -> no heading #{frag} in {dest.name}")
        self.assertEqual(bad, [], "\n" + "\n".join(bad))


class Coverage(unittest.TestCase):
    def docs(self):
        return [p for p in MD if p.startswith("docs/") and p != "docs/INDEX.md"]

    def test_every_document_is_in_the_map(self):
        index = (ROOT / "docs/INDEX.md").read_text()
        self.assertEqual([p for p in self.docs() if Path(p).name not in index], [])

    def test_every_document_is_in_llms_txt(self):
        txt = (ROOT / "llms.txt").read_text()
        listed = {u[len(RAW):] for _, u in re.findall(r"^- \[([^\]]+)\]\(([^)]+)\)", txt, re.M) if u.startswith(RAW)}
        expected = set(self.docs() + ["README.md", "AGENTS.md", "docs/INDEX.md"])
        self.assertEqual(sorted(expected - listed), [], "llms.txt lacks these documents")
        self.assertEqual(sorted(listed - set(MD)), [], "llms.txt links files that do not exist")

    def test_llms_txt_follows_the_convention(self):
        lines = (ROOT / "llms.txt").read_text().splitlines()
        self.assertTrue(lines[0].startswith("# "))
        self.assertTrue(any(l.startswith("> ") for l in lines[:6]))
        self.assertGreaterEqual(sum(1 for l in lines if l.startswith("## ")), 3)
        self.assertTrue(all(re.match(r"^- \[[^\]]+\]\([^)]+\)(: .+)?$", l) for l in lines if l.startswith("- [")))

    def test_llms_full_is_current(self):
        r = subprocess.run([sys.executable, "-B", str(ROOT / "scripts/build-llms"), "--check"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr or "run scripts/build-llms")

    def test_claude_code_imports_agents_md(self):
        self.assertIn("@AGENTS.md", (ROOT / "CLAUDE.md").read_text())


class Shape(unittest.TestCase):
    def test_every_document_opens_with_a_tldr_and_closes_with_related(self):
        bad = []
        for rel in MD:
            if not rel.startswith("docs/"):
                continue
            lines = (ROOT / rel).read_text().strip().splitlines()
            if not any(l.startswith("> **TL;DR") for l in lines[:14]):
                bad.append(f"{rel}: no '> **TL;DR' line near the top")
            if not any(l.startswith("Related:") for l in lines[-6:]):
                bad.append(f"{rel}: no 'Related:' line at the end")
        self.assertEqual(bad, [], "\n" + "\n".join(bad))


class Truth(unittest.TestCase):
    def test_the_tab_shortcuts_in_the_readme_match_the_code(self):
        shell = (ROOT / "web/js/40-shell.js").read_text()
        keys = re.findall(r"\{ id: '[a-z]+', label: [^}]*key: '([a-z])' \}", shell.split("const DEFAULT_UI")[0])
        self.assertGreaterEqual(len(keys), 5)
        self.assertIn("`G` then `" + " ".join(k.upper() for k in keys) + "`", (ROOT / "README.md").read_text())

    def test_the_number_of_collections_in_the_readme_matches_the_code(self):
        text = (ROOT / "web/js/48-collections.js").read_text()
        n = len(re.findall(r"^  \{ id: '[a-z]+', icon:", text, re.M))
        words = {6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten"}
        self.assertIn(f"{words[n]} hand-picked collections", (ROOT / "README.md").read_text())

    def test_testing_md_names_every_test_file(self):
        doc = (ROOT / "docs/TESTING.md").read_text()
        files = sorted(p.name for p in (ROOT / "tests").iterdir() if p.is_file())
        self.assertEqual([f for f in files if f not in doc], [], "docs/TESTING.md does not mention these test files")
        for name in re.findall(r"tests/([\w.\-]+\.(?:py|js))", doc):
            self.assertTrue((ROOT / "tests" / name).exists(), f"TESTING.md names tests/{name}, which does not exist")

    def test_the_public_repository_names_no_private_project(self):
        # The names themselves are not written into this public repository: a maintainer supplies them.
        names = [n.strip().lower() for n in os.environ.get("ROMGI_PRIVATE_NAMES", "").split(",") if n.strip()]
        if not names:
            self.skipTest("set ROMGI_PRIVATE_NAMES=name1,name2 to check that no document names a private project")
        hits = [f"{rel}: {n}" for rel in MD + ["llms.txt", "llms-full.txt"] for n in names if n in (ROOT / rel).read_text().lower()]
        self.assertEqual(hits, [])

    def test_no_personal_paths_in_the_documents(self):
        hits = []
        for rel in MD + ["llms.txt"]:
            for n, line in enumerate((ROOT / rel).read_text().splitlines(), 1):
                if re.search(r"/home/(?!yourname|username|you\b)[a-z]+", line):
                    hits.append(f"{rel}:{n}")
        self.assertEqual(hits, [])


if __name__ == "__main__":
    unittest.main()
