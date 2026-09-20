# Doc Converter

Convert **Markdown → Word (.docx)**, **Markdown → PDF** and **images → PDF**, right from VS Code.
No upload, no sign-up, no account — the conversion runs on your machine, in
the extension itself.

Not in VS Code, or converting on someone else's machine? The same
converters — plus **HTML → PDF**, currently web-only — run as a free
website: **[doc-converter-4vgm.onrender.com](https://doc-converter-4vgm.onrender.com)**.
A VS Code version of HTML → PDF is in testing; see [Roadmap](#roadmap).

## Features

- **Markdown to Word** — headings, bold/italic/code, bullet and numbered
  lists (nested too), tables, blockquotes and links all carry over. Open any
  `.md` file and a **Convert Markdown to Word (.docx)** button appears in the
  top-right of the editor — one click, done.
- **Markdown to PDF** — same idea, same places, a clean A4 PDF: headings,
  lists (nested and task lists), tables, code blocks, quotes and links.
  Built into the extension — no browser, nothing to install.
- **Images to PDF** — combine any number of PNG/JPEG files into one PDF,
  one page per image, in the order you pick. Open a single image and a
  **Combine Images into PDF** button appears in the top-right of the editor.
- Nothing is uploaded. No accounts, no API keys, no configuration required.
- Open source (MIT) — the code is public, issues and PRs are welcome.

## How to use

### Markdown → Word or PDF

Pick whichever is closest at hand — all three work the same way, for Word
and for PDF:

1. Open a `.md` file, then either:
   - **Easiest:** click **Convert Markdown to Word (.docx)** or **Convert
     Markdown to PDF** in the top-right of the editor, next to the tab bar
   - Command Palette (<kbd>Ctrl+Shift+P</kbd> / <kbd>Cmd+Shift+P</kbd>) →
     **Doc Converter: Convert Markdown to Word (.docx)** (or **… to PDF**)
   - right-click the file in the Explorer sidebar → **Convert Markdown to
     Word (.docx)** or **Convert Markdown to PDF**
2. A `.docx` (or `.pdf`) with the same name appears next to the `.md` file. A toast
   offers to reveal or open it.

No file open? Run the command anyway — it'll ask you to pick a `.md` file.

### Images → PDF

1. **One image:** open it in VS Code and click **Combine Images into PDF** in
   the top-right of the editor. The PDF is saved next to it, named after the
   image.
2. **Several images:** in the Explorer, select them (<kbd>Ctrl</kbd>/<kbd>Cmd</kbd>-click
   to multi-select) → right-click → **Combine Images into PDF**. They're
   saved as `images.pdf` in the same folder, ordered by filename.
3. Nothing selected? Run **Doc Converter: Combine Images into PDF** from the
   Command Palette instead — it opens a file picker.

That's the whole workflow. There's no setup step and nothing to configure
before your first conversion.

## Why local matters

Markdown notes and images are often drafts, private notes, or client work —
not things you want passed through a third-party server just to change
format. This extension never makes a network request: everything is public
in the [source](https://github.com/i-mus/doc-converter/tree/main/extension),
so that claim is checkable rather than just stated.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `docConverter.openAfterConvert` | `true` | Show a "Reveal / Open" prompt after each conversion. Turn off for silent conversions. |

## Current limits

- **Images inside Markdown aren't embedded** in either format — the alt text
  is kept instead. That's deliberate: fetching an image means a network
  request, and this extension never makes one.
- Image → PDF reads **PNG and JPEG**. EXIF auto-rotation isn't applied yet.
- Very elaborate tables may render more simply than a full pandoc conversion.
- Markdown → PDF draws Latin, Greek and Cyrillic text plus arrows, symbols
  and emoji (emoji are single-colour). Scripts it has no font for — Chinese,
  Japanese, Korean, Arabic, Hebrew — show as □ and you get a warning saying
  so. **Markdown → Word keeps them all**, so use that for such documents.

## Roadmap

- **HTML → PDF** is live on the [web version](https://doc-converter-4vgm.onrender.com)
  and in testing for VS Code. Good local HTML→PDF needs real CSS/layout
  rendering, which in practice means bundling a headless browser — a
  meaningfully bigger, heavier dependency than `marked`/`pdf-lib`, so it's
  being evaluated rather than shipped outright, to keep the "no network,
  no setup" promise this extension makes intact.
- Beyond that: DOCX ↔ PDF and others — same principle each time, a new
  command, zero new setup.

## Contributing

Issues and pull requests are welcome at
[github.com/i-mus/doc-converter](https://github.com/i-mus/doc-converter).
The extension lives in the `extension/` folder; the Flask source for the
[web version](https://doc-converter-4vgm.onrender.com) is at the repo root.

## Development

```sh
npm install
npm run check     # type-check
npm run smoke     # headless conversion test -> smoke.docx / smoke.pdf
npm test          # integration tests in a real VS Code instance
npm run build     # bundle to dist/extension.js
npm run package   # build + create the .vsix
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host.

## License

[MIT](LICENSE)
