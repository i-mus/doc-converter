"""Convert an HTML document into a PDF."""

from __future__ import annotations

import io

from xhtml2pdf import pisa

from . import pdf_prepare


def _block_external_resources(uri: str, _basepath: str | None) -> str:
    """Refuse to load anything that isn't already embedded in the HTML.

    xhtml2pdf resolves <img>/<link> URIs itself: left alone it will fetch
    http(s) URLs and read local files on the server's disk, which turns
    "convert this HTML" into an SSRF / local-file-disclosure primitive for
    whoever uploads it. Only ``data:`` URIs (content already embedded as
    base64) are allowed through unchanged; everything else is swapped for an
    empty resource, which xhtml2pdf treats as "not found" and skips.
    """
    if isinstance(uri, str) and uri.startswith("data:"):
        return uri
    return "data:,"


def convert_with_report(html: str) -> tuple[bytes, list[str]]:
    """Render HTML to PDF.

    Returns the PDF bytes and the distinct characters no bundled font can draw
    (e.g. CJK); those appear in the PDF as a white square.
    """
    html, unsupported = pdf_prepare.prepare(html)
    buffer = io.BytesIO()
    result = pisa.CreatePDF(
        src=html,
        dest=buffer,
        encoding="utf-8",
        link_callback=_block_external_resources,
    )
    if result.err:
        raise ValueError(f"HTML could not be converted ({result.err} error(s))")
    return buffer.getvalue(), unsupported


def convert(html: str) -> bytes:
    """Render an HTML string to PDF and return the file as bytes."""
    return convert_with_report(html)[0]


def convert_file(src_path: str, dest_path: str) -> None:
    """Convert an .html file on disk to a .pdf file on disk."""
    with open(src_path, "r", encoding="utf-8") as fh:
        html = fh.read()
    with open(dest_path, "wb") as fh:
        fh.write(convert(html))
