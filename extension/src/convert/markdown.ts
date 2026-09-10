import { marked } from "marked";
import HTMLtoDOCX from "@turbodocx/html-to-docx";

/**
 * Render Markdown to a Word (.docx) document.
 *
 * Markdown -> HTML (marked, GFM) -> DOCX (@turbodocx/html-to-docx).
 * Local/relative image references are not embedded.
 */
export async function markdownToDocx(markdown: string): Promise<Buffer> {
  const body = await marked.parse(markdown, { gfm: true, breaks: false });
  const html =
    `<!DOCTYPE html><html><head><meta charset="utf-8"></head>` +
    `<body>${body}</body></html>`;

  const out = await HTMLtoDOCX(html, null, {
    table: { row: { cantSplit: true } },
    footer: false,
    header: false,
  });

  // Node builds return a Buffer; be defensive for other shapes.
  if (Buffer.isBuffer(out)) return out;
  if (out instanceof ArrayBuffer) return Buffer.from(out);
  if (out instanceof Uint8Array) return Buffer.from(out);
  return Buffer.from(await (out as Blob).arrayBuffer());
}
