"""Regression tests for the web converters.

Run with:  uv run --with pytest pytest -q
"""

from __future__ import annotations

import http.server
import io
import json
import threading
import zipfile

import pytest

from converter.app import app

PNG_1x1 = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c63f8cfc0f01f0005000201a2e7b6cd0000000049454e44ae426082"
)

# Characters are built from code points so this file stays plain ASCII.
ARROW, CHECK, ROCKET, E_ACUTE, CJK = chr(0x2192), chr(0x2713), chr(0x1F680), chr(0xE9), chr(0x4F60)


@pytest.fixture()
def client():
    return app.test_client()


@pytest.fixture()
def probe():
    """A local HTTP server that records every request made to it."""
    hits: list[str] = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            hits.append(self.path)
            self.send_response(404)
            self.end_headers()

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}", hits
    server.shutdown()


def _post(client, route: str, data: bytes, name: str = "x.md"):
    return client.post(
        route, data={"file": (io.BytesIO(data), name)}, content_type="multipart/form-data"
    )


# --------------------------------------------------------------------- security


@pytest.mark.parametrize("route", ["/api/md-to-docx", "/api/md-to-pdf"])
def test_markdown_never_fetches_urls_or_reads_files(client, probe, route, tmp_path):
    base, hits = probe
    secret = tmp_path / "secret.png"
    secret.write_bytes(PNG_1x1)
    md = (
        f"![a]({base}/md-image.png)\n\n"
        f'<img src="{base}/raw-html.png" alt="raw">\n\n'
        f"![b]({secret.as_posix()})\n\n"
        f"![c](file:///{secret.as_posix()})\n"
    )
    resp = _post(client, route, md.encode())
    assert resp.status_code == 200
    assert hits == [], f"server made requests: {hits}"
    if route.endswith("docx"):
        names = zipfile.ZipFile(io.BytesIO(resp.data)).namelist()
        assert not [n for n in names if "media" in n], "an image was embedded"


def test_html_to_pdf_never_fetches_resources(client, probe):
    base, hits = probe
    html = (
        f'<html><head><link rel="stylesheet" href="{base}/a.css">'
        f'<style>@import url("{base}/b.css"); body {{ background: url({base}/c.png) }}</style>'
        f'</head><body><img src="{base}/d.png"><p>hi</p></body></html>'
    )
    resp = _post(client, "/api/html-to-pdf", html.encode(), "a.html")
    assert resp.status_code == 200
    assert hits == [], f"server made requests: {hits}"


def test_errors_do_not_leak_internals(client, monkeypatch):
    from converter import md_to_docx

    def boom(_):
        raise RuntimeError("/srv/secret/path.py exploded")

    monkeypatch.setattr(md_to_docx, "convert", boom)
    resp = _post(client, "/api/md-to-docx", b"# hi")
    assert resp.status_code == 500
    assert "secret" not in resp.get_data(as_text=True)


# ------------------------------------------------------------------- robustness


def test_text_uploads_are_size_capped(client):
    resp = _post(client, "/api/md-to-pdf", b"a " * (2 * 1024 * 1024))
    assert resp.status_code == 400
    assert "too large" in resp.json["error"]


@pytest.mark.parametrize(
    "raw",
    [
        b"\xef\xbb\xbf# T" + E_ACUTE.encode() + b"tulo",  # UTF-8 with BOM
        ("# T" + E_ACUTE + "tulo " + ARROW).encode("utf-16"),  # UTF-16 with BOM
        ("# T" + E_ACUTE + "tulo").encode("cp1252"),  # Windows "ANSI"
        b"",  # empty file
    ],
)
def test_odd_encodings_and_empty_files_convert(client, raw):
    assert _post(client, "/api/md-to-pdf", raw).status_code == 200
    assert _post(client, "/api/md-to-docx", raw).status_code == 200


def test_missing_file_is_a_clean_400(client):
    resp = client.post("/api/md-to-pdf", data={}, content_type="multipart/form-data")
    assert resp.status_code == 400


# ------------------------------------------------------------- symbols & layout


def test_symbols_and_emoji_are_drawable(client):
    md = f"{ARROW} {CHECK} {ROCKET} caf{E_ACUTE}"
    resp = _post(client, "/api/md-to-pdf", md.encode())
    assert resp.status_code == 200
    assert "X-Unsupported-Chars" not in resp.headers


def test_undrawable_characters_are_reported(client):
    resp = _post(client, "/api/md-to-pdf", f"{CJK} text".encode())
    assert resp.status_code == 200
    assert json.loads(resp.headers["X-Unsupported-Chars"]) == [CJK]


def test_soft_line_breaks_flow_into_one_paragraph():
    from converter.md_to_docx import markdown_to_html

    html = markdown_to_html("one\ntwo\nthree")
    assert "<br" not in html
    assert markdown_to_html("one  \ntwo").count("<br") == 1  # explicit break kept


def test_long_words_and_code_lines_are_wrapped():
    from converter.pdf_prepare import prepare

    long_url = "https://example.com/" + "a" * 300
    html, _ = prepare(f"<p>{long_url}</p><pre>{'x' * 200}</pre>")
    assert max(len(w) for w in html.replace(chr(0x2009), " ").split()) < 120
    assert all(len(line) <= 80 for line in html.split("\n") if line.startswith("x"))


def test_table_columns_are_sized_to_content():
    from converter.pdf_prepare import prepare

    html, _ = prepare(
        "<table><tr><th>a</th><th>b</th></tr>"
        "<tr><td>tiny</td><td>a much longer piece of text in this column</td></tr></table>"
    )
    import re

    widths = [float(w) for w in re.findall(r'width="([\d.]+)%"', html)]
    assert len(widths) == 4 and widths[0] < widths[1]
    assert abs(sum(widths[:2]) - 100) < 0.1


def test_a_word_that_fits_its_column_is_not_split():
    """Regression: float truncation once split a 29-char word after 28 chars."""
    from converter.pdf_prepare import prepare

    word = "docConverter.openAfterConvert"
    html, _ = prepare(
        f"<table><tr><th>Setting</th><th>What</th></tr>"
        f"<tr><td><code>{word}</code></td><td>{'text ' * 20}</td></tr></table>"
    )
    assert word in html
