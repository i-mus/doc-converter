"""A tiny visitor counter.

Uses Upstash Redis over its REST API when ``UPSTASH_REDIS_REST_URL`` and
``UPSTASH_REDIS_REST_TOKEN`` are set (the only free option that survives a
Render free-tier restart), and otherwise falls back to a local JSON file.
"""

from __future__ import annotations

import json
import os
import threading
import urllib.request
from pathlib import Path

_KEY = os.environ.get("CONVERTER_VISITS_KEY", "visits")
_UPSTASH_URL = os.environ.get("UPSTASH_REDIS_REST_URL", "").rstrip("/")
_UPSTASH_TOKEN = os.environ.get("UPSTASH_REDIS_REST_TOKEN", "")

_FILE = Path(os.environ.get("CONVERTER_DATA_DIR", ".data")) / "visits.json"
_LOCK = threading.Lock()

# Which backend actually served the most recent call: "redis" or "file".
_last_backend = "file"
_last_error = ""


def _upstash(*path: str) -> int | None:
    global _last_backend, _last_error
    if not (_UPSTASH_URL and _UPSTASH_TOKEN):
        return None
    req = urllib.request.Request(
        "/".join((_UPSTASH_URL, *path)),
        headers={"Authorization": f"Bearer {_UPSTASH_TOKEN}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=2.5) as resp:
            value = int(json.load(resp).get("result") or 0)
        _last_backend, _last_error = "redis", ""
        return value
    except Exception as exc:  # noqa: BLE001
        _last_backend, _last_error = "file", f"{type(exc).__name__}: {exc}"
        return None


def _file_read() -> int:
    try:
        return int(json.loads(_FILE.read_text()).get("count", 0))
    except Exception:
        return 0


def _file_bump() -> int:
    with _LOCK:
        n = _file_read() + 1
        try:
            _FILE.parent.mkdir(parents=True, exist_ok=True)
            _FILE.write_text(json.dumps({"count": n}))
        except Exception:
            pass
        return n


def count() -> int:
    """Current visit count."""
    n = _upstash("get", _KEY)
    return n if n is not None else _file_read()


def bump() -> int:
    """Increment and return the new visit count."""
    n = _upstash("incr", _KEY)
    return n if n is not None else _file_bump()


def status() -> dict:
    """Diagnostics: is Redis configured, and did the last call reach it?"""
    return {
        "configured": bool(_UPSTASH_URL and _UPSTASH_TOKEN),
        "backend": _last_backend,
        "error": _last_error,
    }
