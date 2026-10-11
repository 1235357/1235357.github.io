"""Publication boundary controls over tiny static fixtures; no real model run."""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parent / "scripts" / "release-manifest.py"
SPEC = importlib.util.spec_from_file_location("release_manifest", SCRIPT)
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class ReleaseBoundaryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.dist = self.root / "dist"
        self.dist.mkdir()
        for name in release.REQUIRED:
            path = self.dist / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"controlled static fixture")
        (self.dist / "browser-rag/inspector.html").write_text(
            '<script type="module" src="pdf-public-entry.mjs"></script>', encoding="utf-8")
        (self.dist / "browser-rag/acceptance/generator-probe-assets.json").write_text(
            json.dumps(release.assets.qwen_registry()), encoding="utf-8")
        self.addCleanup(patch.stopall)
        patch.object(release, "ROOT", self.root).start()
        patch.object(release, "DIST", self.dist).start()
        body = b"controlled static fixture"
        patch.object(release, "PINNED_ASSETS", {name: {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
                                               for name in release.PINNED_ASSETS}).start()

    def test_records_actual_files_and_static_only_scope(self):
        release.main()
        receipt = json.loads((self.root / "release-manifest.json").read_text())
        self.assertEqual(receipt["fileCount"], len(release.REQUIRED) + 1)
        self.assertEqual(receipt["totalBytes"], sum(p.stat().st_size for p in self.dist.rglob("*") if p.is_file()))
        self.assertIn("no GPU", receipt["scope"])

    def test_refuses_reader_documents_and_private_archives(self):
        for name in ("reader.pdf", "private.docx", "slides.pptx",
                     "browser-rag/acceptance/native-receipt.json", "docs/private.md",
                     ".env.production", "browser-rag/pdf-private-entry.mjs",
                     ".archify/local.json", "figures/x.archify.delivery.json",
                     "figures/x.source-audit.json", "figures/x.strict-check.json"):
            with self.subTest(name=name):
                path = self.dist / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"must remain local")
                try:
                    with self.assertRaises(ValueError):
                        release.main()
                    self.assertFalse((self.root / "release-manifest.json").exists())
                finally:
                    path.unlink()

    def test_refuses_incomplete_or_disabled_public_entry(self):
        required = self.dist / "browser-rag/financial-generation.worker.mjs"
        required.unlink()
        with self.assertRaisesRegex(ValueError, "complete public entry"):
            release.main()
        required.write_bytes(b"controlled static fixture")
        (self.dist / "browser-rag/inspector.html").write_text('<script src="pdf-entry.mjs"></script>')
        with self.assertRaisesRegex(ValueError, "public entry"):
            release.main()
        (self.dist / "browser-rag/inspector.html").write_text(
            '<!-- pdf-public-entry.mjs --><script type="module" src="pdf-entry.mjs"></script>')
        with self.assertRaisesRegex(ValueError, "public entry"):
            release.main()

    def test_refuses_hard_links_and_size_overrun(self):
        source = self.dist / "index.html"
        linked = self.dist / "linked.html"
        os.link(source, linked)
        with self.assertRaisesRegex(ValueError, "hard-linked"):
            release.main()
        linked.unlink()
        with patch.object(release, "LIMIT_BYTES", 1):
            with self.assertRaisesRegex(ValueError, "1 GB"):
                release.main()

    def test_refuses_missing_and_same_size_corrupt_weight(self):
        name = next(name for name in release.PINNED_ASSETS if name.endswith("model_q4.onnx"))
        weight = self.dist / name
        weight.unlink()
        with self.assertRaisesRegex(ValueError, "complete public entry"):
            release.main()
        weight.write_bytes(b"X" * len(b"controlled static fixture"))
        with self.assertRaisesRegex(ValueError, "immutable publication pins"):
            release.main()

    def test_refuses_registry_descriptor_change(self):
        path = self.dist / "browser-rag/acceptance/generator-probe-assets.json"
        registry = json.loads(path.read_text())
        registry["revision"] = "changed-after-build"
        path.write_text(json.dumps(registry))
        with self.assertRaisesRegex(ValueError, "registry differs"):
            release.main()


if __name__ == "__main__":
    unittest.main()
