/* Headless check of the conversion functions (no VS Code host). */
import { writeFileSync } from "fs";
import http from "http";
import sharp from "sharp";
import { markdownToDocx } from "../src/convert/markdown";
import { imagesToPdf } from "../src/convert/images";
import { markdownToPdf } from "../src/convert/markdownPdf";

const md = [
  "# Title",
  "",
  "Some **bold** and *italic* text with `code`.",
  "",
  "- one",
  "- two",
  "  - nested",
  "",
  "1. first",
  "2. second",
  "",
  "| A | B |",
  "| - | - |",
  "| 1 | 2 |",
  "",
  "> A quote.",
  "",
  "[a link](https://example.com)",
  "",
].join("\n");

async function main(): Promise<number> {
  let failures = 0;

  const png = await sharp({
    create: { width: 6, height: 4, channels: 3, background: "#4488cc" },
  }).png().toBuffer();
  const jpg = await sharp({
    create: { width: 4, height: 6, channels: 3, background: "#cc4444" },
  }).jpeg().toBuffer();

  const docx = await markdownToDocx(md);
  writeFileSync("smoke.docx", docx);
  const docxOk = docx.subarray(0, 2).toString("latin1") === "PK";
  console.log(`docx  ${docx.length} bytes  ${docxOk ? "OK (zip)" : "BAD"}`);
  if (!docxOk) failures++;

  // Lists must produce a numbering definition, not plain paragraphs.
  // The zip's central directory stores entry names as plain text.
  const listsOk = docx.includes(Buffer.from("word/numbering.xml"));
  console.log(`list  numbering.xml ${listsOk ? "present  OK" : "MISSING  BAD"}`);
  if (!listsOk) failures++;

  const mdPdf = await markdownToPdf(md).then((r) => r.data);
  writeFileSync("smoke-md.pdf", mdPdf);
  const mdPdfOk = Buffer.from(mdPdf.subarray(0, 4)).toString("latin1") === "%PDF";
  console.log(`mdpdf ${mdPdf.length} bytes  ${mdPdfOk ? "OK" : "BAD"}`);
  if (!mdPdfOk) failures++;

  const pdf = await imagesToPdf([
    { name: "a.png", data: png },
    { name: "b.jpg", data: jpg },
  ]);
  writeFileSync("smoke.pdf", pdf);
  const pdfOk = Buffer.from(pdf.subarray(0, 4)).toString("latin1") === "%PDF";
  console.log(`pdf   ${pdf.length} bytes  ${pdfOk ? "OK" : "BAD"}`);
  if (!pdfOk) failures++;


  // Privacy promise: converting must never touch the network, even when the
  // Markdown points at remote images (including local/private addresses).
  {
    const hits: string[] = [];
    const server = http.createServer((req, res) => {
      hits.push(req.url ?? "");
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const probe = `![x](http://127.0.0.1:${port}/a.png)

<img src="http://127.0.0.1:${port}/b.png" alt="y">
`;
    await markdownToDocx(probe);
    await markdownToPdf(probe);
    server.close();
    const quiet = hits.length === 0;
    console.log(`net   ${quiet ? "no requests made  OK" : "REQUESTS: " + hits.join(",") + "  BAD"}`);
    if (!quiet) failures++;
  }

  // Symbols and emoji must be drawable; scripts no bundled font has must be reported.
  {
    const arrow = String.fromCodePoint(0x2192);
    const check = String.fromCodePoint(0x2713);
    const rocket = String.fromCodePoint(0x1f680);
    const cjk = String.fromCodePoint(0x4f60);
    const ok = await markdownToPdf(`${arrow} ${check} ${rocket} caf${String.fromCodePoint(0xe9)}`);
    const bad = await markdownToPdf(`${cjk} text`);
    const good = ok.unsupported.length === 0 && bad.unsupported.join("") === cjk;
    console.log(`glyph symbols/emoji drawable, CJK reported  ${good ? "OK" : "BAD"}`);
    if (!good) failures++;
  }

  return failures;
}

main().then((n) => process.exit(n));
