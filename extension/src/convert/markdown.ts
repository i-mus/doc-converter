import { marked } from "marked";
import HTMLtoDOCX from "@turbodocx/html-to-docx";

/**
 * Collapse the insignificant whitespace `marked` puts between list tags.
 *
 * `marked` emits `<ul>\n<li>a</li>\n<li>b</li>\n</ul>`; the newlines become
 * stray text nodes that stop @turbodocx/html-to-docx from recognising the
 * list, so items render as plain paragraphs with no bullets/numbers. We strip
 * only whitespace that sits between list-structure tags (or just inside an
 * `<li>`), leaving text — and inline spacing like `</code> <code>` — untouched.
 */
function tidyListWhitespace(html: string): string {
  return html
    .replace(
      /(<(?:ul|ol|li)(?:\s[^>]*)?>|<\/(?:ul|ol|li)>)\s+(?=<(?:ul|ol|li)(?:\s[^>]*)?>|<\/(?:ul|ol|li)>)/gi,
      "$1",
    )
    .replace(/(<li(?:\s[^>]*)?>)\s+/gi, "$1")
    .replace(/\s+(<\/li>)/gi, "$1");
}

/**
 * Replace every `<img>` with its alt text, except tiny inline `data:` images.
 *
 * @turbodocx/html-to-docx downloads any image URL it finds (retrying on
 * failure), so a Markdown file could make this extension call out to the
 * network — including to local/private addresses — which would break its
 * "never makes a network request" promise. Nothing is fetched.
 */
function neutralizeImages(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const value = (src?.[1] ?? src?.[2] ?? src?.[3] ?? "").trim();
    if (/^data:image\/(?:png|jpe?g|gif);base64,[a-z0-9+/=]+$/i.test(value)) return tag;

    const alt = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const text = (alt?.[1] ?? alt?.[2] ?? "").replace(/[<>]/g, "").trim() || "image";
    return `<em>[${text}]</em>`;
  });
}

/**
 * Render Markdown to a Word (.docx) document.
 *
 * Markdown -> HTML (marked, GFM) -> DOCX (@turbodocx/html-to-docx).
 * Images are not embedded (their alt text is kept) and nothing is downloaded.
 */
export async function markdownToDocx(markdown: string): Promise<Buffer> {
  const body = neutralizeImages(
    tidyListWhitespace(await marked.parse(markdown, { gfm: true, breaks: false })),
  );
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
