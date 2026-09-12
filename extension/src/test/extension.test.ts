import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

// A real 1x1 PNG.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "doc-converter-test-"));
}

async function waitForFile(p: string, ms = 20000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (fs.existsSync(p) && fs.statSync(p).size > 0) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${p}`);
}

suite("Doc Converter", () => {
  suiteSetup(async () => {
    await vscode.workspace
      .getConfiguration("docConverter")
      .update("openAfterConvert", false, vscode.ConfigurationTarget.Global);
    await vscode.extensions.getExtension("i-mus.doc-converter")?.activate();
  });

  test("commands are registered", async () => {
    const cmds = await vscode.commands.getCommands(true);
    assert.ok(cmds.includes("docConverter.mdToDocx"));
    assert.ok(cmds.includes("docConverter.imagesToPdf"));
  });

  test("Markdown -> DOCX writes a valid file with list numbering", async () => {
    const dir = tmpDir();
    const md = path.join(dir, "note.md");
    fs.writeFileSync(
      md,
      "# Title\n\n- one\n- two\n  - nested\n\n1. first\n2. second\n\n| A | B |\n| - | - |\n| 1 | 2 |\n",
    );

    await vscode.commands.executeCommand(
      "docConverter.mdToDocx",
      vscode.Uri.file(md),
    );

    const out = path.join(dir, "note.docx");
    await waitForFile(out);
    const buf = fs.readFileSync(out);
    assert.strictEqual(buf.subarray(0, 2).toString("latin1"), "PK", "not a zip");
    assert.ok(
      buf.includes(Buffer.from("word/numbering.xml")),
      "expected list numbering in the docx",
    );
  });

  test("Unsaved Markdown buffer prompts for a save location", async () => {
    const dir = tmpDir();
    const dest = path.join(dir, "picked.docx");

    const doc = await vscode.workspace.openTextDocument({
      language: "markdown",
      content: "# Untitled\n\n- a\n- b\n",
    });
    await vscode.window.showTextDocument(doc);
    assert.strictEqual(doc.uri.scheme, "untitled");

    const original = vscode.window.showSaveDialog;
    (vscode.window as unknown as Record<string, unknown>).showSaveDialog = async () =>
      vscode.Uri.file(dest);
    try {
      await vscode.commands.executeCommand("docConverter.mdToDocx");
    } finally {
      (vscode.window as unknown as Record<string, unknown>).showSaveDialog = original;
    }

    await waitForFile(dest);
    const buf = fs.readFileSync(dest);
    assert.strictEqual(buf.subarray(0, 2).toString("latin1"), "PK");
  });

  test("Images -> PDF combines the selection", async () => {
    const dir = tmpDir();
    const a = path.join(dir, "a.png");
    const b = path.join(dir, "b.png");
    fs.writeFileSync(a, PNG_1x1);
    fs.writeFileSync(b, PNG_1x1);

    await vscode.commands.executeCommand(
      "docConverter.imagesToPdf",
      vscode.Uri.file(a),
      [vscode.Uri.file(a), vscode.Uri.file(b)],
    );

    const out = path.join(dir, "images.pdf");
    await waitForFile(out);
    const buf = fs.readFileSync(out);
    assert.strictEqual(buf.subarray(0, 4).toString("latin1"), "%PDF");
  });
});
