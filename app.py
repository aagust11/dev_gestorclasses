"""Aplicación de escritorio para el gestor de clases usando pywebview."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict

import webview


DEFAULT_DATA_FILE_NAME = "gestor-classes-data.jspn"


def _resolve_resource_path(*parts: str) -> Path:
    """Return the absolute path to a bundled resource."""
    base_path = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base_path.joinpath(*parts).resolve()


def _resolve_data_directory() -> Path:
    """Return the directory where the JSON data file should be stored."""
    if getattr(sys, "frozen", False):  # PyInstaller o ejecutable empaquetado
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def _normalise_json_payload(raw: str | None) -> str:
    """Return a valid JSON string or an empty string if invalid."""
    if raw is None:
        return ""

    raw = raw.strip()
    if not raw:
        return ""

    try:
        json.loads(raw)
    except json.JSONDecodeError:
        return ""

    return raw


def _load_initial_data_from_disk(path: Path) -> str:
    """Return the JSON payload stored on disk, if any."""
    if not path.exists():
        return ""

    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return ""

    return _normalise_json_payload(raw)


class AppApi:
    """Bridge entre el código Python y la interfaz web."""

    def __init__(self, data_path: Path, initial_data: str | None = None) -> None:
        self._data_path = data_path
        self._data_path.parent.mkdir(parents=True, exist_ok=True)
        if initial_data is None:
            initial_data = _load_initial_data_from_disk(data_path)
        self._initial_data = _normalise_json_payload(initial_data)

    def get_data_file_info(self) -> Dict[str, Any]:
        """Return basic information about the data file."""
        return {
            "name": self._data_path.name,
            "exists": self._data_path.exists(),
            "path": str(self._data_path),
        }

    def ensure_data_file(self) -> Dict[str, Any]:
        """Ensure the data file exists; create it with an empty JSON object if needed."""
        if not self._data_path.exists():
            contents = self._initial_data if self._initial_data else "{}\n"
            self._data_path.write_text(contents, encoding="utf-8")
        return self.get_data_file_info()

    def read_data_file(self) -> str:
        """Read and return the raw contents of the data file."""
        if not self._data_path.exists():
            return self._initial_data or ""

        try:
            raw = self._data_path.read_text(encoding="utf-8")
        except OSError:
            return self._initial_data or ""

        payload = _normalise_json_payload(raw)
        if not payload:
            return self._initial_data or ""

        self._initial_data = payload
        return payload

    def write_data_file(self, data: str) -> bool:
        """Persist the provided JSON string to disk."""
        try:
            if data:
                json.loads(data)
        except json.JSONDecodeError as exc:  # pragma: no cover - validación defensiva
            raise ValueError("El contenido proporcionado no es JSON válido") from exc
        persisted = data or "{}\n"
        persisted = _normalise_json_payload(persisted) or "{}\n"
        self._data_path.write_text(persisted, encoding="utf-8")
        self._initial_data = persisted
        return True

    def reset_data_file(self) -> bool:
        """Delete the data file, allowing a clean slate on next launch."""
        if self._data_path.exists():
            self._data_path.unlink()
        self._initial_data = ""
        return True

    def get_initial_data(self) -> str:
        """Return the cached JSON contents loaded at application start."""
        if not self._initial_data:
            self._initial_data = _load_initial_data_from_disk(self._data_path)
        return self._initial_data or ""


def main() -> None:
    resource_dir = _resolve_resource_path()
    data_dir = _resolve_data_directory()
    data_path = data_dir / DEFAULT_DATA_FILE_NAME
    initial_data = _load_initial_data_from_disk(data_path)

    os.chdir(resource_dir)

    api = AppApi(data_path, initial_data=initial_data)
    webview.create_window(
        "Gestor de classes",
        url="index.html",
        js_api=api,
    )
    webview.start(debug=False, http_server=True)


if __name__ == "__main__":
    main()
