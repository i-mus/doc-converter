"""Convert Markdown text into a PDF."""

from __future__ import annotations

from . import html_to_pdf
from .md_to_docx import markdown_to_html

# xhtml2pdf understands a modest CSS subset; this keeps headings, code blocks,
# tables and quotes readable on an A4 page using the built-in PDF fonts.
_STYLE = """
@page { size: A4; margin: 2cm; }
body { font-family: Helvetica; font-size: 11pt; line-height: 1.45; color: #222; }
h1 { font-size: 22pt; margin-top: 18pt; }
h2 { font-size: 17pt; margin-top: 16pt; }
h3 { font-size: 14pt; margin-top: 14pt; }
h4, h5, h6 { font-size: 12pt; margin-top: 12pt; }
a { color: #b4552d; }
code, pre { font-family: Courier; font-size: 9.5pt; background-color: #f3f0ec; }
pre { padding: 8pt; }
blockquote { margin-left: 12pt; padding-left: 10pt; border-left: 2pt solid #b4552d; color: #555; }
table { border: 0.5pt solid #999; border-collapse: collapse; }
th, td { border: 0.5pt solid #999; padding: 4pt; }
th { background-color: #f3f0ec; }
hr { border: 0; border-top: 0.5pt solid #999; }
"""


def convert_with_report(md_text: str) -> tuple[bytes, list[str]]:
    """Convert Markdown to PDF; also return characters no bundled font can draw."""
    body = markdown_to_html(md_text)
    page = (
        '<html><head><meta charset="utf-8"><style>'
        f"{_STYLE}</style></head><body>{body}</body></html>"
    )
    return html_to_pdf.convert_with_report(page)


def convert(md_text: str) -> bytes:
    """Convert a Markdown string to PDF and return the file as bytes."""
    return convert_with_report(md_text)[0]


def convert_file(src_path: str, dest_path: str) -> None:
    """Convert a .md file on disk to a .pdf file on disk."""
    with open(src_path, "r", encoding="utf-8") as fh:
        md_text = fh.read()
    with open(dest_path, "wb") as fh:
        fh.write(convert(md_text))
