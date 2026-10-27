#!/usr/bin/env python3
"""Stage a source-identified, ad-hoc signed connected client; never install it."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import shutil
import stat
import subprocess
import sys
import tomllib

WORKSPACE = Path(__file__).resolve().parents[1]
ROOT = WORKSPACE.parents[1]
PACKAGING = WORKSPACE / "packaging"


def run(*args, check=True):
    result = subprocess.run(args, cwd=WORKSPACE, text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(f"{args[0]} failed ({result.returncode}): {result.stderr}")
    return result


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def inventory(bundle):
    files = []
    for path in sorted(bundle.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"Unexpected symlink: {path}")
        if path.is_file():
            files.append({"path": path.relative_to(bundle).as_posix(),
                          "sha256": digest(path), "bytes": path.stat().st_size,
                          "mode": oct(stat.S_IMODE(path.stat().st_mode))})
    return files


def build_number(sha):
    value = int(sha[:6], 16)
    return f"{1 + value // 10000}.{value // 100 % 100}.{value % 100}"


def validate_destination(path):
    path = path.expanduser().resolve()
    if "Applications" in path.parts or path == ROOT or ROOT in path.parents:
        raise ValueError("Use a new staging directory outside the repository and Applications")
    if path.exists():
        raise ValueError("Staging directory already exists; previous artifacts are preserved")
    return path


def license_files(root):
    return sorted(p for p in root.rglob("*") if p.is_file() and
                  len(p.relative_to(root).parts) <= 3 and
                  p.name.lower().startswith(("license", "licence", "copying",
                                             "copyright", "notice", "unlicense")))


def collect_licenses(metadata, destination):
    destination.mkdir()
    supplements = {s["package"]: s for s in
                   json.loads((PACKAGING / "licenses/sources.json").read_text())}
    packages = []
    for package in sorted(metadata["packages"], key=lambda p: p["id"]):
        if package["id"] in metadata["workspace_members"]:
            continue
        source = Path(package["manifest_path"]).parent
        texts = license_files(source)
        explicit = package.get("license_file")
        if explicit and (source / explicit).is_file():
            texts = sorted(set(texts + [source / explicit]))
        key = package["name"] + "@" + package["version"]
        supplement = supplements.get(key)
        output = destination / key
        output.mkdir()
        for number, text in enumerate(texts):
            shutil.copyfile(text, output / f"{number:03d}-{text.name}")
        if not texts:
            if not supplement:
                raise ValueError(f"Missing license text for {key}")
            text = PACKAGING / "licenses" / supplement["file"]
            if digest(text) != supplement["sha256"]:
                raise ValueError(f"License checksum mismatch for {key}")
            shutil.copyfile(text, output / text.name)
        packages.append({"name": package["name"], "version": package["version"],
                         "source": package["source"], "license": package["license"],
                         "supplement": supplement if not texts else None})
    for source, name in [
        (ROOT / "LICENSE", "MediFlow-MIT.txt"),
        (WORKSPACE / "NOTICE", "MediFlow-NOTICE.txt"),
        (WORKSPACE / "LICENSE-APACHE-GPUI", "GPUI-Apache-2.0.txt"),
        (ROOT / "app/fonts/Newsreader-OFL.txt", "Newsreader-OFL.txt"),
        (ROOT / "native/MediFlowMac/Sources/MediFlowAppleShared/Resources/Fonts/IBM-Plex-Mono-OFL.txt", "IBM-Plex-Mono-OFL.txt"),
    ]:
        shutil.copyfile(source, destination / name)
    icons = (WORKSPACE / "app/src/icons.rs").read_text()
    (destination / "Lucide-Feather.txt").write_text(icons.split("/*", 1)[1].split("*/", 1)[0].strip() + "\n")
    write_json(destination / "packages.json", {
        "scope": "Cargo locked macOS graph, including build and test dependencies (conservative superset)",
        "packages": packages,
    })


def collect_rust_licenses(destination):
    docs = Path(run("rustc", "--print", "sysroot").stdout.strip()) / "share/doc/rust"
    shutil.copytree(docs / "licenses", destination / "Rust/licenses")
    shutil.copyfile(docs / "COPYRIGHT-library.html", destination / "Rust/COPYRIGHT-library.html")


def make_icon(source, stage, resources):
    iconset = stage / "MediFlow.iconset"
    iconset.mkdir()
    for size in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            suffix = "@2x" if scale == 2 else ""
            run("sips", "-z", str(size * scale), str(size * scale), str(source),
                "--out", str(iconset / f"icon_{size}x{size}{suffix}.png"))
    run("iconutil", "-c", "icns", str(iconset), "-o", str(resources / "MediFlow.icns"))
    shutil.rmtree(iconset)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staging", required=True, type=Path,
                        help="New output directory, never Applications or the source tree")
    parser.add_argument("--target-dir", required=True, type=Path,
                        help="Private Cargo target directory outside the source tree")
    args = parser.parse_args()
    if sys.platform != "darwin" or platform.machine() != "arm64":
        parser.error("This local candidate requires an Apple Silicon Mac")
    stage = validate_destination(args.staging)
    target = args.target_dir.expanduser().resolve()
    if "Applications" in target.parts or target == ROOT or ROOT in target.parents:
        parser.error("Cargo target must be outside the repository and Applications")
    if stage == target or stage in target.parents or target in stage.parents:
        parser.error("Staging and Cargo target must be separate directories")
    if run("git", "status", "--porcelain", "--untracked-files=all").stdout.strip():
        parser.error("Commit all source inputs before producing a source-identified bundle")
    sha = run("git", "rev-parse", "HEAD").stdout.strip()
    config = json.loads((PACKAGING / "macos.json").read_text())
    if config["composition"] != "connected-client" or config["signing"] != "ad-hoc":
        parser.error("Only connected-client composition and explicit ad-hoc signing are implemented")
    for key in ("name", "executable"):
        if not config[key] or Path(config[key]).name != config[key] or config[key] in (".", ".."):
            parser.error(f"Invalid bundle {key}")
    version = tomllib.loads((WORKSPACE / "Cargo.toml").read_text())["workspace"]["package"]["version"]
    for variable in ("CARGO_BUILD_TARGET", "RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "RUSTC_WRAPPER", "RUSTC_WORKSPACE_WRAPPER"):
        if os.environ.get(variable):
            parser.error(f"Unset {variable} for the standard local release build")
    os.environ["CARGO_TARGET_DIR"] = str(target)
    os.environ["CARGO_INCREMENTAL"] = "0"
    os.environ.setdefault("CARGO_BUILD_JOBS", "3")
    stage.mkdir(parents=True)
    build = run("cargo", "build", "--release", "--locked", "--offline", "-p", config["package"], check=False)
    (stage / "build.log").write_text(build.stdout + build.stderr)
    if build.returncode:
        raise RuntimeError(f"Release build failed; see {stage / 'build.log'}")
    metadata = json.loads(run("cargo", "metadata", "--locked", "--offline", "--format-version", "1",
                              "--filter-platform", "aarch64-apple-darwin").stdout)
    gpui = next(p for p in metadata["packages"] if p["name"] == "gpui_apple")
    node = next(n for n in metadata["resolve"]["nodes"] if n["id"] == gpui["id"])
    if "runtime_shaders" in node["features"]:
        raise ValueError("runtime_shaders must be disabled for the release bundle")
    shaders = sorted((target / "release/build").glob("gpui_apple-*/out/shaders.metallib"))
    binary = target / "release" / config["executable"]
    binary_bytes = binary.read_bytes()
    embedded_shaders = [p for p in shaders if p.read_bytes() in binary_bytes]
    if not embedded_shaders:
        raise ValueError("No precompiled Metal library found inside the release executable")
    bundle = stage / (config["name"] + ".app")
    resources = bundle / "Contents/Resources"
    resources.mkdir(parents=True)
    macos = bundle / "Contents/MacOS"
    macos.mkdir()
    executable = macos / config["executable"]
    shutil.copyfile(binary, executable)
    executable.chmod(0o755)
    info = {
        "CFBundleName": config["name"], "CFBundleDisplayName": config["name"],
        "CFBundleIdentifier": config["identifier"], "CFBundleExecutable": config["executable"],
        "CFBundlePackageType": "APPL", "CFBundleIconFile": "MediFlow.icns",
        "CFBundleShortVersionString": version, "CFBundleVersion": build_number(sha),
        "LSMinimumSystemVersion": config["minimum_macos"], "NSHighResolutionCapable": True,
        "MediFlowSourceRevision": sha,
    }
    (bundle / "Contents/Info.plist").write_bytes(plistlib.dumps(info, sort_keys=True))
    make_icon(ROOT / config["icon"], stage, resources)
    collect_licenses(metadata, resources / "Licenses")
    collect_rust_licenses(resources / "Licenses")
    linkage = run("otool", "-L", str(executable)).stdout.splitlines()[1:]
    if any(not line.strip().startswith(("/System/Library/", "/usr/lib/")) for line in linkage):
        raise ValueError("Non-system dynamic dependency requires explicit packaging")
    toolchain = {"rustc": run("rustc", "-Vv").stdout.strip(),
                 "cargo": run("cargo", "-V").stdout.strip(),
                 "xcode": run("xcodebuild", "-version").stdout.strip(),
                 "sdk": run("xcrun", "--sdk", "macosx", "--show-sdk-version").stdout.strip(),
                 "clang": run("xcrun", "clang", "--version").stdout.splitlines()[0],
                 "metal": run("xcrun", "metal", "--version").stdout.strip(),
                 "macos": run("sw_vers").stdout.strip(), "architecture": platform.machine()}
    provenance = {"source_sha": sha, "source_tree": run("git", "rev-parse", "HEAD^{tree}").stdout.strip(),
                  "version": version, "build_number": build_number(sha), "configuration": config,
                  "cargo_lock_sha256": digest(WORKSPACE / "Cargo.lock"), "toolchain": toolchain,
                  "metal": {"runtime_shaders": False, "embedded_metallib_sha256": sorted(set(digest(p) for p in embedded_shaders))},
                  "dynamic_dependencies": [line.strip() for line in linkage]}
    write_json(resources / "build.json", provenance)
    if run("git", "rev-parse", "HEAD").stdout.strip() != sha or run("git", "status", "--porcelain").stdout.strip():
        raise ValueError("Source changed during packaging")
    for path in bundle.rglob("*"):
        path.chmod(0o755 if path.is_dir() or path == executable else 0o644)
    bundle.chmod(0o755)
    run("codesign", "--force", "--sign", "-", "--timestamp=none", str(bundle))
    verified = run("codesign", "--verify", "--deep", "--strict", "--verbose=2", str(bundle))
    signature = run("codesign", "-d", "--verbose=4", str(bundle)).stderr
    if "Signature=adhoc" not in signature or "TeamIdentifier=not set" not in signature:
        raise ValueError("Expected explicit ad-hoc signature without a personal identity")
    gatekeeper = run("spctl", "--assess", "--type", "execute", "--verbose=4", str(bundle), check=False)
    write_json(stage / "verification.json", {
        "codesign": {"exit": verified.returncode, "output": verified.stderr},
        "signature": signature, "gatekeeper": {"exit": gatekeeper.returncode,
        "output": gatekeeper.stdout + gatekeeper.stderr, "expected": "rejected: local ad-hoc candidate"}})
    if gatekeeper.returncode != 3 or "rejected" not in gatekeeper.stderr:
        raise ValueError("Unexpected Gatekeeper verdict; inspect verification.json")
    write_json(stage / "manifest.json", {**provenance, "bundle": bundle.name,
        "nondeterministic_fields": [], "files": inventory(bundle)})
    print(stage / "manifest.json")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError) as error:
        sys.exit(str(error))
