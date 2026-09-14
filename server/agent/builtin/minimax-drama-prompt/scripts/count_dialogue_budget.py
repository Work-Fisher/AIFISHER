#!/usr/bin/env python3
"""Check MiniMax drama-prompt duration and dialogue-character budgets."""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path


SEGMENT_RE = re.compile(
    r"^##\s+(?P<id>P\d+)｜(?P<duration>\d{1,2})秒(?:｜(?P<title>.*))?$",
    re.MULTILINE,
)
TAGGED_SPOKEN_RE = re.compile(
    r"<d>\s*\[[^\]]+\]\s*(?P<text>.*?)</d>",
    re.DOTALL,
)
LEGACY_SPOKEN_RE = re.compile(
    r"(?:[\u4e00-\u9fffA-Za-z0-9·]+(?:OS|画外音继续)?)[：:]\s*[“\"](?P<text>.*?)[”\"]"
)
ENVIRONMENT_SPOKEN_RE = re.compile(
    r"环境中一名[^：:\n“\"]{1,120}[：:]\s*[“\"](?P<text>.*?)[”\"]"
)
EFFECTIVE_CHAR_RE = re.compile(r"[\u4e00-\u9fffA-Za-z0-9]")


@dataclass(frozen=True)
class SegmentResult:
    segment_id: str
    duration: int
    dialogue_chars: int
    title: str
    environment_dialogue_chars: tuple[int, ...] = ()


def count_effective_chars(text: str) -> int:
    return len(EFFECTIVE_CHAR_RE.findall(text))


def extract_dialogue(body: str) -> tuple[list[str], list[str], list[str]]:
    """Count tagged and untagged speech together, without counting nested quotes twice."""
    tagged = [item.group("text") for item in TAGGED_SPOKEN_RE.finditer(body)]
    remaining = TAGGED_SPOKEN_RE.sub(" ", body)
    untagged = [item.group("text") for item in LEGACY_SPOKEN_RE.finditer(remaining)]
    environment = [item.group("text") for item in ENVIRONMENT_SPOKEN_RE.finditer(remaining)]
    return tagged, untagged, environment


def budget_issues(result: SegmentResult) -> list[str]:
    issues: list[str] = []
    if not 10 <= result.duration <= 15:
        issues.append("duration")
    if result.dialogue_chars > 48:
        issues.append("dialogue")
    if len(result.environment_dialogue_chars) > 1:
        issues.append("environment-count")
    if any(count > 20 for count in result.environment_dialogue_chars):
        issues.append("environment-dialogue")
    return issues


def inspect_markdown(markdown: str) -> list[SegmentResult]:
    matches = list(SEGMENT_RE.finditer(markdown))
    results: list[SegmentResult] = []
    for index, match in enumerate(matches):
        body_start = match.end()
        body_end = matches[index + 1].start() if index + 1 < len(matches) else len(markdown)
        body = markdown[body_start:body_end]
        tagged, untagged, environment = extract_dialogue(body)
        spoken_text = "".join(tagged + untagged)
        results.append(
            SegmentResult(
                segment_id=match.group("id"),
                duration=int(match.group("duration")),
                dialogue_chars=count_effective_chars(spoken_text),
                title=(match.group("title") or "").strip(),
                environment_dialogue_chars=tuple(count_effective_chars(line) for line in environment),
            )
        )
    return results


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check 10–15 second duration and <=48 effective dialogue characters per segment."
    )
    parser.add_argument("markdown", type=Path, help="Markdown prompt file to inspect")
    args = parser.parse_args()

    content = args.markdown.read_text(encoding="utf-8")
    results = inspect_markdown(content)
    if not results:
        print("No segment headings found. Expected: ## P01｜12秒｜段名", file=sys.stderr)
        return 2

    failed = False
    print("segment\tduration\tdialogue_chars\tstatus\ttitle")
    for result in results:
        issues = budget_issues(result)
        status = "FAIL:" + ",".join(issues) if issues else "PASS"
        failed = failed or bool(issues)
        print(
            f"{result.segment_id}\t{result.duration}\t{result.dialogue_chars}\t{status}\t{result.title}"
        )

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
