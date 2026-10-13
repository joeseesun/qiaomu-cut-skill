from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class PackageTests(unittest.TestCase):
    def test_package_validator_passes(self) -> None:
        result = subprocess.run([sys.executable, str(ROOT / "scripts" / "validate_skill.py"), str(ROOT)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout[-800:] + result.stderr[-800:])

    def test_trigger_eval_passes(self) -> None:
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "trigger_eval.py"), str(ROOT), "--output", "reports/trigger-eval.json"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout[-800:])
        self.assertEqual(json.loads(result.stdout)["summary"]["false_negative"], 0)

    def test_no_nested_skill_entrypoints(self) -> None:
        nested = [p for p in ROOT.rglob("SKILL.md") if p != ROOT / "SKILL.md" and ".deps" not in p.parts and "node_modules" not in p.parts]
        self.assertEqual(nested, [])

    def test_manifest_and_skill_versions_match(self) -> None:
        manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
        self.assertIn(f"version: {manifest['version']}", (ROOT / "SKILL.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
