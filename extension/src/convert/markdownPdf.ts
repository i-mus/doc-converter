import { marked, type Token, type Tokens } from "marked";
// The browser build bundles cleanly with esbuild (no filesystem font lookups)
// and works in the Node extension host.
import pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { COURIER_AFM } from "./courierAfm";

const ACCENT = "#b4552d";
const MUTED = "#555555";
const PANEL = "#f3f0ec";
const RULE = "#999999";

// A4 is 595pt wide; the page margins below leave this much for content.
const PAGE_MARGIN = 56;
const PAGE_CONTENT_WIDTH = 595 - PAGE_MARGIN * 2;

const HEADING_SIZE = [0, 22, 17, 14, 12, 11, 11];

type Run = Record<string, unknown>;
type Style = Run;

/**
 * Fonts and their files. `vfs_fonts` ships Roboto; Courier is a built-in
 * standard font whose metrics file we add ourselves. Passed straight to
 * createPdf, so nothing depends on browser globals.
 */
const FONTS = {
  Roboto: {
    normal: "Roboto-Regular.ttf",
    bold: "Roboto-Medium.ttf",
    italics: "Roboto-Italic.ttf",
    bolditalics: "Roboto-MediumItalic.ttf",
  },
  Courier: {
    normal: "Courier",
    bold: "Courier",
    italics: "Courier",
    bolditalics: "Courier",
  },
};

function vfs(): Record<string, string> {
  const base = (pdfFonts as { pdfMake?: { vfs: Record<string, string> } }).pdfMake?.vfs;
  return { ...(base ?? (pdfFonts as unknown as Record<string, string>)), "data/Courier.afm": COURIER_AFM };
}

/** marked escapes HTML in text/codespan tokens; undo that for the PDF. */
function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

/* ------------------------------------------------------------------- inline */

function inline(tokens: Token[] | undefined, style: Style = {}): Run[] {
  const out: Run[] = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "text": {
        const tt = t as Tokens.Text;
        if (tt.tokens?.length) out.push(...inline(tt.tokens, style));
        else out.push({ ...style, text: unescapeHtml(tt.text) });
        break;
      }
      case "escape":
        out.push({ ...style, text: unescapeHtml((t as Tokens.Escape).text) });
        break;
      case "strong":
        out.push(...inline((t as Tokens.Strong).tokens, { ...style, bold: true }));
        break;
      case "em":
        out.push(...inline((t as Tokens.Em).tokens, { ...style, italics: true }));
        break;
      case "del":
        out.push(
          ...inline((t as Tokens.Del).tokens, { ...style, decoration: "lineThrough" }),
        );
        break;
      case "codespan":
        out.push({
          ...style,
          text: unescapeHtml((t as Tokens.Codespan).text),
          font: "Courier",
          background: PANEL,
        });
        break;
      case "link": {
        const l = t as Tokens.Link;
        out.push(
          ...inline(l.tokens, {
            ...style,
            link: l.href,
            color: ACCENT,
            decoration: "underline",
          }),
        );
        break;
      }
      case "image": {
        // Local/remote images aren't embedded; keep the alt text so nothing vanishes.
        const alt = unescapeHtml((t as Tokens.Image).text || "image");
        out.push({ ...style, text: `[${alt}]`, italics: true, color: MUTED });
        break;
      }
      case "br":
        out.push({ ...style, text: "\n" });
        break;
      case "html":
        // Inline HTML tags are dropped; their text content stays as its own tokens.
        break;
      default: {
        const raw = (t as { raw?: string }).raw;
        if (raw) out.push({ ...style, text: unescapeHtml(stripTags(raw)) });
      }
    }
  }
  return out;
}

function textNode(tokens: Token[] | undefined, extra: Run = {}): Content {
  const runs = inline(tokens);
  return { text: runs.length ? runs : "", ...extra } as Content;
}

/* -------------------------------------------------------------------- block */

function codeBlock(text: string): Content {
  return {
    table: {
      widths: ["*"],
      body: [
        [
          {
            text: text.replace(/\n$/, "") || " ",
            font: "Courier",
            fontSize: 9,
            preserveLeadingSpaces: true,
          },
        ],
      ],
    },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      fillColor: () => PANEL,
      paddingLeft: () => 8,
      paddingRight: () => 8,
      paddingTop: () => 6,
      paddingBottom: () => 6,
    },
    margin: [0, 2, 0, 10],
  } as Content;
}

function quote(children: Content[]): Content {
  return {
    table: {
      widths: [3, "*"],
      body: [[{ text: "", fillColor: ACCENT }, { stack: children, color: MUTED }]],
    },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: (i: number) => (i === 1 ? 10 : 0),
      paddingRight: () => 0,
      paddingTop: () => 2,
      paddingBottom: () => 2,
    },
    margin: [4, 2, 0, 10],
  } as Content;
}

