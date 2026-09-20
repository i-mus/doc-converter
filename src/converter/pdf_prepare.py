"""Rewrite HTML so xhtml2pdf lays it out sensibly.

xhtml2pdf never breaks inside a word, sizes table columns without looking at
their content, and doesn't wrap ``<pre>``. Left alone, long URLs, code lines
and wide tables run off the right edge of the page or overlap their
neighbours. This pass hard-wraps code, sizes table columns from what they
hold, and gives very long words somewhere to break, then hands each character
to a font that can draw it (see ``pdf_fonts``).
"""

from __future__ import annotations

import re

from bs4 import BeautifulSoup, NavigableString

from . import pdf_fonts

_SKIP_TAGS = {"style", "script", "title", "head", "meta", "link"}

# A thin space is the narrowest character xhtml2pdf will wrap at.
_BREAK = chr(0x2009)

# Rough metrics for the DejaVu fonts at the default sizes, in points.
_CONTENT_WIDTH = 482.0  # A4 minus the Markdown stylesheet's 2 cm margins
_SANS_CHAR = 6.0
_MONO_CHAR = 5.8
_CELL_PAD = 10.0  # padding + border, both sides

_PRE_COLS = 76  # code lines longer than this are hard-wrapped
_LONG_WORD = 50  # words longer than this get break opportunities


def _text_nodes(root) -> list[NavigableString]:
    return [
        node
        for node in root.find_all(string=True)
        if type(node) is NavigableString  # not comments / doctype / CDATA
        and not any(p.name in _SKIP_TAGS for p in node.parents)
    ]


def _break_long_words(text: str, limit: int) -> str:
    def chunk(match: re.Match[str]) -> str:
        word = match.group(0)
        return _BREAK.join(word[i : i + limit] for i in range(0, len(word), limit))

    return re.sub(r"\S{%d,}" % (limit + 1), chunk, text)


def _wrap_pre(soup: BeautifulSoup) -> None:
    for pre in soup.find_all("pre"):
        for node in _text_nodes(pre):
            lines: list[str] = []
            for line in str(node).replace("\t", "    ").split("\n"):
                while len(line) > _PRE_COLS:
                    lines.append(line[:_PRE_COLS])
                    line = line[_PRE_COLS:]
                lines.append(line)
            node.replace_with("\n".join(lines))


def _fit_tables(soup: BeautifulSoup) -> None:
    """Give each column a width that fits its content, and break words that still won't fit."""
    for table in soup.find_all("table"):
        if table.find("table"):
            continue  # nested layouts: leave alone
        rows = [
            [c for c in tr.find_all(["td", "th"], recursive=False)]
            for tr in table.find_all("tr")
        ]
        rows = [r for r in rows if r]
        if not rows:
            continue
        if any(
            c.has_attr("colspan") or c.has_attr("rowspan") or c.has_attr("width")
            for r in rows
            for c in r
        ):
            continue  # author already controls the layout

        cols = max(len(r) for r in rows)
        available = _CONTENT_WIDTH - cols * 0.5
        char = [_SANS_CHAR] * cols
        longest = [0.0] * cols
        ideal = [0.0] * cols
        for r in rows:
            for i, cell in enumerate(r):
                width = _MONO_CHAR if cell.find(["code", "pre", "tt"]) else _SANS_CHAR
                char[i] = max(char[i], width)
                words = cell.get_text(" ").split()
                longest[i] = max(longest[i], max((len(w) for w in words), default=0) * width)
                ideal[i] = max(ideal[i], len(" ".join(words)) * width)

        min_w = [min(longest[i], available / 2) + _CELL_PAD for i in range(cols)]
        ideal_w = [max(ideal[i] + _CELL_PAD, min_w[i]) for i in range(cols)]
        sum_min, sum_ideal = sum(min_w), sum(ideal_w)
        if sum_min >= available:
            widths = [w / sum_min * available for w in min_w]
        elif sum_ideal <= available:
            widths = [w / sum_ideal * available for w in ideal_w]
        else:
            spare = available - sum_min
            want = [ideal_w[i] - min_w[i] for i in range(cols)]
            total = sum(want) or 1.0
            widths = [min_w[i] + want[i] / total * spare for i in range(cols)]

        for r in rows:
            for i, cell in enumerate(r):
                cell["width"] = f"{widths[i] / available * 100:.2f}%"
                limit = max(4, int((widths[i] - _CELL_PAD) / char[i]))
                for node in _text_nodes(cell):
                    node.replace_with(_break_long_words(str(node), limit))
        table["data-fitted"] = "1"


def _break_remaining_words(soup: BeautifulSoup) -> None:
    for node in _text_nodes(soup):
        if any(p.name == "pre" or p.get("data-fitted") for p in node.parents):
            continue
        text = str(node)
        fixed = _break_long_words(text, _LONG_WORD)
        if fixed != text:
            node.replace_with(fixed)


def _apply_fonts(soup: BeautifulSoup) -> list[str]:
    seen: set[str] = set()
    for node in _text_nodes(soup):
        text = str(node)
        if text.isascii():
            continue
        pieces = pdf_fonts.shape(text, seen)
        if len(pieces) == 1 and not pieces[0][0]:
            node.replace_with(pieces[0][1])
            continue
        wrapper = soup.new_tag("span")
        for is_emoji, chunk in pieces:
            if is_emoji:
                span = soup.new_tag("span", style=f"font-family: {pdf_fonts.EMOJI_FAMILY}")
                span.string = chunk
                wrapper.append(span)
            else:
                wrapper.append(NavigableString(chunk))
        node.replace_with(wrapper)
        wrapper.unwrap()
    return sorted(seen)


def prepare(html: str) -> tuple[str, list[str]]:
    """Return layout-safe HTML plus the characters no bundled font can draw."""
    pdf_fonts.setup()
    soup = BeautifulSoup(html, "html.parser")
    _wrap_pre(soup)
    _fit_tables(soup)
    _break_remaining_words(soup)
    unsupported = _apply_fonts(soup)
    return str(soup), unsupported
