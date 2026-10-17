#!/usr/bin/env python3
"""Build the four real Newsreader faces used by the native GPUI client.

Install the exact dependency from font-requirements.txt. The upright source is
the existing, unchanged Web font. Supply the official italic file with
--italic-source, or explicitly use --fetch-source to retrieve its pinned URL.
--verify regenerates in memory and compares bytes without modifying artifacts.
No application startup or Cargo build downloads or generates fonts.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import urllib.request

import fontTools
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


FONTTOOLS_VERSION = "4.61.1"
REPOSITORY = Path(__file__).resolve().parents[3]
SCRIPT_PATH = "experiments/gpui-patient-pilot/scripts/build-newsreader-native.py"
COMMIT = "8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5"
UPSTREAM_ROOT = f"https://raw.githubusercontent.com/google/fonts/{COMMIT}/ofl/newsreader/"
UPRIGHT_URL = UPSTREAM_ROOT + "Newsreader%5Bopsz%2Cwght%5D.ttf"
ITALIC_URL = UPSTREAM_ROOT + "Newsreader-Italic%5Bopsz%2Cwght%5D.ttf"
UPRIGHT_PATH = "app/fonts/Newsreader-Variable.ttf"
UPRIGHT_SHA256 = "8a08d13f8a6c0d51be379a60af84f945f65369a67e509ee3c3bdcc421254d7c1"
ITALIC_SHA256 = "796668611f80b64d5adf182fde3b6f29ed83b4e7cbec7b96937e84ac01364792"
LICENSE_PATH = "app/fonts/Newsreader-OFL.txt"
LICENSE_SHA256 = "865f0949b59fab5925506f80102dff3d12e8666412daf52d212db969d40adc25"
UPSTREAM_LICENSE_SHA256 = "fdfad38143ec470553cae82a1e45320bdd1b9ec70415d37bd0171051d8a4ded8"
MANIFEST_NAME = "Newsreader-Native.manifest.json"
FACES = (
    ("Regular", 400, False),
    ("Bold", 700, False),
    ("Italic", 400, True),
    ("BoldItalic", 700, True),
)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def checked(data: bytes, expected: str, description: str) -> bytes:
    if digest(data) != expected:
        raise ValueError(f"{description}: SHA-256 does not match the pinned input")
    return data


def fetch_italic() -> bytes:
    request = urllib.request.Request(
        ITALIC_URL, headers={"User-Agent": "Mediflow-native-font-build"}
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read(2 * 1024 * 1024 + 1)
    return checked(data, ITALIC_SHA256, "official italic source")


def rename_face(font: TTFont, suffix: str) -> None:
    style = "Bold Italic" if suffix == "BoldItalic" else suffix
    names = {
        1: "Newsreader",
        2: style,
        3: f"1.003;MediflowStatic;NewsreaderNative-{suffix}",
        4: f"Newsreader {style}",
        6: f"NewsreaderNative-{suffix}",
        16: "Newsreader",
        17: style,
        21: "Newsreader",
        22: style,
    }
    for name_id, value in names.items():
        font["name"].removeNames(nameID=name_id)
        font["name"].setName(value, name_id, 3, 1, 0x409)
        font["name"].setName(value, name_id, 1, 0, 0)


def outline_digest(font: TTFont) -> str:
    glyph_name = font.getBestCmap()[ord("m")]
    coordinates, endpoints, flags = font["glyf"][glyph_name].getCoordinates(font["glyf"])
    outline = {
        "coordinates": list(coordinates),
        "endpoints": list(endpoints),
        "flags": list(flags),
    }
    return digest(json.dumps(outline, sort_keys=True, separators=(",", ":")).encode())


def make_face(source: bytes, suffix: str, weight: int, italic: bool) -> tuple[bytes, dict]:
    font = TTFont(io.BytesIO(source), recalcTimestamp=False)
    if font["name"].getDebugName(5) != "Version 1.003":
        raise ValueError("Unexpected source font version")
    if bool(font["OS/2"].fsSelection & 1) != italic:
        raise ValueError("Italic must come from the real italic source")
    # All variation axes are pinned. The previous upright asset renders at its
    # default opsz=18, so this does not change the optical size of regular prose.
    instantiateVariableFont(
        font, {"wght": weight, "opsz": 18}, inplace=True, optimize=True
    )
    if "fvar" in font:
        raise ValueError("The native output must be a static face")
    rename_face(font, suffix)
    font["OS/2"].usWeightClass = weight
    selection = font["OS/2"].fsSelection & ~(1 | 32 | 64 | 512)
    selection |= (1 if italic else 0) | (32 if weight == 700 else 0)
    if not italic and weight == 400:
        selection |= 64
    font["OS/2"].fsSelection = selection
    font["head"].macStyle = (font["head"].macStyle & ~3) | (
        (1 if weight == 700 else 0) | (2 if italic else 0)
    )
    buffer = io.BytesIO()
    font.save(buffer, reorderTables=True)
    data = buffer.getvalue()
    loaded = TTFont(io.BytesIO(data), recalcTimestamp=False)
    if loaded["name"].getDebugName(16) != "Newsreader":
        raise ValueError("The GPUI selector requires the shared Newsreader family")
    if (loaded["post"].italicAngle != 0) != italic:
        raise ValueError("The static italic outline must retain its original italic angle")
    return data, {
        "path": f"app/fonts/Newsreader-Native-{suffix}.ttf",
        "sha256": digest(data),
        "bytes": len(data),
        "weight": weight,
        "style": "italic" if italic else "normal",
        "family": loaded["name"].getDebugName(16),
        "postscriptName": loaded["name"].getDebugName(6),
        "version": loaded["name"].getDebugName(5),
        "glyphCount": len(loaded.getGlyphOrder()),
        "sampleOutlineMsha256": outline_digest(loaded),
        "variable": "fvar" in loaded,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--italic-source", type=Path)
    source.add_argument("--fetch-source", action="store_true")
    parser.add_argument("--output-dir", type=Path, default=REPOSITORY / "app/fonts")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    if fontTools.version != FONTTOOLS_VERSION:
        parser.error(f"Install fonttools=={FONTTOOLS_VERSION} to reproduce these files")

    upright = checked((REPOSITORY / UPRIGHT_PATH).read_bytes(), UPRIGHT_SHA256, "Web upright source")
    checked((REPOSITORY / LICENSE_PATH).read_bytes(), LICENSE_SHA256, "bundled OFL notice")
    italic = fetch_italic() if args.fetch_source else checked(
        args.italic_source.read_bytes(), ITALIC_SHA256, "italic source"
    )
    outputs = {}
    records = []
    for suffix, weight, is_italic in FACES:
        data, record = make_face(italic if is_italic else upright, suffix, weight, is_italic)
        outputs[Path(record["path"]).name] = data
        records.append(record)
    if len({record["sampleOutlineMsha256"] for record in records}) != 4:
        raise ValueError("The four faces must have distinct actual glyph outlines")
    manifest = {
        "schemaVersion": 1,
        "purpose": "Real static Newsreader faces for GPUI face selection; no faux weight or slant",
        "generator": {
            "path": SCRIPT_PATH,
            "sha256": digest(Path(__file__).read_bytes()),
            "fonttools": FONTTOOLS_VERSION,
            "axes": {"opsz": 18, "wght": [400, 700]},
            "timestamps": "Original font timestamps retained; no wall clock input",
        },
        "origin": {
            "designerRepository": "https://github.com/productiontype/Newsreader",
            "distributionRepository": "https://github.com/google/fonts",
            "commit": COMMIT,
            "version": "1.003",
            "upright": {"path": UPRIGHT_PATH, "url": UPRIGHT_URL, "sha256": UPRIGHT_SHA256},
            "italic": {"url": ITALIC_URL, "sha256": ITALIC_SHA256},
        },
        "license": {
            "spdx": "OFL-1.1",
            "bundledPath": LICENSE_PATH,
            "bundledSha256": LICENSE_SHA256,
            "upstreamUrl": UPSTREAM_ROOT + "OFL.txt",
            "upstreamSha256": UPSTREAM_LICENSE_SHA256,
            "bundledDifference": "Trailing whitespace removed and final newline added; same license text",
            "copyright": "Copyright 2020 The Newsreader Project Authors (http://github.com/productiontype/Newsreader)",
        },
        "outputs": records,
    }
    outputs[MANIFEST_NAME] = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
    if args.verify:
        for name, data in outputs.items():
            if (args.output_dir / name).read_bytes() != data:
                raise ValueError(f"{name}: generated bytes differ from the committed artifact")
    else:
        args.output_dir.mkdir(parents=True, exist_ok=True)
        for name, data in outputs.items():
            (args.output_dir / name).write_bytes(data)
    print(json.dumps({"result": "pass", "mode": "verify" if args.verify else "build", "faces": records}))


if __name__ == "__main__":
    main()
