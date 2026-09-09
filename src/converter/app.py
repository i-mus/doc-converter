"""Flask web app exposing the two converters with a drag-and-drop UI."""

from __future__ import annotations

import io
import os
import re

from flask import Flask, Response, jsonify, render_template, request, send_file
from werkzeug.middleware.proxy_fix import ProxyFix

from . import image_to_pdf, md_to_docx, visits

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

    md_text = upload.read().decode("utf-8", errors="replace")
    try:
        docx_bytes = md_to_docx.convert(md_text)
    except Exception as exc:  # noqa: BLE001 - surface the reason to the UI
        return jsonify(error=f"Conversion failed: {exc}"), 500

    name = _safe_stem(upload.filename, "document") + ".docx"
    return send_file(
        io.BytesIO(docx_bytes),
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        as_attachment=True,
        download_name=name,
    )


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
        return jsonify(error=f"Conversion failed: {exc}"), 500

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


def main() -> None:
    host = os.environ.get("CONVERTER_HOST", "127.0.0.1")
    port = int(os.environ.get("CONVERTER_PORT", "5000"))
    app.run(host=host, port=port, debug=bool(os.environ.get("CONVERTER_DEBUG")))


if __name__ == "__main__":
    main()
