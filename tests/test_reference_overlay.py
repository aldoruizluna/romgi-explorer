"""Synthetic source facts, stale-order rejection and pinned-cache publication."""
import copy
import gzip
import json
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import reference as R


class OverlayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.art = ["Mock%20Console/Named_Boxarts/Sample%20(USA).png", ""]
        self.platforms, self.roms = ["mock", "mock"], ["", ""]
        self.dataset = {"entries": {"n": 2, "platform": [0, 0], "rom": self.roms}, "dims": {"platforms": [{"id": "mock"}]}}
        for field, value in [("genre", "Action"), ("developer", "Example Studio"), ("publisher", "Example Publisher"), ("releaseyear", "1998"), ("releasemonth", "3"), ("maxusers", "2")]:
            folder = self.root / field
            folder.mkdir()
            key = R.FIELD_OF[field]
            (folder / "Mock Console.dat").write_text(f'game (\n comment "Sample (USA)"\n {key} "{value}"\n)\n')

    def build(self):
        return R.build(self.art, self.platforms, self.roms, self.root)

    def test_exact_match_has_facts_and_unmatched_entry_stays_unknown(self):
        meta = self.build()
        self.assertEqual(meta["cols"]["year"], [1998, 0])
        self.assertEqual(meta["cols"]["month"], [3, 0])
        self.assertEqual(meta["dims"]["dev"], ["Example Studio"])
        self.assertEqual(meta["cols"]["dev"], [1, 0])
        self.assertEqual(meta["stats"]["covered"], 1)
        self.assertEqual(R.validate_overlay(meta, self.dataset, self.art), meta["catalogue_key"])

    def test_same_entry_count_with_different_order_or_serial_is_rejected(self):
        meta = self.build()
        with self.assertRaisesRegex(ValueError, "order"):
            R.validate_overlay(meta, self.dataset, list(reversed(self.art)))
        altered = copy.deepcopy(self.dataset)
        altered["entries"]["rom"][0] = "SLUS-99999"
        with self.assertRaisesRegex(ValueError, "order"):
            R.validate_overlay(meta, altered, self.art)

    def test_missing_columns_and_invalid_facts_are_rejected(self):
        for field, value in [("year", 1930), ("month", 13), ("dev", 99), ("players", True)]:
            with self.subTest(field=field):
                meta = self.build()
                meta["cols"][field][0] = value
                with self.assertRaises(ValueError):
                    R.validate_overlay(meta, self.dataset, self.art)
        with self.assertRaises(ValueError):
            R.build(self.art, ["mock"], self.roms, self.root)

    def test_reference_provenance_and_binding_survive_the_stream(self):
        meta = self.build()
        rows = [json.loads(line) for line in R.ndjson(meta).decode().splitlines()]
        headers = {key: value for key, section, value, *rest in rows if section is None}
        self.assertEqual(headers["catalogue_key"], meta["catalogue_key"])
        self.assertEqual(headers["source"], R.SOURCE)
        self.assertEqual(headers["v"], 1)

    def test_fetch_cli_uses_a_commit_scoped_cache_and_never_adopts_legacy_files(self):
        art_file = self.root / "art.gz"
        art_file.write_bytes(gzip.compress(json.dumps(self.art).encode()))
        cache = self.root / "cache"
        legacy = cache / "genre" / "Mock Console.dat"
        legacy.parent.mkdir(parents=True)
        legacy.write_text("legacy data must not become pinned provenance")
        with patch.object(sys, "argv", ["reference.py", "fetch", "--art", str(art_file), "--out", str(cache)]), patch.object(R, "get", return_value=b'game ( comment "Sample (USA)" genre "Action" )'):
            self.assertEqual(R.main(), 0)
        self.assertTrue((cache / R.LIBRETRO_COMMIT / "genre" / "Mock Console.dat").exists())
        self.assertEqual(legacy.read_text(), "legacy data must not become pinned provenance")

    def test_failed_fetch_does_not_publish_partial_reference_data(self):
        with patch.object(R, "get", side_effect=OSError("synthetic unavailable source")):
            with self.assertRaisesRegex(RuntimeError, "no partial"):
                R.fetch(["Mock Console"], self.root / "failed")

    def test_a_system_name_cannot_read_outside_the_reference_directory(self):
        paths = ["../Named_Boxarts/x.png", "a/b/Named_Boxarts/x.png", "a%5Cb/Named_Boxarts/x.png"]
        self.assertEqual(R.entry_names(paths), [None] * len(paths))
        self.assertEqual(R.systems_of(paths), [])

    def test_bundle_binds_the_overlay_and_keeps_it_optional_offline(self):
        ds = copy.deepcopy(self.dataset)
        ds["meta"] = {"version": "fixture", "built_at": "2026-10-30T00:00:00Z"}
        ds["dims"]["sources"] = []
        ds["links"] = {"n": 0}
        paths = [self.root / name for name in ("dataset.gz", "art.gz", "meta.gz")]
        for path, value in zip(paths, [ds, self.art, self.build()]):
            path.write_bytes(gzip.compress(json.dumps(value).encode()))
        site = self.root / "site"
        command = [sys.executable, str(Path(R.__file__).with_name("bundle.py")), "--pages", "--dataset", str(paths[0]), "--art", str(paths[1]), "--reference", str(paths[2]), "--out-dir", str(site)]
        subprocess.run(command, check=True, capture_output=True)
        version = json.loads((site / "version.json").read_text())
        self.assertTrue((site / version["reference"]).is_file())
        worker = (site / "sw.js").read_text()
        self.assertIn(version["reference"], worker)
        self.assertIn(self.build()["catalogue_key"], (site / "index.html").read_text())
        original = (site / "index.html").read_bytes()
        paths[1].write_bytes(gzip.compress(json.dumps(list(reversed(self.art))).encode()))
        failed = subprocess.run(command, capture_output=True, text=True)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("order", failed.stderr)
        self.assertEqual((site / "index.html").read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
