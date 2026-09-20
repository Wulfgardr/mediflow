#!/usr/bin/env python3
# @Codex
"""Launch a separate Debug fixture bundle. Never stop existing applications.

Requires an explicit, new output directory; retains app, logs and receipt there.
This proves the SwiftUI fixture surface, not a packaged backend or host parity.
"""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import shutil
import subprocess
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    source = args.app.resolve(strict=True)
    if not args.output.is_absolute():
        parser.error("--output must be an absolute, new directory")
    info = plistlib.loads((source / "Contents/Info.plist").read_bytes())
    executable = info["CFBundleExecutable"]
    if Path(executable).name != executable:
        parser.error("Unexpected bundle executable")
    binary = source / "Contents/MacOS" / executable
    binary_bytes = binary.read_bytes()
    # Xcode's Debug app can use a small launcher plus a separate debug dylib.
    debug_library = binary.with_name(executable + ".debug.dylib")
    fixture_code = debug_library.read_bytes() if debug_library.is_file() else binary_bytes
    if b"MEDIFLOW_APPLE_DEMO" not in fixture_code:
        parser.error("The app must contain the Debug-only synthetic fixture")
    # Fail before any mutation if output already exists, including a symlink.
    args.output.mkdir(mode=0o700, parents=False, exist_ok=False)
    output = args.output.resolve(strict=True)
    app = output / "MediFlow Synthetic.app"
    shutil.copytree(source, app, symlinks=True)
    identity = "com.mediflow.synthetic." + uuid.uuid4().hex
    info["CFBundleIdentifier"] = identity
    info["CFBundleDisplayName"] = "MediFlow Synthetic"
    info["CFBundleName"] = "MediFlow Synthetic"
    # The fixture must not become a handler for the user's mediflow:// links.
    info.pop("CFBundleURLTypes", None)
    # Isolate Foundation paths as well as application preferences. HOME is only
    # passed to this subprocess; neither the caller nor the user's home changes.
    isolated_home = output / "home"
    data = isolated_home / "Library/Application Support/MediFlow"
    data.mkdir(parents=True, mode=0o700)
    environment = {
        "HOME": str(isolated_home),
        "CFFIXED_USER_HOME": str(isolated_home),
        "MEDIFLOW_DATA_DIR": str(data),
        "MEDIFLOW_APPLE_DEMO": "1",
        "MEDIFLOW_APPLE_DEV_SKIP_KEYCHAIN": "1",
        "MEDIFLOW_LOCAL_AUTHORITY": "0",
    }
    # Keep a later Finder launch of this QA copy isolated as well.
    info["LSEnvironment"] = environment
    (app / "Contents/Info.plist").write_bytes(plistlib.dumps(info))
    command = ["/usr/bin/open", "-n", "--stdout", str(output / "stdout.log"),
               "--stderr", str(output / "stderr.log")]
    for key, value in environment.items():
        command.extend(["--env", key + "=" + value])
    command.append(str(app))
    # The staged bundle has a changed identity and is only for local QA.
    signing = subprocess.run(["/usr/bin/codesign", "--force", "--sign", "-", str(app)],
                             capture_output=True, text=True)
    receipt = {"source_app": str(source), "app": str(app), "bundle_id": identity,
               "source_binary_sha256": hashlib.sha256(binary_bytes).hexdigest(),
               "source_fixture_code_sha256": hashlib.sha256(fixture_code).hexdigest(),
               "environment": environment, "command": command,
               "signing_exit_code": signing.returncode,
               "signing_stderr": signing.stderr,
               "claim": "Debug fixture UI only; no backend or authenticated workflow proof"}
    if signing.returncode == 0:
        launch = subprocess.run(command, capture_output=True, text=True)
        receipt.update(launch_exit_code=launch.returncode, launch_stderr=launch.stderr)
    (output / "launch-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(output / "launch-receipt.json")
    return receipt.get("launch_exit_code", signing.returncode)


if __name__ == "__main__":
    raise SystemExit(main())