function listItem(item: Tokens.ListItem): Content {
  const parts = blocks(item.tokens, true);
  if (item.task) {
    const box = { text: item.checked ? "[x] " : "[ ] ", font: "Courier" };
    const first = parts[0] as { text?: unknown };
    if (first && Array.isArray(first.text)) first.text = [box, ...first.text];
    else if (first && typeof first.text === "string") first.text = [box, { text: first.text }];
    else parts.unshift({ text: [box] } as Content);
  }
  return parts.length === 1 ? parts[0] : ({ stack: parts } as Content);
}

function list(l: Tokens.List, nested: boolean): Content {
  const margin = nested ? [0, 0, 0, 0] : [0, 0, 0, 8];
  const items = l.items.map(listItem);
  return (
    l.ordered
      ? { ol: items, start: typeof l.start === "number" ? l.start : 1, margin }
      : { ul: items, margin }
  ) as Content;
}

function table(t: Tokens.Table): Content {
  const cell = (c: Tokens.TableCell, header: boolean, i: number): Content =>
    ({
      text: inline(c.tokens, header ? { bold: true } : {}),
      alignment: t.align[i] ?? "left",
      ...(header ? { fillColor: PANEL } : {}),
    }) as unknown as Content;

  return {
    table: {
      headerRows: 1,
      widths: t.header.map(() => "*"),
      body: [
        t.header.map((c, i) => cell(c, true, i)),
        ...t.rows.map((r) => r.map((c, i) => cell(c, false, i))),
      ],
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => RULE,
      vLineColor: () => RULE,
      paddingLeft: () => 6,
      paddingRight: () => 6,
      paddingTop: () => 4,
      paddingBottom: () => 4,
    },
    margin: [0, 2, 0, 10],
  } as Content;
}

function blocks(tokens: Token[], tight = false): Content[] {
  const out: Content[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case "heading": {
        const h = t as Tokens.Heading;
        out.push(
          textNode(h.tokens, {
            bold: true,
            fontSize: HEADING_SIZE[h.depth] ?? 11,
            margin: [0, h.depth === 1 ? 14 : 12, 0, 6],
          }),
        );
        break;
      }
      case "paragraph":
        out.push(textNode((t as Tokens.Paragraph).tokens, { margin: [0, 0, 0, tight ? 2 : 8] }));
        break;
      case "text":
        // A bare text block inside a list item.
        out.push(textNode([t], { margin: [0, 0, 0, 2] }));
        break;
      case "list":
        out.push(list(t as Tokens.List, tight));
        break;
      case "code":
        out.push(codeBlock((t as Tokens.Code).text));
        break;
      case "blockquote":
        out.push(quote(blocks((t as Tokens.Blockquote).tokens)));
        break;
      case "table":
        out.push(table(t as Tokens.Table));
        break;
      case "hr":
        out.push({
          canvas: [
            { type: "line", x1: 0, y1: 0, x2: PAGE_CONTENT_WIDTH, y2: 0, lineWidth: 0.5, lineColor: RULE },
          ],
          margin: [0, 8, 0, 8],
        } as Content);
        break;
      case "html": {
        const text = unescapeHtml(stripTags((t as Tokens.HTML).text)).trim();
        if (text) out.push({ text, margin: [0, 0, 0, 8] } as Content);
        break;
      }
      default:
        break; // space, def, etc.
    }
  }
  return out;
}

/* ------------------------------------------------------------------- public */

/**
 * Render Markdown to a PDF.
 *
 * Markdown -> tokens (marked, GFM) -> pdfmake document -> PDF bytes. Pure
 * JavaScript, fully local: no browser, no network. Images are not embedded
 * (alt text is kept). Text uses Roboto, so scripts Roboto lacks (e.g. CJK)
 * won't render.
 */
export async function markdownToPdf(markdown: string): Promise<Uint8Array> {
  const content = blocks(marked.lexer(markdown));
  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [PAGE_MARGIN, PAGE_MARGIN, PAGE_MARGIN, PAGE_MARGIN],
    defaultStyle: { font: "Roboto", fontSize: 10.5, lineHeight: 1.3 },
    content: content.length ? content : [{ text: " " }],
  };

  return new Promise<Uint8Array>((resolve, reject) => {
    try {
      pdfMake.createPdf(doc, {}, FONTS, vfs()).getBuffer((buf: Uint8Array) => resolve(buf));
    } catch (err) {
      reject(err);
    }
  });
}
