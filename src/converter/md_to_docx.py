"""Convert Markdown text into a Word (.docx) document."""

from __future__ import annotations

import io

import markdown
from docx import Document
from htmldocx import HtmlToDocx

# Markdown extensions that cover the common cases: tables, fenced code blocks,
# footnotes, definition lists, and automatic <br> on trailing spaces / newlines.
_EXTENSIONS = [
    "extra",
    "sane_lists",
    "nl2br",
    "toc",
]


def markdown_to_html(md_text: str) -> str:
    """Render Markdown to an HTML fragment."""
    return markdown.markdown(md_text, extensions=_EXTENSIONS, output_format="html")


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
