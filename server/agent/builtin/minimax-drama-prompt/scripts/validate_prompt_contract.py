#!/usr/bin/env python3
"""Validate the fixed MiniMax drama-prompt output contract."""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from count_dialogue_budget import count_effective_chars, extract_dialogue


SEGMENT_RE = re.compile(
    r"^##\s+(?P<id>P\d+)｜(?P<duration>\d{1,2})秒(?:｜(?P<title>.*))?$",
    re.MULTILINE,
)
MAPPING_RE = re.compile(
    r"^<Subject(?P<subject>\d+)>(?P<name>[A-Z][a-z]+(?: [A-Z][a-z]+)*)(?:是|的)",
)
SPEAKER_RE = re.compile(
    r"^<Subject (?P<subject>\d+)> \(S(?P<speaker>\d+)\) says:$"
)
DIALOGUE_RE = re.compile(r"^<d>\[Chinese\].*</d>$")
SHOT_RE = re.compile(r"^\[Shot (?P<number>\d+)\]$")
LEGACY_SHOT_RE = re.compile(r"^镜头\d+[：：（]")
ELLIPSIS_RE = re.compile(r"(?:…+|\.{3,})")

FORBIDDEN_TAIL = "文字/UI/水印/Logo/角标/可读文字/真实UI"
REQUIRED_DECLARATION = (
    "无背景音乐,仅保留环境音与人声和音效;画面禁字幕/文字/水印/Logo;"
    "禁止可读文字(指画面字幕文字,不含人声台词)"
)


@dataclass(frozen=True)
class ValidationResult:
    segment_id: str
    errors: tuple[str, ...]


def segment_bodies(markdown: str) -> list[tuple[str, str]]:
    matches = list(SEGMENT_RE.finditer(markdown))
    bodies: list[tuple[str, str]] = []
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(markdown)
        bodies.append((match.group("id"), markdown[start:end]))
    return bodies


def validate_segment(segment_id: str, body: str) -> ValidationResult:
    lines = [line.rstrip() for line in body.splitlines()]
    errors: list[str] = []
    tagged, untagged, environment = extract_dialogue(body)
    if count_effective_chars("".join(tagged + untagged)) > 48:
        errors.append("dialogue exceeds 48 effective characters")
    if len(environment) > 1:
        errors.append("at most one temporary environment utterance is allowed")
    if any(count_effective_chars(line) > 20 for line in environment):
        errors.append("temporary environment dialogue exceeds 20 effective characters")
    if untagged != environment:
        errors.append("untagged dialogue must use the temporary environment format")

    if ELLIPSIS_RE.search(body):
        errors.append("ellipsis punctuation is not allowed")

    mappings: dict[int, str] = {}
    shots: list[int] = []

    for line in lines:
        mapping = MAPPING_RE.match(line)
        if mapping:
            mappings[int(mapping.group("subject"))] = mapping.group("name")
        shot = SHOT_RE.match(line)
        if shot:
            shots.append(int(shot.group("number")))
        if LEGACY_SHOT_RE.match(line):
            errors.append("legacy shot label")

    if not mappings:
        errors.append("no character mappings")

    if not shots:
        errors.append("no Shot labels")
    elif shots != list(range(1, len(shots) + 1)):
        errors.append("Shot labels are not sequential from 1")

    for index, line in enumerate(lines):
        speaker = SPEAKER_RE.match(line)
        if speaker:
            subject = int(speaker.group("subject"))
            speaker_id = int(speaker.group("speaker"))
            if subject != speaker_id:
                errors.append(f"Subject {subject} does not match S{speaker_id}")
            if subject not in mappings:
                errors.append(f"speaker Subject {subject} is not mapped")
            if index + 1 >= len(lines) or not DIALOGUE_RE.match(lines[index + 1]):
                errors.append(f"speaker line {index + 1} lacks adjacent dialogue")

        if DIALOGUE_RE.match(line):
            if index == 0 or not SPEAKER_RE.match(lines[index - 1]):
                errors.append(f"dialogue line {index + 1} lacks adjacent speaker")

        if line == "画外音":
            if len(mappings) < 2:
                errors.append("voiceover requires at least two mapped characters")
            if index + 1 >= len(lines) or not SPEAKER_RE.match(lines[index + 1]):
                errors.append(f"voiceover line {index + 1} lacks bound speaker")

    required_tail = ["【禁止项】", FORBIDDEN_TAIL, "【强制声明】", REQUIRED_DECLARATION]
    tail_positions = [body.find(item) for item in required_tail]
    if any(position < 0 for position in tail_positions):
        errors.append("fixed tail is incomplete")
    elif tail_positions != sorted(tail_positions):
        errors.append("fixed tail is out of order")

    return ValidationResult(segment_id=segment_id, errors=tuple(dict.fromkeys(errors)))


def validate_markdown(markdown: str) -> list[ValidationResult]:
    return [validate_segment(segment_id, body) for segment_id, body in segment_bodies(markdown)]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate English names, Subject/S bindings, Shot labels, dialogue lines, voiceover, and fixed tail."
    )
    parser.add_argument("markdown", type=Path, help="Markdown prompt file to inspect")
    args = parser.parse_args()

    content = args.markdown.read_text(encoding="utf-8")
    results = validate_markdown(content)
    if not results:
        print("No segment headings found. Expected: ## P01｜12秒｜段名", file=sys.stderr)
        return 2

    failed = False
    for result in results:
        if result.errors:
            failed = True
            print(f"{result.segment_id}\tFAIL\t{' | '.join(result.errors)}")
        else:
            print(f"{result.segment_id}\tPASS")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
