#!/usr/bin/env python3
"""Transfer a raw native app; receipts check consistency, not authenticity."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import stat
import subprocess
import tempfile
import unicodedata
import zipfile


APP_NAME = "MediFlow.app"
RECEIPT_SUFFIX = ".receipt.json"
MACHO_MAGIC = {b"\xfe\xed\xfa\xce", b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xcf",
               b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca",
               b"\xca\xfe\xba\xbf", b"\xbf\xba\xfe\xca"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def physical_path(value, *, missing=False):
    path = Path(os.path.abspath(value))
    require(not any(ord(char) < 32 or ord(char) == 127 for char in str(path)), "Invalid path")
    for component in reversed((path, *path.parents)):
        try:
            mode = component.lstat().st_mode
        except FileNotFoundError:
            require(missing, f"Missing path: {component}")
            break
        require(not stat.S_ISLNK(mode), f"Symlink path: {component}")
        if component != path:
            require(stat.S_ISDIR(mode), f"Non-directory parent: {component}")
    return path


def regular_file(path):
    path = physical_path(path)
    require(stat.S_ISREG(path.lstat().st_mode), f"Not a regular file: {path}")
    return path


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def run(*args):
    subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def raw_member(parts):
    require(not any(part.casefold() in {"_codesignature", "coderesources"} for part in parts),
            "Refusing a sealed app")
    relative = "/".join(parts).casefold()
    require(not any(relative == prefix or relative.startswith(prefix + "/") for prefix in (
        "contents/resources/webruntime", "contents/resources/headlessruntime", "contents/helpers",
        "contents/resources/mediflow-headless-supervisor.mjs", "contents/resources/local-api-tls-proxy.mjs",
    )), "Refusing an already packaged app")


def validate_app(app, architecture):
    require(app.name == APP_NAME and app.is_dir(), f"Expected raw {APP_NAME}")
    for directory, directories, files in os.walk(app, followlinks=False):
        for name in directories + files:
            entry = Path(directory) / name
            mode = entry.lstat().st_mode
            require(stat.S_ISDIR(mode) or stat.S_ISREG(mode), f"Nonphysical app entry: {entry}")
            raw_member(entry.relative_to(app).parts)
    plist_path = regular_file(app / "Contents/Info.plist")
    with plist_path.open("rb") as stream:
        info = plistlib.load(stream)
    require(isinstance(info, dict) and info.get("CFBundleIdentifier") == "com.mediflow.mobile"
            and info.get("CFBundlePackageType") == "APPL"
            and info.get("CFBundleExecutable") == "MediFlow", "Invalid native bundle Info.plist")
    require("MediFlowQAStorageNamespace" not in info, "Refusing a QA bundle")
    environment = info.get("LSEnvironment", {})
    require(isinstance(environment, dict) and not any(key.startswith("MEDIFLOW_APP_") for key in environment),
            "Refusing a previously stamped app")
    executable = regular_file(app / "Contents/MacOS/MediFlow")
    require(executable.stat().st_mode & 0o111, "Native executable is not executable")
    with executable.open("rb") as stream:
        require(stream.read(4) in MACHO_MAGIC, "Native executable is not Mach-O")
    run("lipo", str(executable), "-verify_arch", architecture)


def validate_zip(archive):
    seen = set()
    entries = {}
    with zipfile.ZipFile(archive) as bundle:
        for entry in bundle.infolist():
            name = entry.filename
            require(name == entry.orig_filename and "\\" not in name and not name.startswith("/")
                    and not any(ord(char) < 32 or ord(char) == 127 for char in name), "Unsafe ZIP path")
            parts = name.rstrip("/").split("/")
            require(all(part not in {"", ".", ".."} and ":" not in part for part in parts)
                    and parts[0] == APP_NAME, "Unsafe ZIP path or foreign app root")
            key = unicodedata.normalize("NFD", "/".join(parts)).casefold()
            require(key not in seen, "Duplicate ZIP path")
            seen.add(key)
            kind = stat.S_IFMT(entry.external_attr >> 16)
            require(kind in {0, stat.S_IFREG, stat.S_IFDIR}
                    and (kind != stat.S_IFDIR or entry.is_dir())
                    and (kind != stat.S_IFREG or not entry.is_dir()), "Unsupported ZIP entry (symlink or special file)")
            require(not entry.flag_bits & 1, "Encrypted ZIP entries are unsupported")
            raw_member(parts[1:])
            entries[key] = entry.is_dir()
        for key in entries:
            for parent in Path(key).parents:
                require(entries.get(str(parent), True), "ZIP file used as directory")
        for name in (f"{APP_NAME}/Contents/Info.plist", f"{APP_NAME}/Contents/MacOS/MediFlow"):
            require(name in bundle.namelist() and not bundle.getinfo(name).is_dir(), f"Missing ZIP app file: {name}")


def receipt_path(archive):
    return Path(str(archive) + RECEIPT_SUFFIX)


def metadata(arguments):
    require(re.fullmatch(r"[0-9a-f]{40}", arguments.revision) is not None, "Revision must be a full lowercase 40-character SHA")
    require(arguments.configuration in {"Debug", "Release"}, "Unsupported configuration")
    require(arguments.architecture in {"arm64", "x86_64"}, "Unsupported architecture")
    return dict(schemaVersion=1, revision=arguments.revision, configuration=arguments.configuration,
                architecture=arguments.architecture)


def export_artifact(arguments):
    receipt = metadata(arguments)
    app = physical_path(arguments.app)
    output = physical_path(arguments.output, missing=True)
    require(output.suffix == ".zip", "Output must be a ZIP archive")
    require(not output.exists() and not receipt_path(output).exists() and not receipt_path(output).is_symlink(),
            "Artifact output already exists")
    physical_path(output.parent)
    validate_app(app, arguments.architecture)
    with tempfile.TemporaryDirectory(prefix=".mediflow-native-", dir=output.parent) as directory:
        archive = Path(directory) / "native.zip"
        run("ditto", "-c", "-k", "--keepParent", "--norsrc", "--noextattr", str(app), str(archive))
        validate_zip(archive)
        receipt["sha256"] = digest(archive)
        for variable, field in (("GITHUB_REPOSITORY", "githubRepository"), ("GITHUB_RUN_ID", "githubRunId"),
                                ("GITHUB_RUN_ATTEMPT", "githubRunAttempt")):
            if os.environ.get(variable):
                receipt[field] = os.environ[variable]
        receipt_file = Path(directory) / "receipt.json"
        receipt_file.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
        require(not output.exists() and not receipt_path(output).exists() and not receipt_path(output).is_symlink(),
                "Artifact output already exists")
        archive.rename(output)
        receipt_file.rename(receipt_path(output))
    print(f"Exported raw native artifact: {output}")
    print(f"Receipt: {receipt_path(output)}")


def import_artifact(arguments):
    expected = metadata(arguments)
    archive = regular_file(arguments.archive)
    sidecar = regular_file(receipt_path(archive))
    with sidecar.open(encoding="utf-8") as stream:
        receipt = json.load(stream)
    require(isinstance(receipt, dict) and type(receipt.get("schemaVersion")) is int
            and all(receipt.get(key) == value for key, value in expected.items()), "Artifact receipt does not match revision/configuration/architecture")
    require(isinstance(receipt.get("sha256"), str) and re.fullmatch(r"[0-9a-f]{64}", receipt["sha256"]),
            "Invalid artifact SHA-256 receipt")
    destination = physical_path(arguments.destination, missing=True)
    require(destination.name == APP_NAME and not destination.exists(), "Import requires a fresh MediFlow.app destination")
    with tempfile.TemporaryDirectory(prefix="mediflow-native-input-", dir=Path(tempfile.gettempdir()).resolve(strict=True)) as directory:
        snapshot = Path(directory) / "native.zip"
        shutil.copyfile(archive, snapshot)
        require(digest(snapshot) == receipt["sha256"], "Artifact SHA-256 mismatch")
        validate_zip(snapshot)
        unpacked = Path(directory) / "unpacked"
        unpacked.mkdir()
        run("ditto", "-x", "-k", "--norsrc", "--noextattr", str(snapshot), str(unpacked))
        app = unpacked / APP_NAME
        validate_app(app, arguments.architecture)
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".mediflow-native-", dir=destination.parent) as staging:
            staged_app = Path(staging) / APP_NAME
            shutil.move(str(app), str(staged_app))
            require(not destination.exists() and not destination.is_symlink(), "Import destination appeared during validation")
            staged_app.rename(destination)
    print(f"Imported raw native app: {destination}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("export", "import"):
        command = commands.add_parser(name)
        command.add_argument("--revision", required=True)
        command.add_argument("--configuration", required=True)
        command.add_argument("--architecture", required=True)
        if name == "export":
            command.add_argument("--app", required=True)
            command.add_argument("--output", required=True)
        else:
            command.add_argument("--archive", required=True)
            command.add_argument("--destination", required=True)
    arguments = parser.parse_args()
    try:
        (export_artifact if arguments.command == "export" else import_artifact)(arguments)
    except (OSError, ValueError, zipfile.BadZipFile, subprocess.CalledProcessError, plistlib.InvalidFileException) as error:
        parser.exit(1, f"Native artifact rejected: {error}\n")


if __name__ == "__main__":
    main()
