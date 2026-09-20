import { marked, type Token, type Tokens } from "marked";
// The browser build bundles cleanly with esbuild (no filesystem font lookups)
// and works in the Node extension host.
import pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { COURIER_AFM } from "./courierAfm";
import {
  EMOJI_CHARS,
  EMOJI_FONT_BASE64,
  SUPPORTED_RANGES,
  SYMBOL_CHARS,
  SYMBOL_FONT_BASE64,
} from "./pdfFonts.generated";

const ACCENT = "#b4552d";
const MUTED = "#555555";
const PANEL = "#f3f0ec";
const RULE = "#999999";

// A4 is 595pt wide; the page margins leave this much for content.
const PAGE_MARGIN = 56;
const PAGE_CONTENT_WIDTH = 595 - PAGE_MARGIN * 2;

const HEADING_SIZE = [0, 22, 17, 14, 12, 11, 11];
const BASE_SIZE = 10.5;
const CODE_SIZE = 9;
// Courier is 0.6em wide; leave room for the code block's own padding.
const CODE_WRAP_COLS = Math.floor((PAGE_CONTENT_WIDTH - 20) / (CODE_SIZE * 0.6));
// Generous, but stops a pathological document from hanging the editor.
const RENDER_TIMEOUT_MS = 120_000;

type Run = Record<string, unknown>;
type Style = Run;

export interface PdfResult {
  data: Uint8Array;
  /** Distinct characters no bundled font can draw (drawn as □ instead). */
  unsupported: string[];
}

/* -------------------------------------------------------------------- fonts */

/**
 * Roboto (from pdfmake) covers Latin/Greek/Cyrillic. Symbols and Emoji are
 * small generated fallbacks; Courier is a built-in standard font whose
 * metrics file we add ourselves. Everything is passed straight to createPdf,
 * so nothing depends on browser globals.
 */
const FONTS = {
  Roboto: {
    normal: "Roboto-Regular.ttf",
    bold: "Roboto-Medium.ttf",
    italics: "Roboto-Italic.ttf",
    bolditalics: "Roboto-MediumItalic.ttf",
  },
  Courier: { normal: "Courier", bold: "Courier", italics: "Courier", bolditalics: "Courier" },
  Symbols: {
    normal: "Symbols.ttf",
    bold: "Symbols.ttf",
    italics: "Symbols.ttf",
    bolditalics: "Symbols.ttf",
  },
  Emoji: {
    normal: "Emoji.ttf",
    bold: "Emoji.ttf",
    italics: "Emoji.ttf",
    bolditalics: "Emoji.ttf",
  },
};

let vfsCache: Record<string, string> | undefined;
function vfs(): Record<string, string> {
  if (!vfsCache) {
    const base = (pdfFonts as { pdfMake?: { vfs: Record<string, string> } }).pdfMake?.vfs;
    vfsCache = {
      ...(base ?? (pdfFonts as unknown as Record<string, string>)),
      "data/Courier.afm": COURIER_AFM,
      "Symbols.ttf": SYMBOL_FONT_BASE64,
      "Emoji.ttf": EMOJI_FONT_BASE64,
    };
  }
  return vfsCache;
}

/* --------------------------------------------------------------- characters */

const UNSUPPORTED_MARK = String.fromCodePoint(0x25a1); // white square, from the Symbols font

// Joiners, selectors, skin-tone and tag modifiers: the monochrome emoji font
// has no ligatures for them, so they'd print as boxes. Drop them.
const INVISIBLE = new RegExp(
  "[" +
    [0xfe0e, 0xfe0f, 0x200d, 0x20e3].map((cp) => String.fromCodePoint(cp)).join("") +
    "\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]",
  "gu",
);
// Characters Courier (WinAnsi) can print beyond Latin-1.
const WIN_ANSI_EXTRA = new Set(
  [..."€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ"].map((c) => c.codePointAt(0)!),
);

