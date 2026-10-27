#!/usr/bin/env python3
"""Reproduce full objc2-family license supplements from locked local Cargo sources."""

import json
from pathlib import Path

from bundle_macos import PACKAGING, digest, run, write_json


def main():
    metadata = json.loads(run("cargo", "metadata", "--locked", "--offline", "--format-version", "1",
                              "--filter-platform", "aarch64-apple-darwin").stdout)
    source = next(p for p in metadata["packages"]
                  if p["name"] == "raw-window-handle" and p["version"] == "0.6.2")
    source_root = Path(source["manifest_path"]).parent
    licenses = PACKAGING / "licenses"
    terms = {}
    for spdx, start in (("MIT", "Permission is hereby granted"),
                        ("ZLIB", "This software is provided"), ("APACHE", "Apache License")):
        path = source_root / f"LICENSE-{spdx}.md"
        original = path.read_text()
        text = original[original.index(start):].strip() + "\n"
        output = licenses / f"objc2-terms-{spdx}.txt"
        output.write_text(text)
        terms[spdx] = {"file": output.name, "sha256": digest(output),
                       "source_package": "raw-window-handle@0.6.2",
                       "source_file": path.name, "source_sha256": digest(path),
                       "extraction": f"From '{start}' through end; omit donor copyright header."}
    sources = json.loads((licenses / "sources.json").read_text())
    for item in sources:
        if item["file"] == "block2-0.6.2-LICENSE.md":
            package = next(p for p in metadata["packages"]
                           if p["name"] + "@" + p["version"] == item["package"])
            selected = ("MIT",) if package["license"] == "MIT" else ("MIT", "ZLIB", "APACHE")
            item["license_texts"] = [terms[key] for key in selected]
            item["note"] = ("Upstream licensing note preserved. Full standard terms reproduced from "
                            "locked local sources; package author/license declarations accompany the "
                            "texts in the bundle. No copyright owner or year invented.")
    write_json(licenses / "sources.json", sources)


if __name__ == "__main__":
    main()
