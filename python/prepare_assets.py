#!/usr/bin/env python3
"""Copy the web assets into ``python/assets`` for packaging."""

from __future__ import annotations

import shutil
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
TARGET_DIR = Path(__file__).resolve().parent / "assets"

FILES_TO_COPY = [
    "index.html",
    "manual.html",
    "manual_i18n.js",
    "actions.js",
    "databasePersistence.js",
    "evaluation.js",
    "filePersistence.js",
    "i18n.js",
    "main.js",
    "state.js",
    "style.css",
    "utils.js",
    "views.js",
    "ejemplo.json",
    "favicon.ico",
    "logo.png",
]

DIRECTORIES_TO_COPY = [
    "locales",
]


def copy_file(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)


def copy_directory(src: Path, dest: Path) -> None:
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(src, dest)


def main() -> None:
    if TARGET_DIR.exists():
        shutil.rmtree(TARGET_DIR)
    TARGET_DIR.mkdir(parents=True, exist_ok=True)

    for relative_path in FILES_TO_COPY:
        src = PROJECT_ROOT / relative_path
        dest = TARGET_DIR / relative_path
        if not src.exists():
            raise FileNotFoundError(f"No s'ha trobat l'arxiu {relative_path}")
        copy_file(src, dest)

    for relative_path in DIRECTORIES_TO_COPY:
        src = PROJECT_ROOT / relative_path
        dest = TARGET_DIR / relative_path
        if not src.exists():
            raise FileNotFoundError(f"No s'ha trobat el directori {relative_path}")
        copy_directory(src, dest)

    print(f"Actius copiats a {TARGET_DIR}")


if __name__ == "__main__":
    main()
