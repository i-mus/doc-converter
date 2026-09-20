"""Flask web app exposing the two converters with a drag-and-drop UI."""

from __future__ import annotations

import codecs
import io
import json
import os
import re

from flask import Flask, Response, jsonify, render_template, request, send_file
from werkzeug.middleware.proxy_fix import ProxyFix

from . import html_to_pdf, image_to_pdf, md_to_docx, md_to_pdf, visits

app = Flask(__name__)
# Honour X-Forwarded-* from Render's / any reverse proxy so request.url_root
# reports https and the real host (used for canonical / OG / sitemap URLs).
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

# Cap per-request upload size. Lower it on memory-constrained hosting
# (e.g. Render's free 512 MB instance) via CONVERTER_MAX_MB.
_MAX_MB = int(os.environ.get("CONVERTER_MAX_MB", "100"))
app.config["MAX_CONTENT_LENGTH"] = _MAX_MB * 1024 * 1024


def _safe_stem(filename: str, fallback: str) -> str:
    stem = os.path.splitext(os.path.basename(filename or ""))[0]
    stem = re.sub(r"[^A-Za-z0-9_.-]+", "_", stem).strip("_.")
    return stem or fallback


def _site_url() -> str:
    """Absolute site origin, e.g. https://doc-converter.onrender.com."""
    configured = os.environ.get("CONVERTER_SITE_URL", "").strip().rstrip("/")
    return configured or request.url_root.rstrip("/")


# Markdown / HTML uploads are parsed in memory, so cap them well below the
# general upload limit (images can legitimately be large; text rarely is).
_MAX_TEXT_MB = float(os.environ.get("CONVERTER_MAX_TEXT_MB", "1"))


class _BadUpload(Exception):
    """A user-facing problem with the uploaded file."""


def _read_text_upload(upload, what: str) -> str:
    raw = upload.read(int(_MAX_TEXT_MB * 1024 * 1024) + 1)
    if len(raw) > _MAX_TEXT_MB * 1024 * 1024:
        raise _BadUpload(f"That {what} file is too large (limit {_MAX_TEXT_MB:g} MB).")
    if raw.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        return raw.decode("utf-16", errors="replace")
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            return raw.decode("cp1252")  # typical of "ANSI" files saved on Windows
        except UnicodeDecodeError:
            return raw.decode("utf-8", errors="replace")


def _fail(exc: Exception, what: str) -> tuple[Response, int]:
    """Log the real error server-side; tell the user something safe."""
    if isinstance(exc, _BadUpload):
        return jsonify(error=str(exc)), 400
    app.logger.exception("%s conversion failed", what)
    return jsonify(error=f"Couldn't convert that file to {what}. It may be malformed."), 500


def _pdf_response(pdf_bytes: bytes, name: str, unsupported: list[str]) -> Response:
    resp = send_file(
        io.BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=True,
        download_name=name,
    )
    if unsupported:
        # ASCII-only JSON, so it is a valid header value.
        resp.headers["X-Unsupported-Chars"] = json.dumps(unsupported[:40])
        resp.headers["Access-Control-Expose-Headers"] = "X-Unsupported-Chars"
    return resp


@app.errorhandler(413)
def too_large(_exc):
    return jsonify(error=f"File too large (limit {_MAX_MB} MB)."), 413


@app.get("/")
def index() -> str:
    return render_template("index.html", site_url=_site_url())


@app.get("/healthz")
def healthz() -> Response:
    return jsonify(status="ok")


@app.get("/api/visits")
def visits_route() -> Response:
    fresh = request.cookies.get("v") != "1"
    n = visits.bump() if fresh else visits.count()
    resp = jsonify(count=n, **visits.status())
    if fresh:
        resp.set_cookie("v", "1", max_age=31_536_000, samesite="Lax")
    return resp


@app.get("/robots.txt")
def robots() -> Response:
    body = f"User-agent: *\nAllow: /\nSitemap: {_site_url()}/sitemap.xml\n"
    return Response(body, mimetype="text/plain")


@app.get("/sitemap.xml")
def sitemap() -> Response:
    body = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"  <url><loc>{_site_url()}/</loc>"
        "<changefreq>monthly</changefreq><priority>1.0</priority></url>\n"
        "</urlset>\n"
    )
    return Response(body, mimetype="application/xml")


@app.post("/api/md-to-docx")
def md_to_docx_route() -> Response:
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        return jsonify(error="Upload a Markdown (.md) file."), 400

    try:
        docx_bytes = md_to_docx.convert(_read_text_upload(upload, "Markdown"))
    except Exception as exc:  # noqa: BLE001
        return _fail(exc, "Word")

    name = _safe_stem(upload.filename, "document") + ".docx"
    return send_file(
        io.BytesIO(docx_bytes),
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        as_attachment=True,
        download_name=name,
    )


@app.post("/api/md-to-pdf")
def md_to_pdf_route() -> Response:
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        return jsonify(error="Upload a Markdown (.md) file."), 400

    try:
        pdf_bytes, unsupported = md_to_pdf.convert_with_report(
            _read_text_upload(upload, "Markdown")
        )
    except Exception as exc:  # noqa: BLE001
        return _fail(exc, "PDF")

    name = _safe_stem(upload.filename, "document") + ".pdf"
    return _pdf_response(pdf_bytes, name, unsupported)


@app.post("/api/image-to-pdf")
def image_to_pdf_route() -> Response:
    uploads = request.files.getlist("files")
    uploads = [u for u in uploads if u and u.filename]
    if not uploads:
        return jsonify(error="Upload one or more image files."), 400

    for u in uploads:
        ext = os.path.splitext(u.filename)[1].lower()
        if ext not in image_to_pdf.SUPPORTED_EXTENSIONS:
            return jsonify(error=f"Unsupported image type: {u.filename}"), 400

    try:
        pdf_bytes = image_to_pdf.convert([u.read() for u in uploads])
    except Exception as exc:  # noqa: BLE001
        return _fail(exc, "PDF")

    if len(uploads) == 1:
        name = _safe_stem(uploads[0].filename, "image") + ".pdf"
    else:
        name = "images.pdf"
    return send_file(
        io.BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=True,
        download_name=name,
    )


@app.post("/api/html-to-pdf")
def html_to_pdf_route() -> Response:
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        return jsonify(error="Upload an HTML (.html) file."), 400

    try:
        pdf_bytes, unsupported = html_to_pdf.convert_with_report(
            _read_text_upload(upload, "HTML")
        )
    except Exception as exc:  # noqa: BLE001
        return _fail(exc, "PDF")

    name = _safe_stem(upload.filename, "document") + ".pdf"
    return _pdf_response(pdf_bytes, name, unsupported)


def main() -> None:
    host = os.environ.get("CONVERTER_HOST", "127.0.0.1")
    port = int(os.environ.get("CONVERTER_PORT", "5000"))
    app.run(host=host, port=port, debug=bool(os.environ.get("CONVERTER_DEBUG")))


if __name__ == "__main__":
    main()
