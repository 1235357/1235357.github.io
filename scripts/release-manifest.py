"""Hash an existing public build and reject accidental private distribution.

No model is executed and no asset is downloaded. CI uploads this manifest as
a separate artifact; it is not a financial accuracy or browser runtime receipt.
"""
from __future__ import annotations

import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import stat
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import browser_release_assets as assets
from site_typography_assets import TYPOGRAPHY_FILES
DIST = ROOT / "dist"
LIMIT_BYTES = 1_000_000_000
PINNED_ASSETS = {
    **{f"assets/typography/{name}": pin for name, pin in TYPOGRAPHY_FILES.items()},
    **{f"browser-rag/models/{revision}/{model}/{name}": pin
       for revision, model, pins in (
           (assets.MINILM_REVISION, assets.MINILM_MODEL_ID, assets.MINILM_MODEL_FILES),
           (assets.QWEN_REVISION, assets.QWEN_MODEL_ID, assets.QWEN_MODEL_FILES))
       for name, pin in pins.items()},
    **{f"browser-rag/vendor/transformers/{name}": pin for name, pin in assets.RUNTIME_FILES.items()},
    **{f"browser-rag/notices/{name}": {key: pin[key] for key in ("bytes", "sha256")}
       for name, pin in assets.QWEN_NOTICE_FILES.items()},
    "browser-rag/notices/MODEL-CARD.txt": assets.MINILM_CARD,
}
REQUIRED = tuple(sorted(set((
    "index.html", "07-operational-receipts.html",
    "browser-rag/pdf-public-entry.mjs",
    "browser-rag/financial-generation.worker.mjs",
    "browser-rag/financial-lookup-view.mjs",
    "browser-rag/bounded-text-view.mjs",
    "browser-rag/complete-record-disclosure.mjs",
    "browser-rag/acceptance/generator-probe-assets.json",
    "browser-rag/notices/QWEN-MODEL-CARD.txt",
    "browser-rag/notices/QWEN-LICENSE.txt",
    "browser-rag/notices/QWEN-ATTRIBUTION.txt", "SITE-LICENSE.txt",
    *("browser-rag/" + name for name in assets.PUBLIC_MODULES),
    *PINNED_ASSETS,
))))

class ModuleScripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sources = []

    def handle_starttag(self, tag, attributes):
        pairs = dict(attributes)
        if tag == "script" and pairs.get("type") == "module":
            self.sources.append(pairs.get("src"))


def main() -> None:
    if not DIST.is_dir() or DIST.is_symlink():
        raise ValueError("A regular public dist build is required")
    entries = []
    total = 0
    for path in sorted(DIST.rglob("*")):
        info = path.lstat()
        if path.is_symlink() or getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            raise ValueError("Links cannot enter the Pages artifact")
        if not path.resolve().is_relative_to(DIST.resolve()):
            raise ValueError("Distribution path escapes its root")
        if path.is_dir():
            continue
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError("Only regular, non-hard-linked distribution files are accepted")
        name = path.relative_to(DIST).as_posix()
        components = name.split("/")
        if any(part in {"node_modules", ".model-cache", "tests", "docs", ".git", ".archify"}
               or part.startswith(".env") for part in components):
            raise ValueError("Private or development directory entered distribution")
        if name.endswith((".archify.delivery.json", ".source-audit.json", ".strict-check.json")):
            raise ValueError("Local figure coordination receipt entered distribution")
        if "/acceptance/" in name and name != "browser-rag/acceptance/generator-probe-assets.json":
            raise ValueError("Only the reviewed generator pin manifest is public")
        if name.endswith("pdf-private-entry.mjs") or name.lower().endswith((".pdf", ".docx", ".pptx")):
            raise ValueError("Private entry or reader/course document entered distribution")
        digest = hashlib.sha256()
        count = 0
        with path.open("rb") as stream:
            while block := stream.read(1024 * 1024):
                digest.update(block)
                count += len(block)
        if count != info.st_size:
            raise ValueError("Distribution changed during hashing")
        total += count
        entries.append({"path": name, "bytes": count, "sha256": digest.hexdigest()})
    names = {entry["path"] for entry in entries}
    if not set(REQUIRED).issubset(names):
        raise ValueError("The complete public entry and notices are required")
    actual = {entry["path"]: {key: entry[key] for key in ("bytes", "sha256")} for entry in entries}
    if any(actual[name] != expected for name, expected in PINNED_ASSETS.items()):
        raise ValueError("Model/runtime body differs from immutable publication pins")
    registry = json.loads((DIST / "browser-rag/acceptance/generator-probe-assets.json").read_text(encoding="utf-8"))
    if registry != assets.qwen_registry():
        raise ValueError("Generator registry differs from the immutable publication contract")
    if total >= LIMIT_BYTES:
        raise ValueError("The Pages artifact exceeds the conservative 1 GB boundary")
    scripts = ModuleScripts()
    scripts.feed((DIST / "browser-rag/inspector.html").read_text(encoding="utf-8"))
    if scripts.sources != ["pdf-public-entry.mjs"]:
        raise ValueError("Inspector did not select the public entry")
    receipt = {
        "schemaVersion": 1,
        "status": "public-build-hashed",
        "commit": os.environ.get("GITHUB_SHA"),
        "scope": "Static file identity and distribution boundary; no GPU or financial quality check",
        "fileCount": len(entries), "totalBytes": total, "limitBytes": LIMIT_BYTES,
        "verifiedPinnedAssetCount": len(PINNED_ASSETS),
        "files": entries,
    }
    destination = ROOT / "release-manifest.json"
    destination.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(f"Public artifact: {len(entries)} files / {total:,} bytes; manifest written")


if __name__ == "__main__":
    main()
