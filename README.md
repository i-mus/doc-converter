# Converter

Four tools, in two forms:

- **Markdown → DOCX** – drop a `.md` file, get a Word document back.
- **Markdown → PDF** – same file, PDF out (via the HTML → PDF engine below).
- **Image → PDF** – drop one or more images, get a single PDF (drag to reorder).
- **HTML → PDF** – drop an `.html` file, get a PDF back (web app only for now).

| Form | Path | Notes |
| --- | --- | --- |
| Web app (Flask) | this repo root | Hosted at <https://doc-converter-4vgm.onrender.com> |
| VS Code extension | [`extension/`](extension/) | Local, offline, nothing uploaded |

Uploaded files are converted in memory and never stored.

## Setup

Requires [uv](https://docs.astral.sh/uv/) and Python 3.12+.

```sh
uv sync
```

## Run

```sh
uv run converter
```

Then open <http://127.0.0.1:5000>.

Environment overrides: `CONVERTER_HOST`, `CONVERTER_PORT`, `CONVERTER_DEBUG=1`,
`CONVERTER_MAX_MB` (upload cap, default 100).

## Deploy (Render)

The repo ships a `render.yaml` Blueprint.

1. Push this repo to GitHub.
2. On <https://dashboard.render.com> → **New → Blueprint**, pick the repo.
   Render reads `render.yaml` and creates a free web service.
3. First deploy takes a few minutes; the app comes up at
   `https://doc-converter.onrender.com` (or whatever you name it).

Notes:

- **Free instances sleep after 15 min idle** — the first request then takes
  ~50 s to wake.
- Free RAM is 512 MB, so `render.yaml` sets `CONVERTER_MAX_MB=25`. Large image
  batches can still exhaust memory; bump the plan or the cap as needed.
- Served by `gunicorn` (1 worker, 4 threads, 120 s timeout). Health check: `/healthz`.

Any host that runs a Python web process works the same way — the `Procfile`
covers Railway / Heroku-style platforms.

## Use from Python / scripts

```python
from converter import md_to_docx, md_to_pdf, image_to_pdf, html_to_pdf

md_to_docx.convert_file("notes.md", "notes.docx")
md_to_pdf.convert_file("notes.md", "notes.pdf")
image_to_pdf.convert_files(["1.jpg", "2.png"], "out.pdf")
html_to_pdf.convert_file("report.html", "report.pdf")
```

## Project layout

| Path | Purpose |
|------|---------|
| `src/converter/md_to_docx.py`   | Markdown → HTML (`markdown`) → DOCX (`htmldocx` + `python-docx`) |
| `src/converter/md_to_pdf.py`    | Markdown → HTML (`markdown`) → PDF (`xhtml2pdf`, remote resources blocked) |
| `src/converter/image_to_pdf.py` | Normalise images with Pillow, assemble PDF with `img2pdf` |
| `src/converter/html_to_pdf.py`  | HTML → PDF (`xhtml2pdf`), external resources blocked (see below) |
| `src/converter/pdf_fonts.py`    | Registers the bundled fonts, maps CSS font names to them, splits text into font runs |
| `src/converter/pdf_prepare.py`  | Pre-render HTML pass: code wrapping, table column sizing, long-word breaks, emoji spans |
| `tests/`                        | Regression tests (SSRF, encodings, limits, fonts) — `uv run --with pytest pytest -q` |
| `src/converter/visits.py`       | Visit counter (Upstash Redis, or a local JSON file) |
| `src/converter/app.py`          | Flask app + JSON API, `robots.txt`, `sitemap.xml` |
| `src/converter/templates/index.html` | Drag-and-drop UI, SEO meta, JSON-LD |

## SEO & analytics

- `<title>`, description, keywords, Open Graph / Twitter tags and a
  `WebApplication` JSON-LD block are in the template; `robots.txt` and
  `sitemap.xml` are served by the app.
- Canonical / OG / sitemap URLs come from `CONVERTER_SITE_URL` (set it to the
  deployed origin), falling back to the request host.
- The footer shows a visit count from `/api/visits` (one bump per browser, via
  a year-long cookie). It uses Upstash Redis when `UPSTASH_REDIS_REST_URL` and
  `UPSTASH_REDIS_REST_TOKEN` are set, otherwise a local JSON file under
  `CONVERTER_DATA_DIR` (which resets on a Render free-tier restart — add the
  free Upstash tier to make it stick).

## Notes / limits

- Markdown supports headings, lists, tables, fenced code, blockquotes, links,
  and inline formatting. Images are **never embedded or fetched** — the alt
  text is kept — in both Word and PDF output (`md_to_docx.py` enforces it: the
  Word library would otherwise download any URL, or open any local path, from
  an uploaded file). A single newline is a soft break, as in CommonMark; two
  trailing spaces make a line break.
- PDFs use bundled fonts (`src/converter/fonts/`): DejaVu Sans / Sans Mono for
  Latin, Greek, Cyrillic, arrows, symbols and box drawing, and Noto Emoji
  (single-colour) for emoji. Characters with no font (Chinese, Japanese,
  Korean, Arabic, Hebrew) become □ and the page warns about it; Word output
  keeps them. Licences are next to the fonts.
- `pdf_prepare.py` works around xhtml2pdf layout gaps before rendering: it
  hard-wraps code, sizes table columns from their content and lets very long
  words break.
- Markdown / HTML uploads are capped at `CONVERTER_MAX_TEXT_MB` (default 1):
  xhtml2pdf takes about a minute and ~150 MB for 1 MB of Markdown, so larger
  files would hit the 120 s timeout or the free instance's memory.
- Images: JPG, PNG, GIF, BMP, TIFF, WEBP. Transparency is flattened onto white;
  EXIF orientation is applied. Animated/multi-page inputs use the first frame.
- HTML → PDF only renders content already embedded in the file (inline
  `<style>`, `data:` URI images). Linked stylesheets, fonts, and remote/local
  `<img src>` are **not** fetched — deliberately: this runs server-side on
  arbitrary uploads, and resolving external URIs there is a known SSRF /
  local-file-disclosure vector for HTML-to-PDF tools. `link_callback` in
  `html_to_pdf.py` enforces it.
- Request size cap is `CONVERTER_MAX_MB` (100 locally, 25 on the free Render plan).
