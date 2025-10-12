"""Launcher for running the Gestor de Classes web UI inside a Python executable."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, Iterable

import webview

DATA_FILE_NAME = "gestor-classes-data.json"


def _iter_candidate_asset_dirs(base_dir: Path) -> Iterable[Path]:
    """Yield possible directories that may contain the frontend bundle."""

    if getattr(sys, "frozen", False):
        # When packaged by PyInstaller the bundled data lives under ``_MEIPASS``.
        bundle_dir = Path(getattr(sys, "_MEIPASS", base_dir))  # type: ignore[attr-defined]
        yield bundle_dir / "assets"
        yield bundle_dir
    else:
        yield base_dir / "assets"
        yield base_dir.parent


def _resolve_assets_dir(base_dir: Path) -> Path:
    """Locate the directory that stores the static frontend assets."""

    for candidate in _iter_candidate_asset_dirs(base_dir):
        index_path = candidate / "index.html"
        if index_path.exists():
            return candidate
    raise FileNotFoundError(
        "No s'han trobat els fitxers estàtics. Executa `python prepare_assets.py` "
        "per preparar-los abans d'empaquetar o comprova que el repositori estigui complet."
    )


def _resolve_app_dir() -> Path:
    """Return the directory that should contain the data file.

    When packaged with PyInstaller, ``sys.executable`` points to the bundled
    executable, so we use its parent directory. During development we default to
    the directory that contains this file.
    """

    if getattr(sys, "frozen", False) and hasattr(sys, "executable"):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


class PersistenceAPI:
    """Expose filesystem helpers to the JavaScript frontend via pywebview."""

    def __init__(self, data_path: Path) -> None:
        self.data_path = data_path

    # ----- helper utilities -------------------------------------------------
    def _ensure_directory(self) -> None:
        self.data_path.parent.mkdir(parents=True, exist_ok=True)

    def _default_payload(self, success: bool, **extra: Any) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"success": success, "name": self.data_path.name}
        payload.update(extra)
        return payload

    # ----- pywebview-exposed methods ---------------------------------------
    def get_saved_file_handle(self) -> Dict[str, Any]:
        return {
            "configured": self.data_path.exists(),
            "name": self.data_path.name,
        }

    def save_file_handle(self) -> Dict[str, Any]:
        try:
            self._ensure_directory()
            if not self.data_path.exists():
                self.data_path.write_text("{}", encoding="utf-8")
            return self._default_payload(True)
        except OSError as exc:  # pragma: no cover - defensive
            return self._default_payload(False, error=str(exc))

    def clear_saved_file_handle(self) -> Dict[str, Any]:
        try:
            if self.data_path.exists():
                self.data_path.unlink()
            return self._default_payload(True)
        except OSError as exc:  # pragma: no cover - defensive
            return self._default_payload(False, error=str(exc))

    def request_existing_data_file(self) -> Dict[str, Any]:
        if not self.data_path.exists():
            return self._default_payload(False, error="Data file not found")
        return self._default_payload(True)

    def request_new_data_file(self) -> Dict[str, Any]:
        try:
            self._ensure_directory()
            self.data_path.write_text("{}", encoding="utf-8")
            return self._default_payload(True)
        except OSError as exc:  # pragma: no cover - defensive
            return self._default_payload(False, error=str(exc))

    def read_data_file(self) -> Dict[str, Any]:
        if not self.data_path.exists():
            return self._default_payload(False, error="Data file not found")
        try:
            contents = self.data_path.read_text(encoding="utf-8")
        except OSError as exc:  # pragma: no cover - defensive
            return self._default_payload(False, error=str(exc))
        return self._default_payload(True, data=contents)

    def write_data_file(self, data: str) -> Dict[str, Any]:
        try:
            self._ensure_directory()
            # Validate JSON before writing so we do not persist invalid data.
            json.loads(data)
            self.data_path.write_text(data, encoding="utf-8")
            return self._default_payload(True)
        except json.JSONDecodeError:
            return self._default_payload(False, error="Persisted payload is not valid JSON")
        except OSError as exc:  # pragma: no cover - defensive
            return self._default_payload(False, error=str(exc))


def main() -> None:
    base_dir = Path(__file__).resolve().parent
    app_dir = _resolve_app_dir()
    assets_dir = _resolve_assets_dir(base_dir)
    data_path = app_dir / DATA_FILE_NAME

    api = PersistenceAPI(data_path)

    index_path = (assets_dir / "index.html").resolve()

    window = webview.create_window(
        "Gestor de Classes",
        url=index_path.as_uri(),
        js_api=api,
    )

    webview.start(debug=False)


if __name__ == "__main__":
    main()
