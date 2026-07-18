#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


TRIGGER_HINTS = [
    "视频", "剪辑", "混剪", "字幕", "电影", "素材", "片头", "转场",
    "运镜", "口播", "科普", "介绍", "short", "video", "edit", "montage"
]

EXPLICIT_NON_VIDEO_HINTS = [
    "不需要视频", "不要视频", "仅音频", "只要音频", "audio only", "no video"
]


def should_trigger(text: str) -> bool:
    lowered = text.lower()
    if any(hint.lower() in lowered for hint in EXPLICIT_NON_VIDEO_HINTS):
        return False
    return any(hint.lower() in lowered for hint in TRIGGER_HINTS)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("skill_dir")
    parser.add_argument("--cases", default="evals/trigger_cases.json")
    parser.add_argument("--output", default="reports/trigger-eval.json")
    args = parser.parse_args()

    root = Path(args.skill_dir).resolve()
    cases_path = root / args.cases
    cases = json.loads(cases_path.read_text(encoding="utf-8"))
    results = []
    failures = []

    for case in cases.get("should_trigger", []):
        got = should_trigger(case["input"])
        results.append({"id": case["id"], "expected": True, "got": got})
        if not got:
            failures.append(case["id"])

    for case in cases.get("should_not_trigger", []):
        got = should_trigger(case["input"])
        results.append({"id": case["id"], "expected": False, "got": got})
        if got:
            failures.append(case["id"])

    report = {
        "ok": not failures,
        "total": len(results),
        "failures": failures,
        "results": results,
    }
    output = root / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
