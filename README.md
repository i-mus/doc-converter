# Converter

A small local web app with two tools:

- **Markdown → DOCX** – drop a `.md` file, get a Word document back.
- **Image → PDF** – drop one or more images, get a single PDF (drag to reorder).

Everything runs on your machine; uploaded files are converted in memory and never
sent anywhere.

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
from converter import md_to_docx, image_to_pdf

md_to_docx.convert_file("notes.md", "notes.docx")
image_to_pdf.convert_files(["1.jpg", "2.png"], "out.pdf")
```

## Project layout

| Path | Purpose |
|------|---------|
| `src/converter/md_to_docx.py`   | Markdown → HTML (`markdown`) → DOCX (`htmldocx` + `python-docx`) |
| `src/converter/image_to_pdf.py` | Normalise images with Pillow, assemble PDF with `img2pdf` |
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
  and inline formatting. Embedded images by URL are not fetched.
- Images: JPG, PNG, GIF, BMP, TIFF, WEBP. Transparency is flattened onto white;
  EXIF orientation is applied. Animated/multi-page inputs use the first frame.
- Request size cap is `CONVERTER_MAX_MB` (100 locally, 25 on the free Render plan).
