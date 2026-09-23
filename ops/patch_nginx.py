#!/usr/bin/env python3
"""Idempotently include the auth location in the existing TLS server block."""

from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Iterable, Sequence, Tuple


INCLUDE = "    include /etc/nginx/snippets/helpinrus-auth-api.conf;\n"
EXPECTED_ROOT = "/var/www/helpinrus"
EXPECTED_SERVER_NAMES = ("201.51.4.212",)
LEGACY_CSP_SOURCES = (
    " https://cdn.jsdelivr.net",
    " https://llnjgyehxsogjmwegnyf.supabase.co",
    " wss://llnjgyehxsogjmwegnyf.supabase.co",
)


def server_blocks(text: str) -> Iterable[Tuple[int, int, str]]:
    lines = text.splitlines(keepends=True)
    depth = 0
    start = None
    for index, line in enumerate(lines):
        stripped = line.strip()
        if depth == 0 and stripped.startswith("server") and "{" in stripped:
            start = index
        depth += line.count("{") - line.count("}")
        if start is not None and depth == 0:
            yield start, index, "".join(lines[start : index + 1])
            start = None


def _directive_arguments(block: str, directive: str) -> Iterable[Tuple[str, ...]]:
    pattern = re.compile(rf"^{re.escape(directive)}\s+(.+?);$")
    for raw_line in block.splitlines():
        line = raw_line.split("#", 1)[0].strip()
        match = pattern.match(line)
        if match:
            yield tuple(match.group(1).split())


def _is_tls_block(block: str) -> bool:
    for arguments in _directive_arguments(block, "listen"):
        if not arguments:
            continue
        endpoint = arguments[0]
        if endpoint == "443" or endpoint.endswith(":443"):
            return True
    return False


def _root_matches(block: str, expected_root: str) -> bool:
    normalized = expected_root.rstrip("/")
    return any(
        arguments
        and arguments[0].strip("\"'").rstrip("/") == normalized
        for arguments in _directive_arguments(block, "root")
    )


def _server_name_matches(block: str, expected_names: Sequence[str]) -> bool:
    expected = frozenset(expected_names)
    return any(
        expected.intersection(argument.strip("\"'") for argument in arguments)
        for arguments in _directive_arguments(block, "server_name")
    )


def _select_helpinrus_tls_block(
    text: str,
    expected_root: str,
    expected_server_names: Sequence[str],
) -> Tuple[int, int, str]:
    tls_blocks = [block for block in server_blocks(text) if _is_tls_block(block[2])]
    root_matches = [
        block for block in tls_blocks if _root_matches(block[2], expected_root)
    ]
    if len(root_matches) == 1:
        return root_matches[0]
    if len(root_matches) > 1:
        named = [
            block
            for block in root_matches
            if _server_name_matches(block[2], expected_server_names)
        ]
        if len(named) == 1:
            return named[0]
        raise ValueError("Helpinrus TLS server block is ambiguous")

    named = [
        block
        for block in tls_blocks
        if _server_name_matches(block[2], expected_server_names)
    ]
    if len(named) == 1:
        return named[0]
    if len(named) > 1:
        raise ValueError("Helpinrus TLS server block is ambiguous")
    raise ValueError("Helpinrus TLS server block was not found")


def patch(
    text: str,
    expected_root: str = EXPECTED_ROOT,
    expected_server_names: Sequence[str] = EXPECTED_SERVER_NAMES,
) -> str:
    start, end, block = _select_helpinrus_tls_block(
        text, expected_root, expected_server_names
    )
    for source in LEGACY_CSP_SOURCES:
        block = block.replace(source, "")
    if INCLUDE.strip() not in block:
        block_lines = block.splitlines(keepends=True)
        block_lines.insert(len(block_lines) - 1, INCLUDE)
        block = "".join(block_lines)
    lines = text.splitlines(keepends=True)
    lines[start : end + 1] = [block]
    return "".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path)
    parser.add_argument("--root", default=EXPECTED_ROOT)
    parser.add_argument("--server-name", action="append", dest="server_names")
    args = parser.parse_args()
    original = args.path.read_text(encoding="utf-8")
    updated = patch(
        original,
        expected_root=args.root,
        expected_server_names=tuple(args.server_names or EXPECTED_SERVER_NAMES),
    )
    if updated != original:
        args.path.write_text(updated, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