// A flag is two regional-indicator letters; the monochrome font can't draw it,
// so show the country code instead.
const FLAG = /([\u{1F1E6}-\u{1F1FF}])([\u{1F1E6}-\u{1F1FF}])/gu;

function isSupported(cp: number): boolean {
  if (cp < 0x20 || cp === 0x7f) return true; // control chars are handled elsewhere
  let lo = 0;
  let hi = SUPPORTED_RANGES.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < SUPPORTED_RANGES[mid * 2]) hi = mid - 1;
    else if (cp > SUPPORTED_RANGES[mid * 2 + 1]) lo = mid + 1;
    else return true;
  }
  return false;
}

type Face = "base" | "symbols" | "emoji";

function faceOf(ch: string): Face {
  if (SYMBOL_CHARS.test(ch)) return "symbols";
  if (EMOJI_CHARS.test(ch)) return "emoji";
  return "base";
}

/**
 * Split text into runs so every character is drawn by a font that has it:
 * the run's own font (Roboto, or Courier for code) for normal text, Symbols
 * for arrows and friends, Emoji for emoji. Characters nothing can draw become □.
 */
function shape(text: string, style: Style, seen: Set<string>): Run[] {
  const monospace = style.font === "Courier";
  const clean = text
    .replace(FLAG, (_m, a: string, b: string) =>
      String.fromCharCode(a.codePointAt(0)! - 0x1f1e6 + 65, b.codePointAt(0)! - 0x1f1e6 + 65),
    )
    .replace(INVISIBLE, "")
    .replace(/\t/g, monospace ? "    " : " ");
  const runs: Run[] = [];
  let face: Face | undefined;
  let buf = "";

  const flush = () => {
    if (!buf) return;
    const run: Run = { ...style, text: buf };
    if (face === "symbols") run.font = "Symbols";
    else if (face === "emoji") run.font = "Emoji";
    else if (monospace && [...buf].some((c) => !courierCan(c.codePointAt(0)!))) run.font = "Roboto";
    runs.push(run);
    buf = "";
  };

  for (const ch of clean) {
    const cp = ch.codePointAt(0)!;
    let out = ch;
    let f: Face;
    if (/\s/.test(ch)) {
      // The Symbols/Emoji fonts have no space glyph, so whitespace always
      // goes to the normal font.
      f = "base";
    } else if (!isSupported(cp)) {
      seen.add(ch);
      out = UNSUPPORTED_MARK;
      f = "symbols";
    } else {
      f = faceOf(ch);
    }
    if (f !== face) flush();
    face = f;
    buf += out;
  }
  flush();
  return runs;
}

function courierCan(cp: number): boolean {
  return cp <= 0xff || WIN_ANSI_EXTRA.has(cp);
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
  return s.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, "");
}

/** Only these are turned into clickable links; anything else stays inert text. */
function safeHref(href: string): string | undefined {
  return /^(https?:|mailto:)/i.test(href.trim()) ? href.trim() : undefined;
}


const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);

/**
 * Give very long unbroken strings (URLs, hashes) somewhere to wrap so they
 * can't run off the right edge of the page.
 */
function breakLongWords(s: string, max = 40): string {
  return s.replace(new RegExp(`\\S{${max + 1},}`, "gu"), (w) =>
    w.replace(new RegExp(`(.{${max}})`, "gu"), "$1" + ZERO_WIDTH_SPACE),
  );
}

/* ---------------------------------------------------------------- converter */

class Converter {
  readonly unsupported = new Set<string>();

  /* ---- inline ---- */

  private leaf(text: string, style: Style): Run[] {
    return shape(text, style, this.unsupported);
  }

