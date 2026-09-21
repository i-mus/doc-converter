"""Convert Markdown text into a Word (.docx) document."""

from __future__ import annotations

import io
import re

import markdown
from bs4 import BeautifulSoup, NavigableString
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


_UNCHECKED = chr(0x2610)  # ☐
_CHECKED = chr(0x2611)  # ☑
_TASK_MARK = re.compile(r"\s*\[([ xX])\](?:\s+|$)")


def _task_lists(html: str) -> str:
    """Turn GitHub-style ``- [x]`` / ``- [ ]`` items into ☑ / ☐ checkboxes.

    Python-Markdown leaves the ``[x]`` as literal text. Bulleted task items get
    ``class="task"`` so the PDF stylesheet can drop the bullet.
    """
    soup = BeautifulSoup(html, "html.parser")
    for li in soup.find_all("li"):
        first = next((s for s in li.find_all(string=True) if s.strip()), None)
        if first is None or type(first) is not NavigableString:
            continue
        # Only the item's own leading text, not text inside a nested list.
        if first.parent is not li and not (
            first.parent.name == "p" and first.parent.parent is li
        ):
            continue
        match = _TASK_MARK.match(str(first))
        if not match:
            continue
        box = _CHECKED if match.group(1) in "xX" else _UNCHECKED
        first.replace_with(f"{box} {str(first)[match.end():]}")
        # Bulleted items lose the bullet; numbered ones keep their number.
        if li.parent is not None and li.parent.name == "ul":
            li["class"] = li.get("class", []) + ["task"]
    return str(soup)


def markdown_to_html(md_text: str) -> str:
    """Render Markdown to an HTML fragment (images replaced by alt text)."""
    html = markdown.markdown(md_text, extensions=_EXTENSIONS, output_format="html")
    return _task_lists(_images_to_alt_text(html))


def _flatten_list_paragraphs(html: str) -> str:
    """Unwrap ``<li><p>`` (a "loose" list, items separated by blank lines).

    htmldocx opens a bullet paragraph for the ``<li>`` and then a second,
    bullet-less one for the ``<p>``, leaving an empty bullet with its text on
    the next line.
    """
    soup = BeautifulSoup(html, "html.parser")
    for li in soup.find_all("li"):
        paragraphs = li.find_all("p", recursive=False)
        for i, p in enumerate(paragraphs):
            if i < len(paragraphs) - 1:
                p.append(soup.new_tag("br"))
            p.unwrap()
    return str(soup)


def convert(md_text: str) -> bytes:
    """Convert a Markdown string to DOCX and return the file as bytes."""
    html = _flatten_list_paragraphs(markdown_to_html(md_text))

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
