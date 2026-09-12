# Doc Converter

Convert **Markdown → Word (.docx)** and **images → PDF**, right from VS Code.
No upload, no sign-up, no account — the conversion runs on your machine, in
the extension itself.

Not in VS Code, or converting on someone else's machine? The same two
converters — plus **HTML → PDF**, currently web-only — run as a free
website: **[doc-converter-4vgm.onrender.com](https://doc-converter-4vgm.onrender.com)**.
A VS Code version of HTML → PDF is in testing; see [Roadmap](#roadmap).

## Features

- **Markdown to Word** — headings, bold/italic/code, bullet and numbered
  lists (nested too), tables, blockquotes and links all carry over.
- **Images to PDF** — combine any number of PNG/JPEG files into one PDF,
  one page per image, in the order you pick.
- Nothing is uploaded. No accounts, no API keys, no configuration required.
- Open source (MIT) — the code is public, issues and PRs are welcome.

## How to use

### Markdown → Word

Pick whichever is closest at hand — all three do the same thing:

1. Open a `.md` file, then either:
   - Command Palette (<kbd>Ctrl+Shift+P</kbd> / <kbd>Cmd+Shift+P</kbd>) →
     **Doc Converter: Convert Markdown to Word (.docx)**
   - the icon in the editor's title bar (top-right of the tab)
   - right-click the file in the Explorer sidebar → **Convert Markdown to
     Word (.docx)**
2. A `.docx` with the same name appears next to the `.md` file. A toast
   offers to reveal or open it.

No file open? Run the command anyway — it'll ask you to pick a `.md` file.

### Images → PDF

1. In the Explorer, select one or more images (<kbd>Ctrl</kbd>/<kbd>Cmd</kbd>-click
   to multi-select) → right-click → **Combine Images into PDF**.
   - One image selected → PDF is named after that image.
   - Several → saved as `images.pdf` in the same folder, ordered by filename.
2. Nothing selected? Run **Doc Converter: Combine Images into PDF** from the
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

- Local/relative `![image](...)` references inside Markdown aren't embedded
  (only remote images work, and only if you're online).
- Image → PDF reads **PNG and JPEG**. EXIF auto-rotation isn't applied yet.
- Very elaborate tables may render more simply than a full pandoc conversion.

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
