"""Convert Markdown text into a Word (.docx) document."""

from __future__ import annotations

import io

import markdown
from bs4 import BeautifulSoup
from docx import Document
from htmldocx import HtmlToDocx

# Markdown extensions that cover the common cases: tables, fenced code blocks,
# footnotes and definition lists. A single newline is a soft break (a space),
# as in CommonMark, so hard-wrapped files flow; two trailing spaces still make
# a line break.
_EXTENSIONS = [
    "extra",
    "sane_lists",
    "toc",
]


def _images_to_alt_text(html: str) -> str:
    """Replace every <img> with its alt text.

    htmldocx downloads any http(s) image URL and opens any local path it is
    given, so an uploaded Markdown file could make the *server* fetch internal
    URLs or read its own files (SSRF / local file disclosure). Images are
    never embedded; nothing is fetched or opened.
    """
    soup = BeautifulSoup(html, "html.parser")
    for img in soup.find_all("img"):
        alt = (img.get("alt") or "").strip() or "image"
        marker = soup.new_tag("em")
        marker.string = f"[{alt}]"
        img.replace_with(marker)
    return str(soup)


def markdown_to_html(md_text: str) -> str:
    """Render Markdown to an HTML fragment (images replaced by alt text)."""
    html = markdown.markdown(md_text, extensions=_EXTENSIONS, output_format="html")
    return _images_to_alt_text(html)


def convert(md_text: str) -> bytes:
    """Convert a Markdown string to DOCX and return the file as bytes."""
    html = markdown_to_html(md_text)

    document = Document()
    parser = HtmlToDocx()
    parser.table_style = "Table Grid"
    parser.add_html_to_document(html, document)

    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def convert_file(src_path: str, dest_path: str) -> None:
    """Convert a .md file on disk to a .docx file on disk."""
    with open(src_path, "r", encoding="utf-8") as fh:
        md_text = fh.read()
    with open(dest_path, "wb") as fh:
        fh.write(convert(md_text))
