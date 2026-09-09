"""Combine one or more images into a single PDF."""

from __future__ import annotations

import io
from typing import Iterable

import img2pdf
from PIL import Image, ImageOps, ImageSequence

# Formats Pillow can open that we are willing to accept.
SUPPORTED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tif", ".tiff", ".webp",
}


def _normalise(data: bytes) -> bytes:
    """Return image bytes that img2pdf can embed reliably.

    img2pdf rejects images with an alpha channel or an unusual colour mode, and
    it ignores EXIF orientation. We open every image with Pillow, bake in the
    orientation, flatten transparency onto white, and re-encode as JPEG.
    """
    with Image.open(io.BytesIO(data)) as im:
        # Multi-frame images (animated GIF/WEBP, multipage TIFF): take frame 1.
        if getattr(im, "n_frames", 1) > 1:
            im = ImageSequence.Iterator(im)[0]

        im = ImageOps.exif_transpose(im)

        if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
            rgba = im.convert("RGBA")
            background = Image.new("RGB", rgba.size, (255, 255, 255))
            background.paste(rgba, mask=rgba.split()[-1])
            im = background
        elif im.mode != "RGB":
            im = im.convert("RGB")

        out = io.BytesIO()
        im.save(out, format="JPEG", quality=95)
        return out.getvalue()


def convert(images: Iterable[bytes]) -> bytes:
    """Convert an ordered iterable of image byte strings into one PDF (bytes)."""
    normalised = [_normalise(data) for data in images]
    if not normalised:
        raise ValueError("No images supplied")
    return img2pdf.convert(normalised)


def convert_files(src_paths: list[str], dest_path: str) -> None:
    """Combine image files on disk into a single PDF on disk."""
    images = []
    for path in src_paths:
        with open(path, "rb") as fh:
            images.append(fh.read())
    with open(dest_path, "wb") as fh:
        fh.write(convert(images))
