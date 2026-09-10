# Doc Converter

Convert **Markdown → Word (.docx)** and **images → PDF** without leaving VS Code.
Everything runs locally in the extension host — no upload, works offline.

## Usage

**Markdown to Word**
- Open a `.md` file and run **Doc Converter: Convert Markdown to Word (.docx)**
  from the Command Palette, or click the title-bar action, or right-click the
  file in the Explorer.
- The `.docx` is written next to the source file.

**Images to PDF**
- Select one or more `.png` / `.jpg` files in the Explorer, right-click →
  **Combine Images into PDF**.
- Or run the command with nothing selected to pick files from a dialog.
- Multiple images are ordered by filename (natural sort); one page per image.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `docConverter.openAfterConvert` | `true` | After converting, offer to reveal or open the file. |

## Limitations (v0.1)

- Markdown covers headings, lists, tables, code, blockquotes, links and inline
  formatting. Images referenced by a local/relative path are **not** embedded.
- Image → PDF supports **PNG and JPEG**. EXIF rotation is not yet applied.
- Complex Markdown tables and deeply nested lists may render more simply than in
  a full pandoc conversion.

For heavier conversions there is also a web version at
<https://doc-converter-4vgm.onrender.com>.

## Development

```sh
npm install
npm run check     # type-check
npm run smoke     # headless conversion test -> smoke.docx / smoke.pdf
npm run build     # bundle to dist/extension.js
npm run package   # build + create the .vsix
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host.
