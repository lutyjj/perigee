#!/usr/bin/env python3
"""Lay out out/perigee/ exactly as the Decky CLI packages a plugin (R12, R13)."""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

ROOT_FILES = ("plugin.json", "package.json", "main.py", "LICENSE", "README.md")
BACKEND_PACKAGE = Path("py_modules") / "perigee"
FRONTEND_BUILD = Path("dist")


def main() -> int:
    staged = REPO_ROOT / "out" / "perigee"
    if not (REPO_ROOT / FRONTEND_BUILD).is_dir():
        print(f"no frontend build at {FRONTEND_BUILD}", file=sys.stderr)
        return 1

    shutil.rmtree(staged, ignore_errors=True)
    (staged / BACKEND_PACKAGE.parent).mkdir(parents=True, exist_ok=True)

    for name in ROOT_FILES:
        shutil.copy2(REPO_ROOT / name, staged / name)
    shutil.copytree(REPO_ROOT / FRONTEND_BUILD, staged / FRONTEND_BUILD)
    shutil.copytree(
        REPO_ROOT / BACKEND_PACKAGE,
        staged / BACKEND_PACKAGE,
        ignore=shutil.ignore_patterns("__pycache__"),
    )
    print(f"staged {staged}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
