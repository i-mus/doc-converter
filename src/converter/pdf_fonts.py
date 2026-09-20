"""Unicode-capable fonts for the HTML -> PDF pipeline.

xhtml2pdf's built-in fonts (Helvetica/Times/Courier) only cover Latin-1, so
arrows, check marks, box drawing, emoji and even some accented letters come
out as empty boxes. This module

* registers DejaVu Sans / Sans Mono (Latin, Greek, Cyrillic, arrows, symbols,
  box drawing...) and routes every common CSS font-family name to them, and
* wraps emoji in a span that uses the (monochrome) Noto Emoji font, because
  reportlab can't fall back from one font to another by itself.

Characters no bundled font has (e.g. CJK) are drawn as a white square and
reported, so callers can tell the user instead of silently producing boxes.
Font licences live next to the font files.
"""

from __future__ import annotations

import functools
import re
from pathlib import Path

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from xhtml2pdf import default

_FONT_DIR = Path(__file__).parent / "fonts"

_SANS = "DejaVuSans"
_MONO = "DejaVuSansMono"
_EMOJI = "NotoEmoji"

EMOJI_FAMILY = _EMOJI

# CSS family names (lower-case) -> registered font. Anything unknown falls back
# to "helvetica", which is mapped to the sans font too.
_MONO_NAMES = "courier|courier new|mono|monospace|monospaced|consolas|menlo|monaco|lucida console"

_WHITE_SQUARE = chr(0x25A1)
# Joiners, selectors, skin-tone and tag modifiers: the monochrome emoji font has
# no ligatures for them, so they'd print as boxes. Drop them (and zero-width space).
_INVISIBLE = re.compile(
    "["
    + "".join(chr(c) for c in (0xFE0E, 0xFE0F, 0x200B, 0x200D, 0x20E3))
    + f"{chr(0x1F3FB)}-{chr(0x1F3FF)}{chr(0xE0020)}-{chr(0xE007F)}]"
)
# A flag is two regional-indicator letters; show the country code instead.
_FLAG = re.compile(
    f"([{chr(0x1F1E6)}-{chr(0x1F1FF)}])([{chr(0x1F1E6)}-{chr(0x1F1FF)}])"
)


@functools.cache
def _cmaps() -> tuple[frozenset[int], frozenset[int]]:
    setup()
    sans = frozenset(pdfmetrics.getFont(_SANS).face.charToGlyph)
    emoji = frozenset(pdfmetrics.getFont(_EMOJI).face.charToGlyph)
    return sans, emoji


@functools.cache
def setup() -> None:
    """Register the fonts and point xhtml2pdf's family names at them (once)."""

    def add(name: str, filename: str) -> None:
        pdfmetrics.registerFont(TTFont(name, str(_FONT_DIR / filename)))

    for family, stem in ((_SANS, "DejaVuSans"), (_MONO, "DejaVuSansMono")):
        add(family, f"{stem}.ttf")
        add(f"{family}-Bold", f"{stem}-Bold.ttf")
        add(f"{family}-Oblique", f"{stem}-Oblique.ttf")
        add(f"{family}-BoldOblique", f"{stem}-BoldOblique.ttf")
        pdfmetrics.registerFontFamily(
            family,
            normal=family,
            bold=f"{family}-Bold",
            italic=f"{family}-Oblique",
            boldItalic=f"{family}-BoldOblique",
        )

    add(_EMOJI, "NotoEmoji-Regular.ttf")
    pdfmetrics.registerFontFamily(
        _EMOJI, normal=_EMOJI, bold=_EMOJI, italic=_EMOJI, boldItalic=_EMOJI
    )

    table = default.DEFAULT_FONT  # copied into every conversion context
    for name in ("arial helvetica geneva sans sansserif sans-serif verdana tahoma "
                 "calibri roboto inter system-ui serif georgia times times-roman "
                 "cambria garamond palatino").split() + ["trebuchet ms", "segoe ui", "times new roman"]:
        table[name] = _SANS
    for name in _MONO_NAMES.split("|"):
        table[name] = _MONO
    table["dejavusans"] = _SANS
    table[_EMOJI.lower()] = _EMOJI
    # Bold/oblique variants that xhtml2pdf looks up by suffix.
    for base, target in (("helvetica", _SANS), ("courier", _MONO)):
        table[f"{base}-bold"] = f"{target}-Bold"
        table[f"{base}-oblique"] = f"{target}-Oblique"
        table[f"{base}-boldoblique"] = f"{target}-BoldOblique"


def shape(text: str, seen: set[str]) -> list[tuple[bool, str]]:
    """Split text into (is_emoji, chunk) pieces; unsupported characters -> white square."""
    sans, emoji = _cmaps()
    text = _FLAG.sub(
        lambda m: chr(ord(m.group(1)) - 0x1F1E6 + 65) + chr(ord(m.group(2)) - 0x1F1E6 + 65),
        text,
    )
    text = _INVISIBLE.sub("", text)

    pieces: list[tuple[bool, str]] = []
    for ch in text:
        cp = ord(ch)
        if ch.isspace() or cp < 0x20 or cp in sans:
            is_emoji, out = False, ch
        elif cp in emoji:
            is_emoji, out = True, ch
        else:
            seen.add(ch)
            is_emoji, out = False, _WHITE_SQUARE
        if pieces and pieces[-1][0] == is_emoji:
            pieces[-1] = (is_emoji, pieces[-1][1] + out)
        else:
            pieces.append((is_emoji, out))
    return pieces
