/* Headless check of the conversion functions (no VS Code host). */
import { writeFileSync } from "fs";
import sharp from "sharp";
import { markdownToDocx } from "../src/convert/markdown";
import { imagesToPdf } from "../src/convert/images";

const md = [
  "# Title",
  "",
  "Some **bold** and *italic* text with `code`.",
  "",
  "- one",
  "- two",
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

  const pdf = await imagesToPdf([
    { name: "a.png", data: png },
    { name: "b.jpg", data: jpg },
  ]);
  writeFileSync("smoke.pdf", pdf);
  const pdfOk = Buffer.from(pdf.subarray(0, 4)).toString("latin1") === "%PDF";
  console.log(`pdf   ${pdf.length} bytes  ${pdfOk ? "OK" : "BAD"}`);
  if (!pdfOk) failures++;

  return failures;
}

main().then((n) => process.exit(n));