  inline(tokens: Token[] | undefined, style: Style = {}): Run[] {
    const out: Run[] = [];
    for (const t of tokens ?? []) {
      switch (t.type) {
        case "text": {
          const tt = t as Tokens.Text;
          if (tt.tokens?.length) out.push(...this.inline(tt.tokens, style));
          // A soft line break in the source is just a space in the output.
          else
            out.push(
              ...this.leaf(breakLongWords(unescapeHtml(tt.text).replace(/\s*\n\s*/g, " ")), style),
            );
          break;
        }
        case "escape":
          out.push(...this.leaf(unescapeHtml((t as Tokens.Escape).text), style));
          break;
        case "strong":
          out.push(...this.inline((t as Tokens.Strong).tokens, { ...style, bold: true }));
          break;
        case "em":
          out.push(...this.inline((t as Tokens.Em).tokens, { ...style, italics: true }));
          break;
        case "del":
          out.push(
            ...this.inline((t as Tokens.Del).tokens, { ...style, decoration: "lineThrough" }),
          );
          break;
        case "codespan":
          out.push(
            ...this.leaf(
              breakLongWords(unescapeHtml((t as Tokens.Codespan).text).replace(/\s*\n\s*/g, " ")),
              { ...style, font: "Courier", background: PANEL },
            ),
          );
          break;
        case "link": {
          const l = t as Tokens.Link;
          const href = safeHref(l.href);
          out.push(
            ...this.inline(
              l.tokens,
              href ? { ...style, link: href, color: ACCENT, decoration: "underline" } : style,
            ),
          );
          break;
        }
        case "image": {
          // Images aren't embedded; keep the alt text so nothing vanishes.
          const alt = unescapeHtml((t as Tokens.Image).text || "image");
          out.push(...this.leaf(`[${alt}]`, { ...style, italics: true, color: MUTED }));
          break;
        }
        case "br":
          out.push({ ...style, text: "\n" });
          break;
        case "html": {
          const raw = (t as Tokens.HTML).text;
          // Inline HTML tags are dropped, except a line break.
          if (/^<br\s*\/?>$/i.test(raw.trim())) out.push({ ...style, text: "\n" });
          break;
        }
        default: {
          const raw = (t as { raw?: string }).raw;
          if (raw) out.push(...this.leaf(unescapeHtml(stripTags(raw)), style));
        }
      }
    }
    return out;
  }

  private textNode(tokens: Token[] | undefined, extra: Run = {}): Content {
    const runs = this.inline(tokens);
    return { text: runs.length ? runs : "", ...extra } as Content;
  }

  /* ---- measuring, for table column widths ---- */

  /** Approximate width in pt of each word in a cell, and whether it's code. */
  private words(tokens: Token[] | undefined): [number, boolean][] {
    const out: [number, boolean][] = [];
    const walk = (ts: Token[] | undefined) => {
      for (const t of ts ?? []) {
        const inner = (t as { tokens?: Token[] }).tokens;
        if (t.type === "codespan") {
          for (const w of unescapeHtml((t as Tokens.Codespan).text).split(/\s+/))
            out.push([[...w].length * BASE_SIZE * 0.6, true]);
        } else if (inner?.length) {
          walk(inner);
        } else if (t.type === "text" || t.type === "escape" || t.type === "image") {
          for (const w of unescapeHtml((t as { text?: string }).text ?? "").split(/\s+/))
            out.push([[...w].length * BASE_SIZE * 0.55, false]);
        }
      }
    };
    walk(tokens);
    return out;
  }

  /* ---- block ---- */

