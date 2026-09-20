# Changelog

## 0.2.0

- New: **Convert Markdown to PDF** — same three ways as Word (editor button,
  right-click, Command Palette). Headings, lists (nested, task lists), tables,
  code blocks, quotes and links carry over. Still 100% local: no browser, no
  network.
- New: opening a PNG/JPEG shows a **Combine Images into PDF** button in the
  top-right of the editor (converts that one image). Several images still go
  through the Explorer right-click.
- README: document the one-click Markdown button.

## 0.1.6

- README: call out the one-click **Convert Markdown to Word (.docx)** button
  in the top-right of the editor for `.md` files. No code changes.

## 0.1.5

- README: note that HTML → PDF is live on the web version and in testing
  for VS Code (see Roadmap for why it's not a quick add). No code changes.

## 0.1.4

- README: link the web version (doc-converter-4vgm.onrender.com) up top and
  in Contributing, not just in the Marketplace homepage field.

## 0.1.3

- Fix: converting an unsaved Markdown buffer (new file, never saved to disk)
  now asks where to save the .docx via a Save dialog, instead of failing with
  a filesystem error.

## 0.1.2

- Marketplace listing: better keywords/description for search, a branded
  gallery banner, and a rewritten README with a clear How to Use section.
  No functional changes.

## 0.1.1

- Markdown bullet and numbered lists (including nested) now render as real
  Word lists instead of plain paragraphs.

## 0.1.0

- Initial release.
- Convert Markdown to Word (.docx) from the editor, Explorer, or Command Palette.
- Combine PNG/JPEG images into a single PDF.
