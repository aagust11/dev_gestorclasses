"""Aplicación de escritorio para el gestor de clases usando pywebview."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict

import webview


DEFAULT_DATA_FILE_NAME = "gestor-classes-data.json"


def _resolve_resource_path(*parts: str) -> Path:
    """Return the absolute path to a bundled resource."""
    base_path = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base_path.joinpath(*parts).resolve()


def _resolve_data_directory() -> Path:
    """Return the directory where the JSON data file should be stored."""
    if getattr(sys, "frozen", False):  # PyInstaller o ejecutable empaquetado
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


class AppApi:
    """Bridge entre el código Python y la interfaz web."""

    def __init__(self, data_path: Path) -> None:
        self._data_path = data_path
        self._data_path.parent.mkdir(parents=True, exist_ok=True)

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
            self._data_path.write_text("{}\n", encoding="utf-8")
        return self.get_data_file_info()

    def read_data_file(self) -> str:
        """Read and return the raw contents of the data file."""
        if not self._data_path.exists():
            return ""
        return self._data_path.read_text(encoding="utf-8")

    def write_data_file(self, data: str) -> bool:
        """Persist the provided JSON string to disk."""
        try:
            if data:
                json.loads(data)
        except json.JSONDecodeError as exc:  # pragma: no cover - validación defensiva
            raise ValueError("El contenido proporcionado no es JSON válido") from exc
        self._data_path.write_text(data or "{}\n", encoding="utf-8")
        return True

    def reset_data_file(self) -> bool:
        """Delete the data file, allowing a clean slate on next launch."""
        if self._data_path.exists():
            self._data_path.unlink()
        return True


def main() -> None:
    resource_dir = _resolve_resource_path()
    data_dir = _resolve_data_directory()
    data_path = data_dir / DEFAULT_DATA_FILE_NAME

    os.chdir(resource_dir)

    api = AppApi(data_path)
    webview.create_window(
        "Gestor de classes",
        url="index.html",
        js_api=api,
    )
    webview.start(debug=False, http_server=True)


if __name__ == "__main__":
    main()