  private codeBlock(text: string): Content {
    // Hard-wrap long lines: pdfmake can't break inside an unbroken line.
    const lines = text
      .replace(/\n$/, "")
      .replace(/\t/g, "    ")
      .split("\n")
      .flatMap((line) => {
        const chars = [...line];
        if (chars.length <= CODE_WRAP_COLS) return [line];
        const parts: string[] = [];
        for (let i = 0; i < chars.length; i += CODE_WRAP_COLS)
          parts.push(chars.slice(i, i + CODE_WRAP_COLS).join(""));
        return parts;
      });
    const runs = this.leaf(lines.join("\n") || " ", { font: "Courier", fontSize: CODE_SIZE });
    return {
      table: {
        widths: ["*"],
        body: [[{ text: runs, preserveLeadingSpaces: true }]],
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
    } as unknown as Content;
  }

  private quote(children: Content[]): Content {
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

  private listItem(item: Tokens.ListItem): Content {
    const parts = this.blocks(item.tokens, true);
    if (item.task) {
      // The glyph comes from the Symbols font; the space after it must not.
      const box = [
        { text: String.fromCodePoint(item.checked ? 0x2611 : 0x2610), font: "Symbols" },
        { text: " " },
      ];
      const first = parts[0] as { text?: unknown };
      if (first && Array.isArray(first.text)) first.text = [...box, ...first.text];
      else if (first && typeof first.text === "string") first.text = [...box, { text: first.text }];
      else parts.unshift({ text: box } as Content);
    }
    if (parts.length === 0) return { text: " " } as Content;
    return parts.length === 1 ? parts[0] : ({ stack: parts } as Content);
  }

  private list(l: Tokens.List, nested: boolean): Content {
    const margin = nested ? [0, 0, 0, 0] : [0, 0, 0, 8];
    const items = l.items.map((i) => this.listItem(i));
    return (
      l.ordered
        ? { ol: items, start: typeof l.start === "number" ? l.start : 1, margin }
        : { ul: items, margin }
    ) as Content;
  }

  private table(t: Tokens.Table): Content {
    const cols = t.header.length;
    if (cols === 0) return { text: "" } as Content;

    const cell = (c: Tokens.TableCell | undefined, header: boolean, i: number): Content =>
      ({
        text: c ? this.inline(c.tokens, header ? { bold: true } : {}) : "",
        alignment: t.align[i] ?? "left",
        ...(header ? { fillColor: PANEL } : {}),
      }) as unknown as Content;

    // Size columns from their content so long words never push the table off
    // the page: each column gets at least its longest word, and the remaining
    // width is shared in proportion to how much text it holds.
    const PAD = 12;
    const available = PAGE_CONTENT_WIDTH - 1 - cols * 0.5;
    const minW: number[] = [];
    const idealW: number[] = [];
    for (let i = 0; i < cols; i++) {
      const cells = [t.header[i], ...t.rows.map((r) => r[i])].filter(Boolean) as Tokens.TableCell[];
      let longest = 0;
      let ideal = 0;
      for (const c of cells) {
        let line = 0;
        for (const [w, mono] of this.words(c.tokens)) {
          longest = Math.max(longest, w);
          line += w + (mono ? BASE_SIZE * 0.6 : BASE_SIZE * 0.3);
        }
        ideal = Math.max(ideal, line);
      }
      minW.push(Math.min(longest, available / 2) + PAD);
      idealW.push(Math.max(ideal + PAD, minW[i]));
    }

    const sumMin = minW.reduce((a, b) => a + b, 0);
    const sumIdeal = idealW.reduce((a, b) => a + b, 0);
    let widths: number[];
    if (sumMin >= available) {
      widths = minW.map((w) => (w / sumMin) * available);
    } else if (sumIdeal <= available) {
      widths = idealW.map((w) => (w / sumIdeal) * available); // fill the page
    } else {
      const spare = available - sumMin;
      const want = idealW.map((w, i) => w - minW[i]);
      const sumWant = want.reduce((a, b) => a + b, 0) || 1;
      widths = minW.map((w, i) => w + (want[i] / sumWant) * spare);
    }

    return {
      table: {
        headerRows: 1,
        // pdfmake adds the cell padding on top of these.
        widths: widths.map((w) => Math.max(w - PAD, 8)),
        body: [
          t.header.map((c, i) => cell(c, true, i)),
          ...t.rows.map((r) => t.header.map((_, i) => cell(r[i], false, i))),
        ],
      },
      layout: {
        hLineWidth: () => 0.5,
        vLineWidth: () => 0.5,
        hLineColor: () => RULE,
        vLineColor: () => RULE,
        paddingLeft: () => PAD / 2,
        paddingRight: () => PAD / 2,
        paddingTop: () => 4,
        paddingBottom: () => 4,
      },
      margin: [0, 2, 0, 10],
    } as Content;
  }

  blocks(tokens: Token[], tight = false): Content[] {
    const out: Content[] = [];
    for (const t of tokens) {
      switch (t.type) {
        case "heading": {
          const h = t as Tokens.Heading;
          out.push(
            this.textNode(h.tokens, {
              bold: true,
              fontSize: HEADING_SIZE[h.depth] ?? 11,
              margin: [0, h.depth === 1 ? 14 : 12, 0, 6],
            }),
          );
          break;
        }
        case "paragraph":
          out.push(
            this.textNode((t as Tokens.Paragraph).tokens, { margin: [0, 0, 0, tight ? 2 : 8] }),
          );
          break;
        case "text":
          // A bare text block inside a list item.
          out.push(this.textNode([t], { margin: [0, 0, 0, 2] }));
          break;
        case "list":
          out.push(this.list(t as Tokens.List, tight));
          break;
        case "code":
          out.push(this.codeBlock((t as Tokens.Code).text));
          break;
        case "blockquote":
          out.push(this.quote(this.blocks((t as Tokens.Blockquote).tokens)));
          break;
        case "table":
          out.push(this.table(t as Tokens.Table));
          break;
        case "hr":
          out.push({
            canvas: [
              {
                type: "line",
                x1: 0,
                y1: 0,
                x2: PAGE_CONTENT_WIDTH,
                y2: 0,
                lineWidth: 0.5,
                lineColor: RULE,
              },
            ],
            margin: [0, 8, 0, 8],
          } as Content);
          break;
        case "html": {
          // Keep line structure so words from neighbouring tags don't run together.
          const html = (t as Tokens.HTML).text
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/(p|div|summary|li|tr|h[1-6]|details|table)>/gi, "\n");
          const text = unescapeHtml(stripTags(html)).replace(/[ \t]+\n/g, "\n").trim();
          if (text)
            out.push({
              text: this.leaf(breakLongWords(text), {}),
              margin: [0, 0, 0, 8],
            } as unknown as Content);
          break;
        }
        default:
          break; // space, def, etc.
      }
    }
    return out;
  }
}

/* ------------------------------------------------------------------- public */

/**
 * Render Markdown to a PDF.
 *
 * Markdown -> tokens (marked, GFM) -> pdfmake document -> PDF bytes. Pure
 * JavaScript, fully local: no browser, no network. Text uses Roboto, with
 * small bundled fallbacks for arrows/symbols and (monochrome) emoji. Images
 * are not embedded (alt text is kept). Characters no bundled font can draw
 * (e.g. CJK) are drawn as □ and reported in `unsupported`.
 */
export async function markdownToPdf(markdown: string): Promise<PdfResult> {
  const converter = new Converter();
  const content = converter.blocks(marked.lexer(markdown));
  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [PAGE_MARGIN, PAGE_MARGIN, PAGE_MARGIN, PAGE_MARGIN],
    defaultStyle: { font: "Roboto", fontSize: BASE_SIZE, lineHeight: 1.3 },
    content: content.length ? content : [{ text: " " }],
  };

  const data = await new Promise<Uint8Array>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The PDF took too long to build — is the file very large?")),
      RENDER_TIMEOUT_MS,
    );
    try {
      pdfMake.createPdf(doc, {}, FONTS, vfs()).getBuffer((buf: Uint8Array) => {
        clearTimeout(timer);
        resolve(buf);
      });
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });

  return { data, unsupported: [...converter.unsupported] };
}
