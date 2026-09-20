# @Codex — stdlib-only inspection; never imports model/wheel code to audit an archive.
import email
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import stat
import sys
import unicodedata
from urllib.parse import unquote, urlparse
import zipfile


def require(condition, code):
    if not condition:
        raise ValueError(code)


def digest(path):
    with open(path, "rb") as handle:
        before = os.fstat(handle.fileno())
        result = hashlib.file_digest(handle, "sha256").hexdigest()
        after = os.fstat(handle.fileno())
    require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
            == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), "artifact_changed")
    return result


def normalize(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def environment(base=False):
    result = {
        "version": platform.python_version(),
        "implementation": platform.python_implementation(),
        "platform": sys.platform,
        "arch": {"aarch64": "arm64", "x86_64": "x64"}.get(platform.machine(), platform.machine()),
        "executable": sys.executable,
        "physicalExecutable": str(Path(sys.executable).resolve()),
        "pythonSha256": digest(sys.executable),
        "prefix": str(Path(sys.prefix).resolve()),
        "basePrefix": str(Path(sys.base_prefix).resolve()),
    }
    if not base:
        packages = {}
        for distribution in importlib.metadata.distributions():
            name = normalize(distribution.metadata["Name"])
            require(name not in packages, "duplicate_distribution")
            location = Path(distribution.locate_file("")).resolve()
            require(location.is_relative_to(Path(sys.prefix).resolve()), "external_distribution")
            packages[name] = distribution.version
        result["packages"] = packages
    return result


def safe_member(name):
    require(isinstance(name, str) and name and not re.search(r"[\x00-\x1f\x7f\\:]", name), "wheel_path_invalid")
    body = name[:-1] if name.endswith("/") else name
    require(body and not body.startswith("/") and all(p not in ("", ".", "..") for p in body.split("/")), "wheel_path_invalid")
    return body


def audit_wheels(payload):
    for wheel in payload["wheels"]:
        file = Path(payload["wheelhouse"]) / wheel["file"]
        require(file.stat().st_size == wheel["bytes"] and digest(file) == wheel["sha256"], "wheel_integrity")
        with zipfile.ZipFile(file) as archive:
            members = archive.infolist()
            require(0 < len(members) <= 100_000 and sum(i.file_size for i in members) <= 32 * 1024**3, "wheel_bounds")
            seen, files = set(), set()
            for info in members:
                name = safe_member(info.filename)
                key = unicodedata.normalize("NFC", name).casefold()
                require(key not in seen, "wheel_duplicate_path")
                seen.add(key)
                mode = info.external_attr >> 16
                require(not stat.S_ISLNK(mode) and stat.S_IFMT(mode) in (0, stat.S_IFREG, stat.S_IFDIR), "wheel_special_file")
                require(not (mode & (stat.S_ISUID | stat.S_ISGID)), "wheel_privileged_file")
                require(not (info.flag_bits & 1) and info.file_size <= 4 * 1024**3, "wheel_encrypted_or_large")
                if not info.is_dir():
                    files.add(name)
            # A file must never also be an ancestor directory, including on case-insensitive APFS.
            file_keys = {unicodedata.normalize("NFC", n).casefold() for n in files}
            for name in seen:
                require(all(str(p) not in file_keys for p in PurePosixPath(name).parents if str(p) != "."), "wheel_file_directory_collision")
            metadata_files = [name for name in files if name.endswith(".dist-info/METADATA") and name.count("/") == 1]
            require(len(metadata_files) == 1, "wheel_metadata_missing")
            metadata_name = metadata_files[0]
            prefix = metadata_name.split("/")[0]
            require(prefix + "/WHEEL" in files and prefix + "/RECORD" in files, "wheel_incomplete")
            require(archive.getinfo(metadata_name).file_size <= 2 * 1024**2, "wheel_metadata_bounds")
            metadata = email.message_from_bytes(archive.read(metadata_name))
            require(normalize(metadata["Name"] or "") == wheel["name"] and metadata["Version"] == wheel["version"], "wheel_identity_mismatch")
            require(wheel["name"] != "pip" or not metadata.get_all("Requires-Dist", []), "pip_bootstrap_dependencies_denied")
            for requirement in metadata.get_all("Requires-Dist", []):
                # Direct URL/path requirements are forbidden even behind an inactive marker.
                require("@" not in requirement and ":" not in requirement and "\\" not in requirement,
                        "wheel_direct_requirement_denied")
            for name in files:
                top = name.split("/")[0]
                if top.endswith(".dist-info"):
                    require(top == prefix, "wheel_multiple_distributions")
                if top.endswith(".data"):
                    require(top == prefix[:-len(".dist-info")] + ".data", "wheel_data_identity")
                    parts = name.split("/")
                    require(len(parts) >= 3 and parts[1] in ("purelib", "platlib", "headers", "scripts", "data"), "wheel_data_scheme")
            require(archive.testzip() is None, "wheel_crc_invalid")
        require(digest(file) == wheel["sha256"], "wheel_changed")
    return {"auditedWheels": len(payload["wheels"])}


def check_plan(payload):
    report = json.loads(Path(payload["report"]).read_text(encoding="utf-8"))
    require(report.get("version") == "1" and isinstance(report.get("install"), list), "pip_report_invalid")
    planned = {}
    locked = {w["name"]: w for w in payload["wheels"]}
    for item in report["install"]:
        metadata = item["metadata"]
        name = normalize(metadata["name"])
        require(name in locked and name not in planned, "pip_unlocked_dependency")
        expected = locked[name]
        require(metadata["version"] == expected["version"], "pip_version_mismatch")
        download = item["download_info"]
        uri = urlparse(download["url"])
        require(uri.scheme == "file" and not uri.netloc and not uri.params and not uri.query and not uri.fragment, "pip_nonlocal_artifact")
        require(unquote(uri.path) == str(Path(payload["wheelhouse"]) / expected["file"]), "pip_foreign_artifact")
        require(download.get("archive_info", {}).get("hashes", {}).get("sha256") == expected["sha256"], "pip_hash_mismatch")
        planned[name] = metadata["version"]
    require(set(planned) == set(locked), "pip_incomplete_plan")
    return {"lockedWheels": len(planned)}


def main():
    os.umask(0o077)
    mode = sys.argv[1]
    if mode == "base":
        result = environment(base=True)
    elif mode == "environment":
        result = environment()
    else:
        raw = sys.stdin.buffer.read(2 * 1024**2 + 1)
        require(len(raw) <= 2 * 1024**2, "payload_too_large")
        payload = json.loads(raw)
        result = audit_wheels(payload) if mode == "wheels" else check_plan(payload) if mode == "plan" else None
        require(result is not None, "inspection_mode_invalid")
    print(json.dumps(result, allow_nan=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Never print dependency diagnostics, local path contents or exception text.
        print('{"error":"local_inspection_failed"}', flush=True)
        sys.exit(1)
