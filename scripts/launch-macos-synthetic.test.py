# @Codex
import importlib.util
import json
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "synthetic_launcher", Path(__file__).with_name("launch-macos-synthetic.py"))
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class SyntheticLauncherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="mediflow-launcher-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = self.root / "Source.app"
        self.code = self.app / "Contents/MacOS"
        self.code.mkdir(parents=True)
        self.original = {"CFBundleExecutable": "MediFlow",
                         "CFBundleIdentifier": "com.mediflow.original",
                         "CFBundleURLTypes": [{"CFBundleURLSchemes": ["mediflow"]}]}
        (self.app / "Contents/Info.plist").write_bytes(plistlib.dumps(self.original))
        (self.code / "MediFlow").write_bytes(b"synthetic executable stub")
        (self.code / "MediFlow.debug.dylib").write_bytes(b"MEDIFLOW_APPLE_DEMO")
        self.output = self.root / "isolated"

    def invoke(self):
        with patch("sys.argv", ["launch", "--app", str(self.app),
                                "--output", str(self.output)]):
            return launcher.main()

    @patch.object(launcher.subprocess, "run")
    def test_launch_isolates_reopen_and_preserves_source(self, run):
        run.return_value = subprocess.CompletedProcess([], 0, "", "")
        self.assertEqual(self.invoke(), 0)
        receipt = json.loads((self.output / "launch-receipt.json").read_text())
        staged = plistlib.loads((Path(receipt["app"]) / "Contents/Info.plist").read_bytes())
        self.assertNotEqual(staged["CFBundleIdentifier"], self.original["CFBundleIdentifier"])
        self.assertNotIn("CFBundleURLTypes", staged)
        self.assertEqual(staged["LSEnvironment"], receipt["environment"])
        self.assertEqual(staged["LSEnvironment"]["MEDIFLOW_APPLE_DEMO"], "1")
        self.assertEqual(staged["LSEnvironment"]["MEDIFLOW_LOCAL_AUTHORITY"], "0")
        self.assertTrue(Path(staged["LSEnvironment"]["HOME"]).is_relative_to(self.output.resolve()))
        self.assertEqual(plistlib.loads((self.app / "Contents/Info.plist").read_bytes()), self.original)
        self.assertEqual([c.args[0][0] for c in run.call_args_list],
                         ["/usr/bin/codesign", "/usr/bin/open"])

    @patch.object(launcher.subprocess, "run")
    def test_existing_directory_is_preserved(self, run):
        self.output.mkdir()
        sentinel = self.output / "keep"
        sentinel.write_text("existing user artifact")
        with self.assertRaises(FileExistsError):
            self.invoke()
        self.assertEqual(sentinel.read_text(), "existing user artifact")
        run.assert_not_called()

    @patch.object(launcher.subprocess, "run")
    def test_non_fixture_app_is_rejected_before_staging(self, run):
        (self.code / "MediFlow.debug.dylib").unlink()
        with self.assertRaises(SystemExit) as failure:
            self.invoke()
        self.assertEqual(failure.exception.code, 2)
        self.assertFalse(self.output.exists())
        run.assert_not_called()

    @patch.object(launcher.subprocess, "run")
    def test_signing_failure_prevents_launch_and_retains_receipt(self, run):
        run.return_value = subprocess.CompletedProcess([], 1, "", "synthetic signing failure")
        self.assertEqual(self.invoke(), 1)
        self.assertEqual(run.call_count, 1)
        receipt = json.loads((self.output / "launch-receipt.json").read_text())
        self.assertEqual(receipt["signing_exit_code"], 1)
        self.assertNotIn("launch_exit_code", receipt)


if __name__ == "__main__":
    unittest.main()
