#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    errors = []
    warnings = []

    required = [
        "SKILL.md",
        "README.md",
        "agents/interface.yaml",
        "evals/trigger_cases.json",
        "reports/skill-ir.json",
        "references/workflows.md",
        "references/source-adapters.md",
        "references/trust-boundary.md",
        "scripts/qcut.js",
    ]
    for rel in required:
        if not (root / rel).exists():
            errors.append(f"missing required file: {rel}")

    skill = root / "SKILL.md"
    if skill.exists():
        text = skill.read_text(encoding="utf-8")
        match = re.match(r"^---\n(.*?)\n---\n", text, re.S)
        if not match:
            errors.append("SKILL.md missing YAML frontmatter")
        else:
            frontmatter = match.group(1)
            if not re.search(r"^name:\s*qiaomu-cut\s*$", frontmatter, re.M):
                errors.append("SKILL.md frontmatter name must be qiaomu-cut")
            if "description: |" not in frontmatter:
                errors.append("SKILL.md description should use block scalar: description: |")
        if "missing evidence" not in text.lower():
            warnings.append("SKILL.md should mention missing evidence boundary")

    readme = root / "README.md"
    if readme.exists():
        readme_text = readme.read_text(encoding="utf-8")
        bad = ["TODO", "your-org/your-repo", "特性 1", "[问题 1]"]
        for token in bad:
            if token in readme_text:
                errors.append(f"README contains placeholder: {token}")
        for phrase in ["npx skills add", "Troubleshooting", "前置条件", "你可以这样说"]:
            if phrase not in readme_text:
                warnings.append(f"README may be missing section/phrase: {phrase}")

    for rel in ["evals/trigger_cases.json", "reports/skill-ir.json"]:
        file = root / rel
        if file.exists():
            try:
                json.loads(file.read_text(encoding="utf-8"))
            except Exception as exc:
                errors.append(f"{rel} is invalid JSON: {exc}")

    report = {
        "ok": not errors,
        "root": str(root),
        "errors": errors,
        "warnings": warnings,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
